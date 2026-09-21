// ─── desk-campaigns-admin — apoio do painel para os Disparos ───────────────────
//
// Só operadores. O CRUD dos disparos é feito pelo painel direto em
// desk_campaigns (RLS de agente); o que precisa de dados que o painel NÃO
// enxerga fica aqui:
//
//   audience_estimate → "≈ quantos clientes vão ver isto?" para o público
//                       escolhido no editor. Varre as contas e infraestruturas
//                       do Supabase de PRODUÇÃO da Cloudfy (read-only), monta o
//                       mesmo contexto que o gateway usa por cliente e aplica a
//                       MESMA matchesAudience — o número do editor e a
//                       elegibilidade real nunca divergem por lógica diferente.
//
// O resultado é cacheado em memória por alguns minutos: o operador mexe nos
// filtros várias vezes seguidas e a base (~3 mil contas) não muda nesse ritmo.

import { corsHeaders } from '../_shared/cors.ts';
import { verifyOperator } from '../_shared/widget-auth.ts';
import { cloudfyProdClient, type ContactSubscription } from '../_shared/contact-info.ts';
import { detectPlanTag } from '../_shared/ai-pipeline.ts';
import { matchesAudience } from '../_shared/campaigns.ts';

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface Body {
  action?: 'audience_estimate';
  audience?: Record<string, unknown>;
}

/** Contexto de público de UMA conta — mesma forma que o gateway monta por e-mail. */
interface AccountContext {
  email: string;
  planTag: string;
  hasActiveInfra: boolean;
  hasBlockedInfra: boolean;
  hasAnyInfra: boolean;
  accountCreatedAt: Date | null;
}

interface InfraRow {
  deployment_status: string | null;
  products: { name: string | null } | null;
  purchase: { client_email: string | null } | null;
}

const PAGE = 1000;         // teto do PostgREST por requisição
const MAX_PAGES = 30;      // ~30 mil linhas — muito acima do parque atual
const CACHE_TTL_MS = 5 * 60_000;

let cache: { at: number; contexts: AccountContext[] } | null = null;

function normalizeStatus(raw: string | null): string {
  const v = String(raw ?? '').toUpperCase();
  if (v === 'DEPLOYED') return 'active';
  if (v === 'DEPLOYING') return 'pending';
  if (v === 'STOPPED') return 'canceled';
  if (v === 'BLOCKED') return 'unpaid';
  return v.toLowerCase();
}

async function loadContexts(): Promise<AccountContext[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.contexts;

  const prod = cloudfyProdClient();
  if (!prod) throw new Error('CLOUDFY_SUPABASE_* ausentes');

  // 1. Todas as contas (e-mail + data de criação)
  const accounts = new Map<string, Date | null>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await prod
      .from('account')
      .select('email, created_at')
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`account: ${error.message}`);
    const rows = (data ?? []) as Array<{ email: string | null; created_at: string | null }>;
    for (const r of rows) {
      const email = (r.email ?? '').trim().toLowerCase();
      if (!email) continue;
      accounts.set(email, r.created_at ? new Date(r.created_at) : null);
    }
    if (rows.length < PAGE) break;
  }

  // 2. Todas as infraestruturas com a compra dona (e-mail) e o produto (plano)
  const subsByEmail = new Map<string, ContactSubscription[]>();
  const statusesByEmail = new Map<string, string[]>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await prod
      .from('infrastructure')
      .select(
        'deployment_status, products(name), ' +
        'purchase:purchases!infrastructure_purchase_id_fkey!inner(client_email)',
      )
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`infrastructure: ${error.message}`);
    const rows = (data ?? []) as unknown as InfraRow[];
    for (const r of rows) {
      const email = (r.purchase?.client_email ?? '').trim().toLowerCase();
      if (!email) continue;
      const subs = subsByEmail.get(email) ?? [];
      subs.push({
        subscription_id: '',
        status: normalizeStatus(r.deployment_status),
        infra_status: r.deployment_status ?? '',
        product: r.products?.name ?? '',
        mrr: 0,
        interval: '',
        promocode: '',
        created_at: '',
      });
      subsByEmail.set(email, subs);
      const st = statusesByEmail.get(email) ?? [];
      st.push(String(r.deployment_status ?? '').toUpperCase());
      statusesByEmail.set(email, st);
      // Conta que só existe na compra (sem linha em account) também é cliente.
      if (!accounts.has(email)) accounts.set(email, null);
    }
    if (rows.length < PAGE) break;
  }

  const contexts: AccountContext[] = [];
  for (const [email, createdAt] of accounts) {
    const statuses = statusesByEmail.get(email) ?? [];
    contexts.push({
      email,
      planTag: detectPlanTag(subsByEmail.get(email) ?? []),
      hasAnyInfra: statuses.length > 0,
      hasActiveInfra: statuses.includes('DEPLOYED'),
      hasBlockedInfra: statuses.includes('BLOCKED'),
      accountCreatedAt: createdAt,
    });
  }

  cache = { at: Date.now(), contexts };
  return contexts;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const operatorId = await verifyOperator(req);
    if (!operatorId) return json({ error: 'Acesso restrito a operadores' }, 401);

    const body: Body = await req.json().catch(() => ({}));

    if (body.action === 'audience_estimate') {
      const audience = (body.audience && typeof body.audience === 'object' ? body.audience : {}) as Parameters<typeof matchesAudience>[0];
      const contexts = await loadContexts();

      let matched = 0;
      const byPlan: Record<string, number> = {};
      for (const ctx of contexts) {
        if (!matchesAudience(audience, ctx)) continue;
        matched++;
        byPlan[ctx.planTag] = (byPlan[ctx.planTag] ?? 0) + 1;
      }

      return json({
        matched,
        total: contexts.length,
        by_plan: byPlan,
        cached_at: cache ? new Date(cache.at).toISOString() : null,
      });
    }

    return json({ error: 'Ação inválida' }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[campaigns-admin] fatal:', msg);
    return json({ error: 'Não foi possível estimar o público agora' }, 500);
  }
});
