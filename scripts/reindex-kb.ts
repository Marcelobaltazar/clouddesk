/**
 * reindex-kb.ts
 *
 * Reindexa TODA a base da IA (artigos da Central + snippets) chamando a Edge
 * Function desk-embed-article para cada documento. Ela refaz o vetor do
 * documento e os trechos da busca híbrida (desk_kb_chunks).
 *
 * Quando rodar:
 *   • uma vez, depois de aplicar a migration 20260925000000_kb_hybrid_search.sql;
 *   • sempre que o fatiamento mudar (supabase/functions/_shared/kb-chunker.ts).
 * Artigos salvos pelo painel já se reindexam sozinhos.
 *
 * Uso:
 *   npx tsx scripts/reindex-kb.ts            (tudo)
 *   npx tsx scripts/reindex-kb.ts --pending  (só o que está com índice
 *     desatualizado/ausente — ex.: depois de uma migration que muda o texto)
 *
 * Variáveis de ambiente (.env ou shell):
 *   VITE_SUPABASE_URL         — URL do projeto CloudDesk
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (nunca commitar)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('\n❌  Defina VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/desk-embed-article`;

type Table = 'desk_knowledge_base' | 'desk_ai_snippets';

type BatchResponse = { ok?: boolean; chunks?: number; next?: number | null; hash?: string; error?: string };

/** Um lote, com até 3 tentativas: o Supabase devolve 546 (limite de recursos)
 *  de forma intermitente, e o lote é idempotente. */
async function invokeBatch(body: Record<string, unknown>): Promise<BatchResponse> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) as BatchResponse : {};
    if (res?.ok && data.ok) return data;
    const transient = !res || res.status >= 500;
    if (attempt >= 3 || !transient) throw new Error(data.error ?? `HTTP ${res?.status ?? 'sem resposta'}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

/** A função indexa em lotes (limite de CPU): repete até next = null. */
async function reindex(table: Table, id: string): Promise<number> {
  let offset: number | null = 0;
  let hash: string | undefined;
  let chunks = 0;
  while (offset !== null) {
    const body = await invokeBatch({ table, id, offset, hash });
    chunks = body.chunks ?? 0;
    hash = body.hash;
    offset = body.next ?? null;
  }
  return chunks;
}

async function main() {
  const failures: string[] = [];
  let chunks = 0;

  const onlyPending = process.argv.includes('--pending');

  for (const table of ['desk_knowledge_base', 'desk_ai_snippets'] as Table[]) {
    const { data: rows, error } = await supabase
      .from(table).select('id, title, content_hash, indexed_hash').order('title');
    if (error) {
      console.error(`❌  Erro ao listar ${table}: ${error.message}`);
      process.exit(1);
    }
    // Pendente = os trechos não são do texto atual (mesma regra do selo do painel).
    const data = onlyPending ? rows.filter((r) => !r.indexed_hash || r.indexed_hash !== r.content_hash) : rows;
    console.log(`\n📄  ${table}: ${data.length} documento(s)${onlyPending ? ` pendente(s) de ${rows.length}` : ''}`);

    for (const [i, doc] of data.entries()) {
      process.stdout.write(`[${i + 1}/${data.length}] ${doc.title.slice(0, 70)} … `);
      try {
        const n = await reindex(table, doc.id);
        chunks += n;
        console.log(`✅ ${n} trecho(s)`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`${table} ${doc.id} "${doc.title}": ${msg}`);
        console.log(`❌ ${msg}`);
      }
    }
  }

  console.log(`\n📊  ${chunks} trecho(s) indexado(s), ${failures.length} falha(s)`);
  for (const f of failures) console.log(`   - ${f}`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\n❌  Erro inesperado:', err);
  process.exit(1);
});
