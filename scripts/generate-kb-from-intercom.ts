/**
 * generate-kb-from-intercom.ts
 *
 * Análise EM LOTE das conversas do Intercom para encontrar LACUNAS (gaps) na
 * base de conhecimento — em vez de gerar um artigo por conversa.
 *
 * Pipeline:
 *   FASE 1 — Coleta:    últimas 500 conversas closed (assunto, tags, resolução)
 *   FASE 2 — Agrupar:   agrupa por tema via palavras-chave (sem IA), min. 3/grupo
 *   FASE 3 — Gap c/ IA: por grupo, a IA compara com os artigos já existentes
 *   FASE 4 — Importa:   só os gaps reais (has_gap=true), como rascunho
 *   FASE 5 — Relatório
 *
 * Uso:
 *   npx tsx scripts/generate-kb-from-intercom.ts
 *   KB_MAX_CONVERSATIONS=50 npx tsx scripts/generate-kb-from-intercom.ts   (teste)
 *
 * Variáveis de ambiente (.env):
 *   INTERCOM_ACCESS_TOKEN     — token de acesso do Intercom
 *   OPENROUTER_API_KEY        — chave da OpenRouter (Gemini 2.5 Flash)
 *   VITE_SUPABASE_URL         — URL do projeto Supabase do CloudDesk
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (bypassa RLS)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ─── Env ────────────────────────────────────────────────────────────────────

const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const SUPABASE_URL   = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!INTERCOM_TOKEN || !OPENROUTER_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('\n❌  Variáveis de ambiente ausentes. Verifique o .env:\n');
  if (!INTERCOM_TOKEN) console.error('   INTERCOM_ACCESS_TOKEN');
  if (!OPENROUTER_KEY) console.error('   OPENROUTER_API_KEY');
  if (!SUPABASE_URL)   console.error('   VITE_SUPABASE_URL');
  if (!SUPABASE_KEY)   console.error('   SUPABASE_SERVICE_ROLE_KEY');
  console.error('');
  process.exit(1);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_CONVERSATIONS = Number(process.env.KB_MAX_CONVERSATIONS) || 500;
const PER_PAGE          = 50;
const AI_DELAY_MS       = 300;          // pausa entre chamadas à IA (rate limit)
const AI_MODEL          = 'google/gemini-2.5-flash';
const MIN_GROUP_SIZE    = 3;            // mínimo de conversas para um tema valer
const INTERCOM_VERSION  = '2.11';

const KB_SOURCE = 'intercom_gap';
// Fontes consideradas como "artigos existentes" ao avaliar gaps e deduplicar.
const KB_SOURCES_EXISTING = ['manual', 'intercom', 'intercom_conversation', 'intercom_gap'];

// ─── Temas (FASE 2) ─────────────────────────────────────────────────────────
// Cada tema é um conjunto de palavras-chave. Uma conversa entra no PRIMEIRO tema
// cujo qualquer keyword apareça no assunto/tags/resolução. Ordem importa: temas
// mais específicos primeiro.

interface ThemeDef {
  key: string;
  label: string;
  keywords: string[];
}

const THEMES: ThemeDef[] = [
  {
    key: 'n8n_offline',
    label: 'Instância n8n offline / 502',
    keywords: ['502', 'n8n nao responde', 'n8n não responde', 'instancia caiu', 'instância caiu',
               'n8n offline', 'n8n fora', 'bad gateway', 'nao abre', 'não abre', 'fora do ar', 'caiu'],
  },
  {
    key: 'access',
    label: 'Problemas de acesso / credenciais',
    keywords: ['senha', 'credencial', 'credenciais', 'login', 'acesso', 'logar', 'entrar',
               'esqueci', 'reset', 'redefinir', 'usuario', 'usuário'],
  },
  {
    key: 'deploy',
    label: 'Deploy / provisionamento travado',
    keywords: ['implantando', 'deploy', 'provisionamento', 'provisionando', 'deploying',
               'travado', 'pendente', 'nao subiu', 'não subiu', 'criando infra'],
  },
  {
    key: 'billing',
    label: 'Cobrança / faturamento',
    keywords: ['cobranca', 'cobrança', 'fatura', 'faturamento', 'pagamento', 'cartao', 'cartão',
               'reembolso', 'estorno', 'duplicada', 'duplicado', 'invoice', 'boleto', 'preco', 'preço'],
  },
  {
    key: 'subscription',
    label: 'Assinatura / plano (upgrade, cancelamento)',
    keywords: ['assinatura', 'plano', 'upgrade', 'downgrade', 'cancelar', 'cancelamento',
               'migrar', 'mudar de plano', 'renovacao', 'renovação'],
  },
  {
    key: 'evolution',
    label: 'Evolution API / WhatsApp',
    keywords: ['evolution', 'whatsapp', 'qr code', 'qrcode', 'instancia whatsapp',
               'conectar numero', 'conectar número', 'desconectou'],
  },
  {
    key: 'domain_dns',
    label: 'Domínio / DNS',
    keywords: ['dns', 'dominio', 'domínio', 'nxdomain', 'subdominio', 'subdomínio',
               'apontamento', 'cname', 'certificado', 'ssl', 'https'],
  },
  {
    key: 'database',
    label: 'Banco de dados (Redis / Postgres)',
    keywords: ['redis', 'postgres', 'postgresql', 'banco de dados', 'database', 'conexao com banco',
               'conexão com banco', 'connection refused'],
  },
  {
    key: 'performance',
    label: 'Performance / lentidão',
    keywords: ['lento', 'lentidao', 'lentidão', 'travando', 'demorando', 'timeout', 'performance',
               'memoria', 'memória', 'cpu', 'sobrecarga'],
  },
];

// ─── Clients ──────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────

interface IntercomConversationPart {
  part_type: string;
  body: string | null;
  author?: { type?: string } | null;
}

interface IntercomConversationListItem {
  id: string;
}

interface IntercomConversationDetail {
  id: string;
  created_at: number;
  tags?: { tags?: Array<{ name: string }> } | null;
  source?: { body?: string | null; subject?: string | null } | null;
  conversation_parts?: { conversation_parts?: IntercomConversationPart[] } | null;
}

interface IntercomPages {
  next?: { starting_after?: string } | string | null;
}

interface IntercomListResponse {
  conversations?: IntercomConversationListItem[];
  data?: IntercomConversationListItem[];
  pages?: IntercomPages;
}

/** Conversa reduzida ao essencial (FASE 1). */
interface ConversationSummary {
  id: string;
  subject: string;       // assunto OU primeira mensagem do cliente
  tags: string[];
  resolution: string;    // última mensagem do suporte
}

