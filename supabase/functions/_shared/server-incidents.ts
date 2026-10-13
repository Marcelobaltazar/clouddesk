// ─── Incidentes de servidor: registro, reinício e avisos (CloudDesk) ──────────
// Fluxo (Bloco 2, modo sombra — decisões de 13/10/2026):
//   1. A IA confirma que o servidor do cliente caiu (server-health.ts) →
//      openOrJoinIncident: um incidente por servidor, cada conversa ligada.
//   2. O painel mostra o alerta; o reinício só sai pelo CLIQUE do operador
//      (requestRestart). Não existe reinício automático.
//   3. Sem agendador: quando o cliente volta a escrever, a IA testa de novo —
//      voltou → "Voltou!"; ainda fora → "em andamento"; passou do prazo →
//      atualização honesta e a conversa vai para a equipe (followUpIncident).
//
// Tudo desligado sem SERVER_INCIDENTS=on — o Bloco 1 pode ir para produção
// antes. Texto para o cliente: sem servidor, provedor, Portainer ou culpa.

import type { ServiceClient } from './supabase.ts';
import { broadcastToConversation } from './broadcast.ts';
import { sendServerRestart, type InfraServer, type ServerVerdict } from './server-health.ts';

export function serverIncidentsEnabled(): boolean {
  return Deno.env.get('SERVER_INCIDENTS') === 'on';
}

/** Nunca dois reinícios do mesmo servidor em menos que isso. */
export const RESTART_COOLDOWN_MIN = 30;
/** Passou disso (do reinício, ou da detecção se ninguém reiniciou) e o serviço
 *  do cliente não voltou → a conversa vai para a equipe. */
export const RECOVERY_DEADLINE_MIN = 30;

const OPEN_STATUSES = ['detected', 'restart_sent'];

// ─── Textos para o cliente ───────────────────────────────────────────────────
// Sem agendador não dá para avisar sozinho quando voltar — então a mensagem
// não promete isso: pede para o cliente testar e chamar de novo.

export function incidentDetectedReply(label: string): string {
  return (
    `Testei agora e confirmei uma instabilidade no ambiente da ${label}. Já acionei a correção.\n\n` +
    `Normalmente volta em 20 a 30 minutos. Depois disso é só testar aí — se ainda estiver fora, ` +
    `me chama aqui que eu verifico de novo na hora.`
  );
}

export function incidentStillDownReply(): string {
  return (
    `Testei de novo agora e ainda não normalizou — a correção está em andamento. ` +
    `Me chama daqui a uns minutinhos que eu testo outra vez.`
  );
}

export function incidentRecoveredReply(label: string): string {
  return (
    `Voltou! Testei agora e a ${label} está respondendo normalmente. ` +
    `Dá uma olhada aí e me fala se está tudo certo do seu lado?`
  );
}

export function incidentUnresolvedReply(replyWindow: string): string {
  return (
    `Atualizando: a correção ainda não terminou. Passei seu caso pra equipe acompanhar de perto — ` +
    `alguém te responde por aqui ${replyWindow}.`
  );
}

// ─── Registro ─────────────────────────────────────────────────────────────────

/** Abre o incidente do servidor (ou entra no que já está aberto) e liga a conversa. */
export async function openOrJoinIncident(
  supabase: ServiceClient,
  server: InfraServer,
  verdict: ServerVerdict,
  conversationId: string,
  infraName: string,
): Promise<{ incidentId: string; isNew: boolean } | null> {
  const findOpen = async (): Promise<string | null> => {
    const { data } = await supabase
      .from('desk_server_incidents')
      .select('id')
      .eq('server_id', server.serverId)
      .in('status', OPEN_STATUSES)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };

  let incidentId = await findOpen();
  let isNew = false;
  if (!incidentId) {
    const { data, error } = await supabase
      .from('desk_server_incidents')
      .insert({
        server_id: server.serverId,
        server_name: server.serverName,
        portainer_url: server.portainerUrl,
        evidence: { attempts: verdict.attempts, controls: verdict.controls, checked_at: new Date().toISOString() },
        last_check_at: new Date().toISOString(),
        last_check_ok: false,
      })
      .select('id')
      .single();
    if (error) {
      // 23505 = outro cliente do mesmo servidor abriu o incidente no mesmo instante
      if (error.code !== '23505') {
        console.error('[incidents] abrir incidente falhou:', error.message);
        return null;
      }
      incidentId = await findOpen();
    } else {
      incidentId = (data as { id: string }).id;
      isNew = true;
    }
  }
  if (!incidentId) return null;

  const { error: linkErr } = await supabase
    .from('desk_server_incident_conversations')
    .upsert(
      { incident_id: incidentId, conversation_id: conversationId, infra_name: infraName },
      { onConflict: 'incident_id,conversation_id', ignoreDuplicates: true },
    );
  if (linkErr) console.warn('[incidents] ligar conversa falhou:', linkErr.message);

  return { incidentId, isNew };
}

