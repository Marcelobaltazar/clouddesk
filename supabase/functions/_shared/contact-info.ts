// ─── Dados do cliente no Supabase de PRODUÇÃO da Cloudfy (read-only) ───────────
// Compartilhado por: get-contact-info, desk-widget-api e o pipeline de IA.
// Somente .select() em account / infrastructure / products / purchases.

import { newClient, type ServiceClient } from './supabase.ts';
import { fetchBillingInfo, type BillingInfo } from './chargefy.ts';

export interface ContactCustomer {
  name: string;
  email: string;
  customer_id: string;
  referral: string;
}

export interface ContactSubscription {
  subscription_id: string;
  status: string;        // normalizado: active | canceled | pending | unpaid
  infra_status: string;  // bruto: DEPLOYED | DEPLOYING | STOPPED | BLOCKED
  product: string;
  mrr: number;
  interval: string;
  promocode: string;
  created_at: string;
}

export interface ContactInfra {
  subscription_id: string;
  infra_id: string;
  purchase_code: string;
  default_domain: string;
  status: string;        // bruto deployment_status
  requests_24h: number;
  requests_7d: number;
  requests_30d: number;
}

export interface ContactInfoResult {
  customer: ContactCustomer | null;
  subscriptions: ContactSubscription[];
  infras: ContactInfra[];
  /** Cobrança na Chargefy. null quando o cliente ainda não foi migrado da
   *  Stripe — maioria dos casos hoje. Campo aditivo: consumidores que só usam
   *  customer/subscriptions/infras seguem funcionando sem alteração. */
  billing?: BillingInfo | null;
}

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

export function normalizeInfraStatus(raw: string | null | undefined): string {
  if (!raw) return '';
  const v = String(raw).toUpperCase();
  if (v === 'DEPLOYED')  return 'active';
  if (v === 'DEPLOYING') return 'pending';
  if (v === 'STOPPED')   return 'canceled';
  if (v === 'BLOCKED')   return 'unpaid';
  return raw.toLowerCase();
}

export function isActiveInfra(infra: ContactInfra): boolean {
  return String(infra.status ?? '').toUpperCase() === 'DEPLOYED';
}

export function cloudfyProdClient(): ServiceClient | null {
  const prodUrl = Deno.env.get('CLOUDFY_SUPABASE_URL');
  const prodKey = Deno.env.get('CLOUDFY_SUPABASE_SERVICE_ROLE_KEY');
  if (!prodUrl || !prodKey) return null;
  return newClient(prodUrl, prodKey);
}

export async function fetchContactInfo(email: string): Promise<ContactInfoResult | null> {
  const prod = cloudfyProdClient();
  if (!prod) {
    console.warn('[contact-info] CLOUDFY_SUPABASE_* secrets ausentes');
    return null;
  }

  // Cobrança (Chargefy) roda em paralelo com as queries do banco — não soma
  // latência. Falha ou cliente não-migrado resolve para null.
  const billingPromise = fetchBillingInfo(email).catch(() => null);

  const { data: accRow } = await prod
    .from('account')
    .select('id, name, email, stripe_customer_id')
    .eq('email', email)
    .maybeSingle();

  const customer: ContactCustomer | null = accRow
    ? {
        name:        (accRow as Record<string, unknown>).name as string ?? '',
        email:       (accRow as Record<string, unknown>).email as string,
        customer_id: (accRow as Record<string, unknown>).stripe_customer_id as string ?? '',
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
      // purchases.amount vem em CENTAVOS (75480 = R$ 754,80) — conferido contra
      // a Chargefy. Sem dividir, o painel mostrava valores 100x maiores.
      mrr:             typeof row.purchase?.amount === 'number' ? row.purchase.amount / 100 : 0,
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

  return { customer, subscriptions, infras, billing: await billingPromise };
}

// ─── Reenvio de credenciais (validação de posse + chamada ao partner API) ──────
// O disparo SÓ acontece por clique do CLIENTE no widget (nunca pela IA). Aqui é
// validado server-side que a infra pertence ao e-mail VERIFICADO e está ativa.

const CLOUDFY_PARTNER_BASE = 'https://partner.cloudfy.space';
const RESEND_TIMEOUT_MS = 10_000;

export interface ResendOutcome {
  success: boolean;
  /** mensagem de erro amigável (pt-BR) quando success=false */
  error?: string;
  status: number;
}

export async function validateAndResendCredentials(
  infraId: string,
  email: string,
): Promise<ResendOutcome> {
  const partnerKey = Deno.env.get('CLOUDFY_PARTNER_KEY');
  if (!partnerKey) {
    console.error('[credentials] CLOUDFY_PARTNER_KEY ausente');
    return { success: false, error: 'Configuração do servidor incompleta', status: 500 };
  }

  const prod = cloudfyProdClient();
  if (!prod) {
    return { success: false, error: 'Configuração do servidor incompleta', status: 500 };
  }

  const { data: infraRow, error: infraErr } = await prod
    .from('infrastructure')
    .select(
      'id, deployment_status, ' +
      'purchase:purchases!infrastructure_purchase_id_fkey!inner(client_email)',
    )
    .eq('id', infraId)
    .eq('purchase.client_email', email)
    .maybeSingle<{ id: string; deployment_status: string | null }>();

  if (infraErr) {
    console.error(`[credentials] erro na validação de posse: ${infraErr.message}`);
    return { success: false, error: 'Não foi possível validar a infraestrutura', status: 502 };
  }

  if (!infraRow) {
    console.warn(`[credentials] NEGADO: infra ${infraId} não pertence a ${email}`);
    return { success: false, error: 'Infraestrutura não encontrada para este cliente', status: 403 };
  }

  if (String(infraRow.deployment_status ?? '').toUpperCase() !== 'DEPLOYED') {
    console.warn(`[credentials] NEGADO: infra ${infraId} não está ativa (${infraRow.deployment_status})`);
    return { success: false, error: 'Esta infraestrutura não está ativa', status: 409 };
  }

  const url = `${CLOUDFY_PARTNER_BASE}/api/partners/infrastructure/${encodeURIComponent(infraId)}/resend-credentials`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'X-Partner-Key': partnerKey, 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError'
      ? `timeout após ${RESEND_TIMEOUT_MS}ms`
      : (err instanceof Error ? err.message : 'desconhecido');
    console.error(`[credentials] fetch falhou: ${reason}`);
    return { success: false, error: 'Não foi possível contatar o serviço da Cloudfy', status: 502 };
  } finally {
    clearTimeout(timer);
  }

  interface CloudfyResponse { success?: boolean; message?: string; error?: string }
  let body: CloudfyResponse | null = null;
  try {
    body = await res.json() as CloudfyResponse;
  } catch { /* corpo não-JSON */ }

  if (!res.ok || body?.success === false) {
    const upstreamError = body?.error ?? body?.message ?? `HTTP ${res.status}`;
    console.error(`[credentials] Cloudfy ${res.status} para infra ${infraId}: ${upstreamError}`);
    return { success: false, error: upstreamError, status: 502 };
  }

  console.log(`[credentials] OK para infra ${infraId}`);
  return { success: true, status: 200 };
}
