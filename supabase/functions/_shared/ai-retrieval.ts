// ─── Recuperação de conhecimento da IA (RAG em 3 camadas) ──────────────────────
//
//   1. BUSCA HÍBRIDA — cada consulta roda em desk_kb_hybrid_search, que devolve o
//      ranking vetorial (significado) e o BM25 (palavra exata) de cada trecho.
//      As consultas são a mensagem do cliente e, quando há conversa anterior, a
//      mensagem junto do contexto ("e no advanced?" sozinho não acha nada).
//      Os rankings são fundidos por RRF (Reciprocal Rank Fusion) e agregados por
//      documento.
//   2. SELETOR — um LLM lê a conversa e os 10 melhores candidatos e decide quais
//      respondem de fato à pergunta, reescreve a pergunta de forma autocontida e
//      diz se a base cobre o assunto (total / parcial / nenhuma).
//   3. BUSCA RECURSIVA — se o seletor diz que a base não cobre, ele mesmo propõe
//      novas consultas (sinônimos, o nome certo do produto, o termo técnico) e o
//      ciclo roda mais uma vez com os candidatos novos.
//
// A IA que responde só recebe o que o seletor aprovou, e recebe junto o
// veredito de cobertura — é isso que permite a ela dizer "não tenho isso
// documentado" em vez de preencher o buraco com invenção.
//
// Módulo PURO: embedding, busca e LLM chegam por injeção (RetrievalDeps). A
// Edge Function liga no Supabase/OpenRouter; o laboratório liga em PGlite e
// no gte-small local.

export type DocType = 'article' | 'snippet';

/** Uma linha de desk_kb_hybrid_search. */
export interface SearchHit {
  chunk_id: string;
  doc_type: DocType;
  doc_id: string;
  chunk_index: number;
  title: string;
  heading: string | null;
  content: string;
  vec_rank: number | null;
  vec_similarity: number | null;
  text_rank: number | null;
  text_score: number | null;
}

/** Documento candidato: a fusão dos trechos dele em todas as consultas. */
export interface RankedDoc {
  key: string;
  doc_type: DocType;
  doc_id: string;
  title: string;
  score: number;
  /** Trechos encontrados, melhor primeiro, sem repetição. */
  chunks: Array<SearchHit & { score: number }>;
}

// ─── Fusão (RRF) ──────────────────────────────────────────────────────────────

/** Constante do RRF. 60 é o valor do artigo original e o padrão de mercado. */
const RRF_K = 60;

export function docKey(docType: DocType, docId: string): string {
  return `${docType}:${docId}`;
}

/**
 * Funde os resultados de várias consultas. Cada consulta traz dois rankings
 * (vetorial e BM25); cada ranking dá 1/(k + posição) ao trecho. O documento
 * vale o seu MELHOR trecho.
 *
 * Medido no gabarito de 50 perguntas reais de clientes (ver o PR): híbrido
 * ganha de vetor puro e de BM25 puro, e "melhor trecho" ganha de somar trechos
 * — somar favorece artigo longo que esbarra no assunto em várias seções.
 */