interface AiGapResult {
  has_gap: boolean;
  gap_description: string;
  title: string;
  content: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');   // remove acentos
}

// ─── Intercom helpers ─────────────────────────────────────────────────────────

async function intercomFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      'Authorization': `Bearer ${INTERCOM_TOKEN}`,
      'Accept': 'application/json',
      'Intercom-Version': INTERCOM_VERSION,
    },
  });
}

async function fetchClosedConversationIds(): Promise<string[]> {
  const ids: string[] = [];
  let startingAfter: string | undefined;
  let page = 1;

  while (ids.length < MAX_CONVERSATIONS) {
    const url = new URL('https://api.intercom.io/conversations');
    url.searchParams.set('state', 'closed');
    url.searchParams.set('per_page', String(PER_PAGE));
    if (startingAfter) url.searchParams.set('starting_after', startingAfter);

    process.stdout.write(`  Página ${page}...`);

    const res = await intercomFetch(url.toString());
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Intercom list ${res.status}: ${err}`);
    }

    const body: IntercomListResponse = await res.json();
    const batch = body.conversations ?? body.data ?? [];
    for (const c of batch) ids.push(c.id);

    process.stdout.write(` ${batch.length} conversas | acumulado: ${ids.length}\n`);

    const next = body.pages?.next;
    startingAfter = typeof next === 'object' && next ? next.starting_after : undefined;

    if (!startingAfter || batch.length === 0) break;
    page++;
  }

  return ids.slice(0, MAX_CONVERSATIONS);
}

/** FASE 1: reduz a conversa a assunto + tags + resolução. */
async function fetchConversationSummary(id: string): Promise<ConversationSummary | null> {
  const res = await intercomFetch(`https://api.intercom.io/conversations/${id}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Intercom detail ${id} ${res.status}: ${err}`);
  }

  const conv: IntercomConversationDetail = await res.json();
  const tags = (conv.tags?.tags ?? []).map((t) => t.name).filter(Boolean);
  const parts = conv.conversation_parts?.conversation_parts ?? [];

  // Assunto: prefere subject, senão a primeira mensagem do cliente
  const subjectRaw = stripHtml(conv.source?.subject) || stripHtml(conv.source?.body);

  // Resolução: última parte de comment escrita por admin/team com corpo real
  let resolution = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.part_type !== 'comment') continue;
    const authorType = p.author?.type ?? '';
    if (authorType !== 'admin' && authorType !== 'team') continue;
    const body = stripHtml(p.body);
    if (body) { resolution = body; break; }
  }

  // Ignora conversas sem assunto algum (vazias / só sistema)
  if (!subjectRaw) return null;

  return {
    id: conv.id,
    subject: subjectRaw.slice(0, 280),
    tags,
    resolution: resolution.slice(0, 400),
  };
}

