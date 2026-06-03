import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { corsHeaders } from '../_shared/cors.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AIRespondRequest {
  conversation_id: string;
  message: string;
  account_name?: string;
  account_email?: string; // passed by widget directly — avoids account table lookup
}

interface MessageMetadata {
  quick_replies?: string[];
}

interface AIRespondResult {
  reply: string | null;
  should_handoff: boolean;
  blocked?: boolean;
  metadata?: MessageMetadata | null;
}

interface MessageRow {
  sender_type: string;
  content: string;
}

interface KBMatch {
  id: string;
  title: string;
  content: string;
  category: string | null;
  source: string | null;
  source_id: string | null;
  similarity: number;
}

// ─── Plan tag ─────────────────────────────────────────────────────────────────

// Hierarquia de planos: Max > Ultra > Advanced > Starter.
// A tag mais alta vence; se o cliente não tem nenhuma assinatura ativa, usa 'sem-plano'.
const PLAN_HIERARCHY = ['max', 'ultra', 'advanced', 'starter'] as const;
type PlanTag = (typeof PLAN_HIERARCHY)[number] | 'sem-plano';

function detectPlanTag(subscriptions: ContactSubscription[]): PlanTag {
  const active = subscriptions.filter((s) => {
    const st = (s.status ?? '').toLowerCase();
    return st === 'active' || st === 'completed';
  });
  if (active.length === 0) return 'sem-plano';

  for (const plan of PLAN_HIERARCHY) {
    if (active.some((s) => (s.product ?? '').toLowerCase().includes(plan))) return plan;
  }
  return 'sem-plano';
}

/** Aplica a tag de plano à conversa (fire-and-forget, não bloqueia a resposta). */
async function applyPlanTag(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  tag: PlanTag,
): Promise<void> {
  try {
    // Remove tags de plano antigas e adiciona a nova.
    const planTags = [...PLAN_HIERARCHY, 'sem-plano'] as string[];

    // 1. Busca as tags atuais da conversa
    const { data: conv } = await supabase
      .from('desk_conversations')
      .select('tags')
      .eq('id', conversationId)
      .maybeSingle();

    const currentTags: string[] = (conv as Record<string, unknown> | null)?.tags as string[] ?? [];
    const filtered = currentTags.filter((t) => !planTags.includes(t));
    const newTags = [...filtered, tag];

    await supabase
      .from('desk_conversations')
      .update({ tags: newTags })
      .eq('id', conversationId);
  } catch (e) {
    console.warn('[AI] applyPlanTag failed:', e instanceof Error ? e.message : e);
  }
}

// Base pública da Central de Ajuda própria do CloudDesk (rota /ajuda do app).
// Configurável via env HELP_CENTER_URL — sem barra final. Default: produção.
const HELP_CENTER_URL = (Deno.env.get('HELP_CENTER_URL') ?? 'https://ajuda.cloudfy.cloud').replace(/\/+$/, '');

// Gera o slug do título igual ao usado no frontend (HelpCenter.articlePath).
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 60);
}

// URL pública do artigo na Central de Ajuda PRÓPRIA (rota /ajuda/:id-slug do app),
// não mais o Intercom externo. A chave é source_id (quando importado) ou o id interno.
// Espelha src/pages/HelpCenter.tsx → articlePath().
function kbArticleUrl(
  _source: string | null,
  sourceId: string | null,
  id?: string | null,
  title?: string | null,
): string | null {
  const key = sourceId ?? id;
  if (!key) return null;
  const slug = title ? slugifyTitle(title) : '';
  return `${HELP_CENTER_URL}/ajuda/${key}${slug ? `-${slug}` : ''}`;
}

interface FAQMatch {
  id: string;
  question: string;
  answer: string;
  similarity: number;
}

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

interface OpenAIChatResponse {
  choices: Array<{ message: { content: string } }>;
}

interface ContactCustomer {
  name: string;
  email: string;
  customer_id: string;
  referral: string;
}