export function fuseHits(hitLists: SearchHit[][]): RankedDoc[] {
  const chunkScores = new Map<string, { hit: SearchHit; score: number }>();

  for (const hits of hitLists) {
    for (const hit of hits) {
      let s = 0;
      if (hit.vec_rank) s += 1 / (RRF_K + hit.vec_rank);
      if (hit.text_rank) s += 1 / (RRF_K + hit.text_rank);
      const prev = chunkScores.get(hit.chunk_id);
      if (prev) prev.score += s;
      else chunkScores.set(hit.chunk_id, { hit, score: s });
    }
  }

  const docs = new Map<string, RankedDoc>();
  for (const { hit, score } of chunkScores.values()) {
    const key = docKey(hit.doc_type, hit.doc_id);
    let doc = docs.get(key);
    if (!doc) {
      doc = { key, doc_type: hit.doc_type, doc_id: hit.doc_id, title: hit.title, score: 0, chunks: [] };
      docs.set(key, doc);
    }
    doc.chunks.push({ ...hit, score });
  }

  for (const doc of docs.values()) {
    doc.chunks.sort((a, b) => b.score - a.score);
    doc.score = doc.chunks[0].score;
  }

  return [...docs.values()].sort((a, b) => b.score - a.score);
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_QUERY_CHARS = 500;

/**
 * Consultas da 1ª rodada, sem LLM: a mensagem como veio e — se o cliente já
 * falou antes nesta conversa — a mensagem com a fala anterior dele na frente.
 * Resposta curta de continuação ("e no advanced?", "onde fica isso?") não tem
 * assunto sozinha; a fusão garante que, se o cliente mudou de assunto, a
 * consulta pura continua mandando.
 */
export function initialQueries(message: string, history: ConversationTurn[]): string[] {
  const queries = [message.slice(0, MAX_QUERY_CHARS)];
  const previousUser = [...history].reverse().find((t) => t.role === 'user')?.content?.trim();
  if (previousUser && previousUser !== message) {
    queries.push(`${previousUser.slice(0, 300)}\n${message}`.slice(0, MAX_QUERY_CHARS));
  }
  return queries;
}

// ─── Seletor (LLM) ────────────────────────────────────────────────────────────

export type Coverage = 'total' | 'parcial' | 'nenhuma';

export interface SelectorVerdict {
  /** Pergunta reescrita de forma autocontida (sem "isso", "e no meu?"). */
  question: string;
  /** false = saudação, agradecimento, dado da conta do cliente: a base não entra. */
  needsKnowledge: boolean;
  /** Números (1-based) dos candidatos que ajudam a responder, do melhor ao pior. */
  relevant: number[];
  coverage: Coverage;
  /** Novas consultas para a busca recursiva (só quando a cobertura não é total). */
  newQueries: string[];
}

/** Quantos candidatos o seletor lê por rodada. */
export const SELECTOR_CANDIDATES = 10;
/** Quantos documentos, no máximo, chegam à IA que responde. */
export const MAX_SELECTED_DOCS = 4;
/** Trecho de cada candidato mostrado ao seletor. */
const EXCERPT_CHARS = 650;

function excerptFor(doc: RankedDoc): string {
  // Os 2 melhores trechos, na ordem em que aparecem no artigo. O trecho que é só
  // o título (ver kb-chunker) não entra: o título já está na linha do candidato.
  const body = doc.chunks.filter((c) => c.content !== doc.title);
  const best = (body.length > 0 ? body : doc.chunks).slice(0, 2).sort((a, b) => a.chunk_index - b.chunk_index);
  const text = best.map((c) => c.content).join('\n[…]\n');
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
}

export const SELECTOR_SYSTEM_PROMPT = `Você é o módulo de busca da central de ajuda da Cloudfy (plataforma de infraestrutura para automações: n8n, Evolution API, Redis, Chatwoot, Supabase, PostgreSQL, IA Ilimitada, MCP, Vibecoding Apps).
Sua tarefa NÃO é responder o cliente. É decidir quais documentos da base respondem à pergunta dele.

Você recebe a conversa recente, a última mensagem do cliente e uma lista numerada de documentos candidatos (artigos e snippets). Snippets são respostas curtas e oficiais da equipe — quando um snippet responde diretamente, ele é o documento mais importante.

Responda SOMENTE com um JSON válido, sem texto antes ou depois:
{"pergunta": "...", "precisa_base": true, "relevantes": [3, 1], "cobertura": "total", "nova_busca": []}

- "pergunta": a dúvida do cliente reescrita como uma pergunta completa e autocontida, usando a conversa para resolver referências ("isso", "e no meu plano?", "onde fica?"). Corrija erros de digitação e use o nome certo dos produtos (ex.: "caludfy" → "Cloudfy", "advacend" → "Advanced", "chatwood" → "Chatwoot").
- "precisa_base": false quando a mensagem é só saudação, agradecimento, confirmação ("ok", "sim"), escolha de um tema genérico sem pergunta, ou pede exclusivamente dados da conta do próprio cliente (status da infra dele, faturas dele). true em qualquer dúvida sobre produto, plano, recurso, preço, política ou como fazer algo.
- "relevantes": os números dos candidatos que contêm informação que ajuda a responder ESTA pergunta, do mais útil ao menos útil, no máximo 4. Documento que só compartilha palavras com a pergunta mas trata de outro assunto NÃO é relevante (ex.: pergunta sobre o MCP estar incluso no plano ≠ artigo sobre revogar acesso do MCP). Lista vazia se nenhum ajuda.
- "cobertura": "total" se os relevantes respondem a pergunta; "parcial" se respondem só uma parte; "nenhuma" se nenhum candidato responde.
- "nova_busca": se a cobertura não for "total", até 3 consultas curtas e diferentes das já tentadas para buscar de novo na base (sinônimos, o termo técnico, o nome do recurso na Cloudfy). Lista vazia se a cobertura for "total" ou "precisa_base" for false.

Julgue pelo conteúdo, não pelo título. Nunca invente números de candidatos que não estão na lista.`;

export function buildSelectorUserPrompt(
  message: string,
  history: ConversationTurn[],
  candidates: RankedDoc[],
  triedQueries: string[],
): string {
  const convo = history.slice(-6).map((t) => {
    const who = t.role === 'user' ? 'Cliente' : 'Atendimento';
    const text = t.content.replace(/\s+/g, ' ').trim();
    return `${who}: ${text.length > 400 ? `${text.slice(0, 400)}…` : text}`;
  }).join('\n');

  const list = candidates.map((doc, i) => {
    const kind = doc.doc_type === 'snippet' ? 'SNIPPET' : 'ARTIGO';
    return `#${i + 1} [${kind}] ${doc.title}\n${excerptFor(doc)}`;
  }).join('\n\n');

  return [
    convo ? `[CONVERSA RECENTE]\n${convo}` : '[CONVERSA RECENTE]\n(início da conversa)',
    `[ÚLTIMA MENSAGEM DO CLIENTE]\n${message}`,
    `[CONSULTAS JÁ TENTADAS]\n${triedQueries.map((q) => `- ${q.replace(/\s+/g, ' ')}`).join('\n')}`,
    `[CANDIDATOS]\n${list || '(nenhum candidato encontrado)'}`,
  ].join('\n\n');
}

function asStringArray(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean).slice(0, max)
    : [];
}

