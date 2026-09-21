// ─── Disparos (outbound) — lado do servidor ────────────────────────────────────
//
// Espelho Deno de src/lib/outbound.ts (o painel e o widget importam de lá; este
// runtime não enxerga o src/). Aqui vive só o que o GATEWAY precisa:
//
//   • decidir quais disparos um cliente verificado pode ver (status, agenda e
//     público — plano, infra, tempo de casa, e-mails de teste);
//   • gravar o que o cliente fez (viu/clicou/fechou/concluiu/passo/reação).
//
// A parte do público que depende da PÁGINA (url_pattern) é avaliada no widget:
// o cliente navega sem recarregar e o servidor não vê a URL mudar.

import type { ServiceClient } from './supabase.ts';
import { fetchContactInfo, cloudfyProdClient, type ContactInfoResult } from './contact-info.ts';
import { detectPlanTag } from './ai-pipeline.ts';

export type CampaignType = 'notice' | 'news' | 'banner' | 'tour';
export type CampaignEvent = 'seen' | 'click' | 'dismiss' | 'complete' | 'step' | 'react';

export const CAMPAIGN_EVENTS: CampaignEvent[] = ['seen', 'click', 'dismiss', 'complete', 'step', 'react'];
export const REACTIONS = ['👍', '❤️', '🎉'];

interface CampaignAudience {
  segment?: 'all' | 'with_plan' | 'without_plan' | 'plans';
  plans?: string[];
  infra?: 'any' | 'active' | 'blocked' | 'none';
  new_customer_days?: number | null;
  url_pattern?: string | null;
  test_emails?: string[];
}

interface CampaignRow {
  id: string;
  type: CampaignType;
  status: 'draft' | 'active' | 'paused' | 'archived';
  content: Record<string, unknown>;
  audience: CampaignAudience | null;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  published_at: string | null;
  sender: { name: string; avatar_url: string | null } | null;
}

interface ReceiptRow {
  campaign_id: string;
  clicked_at: string | null;
  dismissed_at: string | null;
  completed_at: string | null;
  step_reached: number | null;
  reaction: string | null;
}

export interface WidgetCampaign extends Record<string, unknown> {
  id: string;
  type: CampaignType;
  content: Record<string, unknown>;
  priority: number;
  published_at: string | null;
  url_pattern: string | null;
  sender: { name: string; avatar_url: string | null } | null;
  receipt: {
    seen: boolean;
    clicked: boolean;
    dismissed: boolean;
    completed: boolean;
    step_reached: number | null;
    reaction: string | null;
  } | null;
  is_test: boolean;
}

const CAMPAIGN_SELECT =
  'id, type, status, content, audience, priority, starts_at, ends_at, published_at, ' +
  'sender:desk_agents!desk_campaigns_sender_agent_id_fkey(name, avatar_url)';

// ── Público ───────────────────────────────────────────────────────────────────

interface AudienceContext {
  planTag: string;          // max | ultra | advanced | starter | sem-plano
  hasActiveInfra: boolean;
  hasBlockedInfra: boolean;
  hasAnyInfra: boolean;
  accountCreatedAt: Date | null;
}

/** Algum disparo candidato precisa de dados do cliente para decidir? */
function needsContactContext(rows: CampaignRow[]): boolean {
  return rows.some((r) => {
    const a = r.audience ?? {};
    return (a.segment && a.segment !== 'all') || (a.infra && a.infra !== 'any');
  });
}

function needsAccountAge(rows: CampaignRow[]): boolean {
  return rows.some((r) => (r.audience?.new_customer_days ?? 0) > 0);
}