interface ContactSubscription {
  subscription_id: string;
  status: string;        // normalized: active | canceled | pending | unpaid
  infra_status: string;  // raw: DEPLOYED | DEPLOYING | STOPPED | BLOCKED
  product: string;
  mrr: number;
  interval: string;
  promocode: string;
  created_at: string;
}

interface ContactInfra {
  subscription_id: string;
  infra_id: string;
  purchase_code: string;
  default_domain: string;
  status: string;        // raw deployment_status
  requests_24h: number;
  requests_7d: number;
  requests_30d: number;
}

interface ContactInfoResult {
  customer: ContactCustomer | null;
  subscriptions: ContactSubscription[];
  infras: ContactInfra[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TRANSFER_KEYWORD = '[TRANSFERIR]';

const BASE_SYSTEM_PROMPT = `Você é Luna, assistente virtual de suporte da Cloudfy, uma empresa SaaS de infraestrutura.
Seja profissional, amigável e direta. Use linguagem simples e acessível.
Responda em português do Brasil. Respostas curtas e objetivas (máximo 3 parágrafos).
Ao final, pergunte se o cliente precisa de mais ajuda.

[OPÇÕES CLICÁVEIS]
Quando quiser oferecer opções ao usuário, use o formato [OPCOES: Opção 1 | Opção 2 | Opção 3] no final da sua mensagem.

[REENVIO DE CREDENCIAIS DE ACESSO]
Quando o cliente pedir credenciais, acesso, senha, login ou qualquer dado de acesso à infraestrutura:

1. Primeiro tente resolver com os artigos da base de conhecimento.
2. Se não resolver, ofereça o reenvio das credenciais. Liste APENAS as infraestruturas ATIVAS do cliente (aquelas com Deploy DEPLOYED ou status ativo no bloco DADOS DO CLIENTE) como opções clicáveis. Use exatamente este formato:

'Posso reenviar suas credenciais de acesso. Sobre qual infraestrutura você quer receber?
[OPCOES: {nome da infra ativa 1} | {nome da infra ativa 2}]'

   Use os nomes das infraestruturas exatamente como aparecem no bloco DADOS DO CLIENTE. Se o cliente tiver apenas uma infra ativa, ofereça-a mesmo assim como opção única.
3. Quando o cliente selecionar a infraestrutura (a próxima mensagem dele será o nome de uma infra), inclua o marcador [ACTION: resend_credentials] na sua resposta e diga exatamente:

'Credenciais reenviadas! Dá uma olhadinha no seu e-mail e me fala se chegou tudo certinho? 📬'

IMPORTANTE: reenvio de credenciais NÃO é reset de senha — são os dados de acesso ORIGINAIS da infraestrutura. Nunca prometa redefinir senha; apenas reenvie as credenciais existentes.`;

// ─── OpenAI helpers ───────────────────────────────────────────────────────────

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  if (!apiKey) throw new Error('OPENAI_API_KEY not set — RAG skipped');
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embedding error ${res.status}: ${err}`);
  }

  const data: OpenAIEmbeddingResponse = await res.json();
  return data.data[0].embedding;
}

// Chama o LLM via OpenRouter (suporta qualquer provider com a mesma API).
// Modelo configurável via env LLM_MODEL (default: google/gemini-2.5-flash).
async function callLLM(
  apiKey: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const model = Deno.env.get('LLM_MODEL') ?? 'google/gemini-2.5-flash';

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://cloudfy.host',
      'X-Title': 'CloudDesk',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7,
      max_tokens: 512,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter chat error ${res.status}: ${err}`);
  }

  const data: OpenAIChatResponse = await res.json();
  return data.choices[0].message.content;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildClientContext(info: ContactInfoResult | null): string {
  if (!info?.customer) return '';

  const { customer, subscriptions, infras } = info;

  const formatDate = (iso: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const subLines = subscriptions.map((s) => {
    const infra = infras.find((inf) => inf.subscription_id === s.subscription_id);
    const date = formatDate(s.created_at);
    const head = `- ${s.product} | Status: ${s.status} | Desde: ${date}`;
    const infraLine = infra
      ? `  Infra: ${infra.default_domain || infra.purchase_code} | Deploy: ${infra.status}`
      : '';
    return [head, infraLine].filter(Boolean).join('\n');
  }).join('\n');

  return `
--- DADOS DO CLIENTE ---
Nome: ${customer.name}
Email: ${customer.email}

Assinaturas:
${subLines || '(nenhuma assinatura registrada)'}
------------------------

--- REGRAS SOBRE OS DADOS DO CLIENTE ---
- Você TEM acesso aos dados reais do cliente acima.
- Use essas informações para responder com precisão.
- NUNCA diga que não tem acesso a informações que estão no bloco DADOS DO CLIENTE.
- Para valores de plano ou preço, diga que não tem essa informação — ela NÃO está nos dados disponíveis.
- NUNCA INVENTE produtos, planos ou infraestruturas que não estejam listados no bloco DADOS DO CLIENTE. Use SOMENTE os nomes que aparecem ali, EXATAMENTE como estão escritos.
- Ao listar assinaturas/infras do cliente, copie os nomes e status exatamente do bloco — não os traduza, não os "embeleze", não invente descrições.
- NUNCA mencione nomes de campos internos: purchase_code, infra_id, customer_id, subscription_id, default_domain.
- Para se referir à infraestrutura, use o nome (ex.: "sua infraestrutura icyskate") ou apenas "sua infraestrutura".
- Tom: prestativo, direto, sem jargão técnico.
-----------------------------------------
`;
}

/**
 * Decide se o cliente é "somente Starter" — caso em que a IA nunca transfere.
 *
 * Regra: se houver QUALQUER assinatura ativa que NÃO seja Starter (Advanced,
 * Ultra, Max, etc.) → atendimento humano normal (isStarterOnly=false).
 * Se TODAS as assinaturas ativas forem Starter, ou não houver assinatura ativa
 * → nunca transfere (isStarterOnly=true).
 */
function isStarterOnlyClient(contactInfo?: ContactInfoResult | null): boolean {
  const subscriptions = contactInfo?.subscriptions ?? [];
  const activeSubscriptions = subscriptions.filter((s) => {
    const st = (s.status ?? '').toLowerCase();
    return st === 'active' || st === 'completed';
  });
  const hasNonStarter = activeSubscriptions.some(
    (s) => !(s.product ?? '').toLowerCase().includes('starter'),
  );
  return !hasNonStarter;
}

function buildSystemPrompt(
  kbMatches: KBMatch[],
  faqMatches: FAQMatch[],
  clientName?: string,
  contactInfo?: ContactInfoResult | null,
  isFirstMessage?: boolean,
): string {
  const clientSection = clientName
    ? `\n[CLIENTE]\nVocê está atendendo: ${clientName}. Cumprimente-o pelo nome na primeira mensagem.\n`
    : '';

  // Build KB section — show title + full content for each relevant article
  let contextSection: string;
  if (kbMatches.length === 0 && faqMatches.length === 0) {
    contextSection = 'Nenhum conteúdo relevante encontrado na base de conhecimento para esta pergunta.';
  } else {
    const parts: string[] = [];

    if (kbMatches.length > 0) {
      parts.push('[ARTIGOS RELEVANTES]');
      for (const kb of kbMatches) {
        const url = kbArticleUrl(kb.source, kb.source_id, kb.id, kb.title);
        parts.push(
          `Artigo: ${kb.title}${kb.category ? ` (${kb.category})` : ''}\n` +
          `URL: ${url ?? 'null'}\n` +
          `Conteúdo: ${kb.content}`,
        );
      }
    }

    if (faqMatches.length > 0) {
      parts.push('[PERGUNTAS FREQUENTES RELEVANTES]');
      for (const faq of faqMatches) {
        parts.push(`P: ${faq.question}\nR: ${faq.answer}`);
      }
    }

    contextSection = parts.join('\n\n---\n\n');
  }

  const contactContext = buildClientContext(contactInfo ?? null);

  // Somente Starter (sem nenhuma assinatura ativa não-Starter): a IA NUNCA transfere.
  const starterRule = isStarterOnlyClient(contactInfo)
    ? `
[PLANO STARTER — SEM TRANSFERÊNCIA]
Este cliente tem apenas plano(s) Starter ativo(s). NUNCA transfira para humano — mesmo que ele peça explicitamente. NÃO use ${TRANSFER_KEYWORD} em nenhuma hipótese.
Tente resolver tudo você mesma. Se não conseguir resolver, oriente o cliente a usar a Central de ajuda (${HELP_CENTER_URL}/ajuda) e o Discord (https://discord.gg/uDftSRtfKe).
`
    : '';

  const firstMessageInstruction = isFirstMessage && contactInfo?.customer
    ? `
[PRIMEIRA MENSAGEM — SAUDAÇÃO PROATIVA OBRIGATÓRIA]
Esta é a primeira mensagem do cliente. NÃO pergunte apenas "Como posso ajudar?".
Cumprimente pelo nome e apresente um resumo do que você já sabe sobre ele, no seguinte formato:

"Olá, ${contactInfo.customer.name}! Vi aqui no seu perfil:
${contactInfo.subscriptions.filter(s => s.status === 'active').map(s => {
  const infra = contactInfo.infras.find(i => i.subscription_id === s.subscription_id);
  return infra
    ? `• ${s.product} (sua infraestrutura: ${infra.default_domain || infra.purchase_code})`
    : `• ${s.product}`;
}).join('\n')}

Sobre o que você precisa de ajuda hoje?"

Se não houver assinaturas ativas, apenas cumprimente pelo nome e pergunte como pode ajudar.
Adapte o tom — não copie o formato acima palavra por palavra, mas inclua as informações.
`
    : '';

  return `${BASE_SYSTEM_PROMPT}
${clientSection}${contactContext}${firstMessageInstruction}${starterRule}
---

[REGRA DE TRANSFERÊNCIA — OBRIGATÓRIA]
NÃO transfira para humano por padrão. Antes de pensar em transferir, siga esta ordem:

1. Se a pergunta puder ser respondida pelos DADOS DO CLIENTE ou pela base de conhecimento, responda normalmente.
2. Se for uma dúvida genérica (não técnica) que você consegue responder com bom senso, responda você mesma — não transfira.
3. Se for uma pergunta completamente fora do contexto de suporte da Cloudfy (ex.: "onde comprar coca-cola", receitas, assuntos pessoais, notícias), NÃO transfira: responda educadamente que você só pode ajudar com questões relacionadas à Cloudfy (infraestrutura, n8n, Evolution API, assinaturas, etc.) e ofereça ajuda nesses temas.

Você DEVE responder APENAS com a palavra-chave ${TRANSFER_KEYWORD} SOMENTE em um destes casos:
  a) O cliente pediu EXPLICITAMENTE para falar com um humano/atendente; OU
  b) É um problema técnico específico que realmente precisa de intervenção humana e que você não consegue resolver — por exemplo: infraestrutura bloqueada, problema de pagamento/cobrança não resolvido, ou um bug reportado pelo cliente.

Quando transferir, retorne APENAS ${TRANSFER_KEYWORD} — nada antes ou depois, sem explicação.
Dúvida genérica, pergunta fora de contexto, ou algo que você consegue responder NÃO são motivos para transferir.

Se o cliente tem APENAS plano(s) Starter ativo(s) (nenhuma assinatura ativa de Advanced, Ultra, Max ou outro), NUNCA transfira para humano — mesmo que peça. Tente resolver tudo. Se não conseguir, oriente para a Central de ajuda (${HELP_CENTER_URL}/ajuda) e o Discord (https://discord.gg/uDftSRtfKe). Se o cliente tiver alguma assinatura ativa não-Starter, o atendimento humano é normal.

---

[BASE DE CONHECIMENTO — FONTE COMPLEMENTAR]
Use o conteúdo abaixo COMBINADO com o bloco DADOS DO CLIENTE para responder. Os dois são fontes válidas. Se a pergunta for sobre dados específicos do cliente (status da infraestrutura, assinaturas dele etc.), priorize o bloco DADOS DO CLIENTE. Para perguntas gerais ou de como-fazer, use a base de conhecimento.

Cada artigo abaixo tem um campo "URL". Quando você usar as informações de um artigo para montar a resposta, adicione no final da resposta:

📚 Fonte: [título do artigo](url)

Inclua a fonte APENAS se o artigo realmente usado tiver uma URL (campo URL diferente de "null"). Se a URL for "null", NÃO cite a fonte daquele artigo. Nunca invente URLs nem use uma URL diferente da fornecida. Se usar mais de um artigo com URL, liste uma linha "📚 Fonte:" por artigo.

${contextSection}`;
}

// ─── Reply marker parsing ───────────────────────────────────────────────────
// The model can embed two markers in its reply:
//   [OPCOES: A | B | C]          → clickable quick-reply chips
//   [ACTION: resend_credentials] → triggers the credential-resend flow server-side
// Both are stripped from the visible text; OPCOES is lifted into metadata and
// the resend action is flagged so the handler can fire desk-resend-credentials.

const OPCOES_RE = /\[OPCOES:\s*([^\]]+)\]/i;
const RESEND_ACTION_RE = /\[ACTION:\s*resend_credentials\s*\]/i;

