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

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY secret');

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000), // stay well within token limit
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embedding error ${res.status}: ${err}`);
  }

  const data: OpenAIEmbeddingResponse = await res.json();
  return data.data[0].embedding;
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
