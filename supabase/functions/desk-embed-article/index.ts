// ─── desk-embed-article — indexa um artigo/snippet para a busca da IA ──────────
//
// POST { table, id }   (o campo `content` que o painel ainda manda é ignorado)
//
// Lê o registro DO BANCO — o texto indexado é sempre o que está salvo, nunca o
// que veio no body — e:
//   1. gera o vetor do documento inteiro (coluna embedding; usado pela busca
//      legada, que é o fallback do pipeline);
//   2. refaz os trechos em desk_kb_chunks (busca híbrida da IA — ver
//      _shared/kb-chunker.ts e _shared/ai-retrieval.ts).
//
// Quem pode chamar: operador logado no painel (salvar artigo/snippet) ou a
// service role (scripts/reindex-kb.ts). Antes não havia verificação nenhuma: a
// anon key é pública, e qualquer um podia trocar o que a IA lia de um artigo.

import { corsHeaders } from '../_shared/cors.ts';
import { newServiceClient } from '../_shared/supabase.ts';
import { isServiceRoleRequest, verifyOperator } from '../_shared/widget-auth.ts';
import { chunkArticle, chunkSnippet, type KbChunk } from '../_shared/kb-chunker.ts';

type EmbeddableTable = 'desk_knowledge_base' | 'desk_faq' | 'desk_ai_snippets';

const EMBEDDABLE_TABLES: EmbeddableTable[] = ['desk_knowledge_base', 'desk_faq', 'desk_ai_snippets'];

interface EmbedRequest {
  id?: string;
  table?: EmbeddableTable;
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

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Operador primeiro: é o caminho de todo artigo salvo no painel.
    if (!(await verifyOperator(req)) && !(await isServiceRoleRequest(req))) {
      return json({ error: 'Apenas operadores autenticados podem indexar artigos' }, 401);
    }

    const { id, table }: EmbedRequest = await req.json().catch(() => ({}));

    if (!id || !table) {
      return json({ error: 'Missing required fields: id, table' }, 400);
    }
    if (!EMBEDDABLE_TABLES.includes(table)) {
      return json({ error: `table must be one of: ${EMBEDDABLE_TABLES.join(', ')}` }, 400);
    }

    const supabase = newServiceClient();

    // ── FAQ: só o vetor do registro (não entra na busca híbrida) ─────────────
    if (table === 'desk_faq') {
      const { data: faq, error } = await supabase.from('desk_faq').select('question, answer').eq('id', id).maybeSingle();
      if (error) throw new Error(`DB read error: ${error.message}`);
      if (!faq) return json({ error: 'Registro não encontrado' }, 404);
      const embedding = await generateEmbedding(`${faq.question}\n\n${faq.answer}`);
      const { error: upErr } = await supabase.from('desk_faq').update({ embedding }).eq('id', id);
      if (upErr) throw new Error(`DB update error: ${upErr.message}`);
      return json({ ok: true, chunks: 0 });
    }

    const isArticle = table === 'desk_knowledge_base';
    const { data: doc, error: readErr } = await supabase
      .from(table)
      .select('id, title, content')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw new Error(`DB read error: ${readErr.message}`);
    if (!doc) return json({ error: 'Registro não encontrado' }, 404);

    const title = String(doc.title ?? '');
    const content = String(doc.content ?? '');
    console.log(`[Embed] Indexando ${table} id=${id} "${title.slice(0, 60)}"`);

    // Tudo o que é lento (os vetores) acontece ANTES de mexer nos trechos
    // antigos: a janela em que o artigo some da busca fica em milissegundos.
    const docEmbedding = await generateEmbedding(`${title}\n\n${content}`);
    const chunks: KbChunk[] = isArticle ? chunkArticle(title, content) : chunkSnippet(title, content);
    const rows = [];
    for (const c of chunks) {
      rows.push({
        doc_type: isArticle ? 'article' : 'snippet',
        article_id: isArticle ? id : null,
        snippet_id: isArticle ? null : id,
        chunk_index: c.index,
        title,
        heading: c.heading,
        content: c.content,
        embedding: await generateEmbedding(c.embedText),
      });
    }

    const { error: upErr } = await supabase.from(table).update({ embedding: docEmbedding }).eq('id', id);
    if (upErr) throw new Error(`DB update error: ${upErr.message}`);

    const { error: delErr } = await supabase
      .from('desk_kb_chunks')
      .delete()
      .eq(isArticle ? 'article_id' : 'snippet_id', id);
    if (delErr) throw new Error(`Chunk delete error: ${delErr.message}`);

    const { error: insErr } = await supabase.from('desk_kb_chunks').insert(rows);
    if (insErr) throw new Error(`Chunk insert error: ${insErr.message}`);

    console.log(`[Embed] ${table} id=${id}: ${rows.length} trecho(s) indexado(s)`);
    return json({ ok: true, chunks: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Embed] Error:', msg);
    return json({ error: msg }, 500);
  }
});