/** Lê o JSON do seletor. null = resposta inutilizável (o pipeline cai no RRF puro). */
export function parseSelectorVerdict(raw: string, candidateCount: number): SelectorVerdict | null {
  const text = String(raw ?? '').replace(/```(?:json)?/gi, '');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }

  const relevant: number[] = [];
  if (Array.isArray(parsed.relevantes)) {
    for (const n of parsed.relevantes) {
      const i = typeof n === 'number' ? n : Number(n);
      if (Number.isInteger(i) && i >= 1 && i <= candidateCount && !relevant.includes(i)) relevant.push(i);
    }
  }

  const cov = String(parsed.cobertura ?? '').toLowerCase();
  const coverage: Coverage = cov === 'total' || cov === 'parcial' ? cov : 'nenhuma';

  return {
    question: typeof parsed.pergunta === 'string' ? parsed.pergunta.trim().slice(0, MAX_QUERY_CHARS) : '',
    needsKnowledge: parsed.precisa_base !== false,
    relevant: relevant.slice(0, MAX_SELECTED_DOCS),
    // Sem documento relevante não existe cobertura, diga o modelo o que disser.
    coverage: relevant.length === 0 ? 'nenhuma' : coverage,
    newQueries: asStringArray(parsed.nova_busca, 3).map((q) => q.slice(0, MAX_QUERY_CHARS)),
  };
}

// ─── Orquestração ─────────────────────────────────────────────────────────────

export interface RetrievalDeps {
  embed(text: string): Promise<number[]>;
  search(queryText: string, embedding: number[] | null): Promise<SearchHit[]>;
  /** Chamada ao LLM do seletor (system + user → texto). Opcional: sem ela, RRF puro. */
  select?(system: string, user: string): Promise<string>;
  log?(msg: string): void;
}

export interface RetrievalResult {
  /** Pergunta autocontida (do seletor) ou a própria mensagem. */
  question: string;
  needsKnowledge: boolean;
  /** Documentos aprovados, do mais ao menos útil. */
  docs: RankedDoc[];
  /** 'desconhecida' = o seletor falhou e os documentos vieram só do ranking. */
  coverage: Coverage | 'desconhecida';
  rounds: number;
  queries: string[];
  /** Top candidatos vistos (para log/diagnóstico). */
  candidates: RankedDoc[];
}

/** Máximo de rodadas de busca (1 inicial + 1 recursiva). Cada rodada custa uma
 *  chamada de LLM; a terceira quase nunca acha o que as duas primeiras não acharam. */
const MAX_ROUNDS = 2;

async function runQueries(deps: RetrievalDeps, queries: string[]): Promise<SearchHit[][]> {
  return Promise.all(queries.map(async (q) => {
    let embedding: number[] | null = null;
    try {
      embedding = await deps.embed(q);
    } catch (e) {
      // Sem vetor a busca por palavra ainda funciona.
      deps.log?.(`[RAG] embedding falhou, seguindo só com BM25: ${e instanceof Error ? e.message : e}`);
    }
    try {
      return await deps.search(q, embedding);
    } catch (e) {
      deps.log?.(`[RAG] busca falhou para "${q.slice(0, 60)}": ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }));
}

