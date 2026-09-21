/**
 * outbound.ts — Contrato dos Disparos (Avisos, Novidades, Banners, Tours).
 *
 * É o único lugar que descreve o que vai dentro de `desk_campaigns.content` e
 * `.audience`. Painel (editor/prévia/analytics) e widget (renderização) importam
 * daqui; o gateway Deno tem uma cópia espelhada em
 * supabase/functions/_shared/campaigns.ts — ao mudar um formato aqui, mudar lá.
 *
 * Regra de ouro: tudo que o CLIENTE lê fica em `content`; tudo que decide PARA
 * QUEM mostrar fica em `audience`; o resto (status, agenda, prioridade) é coluna.
 */

// ─── Tipos e status ──────────────────────────────────────────────────────────

export type CampaignType = "notice" | "news" | "banner" | "tour";

/** Estado persistido. "Agendado" e "Encerrado" são derivados (ver derivedStatus). */
export type CampaignStatus = "draft" | "active" | "paused" | "archived";

/** Como o painel apresenta o estado — inclui os derivados da agenda. */
export type DerivedStatus = CampaignStatus | "scheduled" | "ended";

export const TYPE_LABELS: Record<CampaignType, string> = {
  notice: "Aviso",
  news: "Novidade",
  banner: "Banner",
  tour: "Tour guiado",
};

export const TYPE_LABELS_PLURAL: Record<CampaignType, string> = {
  notice: "Avisos",
  news: "Novidades",
  banner: "Banners",
  tour: "Tours guiados",
};

export const TYPE_DESCRIPTIONS: Record<CampaignType, string> = {
  notice: "Recado curto que aparece para o cliente no chat — dentro do bubble ou flutuando sobre a página.",
  news: "Item do feed de novidades: título, texto, imagem e link. O cliente vê o histórico do que já foi anunciado.",
  banner: "Faixa fixada no topo do bubble chamando atenção para algo importante. Some quando o cliente fecha.",
  tour: "Passo a passo sobre a tela do produto, destacando onde clicar e explicando o que fazer.",
};

export const STATUS_LABELS: Record<DerivedStatus, string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  active: "No ar",
  paused: "Pausado",
  ended: "Encerrado",
  archived: "Arquivado",
};

// ─── Conteúdo por tipo ───────────────────────────────────────────────────────

/** O que o botão de ação faz. `start_tour` liga um aviso a um tour guiado. */
export type CtaAction = "link" | "open_chat" | "start_tour";

export interface NoticeContent {
  title: string;
  /** Markdown — renderizado pelo mesmo WidgetMarkdown das mensagens do operador. */
  body: string;
  image_url?: string | null;
  cta_label?: string | null;
  cta_action?: CtaAction;
  cta_url?: string | null;
  cta_tour_id?: string | null;
  /**
   * popup — card flutuante acima da bolha, visível MESMO com o widget fechado
   *         (é o que dá alcance: o widget fica fechado quase o tempo todo);
   * card  — só dentro do widget, no topo da lista de chamados.
   */
  display: "popup" | "card";
}

export type NewsTag = "novo" | "melhoria" | "correcao" | "anuncio";

export const NEWS_TAG_LABELS: Record<NewsTag, string> = {
  novo: "Novo recurso",
  melhoria: "Melhoria",
  correcao: "Correção",
  anuncio: "Anúncio",
};

export interface NewsContent {
  title: string;
  /** Markdown. */
  body: string;
  image_url?: string | null;
  link_url?: string | null;
  link_label?: string | null;
  tag?: NewsTag | null;
  /** Reações (👍 ❤️ 🎉) no card. */
  allow_reactions: boolean;
}

export type BannerStyle = "info" | "success" | "warning" | "promo" | "danger";

export const BANNER_STYLE_LABELS: Record<BannerStyle, string> = {
  info: "Informativo",
  success: "Positivo",
  warning: "Atenção",
  promo: "Promoção",
  danger: "Crítico",
};

export interface BannerContent {
  text: string;
  style: BannerStyle;
  emoji?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  dismissible: boolean;
  /** Mostra também como pílula acima da bolha quando o widget está fechado. */
  show_when_closed: boolean;
}

export type TourPlacement = "auto" | "top" | "bottom" | "left" | "right";