// ─── FASE 2: agrupar por tema via keywords ──────────────────────────────────────

interface ThemeGroup {
  def: ThemeDef;
  conversations: ConversationSummary[];
}

function groupByTheme(convs: ConversationSummary[]): ThemeGroup[] {
  const buckets = new Map<string, ThemeGroup>();

  for (const conv of convs) {
    const haystack = normalize([conv.subject, conv.resolution, conv.tags.join(' ')].join(' '));
    const theme = THEMES.find((t) => t.keywords.some((kw) => haystack.includes(normalize(kw))));
    if (!theme) continue; // sem tema reconhecido → ignora

    if (!buckets.has(theme.key)) buckets.set(theme.key, { def: theme, conversations: [] });
    buckets.get(theme.key)!.conversations.push(conv);
  }

  // Só grupos com massa crítica
  return [...buckets.values()]
    .filter((g) => g.conversations.length >= MIN_GROUP_SIZE)
    .sort((a, b) => b.conversations.length - a.conversations.length);
}

// ─── FASE 3: análise de gap com IA ──────────────────────────────────────────────

function buildGapPrompt(group: ThemeGroup, existingTitles: string[]): string {
  const convSummaries = group.conversations
    .map((c, i) => {
      const res = c.resolution ? `\n   Resolução: ${c.resolution}` : '';
      return `${i + 1}. Assunto: ${c.subject}${res}`;
    })
    .join('\n');

  const existing = existingTitles.length > 0
    ? existingTitles.map((t) => `- ${t}`).join('\n')
    : '(nenhum artigo relacionado encontrado)';

  return `Você é um especialista em documentação de suporte técnico.

Temos ${group.conversations.length} conversas de suporte sobre o tema '${group.def.label}'.

Resumo das conversas:
${convSummaries}

Artigos que já temos na base de conhecimento sobre esse tema:
${existing}

Analise e responda em JSON:
{
  "has_gap": true/false,
  "gap_description": "o que está faltando na documentação",
  "title": "título do artigo a criar",
  "content": "artigo completo e bem estruturado em markdown"
}

Para o "content", use como base as seções ## O Problema, ## Por que acontece, ## Solução passo a passo e ## Como evitar — mas sinta-se livre para adaptar, adicionar ou remover seções conforme o tema pedir.

Quando houver informações críticas, riscos ou atenção especial necessária, use o formato de aviso em markdown:

> ⚠️ **Atenção:** texto do aviso aqui

Use avisos amarelos para:
- Ações irreversíveis
- Riscos de perda de dados
- Configurações que afetam produção
- Limitações importantes

Não abuse — use só quando realmente necessário.

Se os artigos existentes já cobrem bem esse tema, retorne has_gap: false.
Responda SOMENTE em JSON válido, sem markdown.`;
}