function parseReplyMarkers(
  raw: string,
): { text: string; metadata: MessageMetadata | null; resendCredentials: boolean } {
  let text = raw;
  const metadata: MessageMetadata = {};

  const opcoesMatch = text.match(OPCOES_RE);
  if (opcoesMatch) {
    const options = opcoesMatch[1]
      .split('|')
      .map((o) => o.trim())
      .filter(Boolean);
    if (options.length > 0) metadata.quick_replies = options;
    text = text.replace(OPCOES_RE, '');
  }

  const resendCredentials = RESEND_ACTION_RE.test(text);
  if (resendCredentials) text = text.replace(RESEND_ACTION_RE, '');

  text = text.replace(/\n{3,}/g, '\n\n').trim();

  const hasMetadata = !!metadata.quick_replies;
  return { text, metadata: hasMetadata ? metadata : null, resendCredentials };
}

// ─── Credential resend (server-side) ──────────────────────────────────────────
// True only for an infra the client can actually receive credentials for.
function isActiveInfra(infra: ContactInfra): boolean {
  return String(infra.status ?? '').toUpperCase() === 'DEPLOYED';
}

// Normaliza para casar nomes de infra contra o texto livre do cliente.
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Cruza o nome da infra mencionado pelo cliente com as infras ATIVAS do contato.
// Retorna o infra_id correspondente, ou null se não houver um match seguro.
function resolveInfraId(mentionText: string, infras: ContactInfra[]): string | null {
  const active = infras.filter(isActiveInfra).filter((i) => i.infra_id);
  if (active.length === 0) return null;

  const haystack = normalizeName(mentionText);

  // Match por nome (default_domain ou purchase_code) contido na mensagem.
  for (const infra of active) {
    const candidates = [infra.default_domain, infra.purchase_code]
      .filter(Boolean)
      .map(normalizeName)
      .filter((c) => c.length >= 3);
    if (candidates.some((c) => haystack.includes(c))) return infra.infra_id;
  }

  // Se há apenas uma infra ativa, assume que é ela (cliente clicou na única opção).
  if (active.length === 1) return active[0].infra_id;

  return null;
}