export interface TourStep {
  id: string;
  /** Seletor CSS do elemento a destacar. Vazio = passo centralizado (sem destaque). */
  selector: string;
  title: string;
  /** Markdown curto. */
  body: string;
  placement: TourPlacement;
  /**
   * Página em que o passo acontece (padrão de URL, ver matchesUrlPattern).
   * Vazio = qualquer página. Se o cliente está em outra, o passo oferece o
   * botão "Ir para a página" e o tour retoma dali depois da navegação.
   */
  url?: string | null;
  /** button — avança pelo botão; click — avança quando o cliente clica no elemento. */
  advance_on: "button" | "click";
  /** Se o elemento não existir na tela, pula o passo em vez de mostrar centralizado. */
  optional?: boolean;
}

export interface TourContent {
  steps: TourStep[];
  /** Começa sozinho quando o cliente abre uma página que casa com start_url. */
  auto_start: boolean;
  /** Página que dispara o auto-start. Vazio = qualquer página. */
  start_url?: string | null;
  show_progress: boolean;
  /** Mensagem do card final ("Pronto! Você já sabe usar…"). Vazio = sem card final. */
  finish_message?: string | null;
  /** Lista o tour no feed de Novidades com botão "Iniciar tour". */
  list_in_news: boolean;
}

export type CampaignContent = NoticeContent | NewsContent | BannerContent | TourContent;

// ─── Público ─────────────────────────────────────────────────────────────────

export type AudienceSegment = "all" | "with_plan" | "without_plan" | "plans";

/** Tags de plano gravadas pela IA em desk_conversations.tags (mesma escala). */
export const PLAN_OPTIONS = ["starter", "advanced", "ultra", "max"] as const;
export type PlanKey = (typeof PLAN_OPTIONS)[number];

export const PLAN_LABELS: Record<PlanKey, string> = {
  starter: "Starter",
  advanced: "Advanced",
  ultra: "Ultra",
  max: "Max",
};

export type AudienceInfra = "any" | "active" | "blocked" | "none";

export const INFRA_LABELS: Record<AudienceInfra, string> = {
  any: "Qualquer situação",
  active: "Com infraestrutura ativa",
  blocked: "Com infraestrutura bloqueada",
  none: "Sem infraestrutura",
};

export interface CampaignAudience {
  segment: AudienceSegment;
  /** Só quando segment = 'plans'. */
  plans?: PlanKey[];
  infra?: AudienceInfra;
  /** Só clientes cuja conta foi criada há no máximo N dias (onboarding). */
  new_customer_days?: number | null;
  /** Só em páginas cuja URL casa com este padrão (avaliado no widget). */
  url_pattern?: string | null;
  /**
   * E-mails que veem o disparo mesmo em rascunho/pausado/agendado — é o
   * "enviar teste para mim" antes de publicar. O widget marca como "Prévia".
   */
  test_emails?: string[];
}

export const DEFAULT_AUDIENCE: CampaignAudience = {
  segment: "all",
  plans: [],
  infra: "any",
  new_customer_days: null,
  url_pattern: null,
  test_emails: [],
};

// ─── Registro completo (linha de desk_campaigns) ─────────────────────────────