export async function retrieveKnowledge(
  deps: RetrievalDeps,
  message: string,
  history: ConversationTurn[],
): Promise<RetrievalResult> {
  const queries = initialQueries(message, history);
  const hitLists = await runQueries(deps, queries);
  let ranked = fuseHits(hitLists);
  let candidates = ranked.slice(0, SELECTOR_CANDIDATES);

  const fallback = (rounds: number): RetrievalResult => ({
    question: message,
    needsKnowledge: true,
    docs: candidates.slice(0, MAX_SELECTED_DOCS),
    coverage: 'desconhecida',
    rounds,
    queries,
    candidates,
  });

  // Sem candidatos o seletor ainda roda: ele pode propor a consulta certa
  // (erro de digitação, nome do recurso) para a rodada recursiva.
  if (!deps.select) return fallback(1);

  let verdict: SelectorVerdict | null = null;
  let shown = candidates;
  let rounds = 0;

  while (rounds < MAX_ROUNDS) {
    rounds++;
    let raw: string;
    try {
      raw = await deps.select(SELECTOR_SYSTEM_PROMPT, buildSelectorUserPrompt(message, history, shown, queries));
    } catch (e) {
      deps.log?.(`[RAG] seletor falhou (rodada ${rounds}): ${e instanceof Error ? e.message : e}`);
      break;
    }

    const next = parseSelectorVerdict(raw, shown.length);
    if (!next) {
      deps.log?.(`[RAG] seletor devolveu JSON inválido (rodada ${rounds})`);
      break;
    }
    verdict = next;
    candidates = shown;

    const wantsMore = verdict.needsKnowledge && verdict.coverage !== 'total' && verdict.newQueries.length > 0;
    if (!wantsMore || rounds >= MAX_ROUNDS) break;

    // Busca recursiva: consultas novas do seletor + a pergunta reescrita.
    const fresh = [...verdict.newQueries, verdict.question]
      .map((q) => q.trim())
      .filter((q) => q && !queries.includes(q));
    if (fresh.length === 0) break;
    queries.push(...fresh);
    deps.log?.(`[RAG] busca recursiva: ${fresh.map((q) => `"${q}"`).join(', ')}`);

    hitLists.push(...await runQueries(deps, fresh));
    ranked = fuseHits(hitLists);

    // Rodada 2: o que o seletor já aprovou fica no topo; o resto é o melhor do
    // ranking novo que ele ainda não viu.
    const approved = verdict.relevant.map((n) => shown[n - 1]).filter(Boolean);
    const seen = new Set(shown.map((d) => d.key));
    const unseen = ranked.filter((d) => !seen.has(d.key));
    const approvedKeys = new Set(approved.map((d) => d.key));
    const refreshedApproved = approved.map((d) => ranked.find((r) => r.key === d.key) ?? d);
    shown = [...refreshedApproved, ...unseen, ...ranked.filter((d) => seen.has(d.key) && !approvedKeys.has(d.key))]
      .slice(0, SELECTOR_CANDIDATES);
  }

  if (!verdict) return fallback(Math.max(rounds, 1));

  return {
    question: verdict.question || message,
    needsKnowledge: verdict.needsKnowledge,
    docs: verdict.needsKnowledge ? verdict.relevant.map((n) => candidates[n - 1]).filter(Boolean) : [],
    coverage: verdict.coverage,
    rounds,
    queries,
    candidates,
  };
}
