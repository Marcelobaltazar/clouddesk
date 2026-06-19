import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { corsHeaders } from '../_shared/cors.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

type EmbeddableTable = 'desk_knowledge_base' | 'desk_faq' | 'desk_ai_snippets';

const EMBEDDABLE_TABLES: EmbeddableTable[] = ['desk_knowledge_base', 'desk_faq', 'desk_ai_snippets'];

interface EmbedRequest {
  id: string;
  content: string;
  table: EmbeddableTable;
}

// ─── Embedding nativo do Supabase ───────────────────────────────────────────────
// Usa o modelo `gte-small` embarcado no runtime das Edge Functions (Supabase.ai).
// 100% local: NÃO chama nenhuma API externa (OpenAI/OpenRouter). Produz vetores de
// 384 dimensões (ver migration 20260613000000_native_embeddings_gte_small.sql).

// `Supabase` é um global injetado no runtime de Edge Functions; tipamos pontualmente.
declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts: { mean_pool: boolean; normalize: boolean }): Promise<number[]> } };
};

const embeddingSession = new Supabase.ai.Session('gte-small');

async function generateEmbedding(text: string): Promise<number[]> {
  // gte-small aceita ~512 tokens; cortamos para caber com folga.
  const input = text.slice(0, 2000);
  const output = await embeddingSession.run(input, { mean_pool: true, normalize: true });
  return output as number[];
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: EmbedRequest = await req.json();
    const { id, content, table } = body;

    if (!id || !content || !table) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: id, content, table' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!EMBEDDABLE_TABLES.includes(table)) {
      return new Response(
        JSON.stringify({ error: `table must be one of: ${EMBEDDABLE_TABLES.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[Embed] Generating embedding for ${table} id=${id}`);

    const embedding = await generateEmbedding(content);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase env vars');

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase
      .from(table)
      .update({ embedding })
      .eq('id', id);

    if (error) throw new Error(`DB update error: ${error.message}`);

    console.log(`[Embed] Saved embedding for ${table} id=${id}`);

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Embed] Error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