export interface Campaign {
  id: string;
  type: CampaignType;
  name: string;
  status: CampaignStatus;
  content: CampaignContent;
  audience: CampaignAudience;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  published_at: string | null;
  sender_agent_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignStats {
  campaign_id: string;
  seen: number;
  clicked: number;
  dismissed: number;
  completed: number;
  started: number;
  reactions: Record<string, number>;
  last_seen_at: string | null;
}

// ─── O que o WIDGET recebe do gateway ────────────────────────────────────────
// Subconjunto do registro (nada de audience/test_emails/nome interno) + estado
// do cliente + quem assina.

export interface CampaignReceiptState {
  seen: boolean;
  clicked: boolean;
  dismissed: boolean;
  completed: boolean;
  step_reached: number | null;
  reaction: string | null;
}

export interface CampaignSender {
  name: string;
  avatar_url: string | null;
}

export interface WidgetCampaign {
  id: string;
  type: CampaignType;
  content: CampaignContent;
  priority: number;
  published_at: string | null;
  /** Só a parte do público avaliada no navegador. */
  url_pattern: string | null;
  sender: CampaignSender | null;
  receipt: CampaignReceiptState | null;
  /** Mostrado por causa de test_emails, sem estar no ar. O widget marca "Prévia". */
  is_test: boolean;
}

export type CampaignEvent = "seen" | "click" | "dismiss" | "complete" | "step" | "react";

export const REACTIONS = ["👍", "❤️", "🎉"] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isNotice(c: { type: CampaignType; content: CampaignContent }): c is { type: "notice"; content: NoticeContent } {
  return c.type === "notice";
}
export function isNews(c: { type: CampaignType; content: CampaignContent }): c is { type: "news"; content: NewsContent } {
  return c.type === "news";
}
export function isBanner(c: { type: CampaignType; content: CampaignContent }): c is { type: "banner"; content: BannerContent } {
  return c.type === "banner";
}
export function isTour(c: { type: CampaignType; content: CampaignContent }): c is { type: "tour"; content: TourContent } {
  return c.type === "tour";
}

export function newStepId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

export function emptyContent(type: CampaignType): CampaignContent {
  switch (type) {
    case "notice":
      return { title: "", body: "", display: "popup", cta_action: "link", cta_label: "", cta_url: "" };
    case "news":
      return { title: "", body: "", tag: "novo", allow_reactions: true, link_label: "Saiba mais", link_url: "" };
    case "banner":
      return { text: "", style: "info", dismissible: true, show_when_closed: false, emoji: "📣" };
    case "tour":
      return {
        steps: [
          { id: newStepId(), selector: "", title: "", body: "", placement: "auto", advance_on: "button", url: "" },
        ],
        auto_start: true,
        start_url: "",
        show_progress: true,
        finish_message: "",
        list_in_news: true,
      };
  }
}

/**
 * Estado como o painel mostra: um disparo `active` ainda fora da janela é
 * "Agendado"; um cuja janela já passou é "Encerrado".
 */
export function derivedStatus(
  c: Pick<Campaign, "status" | "starts_at" | "ends_at">,
  now: Date = new Date(),
): DerivedStatus {
  if (c.status !== "active") return c.status;
  const t = now.getTime();
  if (c.starts_at && new Date(c.starts_at).getTime() > t) return "scheduled";
  if (c.ends_at && new Date(c.ends_at).getTime() <= t) return "ended";
  return "active";
}

/** Dentro da janela de exibição (ou sem janela). */
export function isWithinSchedule(
  c: Pick<Campaign, "starts_at" | "ends_at">,
  now: Date = new Date(),
): boolean {
  const t = now.getTime();
  if (c.starts_at && new Date(c.starts_at).getTime() > t) return false;
  if (c.ends_at && new Date(c.ends_at).getTime() <= t) return false;
  return true;
}

/**
 * Casa uma URL com um padrão simples:
 *   /app/dashboard        → só esse caminho (com ou sem barra final)
 *   /app/*                → tudo abaixo de /app/
 *   *evolution*           → qualquer URL contendo "evolution"
 *   https://x.com/p       → URL completa (esquema+host+caminho)
 *
 * Padrão vazio casa com tudo. A comparação ignora query string e hash,
 * exceto quando o próprio padrão os inclui. Case-insensitive.
 */
export function matchesUrlPattern(pattern: string | null | undefined, href: string): boolean {
  const p = (pattern ?? "").trim().toLowerCase();
  if (!p) return true;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }

  const full = `${url.origin}${url.pathname}${url.search}${url.hash}`.toLowerCase();
  const path = url.pathname.toLowerCase();

  const regex = globToRegex(p);
  const hasScheme = /^https?:\/\//.test(p);
  const hasQuery = p.includes("?") || p.includes("#");

  if (hasScheme) return regex.test(full);
  if (p.startsWith("*")) return regex.test(full) || regex.test(path);
  if (hasQuery) return regex.test(`${path}${url.search}${url.hash}`.toLowerCase());
  return regex.test(path) || regex.test(stripTrailingSlash(path));
}

function stripTrailingSlash(s: string): string {
  return s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s;
}

function globToRegex(glob: string): RegExp {
  // A barra final do padrão não conta: "/app/x/" e "/app/x" são a mesma página.
  const trimmed = glob.length > 1 ? glob.replace(/\/+$/, "") : glob;
  const escaped = trimmed
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  // Barra final opcional na URL: "/app/x" casa "/app/x/".
  return new RegExp(`^${escaped}/?$`, "i");
}