function parseAiJson(raw: string): AiGapResult | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return {
      has_gap:         obj.has_gap === true,
      gap_description: typeof obj.gap_description === 'string' ? obj.gap_description.trim() : '',
      title:           typeof obj.title === 'string' ? obj.title.trim() : '',
      content:         typeof obj.content === 'string' ? obj.content.trim() : '',
    };
  } catch {
    return null;
  }
}

async function callOpenRouter(prompt: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      // Força saída em JSON válido — evita "JSON inválido" quando o content
      // contém markdown com aspas/quebras de linha que escapariam mal.
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter: resposta sem conteúdo');
  return content;
}

async function analyzeGap(group: ThemeGroup, existingTitles: string[]): Promise<AiGapResult | null> {
  const prompt = buildGapPrompt(group, existingTitles);

  // 1ª tentativa
  let parsed = parseAiJson(await callOpenRouter(prompt));
  if (parsed) return parsed;

  // Retry único — respostas malformadas ocasionais costumam passar na 2ª.
  await sleep(AI_DELAY_MS);
  parsed = parseAiJson(await callOpenRouter(prompt));
  return parsed;
}

/** Títulos de KB relacionados a um tema (filtra por keyword no título). */
function relatedTitles(allTitles: string[], theme: ThemeDef): string[] {
  return allTitles.filter((t) => {
    const n = normalize(t);
    return theme.keywords.some((kw) => n.includes(normalize(kw)));
  });
}

// ─── FASE 4: importa o gap como rascunho ─────────────────────────────────────────

