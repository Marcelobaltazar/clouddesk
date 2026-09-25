// ─── Índice da IA de artigos e snippets (painel) ──────────────────────────────
//
// O que a IA lê de um documento são os trechos que a Edge Function
// desk-embed-article gera (busca híbrida). Este módulo:
//   • diz em que estado está o índice de um documento, comparando o hash do
//     texto atual com o hash do texto que foi indexado (migration
//     20260925100000_kb_index_status.sql) — "tem vetor" não quer dizer "está
//     em dia": depois de uma edição cujo reindex falhou, o vetor é do texto velho;
//   • roda a indexação em lotes (a função gera no máximo 4 vetores por chamada
//     para não estourar o limite de CPU) e devolve o erro real, não o
//     "non-2xx" genérico do supabase-js.

import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type KbIndexTable = "desk_knowledge_base" | "desk_ai_snippets";

export interface IndexStatusFields {
  content_hash: string | null;
  indexed_hash: string | null;
  index_chunks: number | null;
  index_error: string | null;
  indexed_at: string | null;
}

/**
 * indexed  — os trechos que a IA lê são deste texto;
 * stale    — o texto mudou depois da última indexação (IA lê a versão antiga);
 * error    — a última tentativa falhou (motivo em index_error);
 * missing  — nunca indexado: a IA não encontra este documento.
 */
export type IndexState = "indexed" | "stale" | "error" | "missing";

export function indexState(doc: IndexStatusFields): IndexState {
  if (doc.indexed_hash && doc.indexed_hash === doc.content_hash) return "indexed";
  if (doc.index_error) return "error";
  if (doc.indexed_hash) return "stale";
  return "missing";
}

export const INDEX_STATUS_COLUMNS = "content_hash, indexed_hash, index_chunks, index_error, indexed_at";

async function describeInvokeError(error: Error): Promise<string> {
  if (!(error instanceof FunctionsHttpError)) return error.message;
  const status = error.context.status;
  try {
    const raw = await error.context.text();
    try {
      const body = JSON.parse(raw) as { error?: string; message?: string };
      if (body.error || body.message) return (body.error ?? body.message) as string;
    } catch { /* corpo não-JSON */ }
    if (status === 546) return "A função estourou o limite de recursos do Supabase (HTTP 546). Tente de novo.";
    return raw ? `HTTP ${status}: ${raw.slice(0, 200)}` : `HTTP ${status}`;
  } catch {
    return `HTTP ${status}`;
  }
}

/** Tentativas por lote. O Supabase devolve 546 (limite de recursos) de forma
 *  intermitente — na reindexação de 25/09/2026, 3 de 128 documentos falharam
 *  assim e passaram na segunda tentativa. Lote é idempotente: repetir é seguro. */
const MAX_ATTEMPTS = 3;

function isTransient(error: Error): boolean {
  if (error instanceof FunctionsHttpError) return error.context.status >= 500;
  return true; // erro de rede / função fora do ar
}

type BatchResponse = { ok?: boolean; chunks?: number; next?: number | null; hash?: string; error?: string };

async function invokeBatch(body: Record<string, unknown>): Promise<BatchResponse> {
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await supabase.functions.invoke<BatchResponse>("desk-embed-article", { body });
    if (!error) return data ?? {};
    if (attempt >= MAX_ATTEMPTS || !isTransient(error)) throw new Error(await describeInvokeError(error));
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

/**
 * Indexa um documento inteiro, lote a lote. `onProgress(feitos, total)` é
 * chamado a cada lote. Lança Error com a mensagem real em caso de falha.
 */
export async function indexDocument(
  table: KbIndexTable,
  id: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ chunks: number }> {
  let offset: number | null = 0;
  let hash: string | undefined;
  let total = 0;

  while (offset !== null) {
    const data = await invokeBatch({ table, id, offset, hash });
    if (!data.ok) throw new Error(data.error ?? "Resposta inválida da indexação");

    total = data.chunks ?? 0;
    hash = data.hash;
    offset = data.next ?? null;
    onProgress?.(offset ?? total, total);
  }

  return { chunks: total };
}