/** Erros de validação antes de salvar/publicar (pt-BR, para o toast). */
export function validateCampaign(c: Pick<Campaign, "type" | "name" | "content" | "audience" | "starts_at" | "ends_at">): string[] {
  const errors: string[] = [];
  if (!c.name.trim()) errors.push("Dê um nome interno ao disparo.");

  if (c.starts_at && c.ends_at && new Date(c.ends_at) <= new Date(c.starts_at)) {
    errors.push("A data de término precisa ser depois do início.");
  }

  if (c.audience.segment === "plans" && (c.audience.plans?.length ?? 0) === 0) {
    errors.push("Escolha pelo menos um plano.");
  }

  const content = c.content;
  switch (c.type) {
    case "notice": {
      const n = content as NoticeContent;
      if (!n.title.trim() && !n.body.trim()) errors.push("O aviso precisa de um título ou texto.");
      if (n.cta_label?.trim()) {
        if ((n.cta_action ?? "link") === "link" && !isHttpUrl(n.cta_url)) errors.push("O botão precisa de um link válido (https://…).");
        if (n.cta_action === "start_tour" && !n.cta_tour_id) errors.push("Escolha qual tour o botão inicia.");
      }
      break;
    }
    case "news": {
      const n = content as NewsContent;
      if (!n.title.trim()) errors.push("A novidade precisa de um título.");
      if (!n.body.trim()) errors.push("A novidade precisa de um texto.");
      if (n.link_url?.trim() && !isHttpUrl(n.link_url)) errors.push("O link de \"saiba mais\" precisa ser válido (https://…).");
      break;
    }
    case "banner": {
      const b = content as BannerContent;
      if (!b.text.trim()) errors.push("O banner precisa de um texto.");
      if (b.cta_label?.trim() && !isHttpUrl(b.cta_url)) errors.push("O botão do banner precisa de um link válido (https://…).");
      break;
    }
    case "tour": {
      const t = content as TourContent;
      if (t.steps.length === 0) errors.push("O tour precisa de pelo menos um passo.");
      t.steps.forEach((s, i) => {
        if (!s.title.trim() && !s.body.trim()) errors.push(`Passo ${i + 1}: escreva um título ou texto.`);
        if (s.advance_on === "click" && !s.selector.trim()) errors.push(`Passo ${i + 1}: avançar por clique exige um seletor.`);
      });
      break;
    }
  }
  return errors;
}

export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Resumo do público em uma linha ("Planos Ultra e Max · infra ativa · em /app/*"). */
export function describeAudience(a: CampaignAudience): string {
  const parts: string[] = [];
  switch (a.segment) {
    case "all": parts.push("Todos os clientes"); break;
    case "with_plan": parts.push("Com plano ativo"); break;
    case "without_plan": parts.push("Sem plano ativo"); break;
    case "plans": {
      const names = (a.plans ?? []).map((p) => PLAN_LABELS[p] ?? p);
      parts.push(names.length ? `Planos ${joinPt(names)}` : "Planos (nenhum)");
      break;
    }
  }
  if (a.infra && a.infra !== "any") parts.push(INFRA_LABELS[a.infra].toLowerCase());
  if (a.new_customer_days) parts.push(`clientes há até ${a.new_customer_days} dias`);
  if (a.url_pattern?.trim()) parts.push(`em ${a.url_pattern.trim()}`);
  return parts.join(" · ");
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** Texto curto para a lista do painel (título que o cliente vê). */
export function campaignHeadline(c: Pick<Campaign, "type" | "content" | "name">): string {
  switch (c.type) {
    case "notice": return (c.content as NoticeContent).title || c.name;
    case "news": return (c.content as NewsContent).title || c.name;
    case "banner": return (c.content as BannerContent).text || c.name;
    case "tour": {
      const t = c.content as TourContent;
      return t.steps[0]?.title || c.name;
    }
  }
}

/**
 * Normaliza uma linha vinda do banco (content/audience chegam como Json solto)
 * para o tipo forte, preenchendo defaults de campos que versões antigas do
 * editor não gravavam.
 */
export function normalizeCampaign(row: {
  id: string;
  type: string;
  name: string;
  status: string;
  content: unknown;
  audience: unknown;
  priority: number | null;
  starts_at: string | null;
  ends_at: string | null;
  published_at: string | null;
  sender_agent_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}): Campaign {
  const type = row.type as CampaignType;
  const base = emptyContent(type) as unknown as Record<string, unknown>;
  const raw = (row.content && typeof row.content === "object" ? row.content : {}) as Record<string, unknown>;
  const content = { ...base, ...raw } as unknown as CampaignContent;
  if (type === "tour") {
    const t = content as TourContent;
    t.steps = Array.isArray(t.steps) ? t.steps.map((s) => ({ ...s, id: s.id || newStepId() })) : [];
  }
  const rawAud = (row.audience && typeof row.audience === "object" ? row.audience : {}) as Partial<CampaignAudience>;
  return {
    id: row.id,
    type,
    name: row.name,
    status: row.status as CampaignStatus,
    content,
    audience: { ...DEFAULT_AUDIENCE, ...rawAud },
    priority: row.priority ?? 0,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    published_at: row.published_at,
    sender_agent_id: row.sender_agent_id,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