// Aciona o reenvio de credenciais chamando a API de parceiros da Cloudfy
// DIRETAMENTE (inline), igual ao fetchContactInfo. Não fazemos function-to-function
// HTTP para desk-resend-credentials porque o gateway de Edge Functions rejeita a
// autenticação interna (UNAUTHORIZED_INVALID_JWT_FORMAT) — mesma razão pela qual
// get-contact-info foi inlined aqui. A Cloudfy envia o e-mail; só disparamos.
const CLOUDFY_PARTNER_BASE = 'https://partner.cloudfy.space';

async function triggerResendCredentials(infraId: string): Promise<boolean> {
  const partnerKey = Deno.env.get('CLOUDFY_PARTNER_KEY');
  if (!partnerKey) {
    console.error('[AI] triggerResendCredentials: CLOUDFY_PARTNER_KEY missing');
    return false;
  }

  try {
    const url = `${CLOUDFY_PARTNER_BASE}/api/partners/infrastructure/${encodeURIComponent(infraId)}/resend-credentials`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Partner-Key': partnerKey,
        'Content-Type': 'application/json',
      },
    });
    const data = await res.json().catch(() => null) as { success?: boolean } | null;
    const ok = res.ok && data?.success !== false;
    if (!ok) console.error(`[AI] resend-credentials failed: ${res.status}`, JSON.stringify(data));
    return ok;
  } catch (e) {
    console.error('[AI] triggerResendCredentials failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

// ─── Contact info (inlined from get-contact-info) ─────────────────────────────
// We query the Cloudfy production Supabase directly here instead of HTTP-calling
// the get-contact-info Edge Function. The Edge gateway rejects internal
// function-to-function JWT authentication with UNAUTHORIZED_INVALID_JWT_FORMAT
// when the env exposes a publishable key (sb_publishable_...) rather than the
// legacy anon JWT. Inlining is faster and avoids that gateway round-trip.
// READ-ONLY: only .select() against account / infrastructure / products / purchases.

interface InfraQueryRow {
  id: string;
  default_domain: string | null;
  deployment_status: string | null;
  created_at: string;
  products: { name: string | null } | null;
  purchase: {
    id: string;
    purchase_code: string | null;
    stripe_subscription_id: string | null;
    amount: number | null;
  } | null;
}

function normalizeInfraStatus(raw: string | null | undefined): string {
  if (!raw) return '';
  const v = String(raw).toUpperCase();
  if (v === 'DEPLOYED')  return 'active';
  if (v === 'DEPLOYING') return 'pending';
  if (v === 'STOPPED')   return 'canceled';
  if (v === 'BLOCKED')   return 'unpaid';
  return raw.toLowerCase();
}

async function fetchContactInfo(email: string): Promise<ContactInfoResult | null> {
  const prodUrl = Deno.env.get('CLOUDFY_SUPABASE_URL');
  const prodKey = Deno.env.get('CLOUDFY_SUPABASE_SERVICE_ROLE_KEY');
  if (!prodUrl || !prodKey) {
    console.warn('[AI] fetchContactInfo: CLOUDFY_SUPABASE_* secrets missing');
    return null;
  }

  const prod = createClient(prodUrl, prodKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: accRow } = await prod
    .from('account')
    .select('id, name, email, stripe_customer_id')
    .eq('email', email)
    .maybeSingle();

  const customer: ContactCustomer | null = accRow
    ? {
        name:        accRow.name ?? '',
        email:       accRow.email,
        customer_id: accRow.stripe_customer_id ?? '',
        referral:    '',
      }
    : null;

  const { data: infraRows } = await prod
    .from('infrastructure')
    .select(
      'id, default_domain, deployment_status, created_at, ' +
      'products(name), ' +
      'purchase:purchases!infrastructure_purchase_id_fkey!inner(' +
        'id, purchase_code, stripe_subscription_id, amount, client_email' +
      ')',
    )
    .eq('purchase.client_email', email)
    .order('created_at', { ascending: false });

  const rows = (infraRows ?? []) as unknown as InfraQueryRow[];

  const subscriptions: ContactSubscription[] = rows.map((row) => {
    const subscriptionId = row.purchase?.stripe_subscription_id ?? row.purchase?.id ?? row.id;
    return {
      subscription_id: subscriptionId,
      status:          normalizeInfraStatus(row.deployment_status),
      infra_status:    row.deployment_status ?? '',
      product:         row.products?.name ?? '',
      mrr:             typeof row.purchase?.amount === 'number' ? row.purchase.amount : 0,
      interval:        '',
      promocode:       '',
      created_at:      row.created_at,
    };
  });

  const infras: ContactInfra[] = rows.map((row) => {
    const subscriptionId = row.purchase?.stripe_subscription_id ?? row.purchase?.id ?? row.id;
    return {
      subscription_id: subscriptionId,
      infra_id:        row.id,
      purchase_code:   row.purchase?.purchase_code ?? row.default_domain ?? '',
      default_domain:  row.default_domain ?? '',
      status:          row.deployment_status ?? '',
      requests_24h:    0,
      requests_7d:     0,
      requests_30d:    0,
    };
  });

  return { customer, subscriptions, infras };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: AIRespondRequest = await req.json();
    const { conversation_id, message, account_name, account_email } = body;

    if (!conversation_id || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: conversation_id, message' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[AI] conversation=${conversation_id} message="${message.substring(0, 60)}"`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase env vars');

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Guard: skip if conversation is not AI-active or already resolved/pending ─
    const { data: convRow, error: convErr } = await supabase
      .from('desk_conversations')
      .select('ai_active, status, account_user_id')
      .eq('id', conversation_id)
      .maybeSingle();

    if (convErr) {
      console.warn('[AI] Failed to fetch conversation state:', convErr.message);
    }

    if (
      convRow &&
      (!convRow.ai_active || convRow.status === 'pending' || convRow.status === 'resolved')
    ) {
      console.log(`[AI] Blocked — ai_active=${convRow.ai_active} status=${convRow.status}`);
      const blocked: AIRespondResult = { reply: null, should_handoff: false, blocked: true };
      return new Response(
        JSON.stringify(blocked),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY secret');

    // Embeddings continuam na OpenAI (modelo text-embedding-3-small).
    // Se OPENAI_API_KEY não estiver definida, o RAG é pulado graciosamente.
    const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? '';

    // ── Step 1: Conversation history + client contact info in parallel ─────────
    const accountUserId = (convRow as Record<string, unknown> | null)?.account_user_id as string | undefined;

    // Resolve client email: use account_email from request body if provided (widget path),
    // otherwise fall back to querying the account table by user_id.
    // Non-fatal: if any step fails, the AI proceeds without client context.
    const contactInfoPromise: Promise<ContactInfoResult | null> = (async () => {
      try {
        let email = account_email ?? null;

        if (!email && accountUserId) {
          const { data: acc } = await supabase
            .from('account')
            .select('email')
            .eq('user_id', accountUserId)
            .maybeSingle();
          email = acc?.email ?? null;
        }

        if (!email) return null;

        return await fetchContactInfo(email);
      } catch (e) {
        console.warn('[AI] get-contact-info failed:', e instanceof Error ? e.message : e);
        return null;
      }
    })();

    const historyPromise = supabase
      .from('desk_messages')
      .select('sender_type, content')
      .eq('conversation_id', conversation_id)
      .eq('is_private_note', false)
      .order('created_at', { ascending: false })
      .limit(10);

    const [contactInfo, { data: historyRows, error: historyErr }] = await Promise.all([
      contactInfoPromise,
      historyPromise,
    ]);

    if (historyErr) console.warn('[AI] History fetch failed:', historyErr.message);
    console.log(
      `[AI] contact=${contactInfo?.customer?.name ?? 'unknown'} ` +
      `subs=${contactInfo?.subscriptions?.length ?? 0} ` +
      `infras=${contactInfo?.infras?.length ?? 0}`
    );

    const history = ((historyRows ?? []) as MessageRow[]).reverse();
    const isFirstMessage = history.length === 0;
    console.log(`[AI] History: ${history.length} messages, firstMessage=${isFirstMessage}`);

    // Tag automática por plano (item 2). Fire-and-forget: não bloqueia a resposta.
    // Mantém desk_conversations.tags com a tag do plano mais alto do cliente.
    const planTag = detectPlanTag(contactInfo?.subscriptions ?? []);
    void applyPlanTag(supabase, conversation_id, planTag);
    console.log(`[AI] Plan tag: ${planTag}`);

    // ── Step 2: Semantic search (RAG) ─────────────────────────────────────────
    // Generate embedding for the user's message, then query KB and FAQ in parallel.
    // Falls back gracefully: if embedding fails, the AI responds without KB context.
    let kbMatches: KBMatch[] = [];
    let faqMatches: FAQMatch[] = [];

    try {
      const embedding = await generateEmbedding(message, openaiKey);
      console.log('[AI] Embedding generated');

      const [kbRes, faqRes] = await Promise.all([
        supabase.rpc('match_knowledge_base', {
          query_embedding: embedding,
          match_threshold: 0.5,
          match_count: 5,
        }),
        supabase.rpc('match_faq', {
          query_embedding: embedding,
          match_threshold: 0.5,
          match_count: 3,
        }),
      ]);

      if (kbRes.error) {
        console.warn('[AI] KB search failed:', kbRes.error.message);
      } else {
        kbMatches = (kbRes.data ?? []) as KBMatch[];
      }

      if (faqRes.error) {
        console.warn('[AI] FAQ search failed:', faqRes.error.message);
      } else {
        faqMatches = (faqRes.data ?? []) as FAQMatch[];
      }

      console.log(`[AI] RAG: ${kbMatches.length} KB articles, ${faqMatches.length} FAQs`);
    } catch (embedErr) {
      // Non-fatal: AI will respond without KB context rather than failing entirely
      console.warn('[AI] Embedding/search failed — responding without KB context:', embedErr);
    }

    // ── Step 3: Build prompt + call OpenAI ────────────────────────────────────
    const systemPrompt = buildSystemPrompt(kbMatches, faqMatches, account_name, contactInfo, isFirstMessage);

    const chatMessages = history.map((m) => ({
      role: m.sender_type === 'contact' ? 'user' : 'assistant',
      content: m.content,
    }));
    chatMessages.push({ role: 'user', content: message });

    const rawReply = await callLLM(apiKey, systemPrompt, chatMessages);
    console.log(`[AI] Reply: "${rawReply.substring(0, 80)}"`);

    // Somente Starter nunca transfere — reforço server-side caso o modelo ignore o prompt.
    const isStarterClient = isStarterOnlyClient(contactInfo);
    const should_handoff = !isStarterClient && rawReply.includes(TRANSFER_KEYWORD);

    // Strip the [OPCOES] / [ACTION] markers. On handoff the reply is just the
    // transfer keyword, so there is nothing to parse.
    let { text: reply, metadata, resendCredentials } = should_handoff
      ? { text: rawReply, metadata: null, resendCredentials: false }
      : parseReplyMarkers(rawReply);

    // [ACTION: resend_credentials] — resolve a infra ATIVA escolhida pelo cliente
    // (cruza o nome citado na mensagem com contactInfo.infras) e dispara o reenvio.
    // A IA já confirmou o reenvio no texto; aqui executamos de fato.
    if (resendCredentials) {
      const infraId = resolveInfraId(message, contactInfo?.infras ?? []);
      if (infraId) {
        const ok = await triggerResendCredentials(infraId);
        if (!ok) {
          reply = 'Tive um problema ao reenviar suas credenciais agora. Pode tentar de novo em instantes ou descrever o que precisa que eu te ajudo por aqui.';
          metadata = null;
        }
        console.log(`[AI] resend_credentials infra=${infraId} ok=${ok}`);
      } else {
        // Nenhuma infra ativa identificada — não confirme um reenvio que não houve.
        reply = 'Não consegui identificar uma infraestrutura ativa para reenviar as credenciais. Pode me dizer qual infraestrutura você quer acessar?';
        metadata = null;
        console.log('[AI] resend_credentials: no active infra resolved');
      }
    }

    // Starter: se o modelo tentou transferir mesmo proibido, troca o "[TRANSFERIR]"
    // residual por uma orientação para os canais de autoatendimento.
    if (isStarterClient && reply.includes(TRANSFER_KEYWORD)) {
      reply = `Não consegui resolver isso por aqui agora. Recomendo conferir nossa Central de ajuda em ${HELP_CENTER_URL}/ajuda ou pedir ajuda no nosso Discord: https://discord.gg/uDftSRtfKe`;
      metadata = null;
    }

    const result: AIRespondResult = { reply, should_handoff, metadata };

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[AI] Fatal error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