// ─── Reinício ─────────────────────────────────────────────────────────────────

export async function requestRestart(
  supabase: ServiceClient,
  incidentId: string,
  requestedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: incident } = await supabase
    .from('desk_server_incidents')
    .select('id, server_id, server_name, status')
    .eq('id', incidentId)
    .maybeSingle();
  const inc = incident as { id: string; server_id: number; server_name: string; status: string } | null;
  if (!inc) return { ok: false, error: 'Incidente não encontrado' };
  if (inc.status !== 'detected') return { ok: false, error: 'Este incidente não está aguardando reinício' };

  const since = new Date(Date.now() - RESTART_COOLDOWN_MIN * 60_000).toISOString();
  const { count } = await supabase
    .from('desk_server_incidents')
    .select('id', { count: 'exact', head: true })
    .eq('server_id', inc.server_id)
    .gt('restart_sent_at', since);
  if ((count ?? 0) > 0) return { ok: false, error: `Este servidor já foi reiniciado nos últimos ${RESTART_COOLDOWN_MIN} minutos` };

  // Reserva o incidente ANTES de enviar: dois operadores clicando ao mesmo
  // tempo não podem gerar dois reinícios.
  const now = new Date().toISOString();
  const { data: claimed } = await supabase
    .from('desk_server_incidents')
    .update({ status: 'restart_sent', restart_sent_at: now, restart_mode: 'manual', restart_requested_by: requestedBy, updated_at: now })
    .eq('id', incidentId)
    .eq('status', 'detected')
    .select('id');
  if (!claimed || (claimed as unknown[]).length === 0) return { ok: false, error: 'O reinício já foi enviado' };

  const result = await sendServerRestart(inc.server_name);
  if (!result.ok) {
    await supabase
      .from('desk_server_incidents')
      .update({ status: 'detected', restart_sent_at: null, restart_mode: null, restart_error: result.error ?? 'falha', updated_at: new Date().toISOString() })
      .eq('id', incidentId);
    console.error(`[incidents] reinício de ${inc.server_name} falhou: ${result.error}`);
    return { ok: false, error: `Não foi possível enviar o reinício: ${result.error}` };
  }
  await supabase.from('desk_server_incidents').update({ restart_error: null }).eq('id', incidentId);
  console.log(`[incidents] reinício enviado: ${inc.server_name} (operador)`);
  return { ok: true };
}

export async function dismissIncident(supabase: ServiceClient, incidentId: string): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('desk_server_incidents')
    .update({ status: 'dismissed', resolved_at: now, updated_at: now })
    .eq('id', incidentId)
    .in('status', [...OPEN_STATUSES, 'unresolved'])
    .select('id');
  return data && (data as unknown[]).length > 0 ? { ok: true } : { ok: false, error: 'Incidente já encerrado' };
}

// ─── Avisos aos clientes ──────────────────────────────────────────────────────

const MSG_SELECT = 'id, conversation_id, sender_type, content, created_at, ai_generated, is_private_note, metadata';