async function insertGapArticle(gap: AiGapResult, themeKey: string): Promise<'inserted' | 'exists'> {
  const sourceId = `gap_${themeKey}`;

  const { data: existing, error: selErr } = await supabase
    .from('desk_knowledge_base')
    .select('id')
    .eq('source_id', sourceId)
    .maybeSingle();

  if (selErr) throw new Error(`Supabase select (${sourceId}): ${selErr.message}`);
  if (existing?.id) return 'exists';

  const { error } = await supabase.from('desk_knowledge_base').insert({
    title:        gap.title,
    content:      gap.content || gap.title,
    source:       KB_SOURCE,
    source_id:    sourceId,
    is_published: false, // rascunho para revisão manual antes de publicar
  });

  if (error) throw new Error(`Supabase insert (${sourceId}): ${error.message}`);
  return 'inserted';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀  Intercom → análise de GAPS na KB (Gemini 2.5 Flash)\n');

  const stats = {
    analyzed: 0,        // conversas com conteúdo (summaries)
    groups: 0,          // grupos com >= MIN_GROUP_SIZE
    withGap: 0,         // grupos com gap real
    imported: 0,
    skippedCovered: 0,  // grupos já cobertos (has_gap=false)
    errors: 0,
  };
  const importedTitles: string[] = [];
  const errorList: Array<{ ref: string; error: string }> = [];

  // ── FASE 1: coleta ──
  console.log('📥  FASE 1 — Buscando conversas resolvidas (closed) do Intercom...');
  const ids = await fetchClosedConversationIds();
  console.log(`\n✅  ${ids.length} conversas para resumir.\n`);

  console.log('📄  Resumindo (assunto + tags + resolução)...');
  const summaries: ConversationSummary[] = [];
  for (const id of ids) {
    try {
      const s = await fetchConversationSummary(id);
      if (s) { summaries.push(s); stats.analyzed++; }
    } catch (err) {
      stats.errors++;
      errorList.push({ ref: `fetch conv_${id}`, error: err instanceof Error ? err.message : String(err) });
    }
  }
  console.log(`\n✅  ${summaries.length} conversas resumidas.\n`);

  // ── FASE 2: agrupar por tema ──
  console.log('🧩  FASE 2 — Agrupando por tema (palavras-chave, sem IA)...');
  const groups = groupByTheme(summaries);
  stats.groups = groups.length;
  for (const g of groups) {
    console.log(`   • ${g.def.label}: ${g.conversations.length} conversas`);
  }
  if (groups.length === 0) {
    console.log('   (nenhum tema atingiu o mínimo de ' + MIN_GROUP_SIZE + ' conversas)');
  }
  console.log('');

  // Títulos de KB existentes (uma vez só) para contexto da IA
  const { data: kbRows, error: kbErr } = await supabase
    .from('desk_knowledge_base')
    .select('title')
    .in('source', KB_SOURCES_EXISTING);
  if (kbErr) console.warn(`⚠️  Não foi possível carregar títulos da KB: ${kbErr.message}`);
  const allTitles: string[] = (kbRows ?? []).map((r) => r.title as string);

  // ── FASE 3 + 4: análise de gap + import ──
  console.log('🤖  FASE 3 — Analisando gaps com a IA e importando os reais...\n');

  for (const group of groups) {
    const ref = group.def.key;
    process.stdout.write(`  • ${group.def.label}...`);

    let gap: AiGapResult | null;
    try {
      gap = await analyzeGap(group, relatedTitles(allTitles, group.def));
    } catch (err) {
      stats.errors++;
      errorList.push({ ref, error: err instanceof Error ? err.message : String(err) });
      process.stdout.write(` ✗ IA: ${err instanceof Error ? err.message : String(err)}\n`);
      await sleep(AI_DELAY_MS);
      continue;
    }

    if (!gap) {
      stats.errors++;
      errorList.push({ ref, error: 'JSON inválido da IA' });
      process.stdout.write(' ✗ JSON inválido\n');
      await sleep(AI_DELAY_MS);
      continue;
    }

    if (!gap.has_gap || !gap.title) {
      stats.skippedCovered++;
      process.stdout.write(' — já coberto pela KB\n');
      await sleep(AI_DELAY_MS);
      continue;
    }

    stats.withGap++;

    try {
      const result = await insertGapArticle(gap, group.def.key);
      if (result === 'inserted') {
        stats.imported++;
        importedTitles.push(gap.title);
        process.stdout.write(` ✓ "${gap.title.slice(0, 60)}"\n`);
      } else {
        stats.skippedCovered++;
        process.stdout.write(' ↪ já existe (source_id)\n');
      }
    } catch (err) {
      stats.errors++;
      errorList.push({ ref, error: err instanceof Error ? err.message : String(err) });
      process.stdout.write(` ✗ ${err instanceof Error ? err.message : String(err)}\n`);
    }

    await sleep(AI_DELAY_MS);
  }

  // ── FASE 5: relatório ──
  console.log('\n─────────────────────────────────────────');
  console.log('📊  RELATÓRIO FINAL');
  console.log('─────────────────────────────────────────');
  console.log(`  Conversas analisadas    : ${stats.analyzed}`);
  console.log(`  Grupos identificados    : ${stats.groups}`);
  console.log(`  Grupos com gap real     : ${stats.withGap}`);
  console.log(`  Artigos importados      : ${stats.imported}`);
  console.log(`  Pulados (já cobertos)   : ${stats.skippedCovered}`);
  console.log(`  Erros                   : ${stats.errors}`);

  if (importedTitles.length > 0) {
    console.log('\n✅  Artigos criados (rascunho):');
    importedTitles.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  }

  if (errorList.length > 0) {
    console.log('\n❌  Erros:');
    errorList.forEach(({ ref, error }) => console.log(`   • ${ref}: ${error}`));
  }

  console.log('\n─────────────────────────────────────────\n');
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n❌  Erro fatal:', err?.message ?? err);
  process.exit(1);
});
