/**
 * import-intercom-internal-articles.ts
 *
 * Importa artigos INTERNOS / não-públicos do Intercom (state='draft') para
 * desk_knowledge_base. Diferente do import-intercom-articles.ts (que traz só os
 * publicados na central de ajuda), este traz o conteúdo interno que NÃO aparece
 * para o cliente — mas que deve alimentar a IA diretamente.
 *
 * Por isso entram como is_published=true: o `is_published` aqui controla se o
 * artigo está ATIVO para a IA/busca, não se ele é público no Intercom.
 *
 * Uso:
 *   npx tsx scripts/import-intercom-internal-articles.ts
 *
 * Variáveis de ambiente (.env):
 *   INTERCOM_ACCESS_TOKEN     — token de acesso do Intercom
 *   VITE_SUPABASE_URL         — URL do projeto Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (bypassa RLS)
 */

import 'dotenv/config';
import TurndownService from 'turndown';
import { createClient } from '@supabase/supabase-js';

// ─── Env ──────────────────────────────────────────────────────────────────────

const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const SUPABASE_URL   = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!INTERCOM_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('\n❌  Variáveis de ambiente ausentes. Verifique o .env:\n');
  console.error('   INTERCOM_ACCESS_TOKEN');
  console.error('   VITE_SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY\n');
  process.exit(1);
}

// ─── Config ─────────────────────────────────────────────────────────────────

const KB_SOURCE = 'intercom_internal';

// ─── Clients ──────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface IntercomArticle {
  id: string;
  title: string;
  body: string | null;       // HTML
  state: 'published' | 'draft';
  created_at: number;        // Unix timestamp
  updated_at: number;
  url: string | null;
}

interface IntercomPages {
  type: string;
  page: number;
  per_page: number;
  total_pages: number;
  next?: {
    page?: number;
    starting_after?: string;
  } | null;
}

interface IntercomResponse {
  data: IntercomArticle[];
  pages: IntercomPages;
  total_count: number;
}

// ─── Intercom pagination ──────────────────────────────────────────────────────

async function fetchAllArticles(): Promise<IntercomArticle[]> {
  const articles: IntercomArticle[] = [];
  let page = 1;

  while (true) {
    const url = new URL('https://api.intercom.io/articles');
    url.searchParams.set('per_page', '50');
    url.searchParams.set('page', String(page));

    process.stdout.write(`  Página ${page}...`);

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${INTERCOM_TOKEN}`,
        'Accept': 'application/json',
        'Intercom-Version': '2.11',
      },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Intercom API ${res.status}: ${err}`);
    }

    const body: IntercomResponse = await res.json();
    articles.push(...body.data);

    process.stdout.write(
      ` ${body.data.length} artigos | total acumulado: ${articles.length}` +
      ` | página ${body.pages.page}/${body.pages.total_pages}\n`,
    );

    if (body.pages.page >= body.pages.total_pages) break;
    page++;
  }

  return articles;
}

// ─── HTML → Markdown ──────────────────────────────────────────────────────────

function toMarkdown(html: string | null): string {
  if (!html) return '';
  const cleaned = html
    .replace(/<div[^>]*class="[^"]*intercom[^"]*"[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n');
  return td.turndown(cleaned).trim();
}

// ─── Supabase insert (SELECT antes de INSERT para não duplicar) ─────────────────
// O índice único de source_id é parcial (WHERE source_id IS NOT NULL), então o
// client JS não o usa para ON CONFLICT. Fazemos check-then-write manual.

async function upsertArticle(article: IntercomArticle): Promise<'inserted' | 'updated'> {
  const sourceId  = String(article.id);
  const markdown  = toMarkdown(article.body);
  const createdAt = new Date(article.created_at * 1000).toISOString();

  const record = {
    title:        article.title,
    content:      markdown || article.title, // nunca grava conteúdo vazio
    source:       KB_SOURCE,
    source_id:    sourceId,
    is_published: true, // ativo para a IA/busca (não é público no Intercom)
    created_at:   createdAt,
  };

  const { data: existing, error: selectErr } = await supabase
    .from('desk_knowledge_base')
    .select('id')
    .eq('source_id', sourceId)
    .maybeSingle();

  if (selectErr) throw new Error(`Supabase select (${sourceId}): ${selectErr.message}`);

  if (existing?.id) {
    const { error } = await supabase
      .from('desk_knowledge_base')
      .update({ title: record.title, content: record.content, source: KB_SOURCE, is_published: true })
      .eq('id', existing.id);
    if (error) throw new Error(`Supabase update (${sourceId}): ${error.message}`);
    return 'updated';
  }

  const { error } = await supabase.from('desk_knowledge_base').insert(record);
  if (error) throw new Error(`Supabase insert (${sourceId}): ${error.message}`);
  return 'inserted';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀  Intercom (artigos internos) → CloudDesk KB\n');

  // 1. Fetch
  console.log('📥  Buscando artigos do Intercom...');
  const all = await fetchAllArticles();
  console.log(`\n✅  ${all.length} artigos encontrados no total.\n`);

  // 2. Filtrar internos / não-públicos (state='draft')
  const internal = all.filter((a) => a.state !== 'published');
  const published = all.filter((a) => a.state === 'published');

  console.log(`📋  ${internal.length} internos/rascunho (importar)  |  ${published.length} publicados (ignorados)\n`);

  if (internal.length === 0) {
    console.log('Nenhum artigo interno/rascunho para importar.\n');
    process.exit(0);
  }

  // 3. Import
  console.log('📤  Importando artigos internos para desk_knowledge_base...\n');

  const inserted: string[] = [];
  const updated:  string[] = [];
  const failed:   Array<{ title: string; error: string }> = [];

  for (const article of internal) {
    process.stdout.write(`  ⬆  ${article.title.slice(0, 70)}...`);
    try {
      const result = await upsertArticle(article);
      if (result === 'inserted') {
        inserted.push(article.title);
        process.stdout.write(' ✓ novo\n');
      } else {
        updated.push(article.title);
        process.stdout.write(' ↻ atualizado\n');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ title: article.title, error: msg });
      process.stdout.write(` ✗ ${msg}\n`);
    }
  }

  // 4. Report
  console.log('\n─────────────────────────────────────────');
  console.log('📊  RELATÓRIO FINAL');
  console.log('─────────────────────────────────────────');
  console.log(`  Total encontrado      : ${all.length}`);
  console.log(`  Internos/rascunho     : ${internal.length}`);
  console.log(`  Novos importados      : ${inserted.length}`);
  console.log(`  Atualizados           : ${updated.length}`);
  console.log(`  Publicados (ignorados): ${published.length}`);
  console.log(`  Erros                 : ${failed.length}`);

  if (inserted.length > 0) {
    console.log('\n✅  Artigos importados:');
    inserted.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  }

  if (updated.length > 0) {
    console.log('\n↻  Artigos atualizados:');
    updated.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  }

  if (failed.length > 0) {
    console.log('\n❌  Erros:');
    failed.forEach(({ title, error }) => console.log(`   • ${title}: ${error}`));
  }

  console.log('\n─────────────────────────────────────────\n');
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n❌  Erro fatal:', err.message ?? err);
  process.exit(1);
});