/** Mensagem da Luna numa conversa, já empurrada para o widget aberto. */
export async function postBotMessage(supabase: ServiceClient, conversationId: string, content: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('desk_messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'bot',
      content,
      ai_generated: true,
      content_type: 'text',
      is_private_note: false,
      metadata: {},
    })
    .select(MSG_SELECT)
    .single();
  if (error) {
    console.error('[incidents] aviso ao cliente falhou:', error.message);
    return false;
  }
  await supabase.from('desk_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
  void broadcastToConversation(conversationId, 'new_message', data as Record<string, unknown>);
  return true;
}

// ─── Acompanhamento sem agendador ─────────────────────────────────────────────
// O cliente volta a escrever numa conversa ligada a um incidente aberto → a IA
// testa o n8n dele de novo e responde com o desfecho, em vez de seguir o
// atendimento normal.

export interface ConversationIncident {
  incidentId: string;
  status: string;
  detectedAt: string;
  restartSentAt: string | null;
  infraName: string | null;
}

interface LinkRow {
  incident_id: string;
  infra_name: string | null;
  desk_server_incidents: { status: string; detected_at: string; restart_sent_at: string | null } | null;
}

/** Incidente aberto ligado a esta conversa e ainda sem desfecho para o cliente. */
export async function findOpenIncidentForConversation(
  supabase: ServiceClient,
  conversationId: string,
): Promise<ConversationIncident | null> {
  const { data, error } = await supabase
    .from('desk_server_incident_conversations')
    .select('incident_id, infra_name, desk_server_incidents!inner(status, detected_at, restart_sent_at)')
    .eq('conversation_id', conversationId)
    .is('notified_at', null)
    .in('desk_server_incidents.status', OPEN_STATUSES)
    .limit(1);
  if (error) {
    console.warn('[incidents] busca do incidente da conversa falhou:', error.message);
    return null;
  }
  const row = ((data ?? []) as unknown as LinkRow[])[0];
  if (!row?.desk_server_incidents) return null;
  return {
    incidentId: row.incident_id,
    status: row.desk_server_incidents.status,
    detectedAt: row.desk_server_incidents.detected_at,
    restartSentAt: row.desk_server_incidents.restart_sent_at,
    infraName: row.infra_name,
  };
}

export type FollowUpKind = 'recovered' | 'still_down' | 'deadline';

/** O que dizer ao cliente: voltou, ainda em correção, ou passou do prazo. */
export function decideFollowUp(
  inc: ConversationIncident,
  n8nOk: boolean,
  replyWindow: string,
  now = Date.now(),
): { kind: FollowUpKind; reply: string } {
  const label = inc.infraName ? `sua infraestrutura **${inc.infraName}**` : 'sua infraestrutura';
  if (n8nOk) return { kind: 'recovered', reply: incidentRecoveredReply(label) };
  const since = (now - new Date(inc.restartSentAt ?? inc.detectedAt).getTime()) / 60_000;
  if (since >= RECOVERY_DEADLINE_MIN) return { kind: 'deadline', reply: incidentUnresolvedReply(replyWindow) };
  return { kind: 'still_down', reply: incidentStillDownReply() };
}

/** Registra o desfecho da conversa e, se ninguém mais estiver esperando,
 *  fecha o incidente: voltou → resolvido; prazo vencido com reinício enviado →
 *  não resolvido; ninguém reiniciou ainda → segue no painel aguardando o operador. */
export async function settleIncidentConversation(
  supabase: ServiceClient,
  inc: ConversationIncident,
  conversationId: string,
  kind: Exclude<FollowUpKind, 'still_down'>,
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('desk_server_incident_conversations')
    .update({ notified_at: now })
    .eq('incident_id', inc.incidentId)
    .eq('conversation_id', conversationId);

  const { count } = await supabase
    .from('desk_server_incident_conversations')
    .select('conversation_id', { count: 'exact', head: true })
    .eq('incident_id', inc.incidentId)
    .is('notified_at', null);
  if ((count ?? 0) > 0) return;

  const next = kind === 'recovered' ? 'recovered' : inc.status === 'restart_sent' ? 'unresolved' : null;
  if (!next) return;
  await supabase
    .from('desk_server_incidents')
    .update({ status: next, resolved_at: next === 'recovered' ? now : null, updated_at: now })
    .eq('id', inc.incidentId)
    .in('status', OPEN_STATUSES);
}