export function matchesAudience(audience: CampaignAudience | null, ctx: AudienceContext): boolean {
  const a = audience ?? {};
  const hasPlan = ctx.planTag !== 'sem-plano';

  switch (a.segment ?? 'all') {
    case 'with_plan':
      if (!hasPlan) return false;
      break;
    case 'without_plan':
      if (hasPlan) return false;
      break;
    case 'plans': {
      const wanted = (a.plans ?? []).map((p) => String(p).toLowerCase());
      if (wanted.length === 0 || !wanted.includes(ctx.planTag)) return false;
      break;
    }
  }

  switch (a.infra ?? 'any') {
    case 'active':
      if (!ctx.hasActiveInfra) return false;
      break;
    case 'blocked':
      if (!ctx.hasBlockedInfra) return false;
      break;
    case 'none':
      if (ctx.hasAnyInfra) return false;
      break;
  }

  const days = a.new_customer_days ?? 0;
  if (days > 0) {
    // Sem data de criação conhecida não dá para afirmar que é novo — fica de fora.
    if (!ctx.accountCreatedAt) return false;
    const ageMs = Date.now() - ctx.accountCreatedAt.getTime();
    if (ageMs > days * 86_400_000) return false;
  }

  return true;
}

function isTestEmail(audience: CampaignAudience | null, email: string): boolean {
  const list = audience?.test_emails ?? [];
  return list.some((e) => String(e).trim().toLowerCase() === email);
}

function withinSchedule(row: CampaignRow, now: number): boolean {
  if (row.starts_at && Date.parse(row.starts_at) > now) return false;
  if (row.ends_at && Date.parse(row.ends_at) <= now) return false;
  return true;
}

// ── Contexto do cliente ───────────────────────────────────────────────────────

async function buildContext(
  email: string,
  wantContact: boolean,
  wantAge: boolean,
  prefetched?: ContactInfoResult | null,
): Promise<AudienceContext> {
  const ctx: AudienceContext = {
    planTag: 'sem-plano',
    hasActiveInfra: false,
    hasBlockedInfra: false,
    hasAnyInfra: false,
    accountCreatedAt: null,
  };

  if (wantContact) {
    const info = prefetched !== undefined
      ? prefetched
      : await fetchContactInfo(email).catch(() => null);
    if (info) {
      ctx.planTag = detectPlanTag(info.subscriptions ?? []);
      const statuses = (info.infras ?? []).map((i) => String(i.status ?? '').toUpperCase());
      ctx.hasAnyInfra = statuses.length > 0;
      ctx.hasActiveInfra = statuses.includes('DEPLOYED');
      ctx.hasBlockedInfra = statuses.includes('BLOCKED');
    }
  }

  if (wantAge) {
    // Consulta isolada (não passa por fetchContactInfo) para uma coluna
    // inesperada aqui nunca derrubar o resto do widget.
    try {
      const prod = cloudfyProdClient();
      if (prod) {
        const { data } = await prod
          .from('account')
          .select('created_at')
          .eq('email', email)
          .maybeSingle();
        const created = (data as { created_at?: string } | null)?.created_at;
        if (created) ctx.accountCreatedAt = new Date(created);
      }
    } catch (e) {
      console.warn('[campaigns] created_at da conta indisponível:', e instanceof Error ? e.message : e);
    }
  }

  return ctx;
}

// ── Elegíveis para um cliente ─────────────────────────────────────────────────

/**
 * Disparos que este cliente pode ver agora, já com o estado dele (receipt).
 *
 * Entram:
 *   • active + dentro da janela + público casa; ou
 *   • qualquer status exceto archived, se o e-mail está em test_emails
 *     (prévia antes de publicar — marcado is_test).
 *
 * Não filtra por "já fechou/clicou": o widget decide o que esconder por tipo
 * (uma novidade clicada continua no feed; um aviso fechado some).
 */
