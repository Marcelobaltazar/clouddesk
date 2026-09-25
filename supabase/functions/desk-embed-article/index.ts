// ─── desk-embed-article — indexa um artigo/snippet para a busca da IA ──────────
//
// POST { table, id, offset?, hash? }   (o `content` que painéis antigos mandam é ignorado)
//   → { ok, chunks, next, hash }       next = null quando terminou
//
// Lê o registro DO BANCO — o texto indexado é sempre o que está salvo, nunca o
// que veio no body — e refaz os trechos em desk_kb_chunks (busca híbrida da IA,
// ver _shared/kb-chunker.ts e _shared/ai-retrieval.ts), EM LOTES: cada chamada
// gera no máximo BATCH vetores. Artigo com 8+ trechos numa chamada só estourava
// o limite de CPU da Edge Function (HTTP 546) — 14 artigos longos falharam
// assim na primeira reindexação. Quem chama repete com `offset = next` até
// next = null (painel e scripts/reindex-kb.ts fazem isso).
//
// Status: só ao terminar o ÚLTIMO lote o registro ganha indexed_hash =
// content_hash (o painel mostra "Indexado" só quando os dois batem). Erro vai
// para index_error. `hash` amarra os lotes ao mesmo texto: se o artigo for
// salvo no meio da indexação, a chamada seguinte recusa em vez de misturar
// trechos de duas versões.
//
// Quem pode chamar: operador logado no painel ou chave de serviço (scripts).

import { corsHeaders } from '../_shared/cors.ts';
import { newServiceClient, type ServiceClient } from '../_shared/supabase.ts';
import { isServiceRoleRequest, verifyOperator } from '../_shared/widget-auth.ts';
import { chunkArticle, chunkSnippet } from '../_shared/kb-chunker.ts';

type EmbeddableTable = 'desk_knowledge_base' | 'desk_faq' | 'desk_ai_snippets';

const EMBEDDABLE_TABLES: EmbeddableTable[] = ['desk_knowledge_base', 'desk_faq', 'desk_ai_snippets'];

/** Vetores por chamada. Artigos com até 7 passavam numa chamada só; 4 (+1 do
 *  documento inteiro no primeiro lote) deixa folga. */
const BATCH = 4;

interface EmbedRequest {
  id?: string;
  table?: EmbeddableTable;
  offset?: number;
  hash?: string;
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

/** Registra o erro no próprio documento, para o painel mostrar. Nunca lança. */
async function recordError(supabase: ServiceClient, table: EmbeddableTable, id: string, message: string) {
  if (table === 'desk_faq') return;
  const { error } = await supabase.from(table).update({ index_error: message.slice(0, 500) }).eq('id', id);
  if (error) console.warn(`[Embed] não consegui gravar o erro em ${table} ${id}:`, error.message);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let supabase: ServiceClient | null = null;
  let target: { table: EmbeddableTable; id: string } | null = null;

  try {
    // Operador primeiro: é o caminho de todo artigo salvo no painel.
    if (!(await verifyOperator(req)) && !(await isServiceRoleRequest(req))) {
      return json({ error: 'Apenas operadores autenticados podem indexar artigos' }, 401);
    }

    const { id, table, offset: rawOffset, hash }: EmbedRequest = await req.json().catch(() => ({}));

    if (!id || !table) {
      return json({ error: 'Missing required fields: id, table' }, 400);
    }
    if (!EMBEDDABLE_TABLES.includes(table)) {
      return json({ error: `table must be one of: ${EMBEDDABLE_TABLES.join(', ')}` }, 400);
    }

    supabase = newServiceClient();

    // ── FAQ: só o vetor do registro (não entra na busca híbrida) ─────────────
    if (table === 'desk_faq') {
      const { data: faq, error } = await supabase.from('desk_faq').select('question, answer').eq('id', id).maybeSingle();
      if (error) throw new Error(`DB read error: ${error.message}`);
      if (!faq) return json({ error: 'Registro não encontrado' }, 404);
      const embedding = await generateEmbedding(`${faq.question}\n\n${faq.answer}`);
      const { error: upErr } = await supabase.from('desk_faq').update({ embedding }).eq('id', id);
      if (upErr) throw new Error(`DB update error: ${upErr.message}`);
      return json({ ok: true, chunks: 0, next: null });
    }

    target = { table, id };
    const isArticle = table === 'desk_knowledge_base';
    const idColumn = isArticle ? 'article_id' : 'snippet_id';

    const { data: doc, error: readErr } = await supabase
      .from(table)
      .select('id, title, content, content_hash')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw new Error(`DB read error: ${readErr.message}`);
    if (!doc) return json({ error: 'Registro não encontrado' }, 404);

    const contentHash = String(doc.content_hash ?? '');
    if (hash && hash !== contentHash) {
      return json({ error: 'O texto mudou durante a indexação. Clique em indexar de novo.' }, 409);
    }

    const title = String(doc.title ?? '');
    const content = String(doc.content ?? '');
    const chunks = isArticle ? chunkArticle(title, content) : chunkSnippet(title, content);
    const total = chunks.length;
    const start = Math.min(Math.max(0, Math.floor(Number(rawOffset) || 0)), Math.max(0, total - 1));
    const batch = chunks.slice(start, start + BATCH);
    const end = start + batch.length;

    // Tudo o que é lento (os vetores) acontece ANTES de mexer nos trechos
    // antigos: a janela em que o lote some da busca fica em milissegundos.
    const docEmbedding = start === 0 ? await generateEmbedding(`${title}\n\n${content}`) : null;
    const rows = [];
    for (const c of batch) {
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

    if (docEmbedding) {
      // Vetor do documento inteiro: usado pela busca antiga, que é o fallback.
      const { error } = await supabase.from(table).update({ embedding: docEmbedding }).eq('id', id);
      if (error) throw new Error(`DB update error: ${error.message}`);
    }

    const { error: delErr } = await supabase
      .from('desk_kb_chunks').delete().eq(idColumn, id).gte('chunk_index', start).lt('chunk_index', end);
    if (delErr) throw new Error(`Chunk delete error: ${delErr.message}`);

    const { error: insErr } = await supabase.from('desk_kb_chunks').insert(rows);
    if (insErr) throw new Error(`Chunk insert error: ${insErr.message}`);

    if (end < total) {
      console.log(`[Embed] ${table} ${id}: lote ${start}–${end - 1} de ${total}`);
      return json({ ok: true, chunks: total, next: end, hash: contentHash });
    }

    // Último lote: some com trechos de uma versão anterior mais longa e marca
    // o documento como indexado para ESTE texto.
    const { error: tailErr } = await supabase.from('desk_kb_chunks').delete().eq(idColumn, id).gte('chunk_index', total);
    if (tailErr) throw new Error(`Chunk cleanup error: ${tailErr.message}`);

    const { error: statusErr } = await supabase.from(table).update({
      indexed_hash: contentHash,
      index_chunks: total,
      index_error: null,
      indexed_at: new Date().toISOString(),
    }).eq('id', id);
    if (statusErr) throw new Error(`Status update error: ${statusErr.message}`);

    console.log(`[Embed] ${table} ${id} "${title.slice(0, 60)}": ${total} trecho(s) indexado(s)`);
    return json({ ok: true, chunks: total, next: null, hash: contentHash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Embed] Error:', msg);
    if (supabase && target) await recordError(supabase, target.table, target.id, msg);
    return json({ error: msg }, 500);
  }
});
