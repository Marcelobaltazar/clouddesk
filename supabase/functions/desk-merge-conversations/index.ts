// ─── desk-merge-conversations — mesclar chamados do mesmo cliente ──────────────
//
// Feature "Mesclar com..." do painel (estilo Intercom). Só operadores.
// Ações:
//   list  → lista as OUTRAS conversas do mesmo cliente (abertas e resolvidas),
//           para o buscador do dialog.
//   merge → mescla a conversa ATUAL (source) para dentro da ESCOLHIDA (target):
//           gera um resumo por IA da conversa absorvida, move as mensagens/tags/
//           CSAT e marca a source como 'merged'. Tudo atômico na função SQL.
//
// SEGURANÇA: valida operador autenticado + que source e target são do MESMO
// cliente (mesmo user_email) — nunca mistura clientes diferentes.

import { corsHeaders } from '../_shared/cors.ts';
import { newServiceClient } from '../_shared/supabase.ts';
import { verifyOperator } from '../_shared/widget-auth.ts';
import { summarizeConversation } from '../_shared/ai-pipeline.ts';

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Body {
  action?: 'list' | 'merge';
  conversation_id?: string;   // conversa atual (contexto)
  source_id?: string;         // absorvida (merge)
  target_id?: string;         // destino (merge)
  agent_name?: string;
}

interface ConvRow {
  id: string;
  status: string;
  subject: string | null;
  user_email: string | null;
  created_at: string;
  updated_at: string;
  channel: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const operatorId = await verifyOperator(req);
    if (!operatorId) return json({ error: 'Apenas operadores autenticados' }, 401);

    const body: Body = await req.json().catch(() => ({}));
    const service = newServiceClient();

    // ── LIST: outras conversas do mesmo cliente ────────────────────────────────
    if (body.action === 'list') {
      if (!body.conversation_id || !UUID_RE.test(body.conversation_id)) {
        return json({ error: 'conversation_id inválido' }, 400);
      }

      const { data: current } = await service
        .from('desk_conversations')
        .select('id, user_email')
        .eq('id', body.conversation_id)
        .maybeSingle();

      const email = (current as { user_email?: string } | null)?.user_email;
      if (!email) return json({ conversations: [] });

      // Mesmo e-mail, exceto a atual e as já mescladas. Abertas E resolvidas.
      const { data, error } = await service
        .from('desk_conversations')
        .select('id, status, subject, user_email, created_at, updated_at, channel')
        .ilike('user_email', email)
        .neq('id', body.conversation_id)
        .neq('status', 'merged')
        .order('updated_at', { ascending: false })
        .limit(50);

      if (error) return json({ error: error.message }, 500);

      const rows = (data ?? []) as unknown as ConvRow[];
      // Última mensagem (prévia) de cada conversa
      const ids = rows.map((r) => r.id);
      const previews: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: msgs } = await service
          .from('desk_messages')
          .select('conversation_id, content, created_at')
          .in('conversation_id', ids)
          .eq('is_private_note', false)
          .order('created_at', { ascending: false });
        for (const m of (msgs ?? []) as Array<{ conversation_id: string; content: string }>) {
          if (!previews[m.conversation_id]) previews[m.conversation_id] = m.content.slice(0, 80);
        }
      }

      return json({
        conversations: rows.map((r) => ({ ...r, preview: previews[r.id] ?? '' })),
      });
    }

    // ── MERGE: source → target ──────────────────────────────────────────────────
    if (body.action === 'merge') {
      const { source_id, target_id } = body;
      if (!source_id || !target_id || !UUID_RE.test(source_id) || !UUID_RE.test(target_id)) {
        return json({ error: 'source_id / target_id inválidos' }, 400);
      }
      if (source_id === target_id) {
        return json({ error: 'Não é possível mesclar uma conversa com ela mesma' }, 400);
      }

      // Valida que as duas existem e são do MESMO cliente
      const { data: both } = await service
        .from('desk_conversations')
        .select('id, user_email, status')
        .in('id', [source_id, target_id]);

      const rows = (both ?? []) as Array<{ id: string; user_email: string | null; status: string }>;
      const src = rows.find((r) => r.id === source_id);
      const tgt = rows.find((r) => r.id === target_id);
      if (!src || !tgt) return json({ error: 'Conversa não encontrada' }, 404);
      if (tgt.status === 'merged') return json({ error: 'A conversa destino já foi mesclada em outra' }, 409);

      const eq = (a: string | null, b: string | null) =>
        (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
      if (!eq(src.user_email, tgt.user_email)) {
        return json({ error: 'As conversas são de clientes diferentes' }, 403);
      }

      // Resumo por IA da conversa ABSORVIDA (source), a partir do histórico dela.
      const { data: srcMsgs } = await service
        .from('desk_messages')
        .select('sender_type, content')
        .eq('conversation_id', source_id)
        .eq('is_private_note', false)
        .order('created_at', { ascending: true })
        .limit(60);

      const summary = await summarizeConversation(
        (srcMsgs ?? []) as Array<{ sender_type: string; content: string }>,
      ).catch(() => null);

      // Executa o merge atômico
      const { error: mergeErr } = await service.rpc('desk_merge_conversations', {
        p_source: source_id,
        p_target: target_id,
        p_agent_name: body.agent_name ?? null,
        p_summary_question: summary?.question ?? null,
        p_summary_bullets: summary?.summary ?? null,
      });

      if (mergeErr) {
        console.error('[merge] rpc falhou:', mergeErr.message);
        return json({ error: mergeErr.message }, 500);
      }

      return json({ ok: true, target_id, summary });
    }

    return json({ error: 'Ação inválida' }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[desk-merge-conversations] fatal:', msg);
    return json({ error: msg }, 500);
  }
});