export async function loadEligibleCampaigns(
  service: ServiceClient,
  email: string,
  opts: { contactInfo?: ContactInfoResult | null } = {},
): Promise<WidgetCampaign[]> {
  const { data, error } = await service
    .from('desk_campaigns')
    .select(CAMPAIGN_SELECT)
    .neq('status', 'archived')
    .order('priority', { ascending: false })
    .order('published_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[campaigns] listar falhou:', error.message);
    return [];
  }

  const now = Date.now();
  const rows = ((data ?? []) as unknown as CampaignRow[]).map((r) => ({
    ...r,
    // O join devolve objeto (FK única); normaliza caso venha em array.
    sender: Array.isArray(r.sender) ? (r.sender[0] ?? null) : r.sender,
  }));

  // Primeiro corte, barato: status/agenda (ou e-mail de teste).
  const candidates = rows.filter((r) => {
    if (isTestEmail(r.audience, email)) return true;
    return r.status === 'active' && withinSchedule(r, now);
  });
  if (candidates.length === 0) return [];

  // Dados do cliente só se algum candidato precisa deles — a maioria dos
  // disparos é "todos os clientes" e não vale uma ida ao Supabase de produção.
  const live = candidates.filter((r) => !isTestEmail(r.audience, email));
  const ctx = await buildContext(
    email,
    needsContactContext(live),
    needsAccountAge(live),
    opts.contactInfo,
  );

  const eligible = candidates.filter((r) => {
    if (isTestEmail(r.audience, email)) return true;
    return matchesAudience(r.audience, ctx);
  });
  if (eligible.length === 0) return [];

  const { data: receipts } = await service
    .from('desk_campaign_receipts')
    .select('campaign_id, clicked_at, dismissed_at, completed_at, step_reached, reaction')
    .eq('email', email)
    .in('campaign_id', eligible.map((r) => r.id));

  const receiptBy = new Map<string, ReceiptRow>();
  for (const r of (receipts ?? []) as unknown as ReceiptRow[]) receiptBy.set(r.campaign_id, r);

  return eligible.map((r) => {
    const rec = receiptBy.get(r.id) ?? null;
    const liveNow = r.status === 'active' && withinSchedule(r, now);
    return {
      id: r.id,
      type: r.type,
      content: r.content ?? {},
      priority: r.priority ?? 0,
      published_at: r.published_at,
      url_pattern: r.audience?.url_pattern ?? null,
      sender: r.sender ?? null,
      receipt: rec
        ? {
            seen: true,
            clicked: !!rec.clicked_at,
            dismissed: !!rec.dismissed_at,
            completed: !!rec.completed_at,
            step_reached: rec.step_reached,
            reaction: rec.reaction,
          }
        : null,
      is_test: !liveNow,
    };
  });
}

// ── Eventos ───────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Grava um evento do cliente num disparo. Verifica que o disparo existe e não
 * está arquivado — um id inventado não cria lixo na tabela de receipts.
 */
export async function trackCampaignEvent(
  service: ServiceClient,
  campaignId: unknown,
  email: string,
  event: unknown,
  step?: unknown,
  reaction?: unknown,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (typeof campaignId !== 'string' || !UUID_RE.test(campaignId)) {
    return { ok: false, status: 400, error: 'campaign_id inválido' };
  }
  if (typeof event !== 'string' || !CAMPAIGN_EVENTS.includes(event as CampaignEvent)) {
    return { ok: false, status: 400, error: 'evento inválido' };
  }

  let stepValue: number | null = null;
  if (event === 'step' || event === 'complete') {
    const n = Number(step);
    stepValue = Number.isInteger(n) && n >= 0 && n < 100 ? n : null;
    if (event === 'step' && stepValue === null) {
      return { ok: false, status: 400, error: 'step inválido' };
    }
  }

  let reactionValue: string | null = null;
  if (event === 'react') {
    if (reaction !== null && reaction !== undefined) {
      if (typeof reaction !== 'string' || !REACTIONS.includes(reaction)) {
        return { ok: false, status: 400, error: 'reação inválida' };
      }
      reactionValue = reaction;
    }
  }

  const { data: exists } = await service
    .from('desk_campaigns')
    .select('id')
    .eq('id', campaignId)
    .neq('status', 'archived')
    .maybeSingle();
  if (!exists) return { ok: false, status: 404, error: 'Disparo não encontrado' };

  const { error } = await service.rpc('desk_campaign_track', {
    p_campaign_id: campaignId,
    p_email: email,
    p_event: event,
    p_step: stepValue,
    p_reaction: reactionValue,
  });
  if (error) {
    console.error('[campaigns] track falhou:', error.message);
    return { ok: false, status: 500, error: 'Não foi possível registrar' };
  }
  return { ok: true };
}
