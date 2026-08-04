// Tipos e helpers para a resposta da Edge Function get-contact-info.
// Fonte de dados: Supabase de produção da Cloudfy (CLOUDFY_SUPABASE_*).
// Consumido por ClientInfoPanel, Contacts e ChatWidget.

export interface ContactCustomer {
  name: string;
  email: string;
  customer_id: string;
  referral: string;
}

export interface ContactSubscription {
  subscription_id: string;
  status: string;       // normalizado: active | pending | canceled | unpaid
  infra_status: string; // bruto: DEPLOYED | DEPLOYING | STOPPED | BLOCKED
  product: string;
  mrr: number;
  interval: string;   // month | year
  promocode: string;
  created_at: string; // ISO 8601
}

export interface ContactInfra {
  subscription_id: string; // links back to the subscription
  infra_id: string;
  status: string;          // bruto: DEPLOYED | DEPLOYING | STOPPED | BLOCKED
  default_domain: string;  // ex: "iconicmillipede"
  purchase_code: string;
  requests_24h: number;
  requests_7d: number;
  requests_30d: number;
}

// ─── Cobrança (Chargefy) ──────────────────────────────────────────────────────
// Espelha os tipos de supabase/functions/_shared/chargefy.ts. Valores já vêm
// convertidos de centavos pela Edge Function.

export interface BillingSubscription {
  status: string;
  product_name: string;
  amount: number;
  currency: string;
  interval: string;
  quantity: number;
  started_at: string;
  next_billing_at: string;
  current_period_end: string;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  has_pending_update: boolean;
}

export interface BillingInvoice {
  number: string;
  status: string;
  amount_total: number;
  amount_due: number;
  amount_discount: number;
  currency: string;
  due_date: string | null;
  paid_at: string | null;
  hosted_url: string | null;
  pdf_url: string | null;
  interest_amount: number;
  late_fee_amount: number;
  credit_applied: number;
  billing_reason: string | null;
  allow_late_payment: boolean;
}

export interface BillingCharge {
  status: string;
  paid: boolean;
  amount: number;
  currency: string;
  created_at: string;
  method: string;
  card_brand: string | null;
  card_last4: string | null;
  installments: number | null;
  receipt_url: string | null;
  error_message: string | null;
  error_code: string | null;
}

export interface BillingInfo {
  customer_since: string;
  phone: string | null;
  subscriptions: BillingSubscription[];
  invoices: BillingInvoice[];
  charges: BillingCharge[];
}

export interface ContactInfo {
  customer: ContactCustomer | null;
  subscriptions: ContactSubscription[];
  infras: ContactInfra[];
  /** null para clientes ainda não migrados para a Chargefy. */
  billing?: BillingInfo | null;
}

export const intervalLabels: Record<string, string> = {
  month: "Mensal",
  year:  "Anual",
};

/** Combina product + interval num rótulo de plano, ex: "Cloud Advanced · Mensal" */
export function planLabel(sub: ContactSubscription | null): string | null {
  if (!sub?.product) return null;
  const interval = sub.interval ? intervalLabels[sub.interval] ?? sub.interval : null;
  return interval ? `${sub.product} · ${interval}` : sub.product;
}

/**
 * Rótulo + classes de cor para o `deployment_status` bruto da infraestrutura.
 *   DEPLOYED  → verde   (no ar)
 *   DEPLOYING → âmbar   (provisionando)
 *   STOPPED   → cinza   (parada/cancelada)
 *   BLOCKED   → vermelho (bloqueada, ger. pagamento)
 */
export interface DeploymentStatusStyle {
  label: string;
  /** classes para badge (texto + fundo + borda) */
  cls: string;
  /** classe da bolinha de status */
  dotCls: string;
}

export function deploymentStatusStyle(raw: string | null | undefined): DeploymentStatusStyle {
  const v = String(raw ?? "").toUpperCase();
  switch (v) {
    case "DEPLOYED":
      return { label: "No ar",        cls: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20", dotCls: "bg-emerald-500" };
    case "DEPLOYING":
      return { label: "Provisionando", cls: "text-amber-500 bg-amber-500/10 border-amber-500/20",       dotCls: "bg-amber-500" };
    case "BLOCKED":
      return { label: "Bloqueada",     cls: "text-rose-500 bg-rose-500/10 border-rose-500/20",           dotCls: "bg-rose-500" };
    case "STOPPED":
      return { label: "Parada",        cls: "text-muted-foreground bg-muted/40 border-border",           dotCls: "bg-muted-foreground" };
    default:
      return { label: raw ? String(raw) : "—", cls: "text-muted-foreground bg-muted/40 border-border",   dotCls: "bg-muted-foreground" };
  }
}
