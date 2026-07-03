import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { corsHeaders } from '../_shared/cors.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AIRespondRequest {
  conversation_id: string;
  message: string;
  account_name?: string;
  account_email?: string; // passed by widget directly — avoids account table lookup
  /**
   * 'draft': modo copilot do operador — gera um rascunho de resposta usando o
   * mesmo pipeline de contexto, SEM inserir mensagem, SEM executar ações
   * (reenvio de credenciais), SEM transferir e ignorando o guard de ai_active.
   */
  mode?: 'draft';
  /**
   * Origem da mensagem no widget. 'quick_reply' = clique em botão/chip (seleção
   * intermediária, ex.: "qual infraestrutura?") — NUNCA encerra a conversa
   * neste turno, mesmo que o modelo sinalize resolved=sim.
   */
  source?: 'quick_reply' | 'text';
}

interface CredentialAction {
  infra_id: string;
  label: string;
}

interface MessageMetadata {
  quick_replies?: string[];
  // Botões de ação de reenvio de credenciais. Um por infraestrutura ATIVA.
  // Disparar só acontece quando o CLIENTE clica no botão no widget — a IA nunca
  // reenvia nada por conta própria.
  credential_actions?: CredentialAction[];
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
// Configurável via env HELP_CENTER_URL — sem barra final. Default: o domínio de
// produção do app (ajuda.cloudfy.cloud responde 403 — não usar até ser liberado).
const HELP_CENTER_URL = (Deno.env.get('HELP_CENTER_URL') ?? 'https://clouddesk.apps.cloudfy.cloud').replace(/\/+$/, '');

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

interface SnippetMatch {
  id: string;
  title: string;
  content: string;
  category: string | null;
  similarity: number;
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

[REENVIO DE CREDENCIAIS DE ACESSO — REGRAS RÍGIDAS]
Seu papel é conversar, tirar dúvidas e dar suporte. Você NUNCA reenvia credenciais por conta própria e NUNCA afirma que enviou ou reenviou credenciais. Quem dispara o reenvio é o PRÓPRIO CLIENTE, clicando em um botão.

Só existe UMA forma de oferecer o reenvio: incluir o marcador [OFERECER_CREDENCIAIS] na sua resposta. Esse marcador faz o sistema mostrar um botão "Reenviar minhas credenciais" para o cliente clicar. Use-o APENAS quando TODAS as condições abaixo forem verdadeiras:

1. O cliente pediu o reenvio das credenciais de forma EXPLÍCITA e INEQUÍVOCA. Exemplos que CONTAM como pedido claro: "quero minhas credenciais", "me reenvia o acesso", "perdi meu login e senha, pode mandar de novo?", "não recebi as credenciais da minha infra".
2. Não é uma simples dúvida, dificuldade de login, "como faço para...", reclamação, ou menção indireta. Nesses casos, AJUDE com a base de conhecimento e NÃO use o marcador.
3. O cliente tem ao menos uma infraestrutura ATIVA (Deploy DEPLOYED no bloco DADOS DO CLIENTE).

Quando em dúvida se o pedido é claro o suficiente: NÃO inclua o marcador. Em vez disso, pergunte. Ex: "Você gostaria que eu te ajudasse a reenviar as credenciais de acesso da sua infraestrutura?". Só depois de um "sim" claro é que você inclui [OFERECER_CREDENCIAIS].

Ao usar [OFERECER_CREDENCIAIS], escreva uma frase curta convidando o clique, SEM afirmar que algo foi enviado. Exemplo:
'Claro! É só clicar no botão abaixo para reenviar suas credenciais de acesso. Elas chegarão no seu e-mail. 📩
[OFERECER_CREDENCIAIS]'

Se o cliente tem MAIS DE UMA infraestrutura ativa, NÃO pergunte "qual infraestrutura?" e NÃO use [OPCOES] para listar infraestruturas — o sistema mostra um botão POR infraestrutura ativa e o cliente escolhe clicando no botão certo. Basta usar [OFERECER_CREDENCIAIS].

NUNCA escreva "Credenciais reenviadas", "já enviei", "acabei de mandar" ou qualquer confirmação de envio — você não envia nada. A confirmação aparece sozinha quando o cliente clica no botão. Enquanto o cliente não clicar, o pedido dele NÃO está resolvido (resolved=nao no bloco META).

IMPORTANTE: reenvio de credenciais NÃO é reset de senha — são os dados de acesso ORIGINAIS da infraestrutura. Nunca prometa redefinir senha.`;

// ─── Embedding nativo do Supabase (gte-small, 384 dims) ─────────────────────────
// Roda no runtime da Edge Function via Supabase.ai — SEM API externa. Os vetores
// gerados aqui casam com os índices/funções match_* migrados para VECTOR(384).

// `Supabase` é um global do runtime de Edge Functions; tipamos pontualmente.
declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts: { mean_pool: boolean; normalize: boolean }): Promise<number[]> } };
};

const embeddingSession = new Supabase.ai.Session('gte-small');

async function generateEmbedding(text: string): Promise<number[]> {
  const input = text.slice(0, 2000); // gte-small ~512 tokens
  const output = await embeddingSession.run(input, { mean_pool: true, normalize: true });
  return output as number[];
}

// Chama o LLM via OpenRouter (suporta qualquer provider com a mesma API).
// Modelo configurável via env LLM_MODEL (default: google/gemini-2.5-flash).

interface LLMUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface LLMResult {
  content: string;
  model: string;
  usage: LLMUsage | null;
}

async function callLLM(
  apiKey: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
): Promise<LLMResult> {
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
      max_tokens: 768,
      usage: { include: true },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter chat error ${res.status}: ${err}`);
  }

  const data: OpenAIChatResponse & { usage?: LLMUsage } = await res.json();
  return {
    content: data.choices[0].message.content,
    model,
    usage: data.usage ?? null,
  };
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
  snippetMatches: SnippetMatch[],
  clientName?: string,
  contactInfo?: ContactInfoResult | null,
  isFirstMessage?: boolean,
): string {
  const clientSection = clientName
    ? `\n[CLIENTE]\nVocê está atendendo: ${clientName}. Cumprimente-o pelo nome na primeira mensagem.\n`
    : '';

  // Build KB section — show title + full content for each relevant article.
  // Snippets de IA têm PRIORIDADE: respostas curtas e canônicas, listadas primeiro.
  let contextSection: string;
  if (kbMatches.length === 0 && faqMatches.length === 0 && snippetMatches.length === 0) {
    contextSection = 'Nenhum conteúdo relevante encontrado na base de conhecimento para esta pergunta.';
  } else {
    const parts: string[] = [];

    if (snippetMatches.length > 0) {
      parts.push('[SNIPPETS — REFERÊNCIA RÁPIDA PRIORITÁRIA]');
      parts.push('Use estes snippets como fonte PREFERENCIAL. São respostas curtas e canônicas validadas pela equipe — prefira-os ao conteúdo dos artigos quando houver sobreposição.');
      for (const sn of snippetMatches) {
        parts.push(`Snippet: ${sn.title}${sn.category ? ` (${sn.category})` : ''}\nConteúdo: ${sn.content}`);
      }
    }

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
//   [OPCOES: A | B | C]      → clickable quick-reply chips
//   [OFERECER_CREDENCIAIS]   → render credential-resend BUTTONS (one per active
//                              infra). The model NEVER triggers the resend; the
//                              client does, by clicking a button in the widget.
// Both are stripped from the visible text; OPCOES + credential buttons are lifted
// into metadata.

const OPCOES_RE = /\[OPCOES:\s*([^\]]+)\]/i;
const OFFER_CREDENTIALS_RE = /\[OFERECER_CREDENCIAIS\s*\]/i;

// O modelo NUNCA envia credenciais — qualquer afirmação de envio vinda do bot é
// falsa por definição (o envio real só acontece no clique do cliente, via
// desk-resend-credentials). Este regex detecta a alucinação para corrigi-la
// server-side: o texto é trocado por um convite honesto ao clique e os botões
// reais são anexados.
const FALSE_SENT_CLAIM_RE =
  /credenciais\s+(?:re)?enviad|(?:re)?enviei\s+(?:suas?\s+|as\s+)?credenciais|acabei\s+de\s+(?:re)?enviar/i;

// O auto-resolve só pode fechar a conversa quando o CLIENTE confirma o
// encerramento com as próprias palavras. O modelo marca resolved=sim assim que
// acha que respondeu bem — inclusive terminando com "precisa de mais alguma
// ajuda?" — e fechava a conversa "do nada" na cara do cliente. O sinal do
// modelo vira apenas condição NECESSÁRIA; a suficiente é o cliente sinalizar
// que acabou. Mensagens com "?" nunca contam (pergunta = conversa continua).
const CLIENT_CLOSURE_RE =
  /(obrigad[oa]?|valeu|vlw|resolvid[oa]|resolveu|era s[oó] isso|s[oó] isso mesmo|pode (encerrar|fechar)|tudo certo|deu certo|funcionou|consegui( aqui)?|perfeito)/i;

function clientConfirmedClosure(message: string): boolean {
  return CLIENT_CLOSURE_RE.test(message) && !message.includes('?');
}

// ─── Análise de intenção / sentimento / urgência ─────────────────────────────
// O modelo anexa um bloco [META: ...] no FINAL de toda resposta (instrução no
// system prompt). Isso dá classificação estruturada na MESMA chamada — zero
// custo/latência extra. O bloco é removido do texto visível.

const META_INSTRUCTION = `
[ANÁLISE OBRIGATÓRIA — BLOCO META]
No FINAL de TODA resposta (inclusive quando responder apenas ${TRANSFER_KEYWORD}), anexe em uma linha própria:
[META: intent=<valor> sentiment=<valor> urgency=<valor> resolved=<sim|nao>]

- intent: credenciais | n8n | evolution | infra_down | billing | cancelamento | upgrade | dominio | duvida_geral | outro
- sentiment: positivo | neutro | negativo | irritado
- urgency: baixa | media | alta | critica
- resolved: sim (se você acredita que resolveu o problema do cliente nesta resposta) | nao (se ainda há algo pendente)
- resolved=nao SEMPRE que uma ação do cliente ainda estiver pendente — por exemplo, quando você ofereceu o botão de reenvio de credenciais e ele ainda não clicou/confirmou o recebimento.

Critérios de urgency:
- critica: produção fora do ar, cliente perdendo dinheiro/clientes agora
- alta: serviço degradado, bloqueio de trabalho, cliente irritado, ameaça de cancelamento
- media: problema real mas contornável
- baixa: dúvida, curiosidade, configuração sem pressa

O bloco META nunca deve aparecer sem todos os 4 campos. Não explique o bloco ao cliente.`;

const META_RE = /\[META:\s*intent=([\w-]+)\s+sentiment=([\w-]+)\s+urgency=([\w-]+)(?:\s+resolved=(sim|nao))?\s*\]/i;

interface MessageAnalysis {
  intent: string;
  sentiment: string;
  urgency: string;
  resolved: boolean;
}

function parseMetaBlock(raw: string): { text: string; analysis: MessageAnalysis | null } {
  const m = raw.match(META_RE);
  if (!m) return { text: raw.trim(), analysis: null };
  return {
    text: raw.replace(META_RE, '').replace(/\n{3,}/g, '\n\n').trim(),
    analysis: {
      intent: m[1].toLowerCase(),
      sentiment: m[2].toLowerCase(),
      urgency: m[3].toLowerCase(),
      resolved: (m[4] ?? '').toLowerCase() === 'sim',
    },
  };
}

// urgência → prioridade da conversa. Só PROMOVE (nunca rebaixa o que o operador definiu).
const PRIORITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };

