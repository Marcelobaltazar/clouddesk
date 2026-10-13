// ─── desk-server-incidents — ações do operador sobre incidentes de servidor ────
//
// Só operadores. O painel lê os incidentes direto da tabela (RLS de agente);
// o que muda estado passa por aqui, com service role:
//
//   restart → envia o reinício do servidor (formulário interno da equipe).
//             Respeita o intervalo mínimo entre reinícios do mesmo servidor e
//             nunca envia duas vezes (o incidente é reservado antes do envio).
//   dismiss → "Não é o caso": encerra o incidente sem reiniciar.
//
// Tudo desligado sem SERVER_INCIDENTS=on.

import { corsHeaders } from '../_shared/cors.ts';
import { newServiceClient } from '../_shared/supabase.ts';
import { verifyOperator } from '../_shared/widget-auth.ts';
import { dismissIncident, requestRestart, serverIncidentsEnabled } from '../_shared/server-incidents.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface Body {
  action?: 'restart' | 'dismiss';
  incident_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const operatorAuthId = await verifyOperator(req);
    if (!operatorAuthId) return json({ error: 'Acesso restrito a operadores' }, 401);
    if (!serverIncidentsEnabled()) return json({ error: 'Incidentes de servidor estão desligados (SERVER_INCIDENTS)' }, 409);

    const body: Body = await req.json().catch(() => ({}));
    if (!body.incident_id || !UUID_RE.test(body.incident_id)) return json({ error: 'incident_id inválido' }, 400);

    const supabase = newServiceClient();

    if (body.action === 'restart') {
      const result = await requestRestart(supabase, body.incident_id, 'manual', operatorAuthId);
      return result.ok ? json({ ok: true }) : json({ error: result.error }, 409);
    }

    if (body.action === 'dismiss') {
      const result = await dismissIncident(supabase, body.incident_id);
      return result.ok ? json({ ok: true }) : json({ error: result.error }, 409);
    }

    return json({ error: 'Ação desconhecida' }, 400);
  } catch (e) {
    console.error('[desk-server-incidents]', e instanceof Error ? e.message : e);
    return json({ error: 'Erro interno' }, 500);
  }
});
