// ─── desk-ai-respond — copilot do OPERADOR (modo draft) ─────────────────────────
//
// Este endpoint agora é EXCLUSIVO do painel: gera um rascunho de resposta usando
// o mesmo pipeline de contexto da IA, sem inserir mensagem, sem executar ações e
// sem transferir. Requer um operador autenticado (JWT deste projeto + registro em
// desk_agents).
//
// Os turnos reais do WIDGET passaram para a Edge Function desk-widget-api, que
// verifica a identidade do cliente (HMAC) antes de chamar o pipeline. Chamadas
// fora dos modos abaixo retornam 410 com instrução de migração.
//
// Modos (sempre operador autenticado):
//   draft   { conversation_id, message } → { reply }   estrelinha do editor
//   rewrite { text, tone }               → { text }    reescrever no tom pedido
//
// Pipeline completo: ../_shared/ai-pipeline.ts · reescrita: ../_shared/ai-rewrite.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { corsHeaders } from '../_shared/cors.ts';
import { verifyOperator } from '../_shared/widget-auth.ts';
import { callLLM, runAiPipeline } from '../_shared/ai-pipeline.ts';
import {
  buildRewriteUserPrompt,
  cleanRewriteOutput,
  isRewriteTone,
  MAX_REWRITE_CHARS,
  missingUrls,
  REWRITE_SYSTEM_PROMPT,
} from '../_shared/ai-rewrite.ts';

interface DraftRequest {
  conversation_id?: string;
  message?: string;
  mode?: string;
  text?: string;
  tone?: string;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: DraftRequest = await req.json().catch(() => ({}));
    const { conversation_id, message, mode } = body;

    if (mode === 'rewrite') {
      if (!(await verifyOperator(req))) {
        return json({ error: 'Apenas operadores autenticados podem reescrever mensagens' }, 401);
      }
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) return json({ error: 'Escreva a mensagem antes de pedir para reescrever' }, 400);
      if (text.length > MAX_REWRITE_CHARS) return json({ error: 'Texto longo demais para reescrever' }, 400);
      if (!isRewriteTone(body.tone)) return json({ error: 'Tom inválido' }, 400);

      const apiKey = Deno.env.get('OPENROUTER_API_KEY');
      if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY secret');

      const llm = await callLLM(
        apiKey,
        REWRITE_SYSTEM_PROMPT,
        [{ role: 'user', content: buildRewriteUserPrompt(text, body.tone) }],
        { temperature: body.tone === 'corrigir' ? 0.1 : 0.5, maxTokens: 2000, timeoutMs: 30_000 },
      );
      const rewritten = cleanRewriteOutput(llm.content);
      if (!rewritten) return json({ error: 'A IA não devolveu texto — tente de novo' }, 502);
      const lost = missingUrls(text, rewritten);
      if (lost.length > 0) {
        console.warn(`[desk-ai-respond] rewrite descartada: perdeu ${lost.length} link(s)`);
        return json({ error: 'A reescrita perdeu um link do texto original — tente de novo' }, 422);
      }
      return json({ text: rewritten });
    }

    if (mode !== 'draft') {
      return json({
        error: 'Este endpoint aceita apenas mode=draft ou mode=rewrite (painel do operador). O widget usa desk-widget-api.',
      }, 410);
    }

    if (!conversation_id || !message) {
      return json({ error: 'Missing required fields: conversation_id, message' }, 400);
    }

    // Somente operadores registrados podem gerar rascunhos
    const operatorId = await verifyOperator(req);
    if (!operatorId) {
      return json({ error: 'Apenas operadores autenticados podem usar o copilot' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase env vars');
    const service = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const outcome = await runAiPipeline(service, {
      conversationId: conversation_id,
      message,
      mode: 'draft',
    });

    return json({ reply: outcome.reply, should_handoff: false, metadata: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[desk-ai-respond] Fatal error:', msg);
    return json({ error: msg }, 500);
  }
});