function priorityForUrgency(urgency: string): string | null {
  if (urgency === 'critica') return 'urgent';
  if (urgency === 'alta') return 'high';
  return null;
}

/** Aplica análise à conversa: prioridade (promoção) + tag de intenção. Fire-and-forget. */
async function applyAnalysis(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  analysis: MessageAnalysis,
): Promise<void> {
  try {
    const { data: conv } = await supabase
      .from('desk_conversations')
      .select('priority, tags')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv) return;

    const update: Record<string, unknown> = {};

    const target = priorityForUrgency(analysis.urgency);
    const current = (conv as Record<string, unknown>).priority as string;
    if (target && (PRIORITY_RANK[target] ?? 0) > (PRIORITY_RANK[current] ?? 0)) {
      update.priority = target;
    }

    const tags: string[] = ((conv as Record<string, unknown>).tags as string[]) ?? [];
    const intentTag = `intent:${analysis.intent}`;
    const withoutIntents = tags.filter((t) => !t.startsWith('intent:'));
    if (!tags.includes(intentTag) || tags.length !== withoutIntents.length + 1) {
      update.tags = [...withoutIntents, intentTag];
    }

    if (Object.keys(update).length > 0) {
      await supabase.from('desk_conversations').update(update).eq('id', conversationId);
    }
  } catch (e) {
    console.warn('[AI] applyAnalysis failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * Auto-fecha a conversa quando a IA sinalizou resolved=sim E o cliente tem
 * plano Advanced, Ultra ou Max. Fire-and-forget — não bloqueia a resposta.
 *
 * Starter: nunca auto-fecha (a IA nunca transfere, mas o encerramento é
 * manual ou via CSAT).
 * Advanced/Ultra/Max: se a IA sinalizou resolved=sim, a conversa é marcada
 * como 'resolved' com uma mensagem de sistema de encerramento.
 */
async function maybeAutoResolve(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  analysis: MessageAnalysis | null,
  contactInfo: ContactInfoResult | null,
): Promise<void> {
  if (!analysis?.resolved) return;

  const planTag = detectPlanTag(contactInfo?.subscriptions ?? []);
  const autoresolvePlans: PlanTag[] = ['advanced', 'ultra', 'max'];
  if (!autoresolvePlans.includes(planTag)) return;

  try {
    await supabase
      .from('desk_conversations')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', conversationId);

    await supabase.from('desk_messages').insert({
      conversation_id: conversationId,
      sender_type: 'system',
      content: 'Conversa encerrada automaticamente pela IA após resolução.',
      content_type: 'text',
    });

    console.log(`[AI] Auto-resolved conversation ${conversationId} (plan=${planTag})`);
  } catch (e) {
    console.warn('[AI] maybeAutoResolve failed:', e instanceof Error ? e.message : e);
  }
}

/** Log estruturado da interação em desk_ai_interactions (analytics da IA). */
async function logInteraction(
  supabase: ReturnType<typeof createClient>,
  params: {
    conversationId: string;
    model: string;
    usage: LLMUsage | null;
    latencyMs: number;
    wasEscalated: boolean;
    analysis: MessageAnalysis | null;
    kbIds: string[];
    faqIds: string[];
    snippetIds: string[];
    draft: boolean;
  },
): Promise<void> {
  try {
    await supabase.from('desk_ai_interactions').insert({
      conversation_id: params.conversationId,
      provider: 'openrouter',
      model: params.model,
      prompt_tokens: params.usage?.prompt_tokens ?? null,
      completion_tokens: params.usage?.completion_tokens ?? null,
      total_tokens: params.usage?.total_tokens ?? null,
      latency_ms: params.latencyMs,
      was_escalated: params.wasEscalated,
      context_sources: {
        kb: params.kbIds,
        faq: params.faqIds,
        snippets: params.snippetIds,
        intent: params.analysis?.intent ?? null,
        sentiment: params.analysis?.sentiment ?? null,
        urgency: params.analysis?.urgency ?? null,
        draft: params.draft,
      },
    });
  } catch (e) {
    console.warn('[AI] logInteraction failed:', e instanceof Error ? e.message : e);
  }
}

function parseReplyMarkers(
  raw: string,
  activeInfras: ContactInfra[],
): { text: string; metadata: MessageMetadata | null } {
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

  // [OFERECER_CREDENCIAIS] → anexa um botão por infra ATIVA com o infra_id já
  // resolvido no servidor. O texto NUNCA confirma envio — só convida ao clique.
  // Se o modelo emitiu o marcador mas o cliente não tem infra ativa, o marcador
  // é descartado silenciosamente (sem botões), evitando ofertas vazias.
  if (OFFER_CREDENTIALS_RE.test(text)) {
    text = text.replace(OFFER_CREDENTIALS_RE, '');
    const actions: CredentialAction[] = activeInfras
      .filter((i) => i.infra_id)
      .map((i) => ({
        infra_id: i.infra_id,
        label: i.default_domain || i.purchase_code || 'Minha infraestrutura',
      }));
    if (actions.length > 0) metadata.credential_actions = actions;
  }

  text = text.replace(/\n{3,}/g, '\n\n').trim();

  const hasMetadata = !!metadata.quick_replies || !!metadata.credential_actions;
  return { text, metadata: hasMetadata ? metadata : null };
}

// ─── Credential resend (eligibility) ──────────────────────────────────────────
// A IA NÃO dispara o reenvio. Ela só marca quais infras estão ATIVAS para que o
// widget mostre um botão por infra. O disparo é feito pelo CLIENTE, clicando no
// botão → chama a Edge Function desk-resend-credentials com o infra_id.
function isActiveInfra(infra: ContactInfra): boolean {
  return String(infra.status ?? '').toUpperCase() === 'DEPLOYED';
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
    const { conversation_id, message, account_name, account_email, mode, source } = body;
    const isDraft = mode === 'draft';
    const isButtonClick = source === 'quick_reply';

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

    // ── Reabertura: cliente respondeu numa conversa resolvida ──────────────────
    // Sem isto a mensagem cai num buraco negro: a IA é bloqueada pelo guard e a
    // conversa não volta para a aba "Abertas" do painel. Reabrimos ANTES do guard
    // (service role — o widget anon não tem policy de UPDATE).
    //
    // REATIVAR A IA no reopen: uma conversa RESOLVIDA que o cliente reabre é uma
    // nova rodada de autoatendimento. Se ela tinha sido pausada por um humano
    // antes de resolver (ai_active=false), reabrir sem reativar deixava a IA
    // bloqueada para sempre e o cliente no vácuo — nem IA nem humano respondiam.
    // Ao reabrir, a IA volta a atender; se um operador quiser assumir de novo,
    // ele repausa manualmente na thread.
    if (!isDraft && convRow?.status === 'resolved') {
      const { error: reopenErr } = await supabase
        .from('desk_conversations')
        .update({ status: 'open', resolved_at: null, ai_active: true })
        .eq('id', conversation_id);
      if (reopenErr) {
        console.error('[AI] Failed to reopen resolved conversation:', reopenErr.message);
      } else {
        console.log(`[AI] Reopened resolved conversation ${conversation_id} (client replied) — IA reactivated`);
        convRow.status = 'open';
        convRow.ai_active = true;
      }
    }

    if (
      !isDraft &&
      convRow &&
      (!convRow.ai_active || convRow.status === 'pending' || convRow.status === 'resolved')
    ) {
      console.log(`[AI] Blocked — ai_active=${convRow.ai_active} status=${convRow.status}`);
      // Mesmo sem resposta da IA, a conversa precisa "subir" no inbox e disparar
      // o Realtime de desk_conversations para os operadores verem a mensagem nova.
      // (Nada mais atualiza a conversa neste caminho — o widget anon não pode.)
      const { error: bumpErr } = await supabase
        .from('desk_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversation_id);
      if (bumpErr) console.warn('[AI] Failed to bump updated_at on blocked path:', bumpErr.message);

      const blocked: AIRespondResult = { reply: null, should_handoff: false, blocked: true };
      return new Response(
        JSON.stringify(blocked),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY secret');

    // Embeddings nativos (gte-small via Supabase.ai) — sem chave/API externa.

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
    // O widget insere a mensagem do cliente ANTES de chamar esta function, então
    // o histórico já a contém — history.length===0 quase nunca ocorre nesse
    // caminho. Para o auto-resolve, o critério é por turnos do CLIENTE: só se
    // permite fechar a partir do 2º turno (ele precisa ter tido a chance de
    // reagir a uma resposta da IA; fechar na primeira resposta é prematuro).
    const contactTurns = history.filter((m) => m.sender_type === 'contact').length;
    const isFirstClientTurn = contactTurns <= 1;
    console.log(`[AI] History: ${history.length} messages, firstMessage=${isFirstMessage}, contactTurns=${contactTurns}`);

    // Tag automática por plano (item 2). Fire-and-forget: não bloqueia a resposta.
    // Mantém desk_conversations.tags com a tag do plano mais alto do cliente.
    // No modo draft (copilot do operador) não mexemos na conversa.
    if (!isDraft) {
      const planTag = detectPlanTag(contactInfo?.subscriptions ?? []);
      void applyPlanTag(supabase, conversation_id, planTag);
      console.log(`[AI] Plan tag: ${planTag}`);
    }

    // ── Step 2: Semantic search (RAG) ─────────────────────────────────────────
    // Generate embedding for the user's message, then query KB and FAQ in parallel.
    // Falls back gracefully: if embedding fails, the AI responds without KB context.
    let kbMatches: KBMatch[] = [];
    let faqMatches: FAQMatch[] = [];
    let snippetMatches: SnippetMatch[] = [];

    try {
      const embedding = await generateEmbedding(message);
      console.log('[AI] Embedding generated');

      const [kbRes, faqRes, snippetRes] = await Promise.all([
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
        supabase.rpc('match_ai_snippets', {
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

      if (snippetRes.error) {
        console.warn('[AI] Snippet search failed:', snippetRes.error.message);
      } else {
        snippetMatches = (snippetRes.data ?? []) as SnippetMatch[];
      }

      console.log(`[AI] RAG: ${snippetMatches.length} snippets, ${kbMatches.length} KB articles, ${faqMatches.length} FAQs`);
    } catch (embedErr) {
      // Non-fatal: AI will respond without KB context rather than failing entirely
      console.warn('[AI] Embedding/search failed — responding without KB context:', embedErr);
    }

    // ── Step 3: Build prompt + call OpenAI ────────────────────────────────────
    let systemPrompt = buildSystemPrompt(kbMatches, faqMatches, snippetMatches, account_name, contactInfo, isFirstMessage);
    systemPrompt += `\n${META_INSTRUCTION}`;

    if (isDraft) {
      systemPrompt += `

[MODO RASCUNHO — COPILOT DO OPERADOR]
Esta resposta será revisada por um operador HUMANO antes de ser enviada ao cliente.
- NUNCA use ${TRANSFER_KEYWORD} — o humano já está aqui.
- Escreva a melhor resposta possível como se fosse o operador.
- Não use [OPCOES] nem [ACTION].`;
    }

    const chatMessages = history.map((m) => ({
      role: m.sender_type === 'contact' ? 'user' : 'assistant',
      content: m.content,
    }));
    chatMessages.push({ role: 'user', content: message });

    const llmStart = Date.now();
    const llm = await callLLM(apiKey, systemPrompt, chatMessages);
    const latencyMs = Date.now() - llmStart;

    // Bloco [META: ...] — classificação estruturada embutida na mesma resposta.
    const { text: replyWithoutMeta, analysis } = parseMetaBlock(llm.content);
    const rawReply = replyWithoutMeta;
    console.log(`[AI] Reply: "${rawReply.substring(0, 80)}" meta=${JSON.stringify(analysis)} latency=${latencyMs}ms`);

    // Somente Starter nunca transfere — reforço server-side caso o modelo ignore o prompt.
    const isStarterClient = isStarterOnlyClient(contactInfo);
    const should_handoff = !isDraft && !isStarterClient && rawReply.includes(TRANSFER_KEYWORD);

    // Strip the [OPCOES] / [OFERECER_CREDENCIAIS] markers and lift them into
    // metadata. On handoff the reply is just the transfer keyword, so there is
    // nothing to parse. Credential buttons are built from the client's ACTIVE
    // infras only — the resend itself is triggered by the client's click, never
    // here.
    const activeInfras = (contactInfo?.infras ?? []).filter(isActiveInfra);
    let { text: reply, metadata } = should_handoff
      ? { text: rawReply, metadata: null as MessageMetadata | null }
      : parseReplyMarkers(rawReply, activeInfras);

    // ── Guard determinístico do fluxo de credenciais ────────────────────────────
    // O modelo às vezes ignora o [OFERECER_CREDENCIAIS] (pergunta "qual infra?" via
    // chips) ou alucina "Credenciais reenviadas!" sem que nada tenha sido enviado.
    // Correção server-side, independente do modelo:
    //   1. intent=credenciais (classificação do próprio modelo) sem botões → anexa
    //      os botões reais (um por infra ativa; o backend revalida posse no clique).
    //   2. Afirmação falsa de envio → texto substituído por convite honesto ao clique.
    if (!isDraft && !should_handoff) {
      const falseClaim = FALSE_SENT_CLAIM_RE.test(reply);
      const wantsCredentials = analysis?.intent === 'credenciais';

      if ((falseClaim || wantsCredentials) && !metadata?.credential_actions) {
        const actions: CredentialAction[] = activeInfras
          .filter((i) => i.infra_id)
          .map((i) => ({
            infra_id: i.infra_id,
            label: i.default_domain || i.purchase_code || 'Minha infraestrutura',
          }));
        if (actions.length > 0) {
          metadata = { ...(metadata ?? {}), credential_actions: actions };
          console.log(`[AI] Credential guard: attached ${actions.length} button(s) (falseClaim=${falseClaim})`);
        }
      }

      if (falseClaim) {
        reply = metadata?.credential_actions?.length
          ? 'Para receber suas credenciais de acesso, é só clicar no botão abaixo — elas chegam no seu e-mail cadastrado. 📩'
          : 'Não encontrei uma infraestrutura ativa na sua conta para reenviar credenciais. Se você acredita que isso é um erro, me avise que eu verifico com a equipe.';
        console.warn('[AI] Credential guard: false "sent" claim scrubbed from reply');
      }
    }

    // ── Handoff decidido pela IA → persistir server-side ────────────────────────
    // O widget roda como anon e NÃO tem policy de UPDATE em desk_conversations
    // (o update dele é um no-op silencioso). Sem isto, a conversa nunca vira
    // 'pending' e a IA continua respondendo depois de "transferir".
    if (should_handoff) {
      const { error: handoffErr } = await supabase
        .from('desk_conversations')
        .update({ status: 'pending', ai_active: false })
        .eq('id', conversation_id);
      if (handoffErr) {
        console.error('[AI] Failed to persist handoff:', handoffErr.message);
      } else {
        console.log(`[AI] Handoff persisted — conversation ${conversation_id} → pending, ai_active=false`);
      }
    }

    // Inteligência aplicada à conversa (prioridade + tag de intenção), auto-resolve
    // e log de analytics — fire-and-forget, nunca bloqueia a resposta ao cliente.
    if (!isDraft && analysis) {
      void applyAnalysis(supabase, conversation_id, analysis);
      // Auto-resolve: Advanced/Ultra/Max quando IA sinaliza resolved=sim (via META).
      // Regras por tipo de interação — NUNCA auto-resolver quando:
      //   • houve handoff;
      //   • há botões de credenciais aguardando o clique do cliente;
      //   • a própria resposta faz uma pergunta com opções (quick_replies) —
      //     uma pergunta não é uma resolução;
      //   • a mensagem do cliente veio de um clique em botão/chip (source=
      //     'quick_reply') — seleção intermediária nunca encerra o chamado;
      //   • é o PRIMEIRO turno do cliente na conversa — fechar na primeira
      //     resposta (antes de ele poder reagir) é prematuro por definição;
      //   • o CLIENTE não confirmou o encerramento ("obrigado", "resolveu",
      //     "era só isso"...) — o resolved=sim do modelo sozinho não basta:
      //     ele marca resolvido logo após responder uma pergunta informativa
      //     e a conversa fechava "do nada" na cara do cliente.
      const closureConfirmed = clientConfirmedClosure(message);
      const skipAutoResolve =
        should_handoff ||
        !!metadata?.credential_actions ||
        !!metadata?.quick_replies ||
        isButtonClick ||
        isFirstClientTurn ||
        !closureConfirmed;
      if (skipAutoResolve) {
        if (analysis.resolved) {
          console.log(
            `[AI] Auto-resolve skipped (credential_actions=${!!metadata?.credential_actions} ` +
            `quick_replies=${!!metadata?.quick_replies} buttonClick=${isButtonClick} ` +
            `firstClientTurn=${isFirstClientTurn} closureConfirmed=${closureConfirmed} ` +
            `handoff=${should_handoff})`,
          );
        }
      } else {
        void maybeAutoResolve(supabase, conversation_id, analysis, contactInfo);
      }
    }
    void logInteraction(supabase, {
      conversationId: conversation_id,
      model: llm.model,
      usage: llm.usage,
      latencyMs,
      wasEscalated: should_handoff,
      analysis,
      kbIds: kbMatches.map((k) => k.id),
      faqIds: faqMatches.map((f) => f.id),
      snippetIds: snippetMatches.map((s) => s.id),
      draft: isDraft,
    });

    // Modo draft: nunca executa ações nem transfere — apenas devolve o texto
    // limpo para o operador revisar.
    if (isDraft) {
      const draftReply = reply.replace(TRANSFER_KEYWORD, '').trim();
      const draftResult: AIRespondResult = {
        reply: draftReply || 'Não consegui gerar uma sugestão para esta conversa.',
        should_handoff: false,
        metadata: null,
      };
      return new Response(
        JSON.stringify(draftResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
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
