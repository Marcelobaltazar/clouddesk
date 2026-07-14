// ─── desk-ai-respond — copilot do OPERADOR (modo draft) ─────────────────────────
//
// Este endpoint agora é EXCLUSIVO do painel: gera um rascunho de resposta usando
// o mesmo pipeline de contexto da IA, sem inserir mensagem, sem executar ações e
// sem transferir. Requer um operador autenticado (JWT deste projeto + registro em
// desk_agents).
//
// Os turnos reais do WIDGET passaram para a Edge Function desk-widget-api, que
// verifica a identidade do cliente (HMAC) antes de chamar o pipeline. Chamadas
// não-draft aqui retornam 410 com instrução de migração.
//
// Pipeline completo: ../_shared/ai-pipeline.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { corsHeaders } from '../_shared/cors.ts';
import { verifyOperator } from '../_shared/widget-auth.ts';
import { runAiPipeline } from '../_shared/ai-pipeline.ts';

interface DraftRequest {
  conversation_id?: string;
  message?: string;
  mode?: string;
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

    if (mode !== 'draft') {
      return json({
        error: 'Este endpoint aceita apenas mode=draft (copilot do operador). O widget usa desk-widget-api.',
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
