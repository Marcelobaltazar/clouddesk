import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { corsHeaders } from '../_shared/cors.ts';
import { verifyOperator } from '../_shared/widget-auth.ts';
import { fetchBillingInfo, type BillingInfo } from '../_shared/chargefy.ts';

// ─── Types ──────────────────────────────────────────────────────────────────
// Same shape as before — consumers (ChatWidget, ClientInfoPanel, desk-ai-respond)
// keep working without changes. Source of truth swapped from Airtable to the
// Cloudfy production Supabase (separate project: CLOUDFY_SUPABASE_*).

interface ContactInfoRequest {
  email: string;
}

interface CustomerInfo {
  name: string;
  email: string;
  customer_id: string; // Stripe cus_...
  referral: string;    // not stored in the new schema — kept as "" for contract compatibility
}

/**
 * One row per provisioned infrastructure (1:1 with infras[] below). Each entry
 * IS a subscription in the new model — purchases are no longer the source of
 * truth, because a single subscription can have multiple purchase records
 * (renewals, upgrades) that would otherwise duplicate in the UI.
 */
interface SubscriptionInfo {
  subscription_id: string; // stripe_subscription_id from the parent purchase, or purchase.id as fallback
  status: string;          // normalized for legacy consumers: active | canceled | pending | unpaid
  infra_status: string;    // original deployment_status: DEPLOYED | DEPLOYING | STOPPED | BLOCKED
  product: string;         // products.name (joined via infrastructure.product_id)
  mrr: number;             // purchase.amount when present, else 0
  interval: string;        // not stored — empty
  promocode: string;       // not stored — empty
  created_at: string;      // infrastructure.created_at
}

interface InfraInfo {
  subscription_id: string; // same value as SubscriptionInfo[i].subscription_id (1:1)
  infra_id: string;        // infrastructure.id
  purchase_code: string;   // from the parent purchase
  default_domain: string;  // infrastructure.default_domain (e.g. "iconicmillipede")
  status: string;          // raw deployment_status (DEPLOYED | DEPLOYING | STOPPED | BLOCKED)
  requests_24h: number;    // not tracked — 0
  requests_7d: number;
  requests_30d: number;
}

interface ContactInfoResult {
  customer: CustomerInfo | null;
  subscriptions: SubscriptionInfo[];
  infras: InfraInfo[];
  /** Cobrança na Chargefy. null para clientes ainda não migrados da Stripe. */
  billing?: BillingInfo | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Maps Cloudfy's `infrastructure.deployment_status` to the legacy Stripe-style
 * status that existing consumers filter by (`s.status === 'active'`).
 *
 *   DEPLOYED  → active   (running and serving traffic)
 *   DEPLOYING → pending  (being provisioned, ~20 min)
 *   STOPPED   → canceled (cancelled and destroyed)
 *   BLOCKED   → unpaid   (blocked, usually due to payment)
 *
 * The original value is also returned separately via `infra_status` so the UI
 * can show the precise label / explanation per state.
 */
function normalizeStatus(raw: string | null | undefined): string {
  if (!raw) return '';
  const v = String(raw).toUpperCase();
  if (v === 'DEPLOYED')  return 'active';
  if (v === 'DEPLOYING') return 'pending';
  if (v === 'STOPPED')   return 'canceled';
  if (v === 'BLOCKED')   return 'unpaid';
  return raw.toLowerCase();
}

// Row shapes returned by the SELECT queries. Narrow what we read so a schema
// change elsewhere can't silently break us.

interface AccountRow {
  id: string;
  name: string | null;
  email: string;
  stripe_customer_id: string | null;
}

interface InfrastructureRow {
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

// ─── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Dados de cliente (nome, assinaturas, infra) são sensíveis: apenas
    // OPERADORES autenticados do painel podem consultar por e-mail arbitrário.
    // O widget não chama mais esta função — usa desk-widget-api (identidade HMAC).
    const operatorId = await verifyOperator(req);
    if (!operatorId) {
      return new Response(
        JSON.stringify({ error: 'Apenas operadores autenticados' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { email }: ContactInfoRequest = await req.json();

    if (!email || typeof email !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const prodUrl = Deno.env.get('CLOUDFY_SUPABASE_URL');
    const prodKey = Deno.env.get('CLOUDFY_SUPABASE_SERVICE_ROLE_KEY');
    if (!prodUrl || !prodKey) {
      console.error('[get-contact-info] Missing CLOUDFY_SUPABASE_* secrets');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Separate client pointing at the Cloudfy production database. READ-ONLY usage.
    const prodClient = createClient(prodUrl, prodKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── 1) account by email ────────────────────────────────────────────────
    // Cobrança (Chargefy) em paralelo com o banco — não soma latência.
    const billingPromise = fetchBillingInfo(email).catch(() => null);

    const { data: accRow, error: accErr } = await prodClient
      .from('account')
      .select('id, name, email, stripe_customer_id')
      .eq('email', email)
      .maybeSingle<AccountRow>();

    if (accErr) {
      console.error('[get-contact-info] account error:', accErr.message);
    }

    const customer: CustomerInfo | null = accRow
      ? {
          name:        accRow.name ?? '',
          email:       accRow.email,
          customer_id: accRow.stripe_customer_id ?? '',
          referral:    '', // not stored in the new schema
        }
      : null;

    // ── 2) infrastructure for this client, with parent purchase + product ───
    // Source of truth: one row per provisioned infra. Filters by
    // purchase.client_email through an inner-joined embed, so we don't have to
    // fetch purchases first. The FK between infrastructure and purchases is
    // ambiguous (two FKs exist) — we disambiguate with
    // `infrastructure_purchase_id_fkey` (the many-to-one "belongs to" link).
    const { data: infraRows, error: infraErr } = await prodClient
      .from('infrastructure')
      .select(
        'id, default_domain, deployment_status, created_at, ' +
        'products(name), ' +
        'purchase:purchases!infrastructure_purchase_id_fkey!inner(' +
          'id, purchase_code, stripe_subscription_id, amount, client_email' +
        ')',
      )
      .eq('purchase.client_email', email)
      .order('created_at', { ascending: false })
      .returns<InfrastructureRow[]>();

    if (infraErr) {
      console.error('[get-contact-info] infrastructure error:', infraErr.message);
    }

    const rows = infraRows ?? [];

    // Build both arrays from the same source — guarantees 1:1 alignment by index.
    const subscriptions: SubscriptionInfo[] = rows.map((row) => {
      const subscriptionId = row.purchase?.stripe_subscription_id ?? row.purchase?.id ?? row.id;
      return {
        subscription_id: subscriptionId,
        status:          normalizeStatus(row.deployment_status),
        infra_status:    row.deployment_status ?? '',
        product:         row.products?.name ?? '',
        // purchases.amount vem em CENTAVOS (75480 = R$ 754,80).
        mrr:             typeof row.purchase?.amount === 'number' ? row.purchase.amount / 100 : 0,
        interval:        '',
        promocode:       '',
        created_at:      row.created_at,
      };
    });

    const infras: InfraInfo[] = rows.map((row) => {
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

    console.log(
      `[get-contact-info] ${email} → ${subscriptions.length} subscription(s), ${infras.length} infra(s)`,
    );

    const result: ContactInfoResult = {
      customer,
      subscriptions,
      infras,
      billing: await billingPromise,
    };
    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[get-contact-info] error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
