// ─── Incidentes de servidor: registro, reinício e avisos (CloudDesk) ──────────
// Fluxo (Bloco 2, modo sombra):
//   1. A IA confirma que o servidor do cliente caiu (server-health.ts) →
//      openOrJoinIncident: um incidente por servidor, cada conversa ligada.
//   2. O painel mostra o alerta; o operador confirma → requestRestart('manual').
//      Com SERVER_RESTART_AUTO_MINUTES definido, o monitor envia sozinho depois
//      desse tempo sem confirmação ('auto'). Sem o secret, só manual.
//   3. O monitor testa de novo; voltou → avisa cada cliente na conversa dele.
//
// Tudo desligado sem SERVER_INCIDENTS=on — o Bloco 1 pode ir para produção
// antes. Texto para o cliente: sem servidor, provedor, Portainer ou culpa.

import type { ServiceClient } from './supabase.ts';
import { broadcastToConversation } from './broadcast.ts';
import { sendServerRestart, type InfraServer, type ServerVerdict } from './server-health.ts';

export function serverIncidentsEnabled(): boolean {
  return Deno.env.get('SERVER_INCIDENTS') === 'on';
}

/** Minutos sem confirmação até o reinício automático. null = só manual. */
export function autoRestartMinutes(): number | null {
  const v = Number(Deno.env.get('SERVER_RESTART_AUTO_MINUTES'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Nunca dois reinícios do mesmo servidor em menos que isso. */
export const RESTART_COOLDOWN_MIN = 30;
/** Depois do reinício, quanto esperar antes de dar o incidente como não resolvido. */
export const RECOVERY_DEADLINE_MIN = 30;

const OPEN_STATUSES = ['detected', 'restart_sent'];

// ─── Textos para o cliente ───────────────────────────────────────────────────

export function incidentDetectedReply(label: string): string {
  return (
    `Testei agora e confirmei uma instabilidade no ambiente da ${label}. Já acionei a correção.\n\n` +
    `Normalmente volta em 20 a 30 minutos. Vou acompanhando daqui e, assim que estiver tudo no ar, ` +
    `te aviso nesta conversa — não precisa fazer nada por enquanto.`
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
  mode: 'manual' | 'auto',
  requestedBy: string | null,
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

  // Reserva o incidente ANTES de enviar: dois cliques (ou clique + automático)
  // não podem gerar dois reinícios.
  const now = new Date().toISOString();
  const { data: claimed } = await supabase
    .from('desk_server_incidents')
    .update({ status: 'restart_sent', restart_sent_at: now, restart_mode: mode, restart_requested_by: requestedBy, updated_at: now })
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
  console.log(`[incidents] reinício enviado: ${inc.server_name} (${mode})`);
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
