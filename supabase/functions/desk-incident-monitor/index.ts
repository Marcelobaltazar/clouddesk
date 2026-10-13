// ─── desk-incident-monitor — acompanha os incidentes de servidor abertos ───────
//
// Chamado por um agendador a cada ~2 minutos. Sem incidente aberto, é uma
// consulta e acabou (nada é gravado). Para cada incidente aberto:
//
//   • servidor respondeu → testa o n8n de cada infra ligada; a que voltou recebe
//     o aviso "Voltou!" na conversa. Todas avisadas → incidente resolvido.
//   • ainda fora e aguardando o operador → com SERVER_RESTART_AUTO_MINUTES
//     definido e o tempo vencido, envia o reinício sozinho ('auto').
//   • reinício enviado há mais de RECOVERY_DEADLINE_MIN e ainda fora →
//     incidente não resolvido; cada cliente ainda sem aviso recebe uma
//     atualização honesta e a conversa vai para a equipe.
//
// Auth: chave de serviço OU cabeçalho x-monitor-secret = INCIDENT_MONITOR_SECRET
// (para um agendador externo não precisar da chave de serviço).
// Tudo desligado sem SERVER_INCIDENTS=on.

import { corsHeaders } from '../_shared/cors.ts';
import { newServiceClient, type ServiceClient } from '../_shared/supabase.ts';
import { isServiceRoleRequest, timingSafeEqual } from '../_shared/widget-auth.ts';
import { broadcastToConversation } from '../_shared/broadcast.ts';
import { portainerResponds } from '../_shared/server-health.ts';
import {
  autoRestartMinutes,
  incidentRecoveredReply,
  incidentUnresolvedReply,
  postBotMessage,
  RECOVERY_DEADLINE_MIN,
  requestRestart,
  serverIncidentsEnabled,
} from '../_shared/server-incidents.ts';
import { humanReplyWindow } from '../_shared/support-sla.ts';

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface Incident {
  id: string;
  server_name: string;
  portainer_url: string;
  status: 'detected' | 'restart_sent';
  detected_at: string;
  restart_sent_at: string | null;
}

interface Link {
  conversation_id: string;
  infra_name: string | null;
  notified_at: string | null;
}

const INFRA_NAME_RE = /^[a-z0-9-]{1,63}$/;

async function n8nResponds(infraName: string): Promise<boolean> {
  if (!INFRA_NAME_RE.test(infraName)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(`https://${infraName}-n8n.cloudfy.live`, { method: 'GET', redirect: 'follow', signal: controller.signal });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const label = (infraName: string | null) => infraName ? `sua infraestrutura **${infraName}**` : 'sua infraestrutura';
const minutesSince = (iso: string | null) => iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : 0;

async function handleIncident(supabase: ServiceClient, inc: Incident): Promise<string> {
  const serverOk = await portainerResponds(inc.portainer_url);
  const now = new Date().toISOString();
  await supabase.from('desk_server_incidents').update({ last_check_at: now, last_check_ok: serverOk, updated_at: now }).eq('id', inc.id);

  const { data: linkRows } = await supabase
    .from('desk_server_incident_conversations')
    .select('conversation_id, infra_name, notified_at')
    .eq('incident_id', inc.id);
  const pending = ((linkRows ?? []) as Link[]).filter((l) => !l.notified_at);

  const markNotified = (conversationId: string) => supabase.from('desk_server_incident_conversations')
    .update({ notified_at: new Date().toISOString() })
    .eq('incident_id', inc.id).eq('conversation_id', conversationId);

  let stillPending = pending;
  if (serverOk) {
    // Servidor de pé não garante a stack de pé: avisa só quem já tem o n8n de volta.
    const left: Link[] = [];
    for (const link of pending) {
      const back = !!link.infra_name && await n8nResponds(link.infra_name);
      if (back && await postBotMessage(supabase, link.conversation_id, incidentRecoveredReply(label(link.infra_name)))) {
        await markNotified(link.conversation_id);
      } else {
        left.push(link);
      }
    }
    stillPending = left;
    if (stillPending.length === 0) {
      await supabase.from('desk_server_incidents')
        .update({ status: 'recovered', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', inc.id);
      return `${inc.server_name}: voltou (${pending.length} aviso(s))`;
    }
  }

  if (!serverOk && inc.status === 'detected') {
    const auto = autoRestartMinutes();
    if (auto !== null && minutesSince(inc.detected_at) >= auto) {
      const r = await requestRestart(supabase, inc.id, 'auto', null);
      return `${inc.server_name}: reinício automático ${r.ok ? 'enviado' : `não enviado (${r.error})`}`;
    }
  }

  // Prazo vencido (contado do reinício, ou da detecção se ninguém reiniciou):
  // quem ainda não teve o serviço de volta recebe uma atualização honesta e a
  // conversa vai para a equipe. Nunca deixar o cliente sem notícia depois de
  // ter ouvido "volta em 20 a 30 minutos".
  const since = minutesSince(inc.restart_sent_at ?? inc.detected_at);
  if (since >= RECOVERY_DEADLINE_MIN && stillPending.length > 0) {
    const window = humanReplyWindow();
    for (const link of stillPending) {
      await postBotMessage(supabase, link.conversation_id, incidentUnresolvedReply(window));
      await markNotified(link.conversation_id);
      await supabase.from('desk_conversations')
        .update({ status: 'pending', ai_active: false, priority: 'urgent' })
        .eq('id', link.conversation_id);
      void broadcastToConversation(link.conversation_id, 'conv_updated', { status: 'pending', ai_active: false });
    }
    // Servidor ok → o que sobrou é da stack do cliente: o incidente de servidor
    // termina. Reinício enviado e servidor fora → não resolvido. Ninguém
    // reiniciou ainda → continua aguardando o operador no painel.
    const next = serverOk ? 'recovered' : inc.status === 'restart_sent' ? 'unresolved' : null;
    if (next) {
      await supabase.from('desk_server_incidents')
        .update({ status: next, resolved_at: next === 'recovered' ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq('id', inc.id);
    }
    return `${inc.server_name}: prazo de ${RECOVERY_DEADLINE_MIN} min vencido — ${stillPending.length} conversa(s) com a equipe`;
  }

  return `${inc.server_name}: ${serverOk ? 'servidor ok, aguardando serviços' : inc.status === 'detected' ? 'fora, aguardando confirmação' : 'aguardando o reinício fazer efeito'}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const secret = Deno.env.get('INCIDENT_MONITOR_SECRET');
  const given = req.headers.get('x-monitor-secret') ?? '';
  const allowed = (secret && given && timingSafeEqual(given, secret)) || (await isServiceRoleRequest(req));
  if (!allowed) return json({ error: 'unauthorized' }, 401);
  if (!serverIncidentsEnabled()) return json({ ok: true, skipped: 'SERVER_INCIDENTS desligado' });

  try {
    const supabase = newServiceClient();
    const { data, error } = await supabase
      .from('desk_server_incidents')
      .select('id, server_name, portainer_url, status, detected_at, restart_sent_at')
      .in('status', ['detected', 'restart_sent']);
    if (error) return json({ error: error.message }, 500);

    const incidents = (data ?? []) as Incident[];
    const report: string[] = [];
    for (const inc of incidents) report.push(await handleIncident(supabase, inc));
    if (report.length > 0) console.log('[monitor]', report.join(' | '));
    return json({ ok: true, open: incidents.length, report });
  } catch (e) {
    console.error('[monitor]', e instanceof Error ? e.message : e);
    return json({ error: 'Erro interno' }, 500);
  }
});
