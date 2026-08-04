// ─── Dados de cobrança na Chargefy (SOMENTE LEITURA) ──────────────────────────
// Acessado pelo servidor MCP da Chargefy (https://mcp.chargefy.io) com uma API
// key de organização de escopo `read`. A superfície MCP não expõe delete nem
// lifecycle financeiro — nada aqui escreve, captura, reembolsa ou cancela.
//
// Nem todo cliente da Cloudfy existe na Chargefy (migração em andamento vinda da
// Stripe). Ausência de cadastro é estado NORMAL, não erro: retorna null e o
// pipeline segue com os dados do banco de produção.

const MCP_ENDPOINT = 'https://mcp.chargefy.io';
const MCP_TIMEOUT_MS = 8_000;

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface BillingSubscription {
  status: string;              // bruto: active | trialing | past_due | unpaid | paused | canceled
  product_name: string;        // resolvido via cache de produtos; cai no id se não achar
  amount: number;              // em unidade monetária (já convertido de centavos)
  currency: string;            // maiúsculo: BRL
  interval: string;            // month | year | ...
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
  status: string;              // paid | open | draft | uncollectible | void
  amount_total: number;
  amount_due: number;
  amount_discount: number;
  currency: string;
  due_date: string | null;
  paid_at: string | null;
  hosted_url: string | null;   // 2ª via
  pdf_url: string | null;
  interest_amount: number;
  late_fee_amount: number;
  credit_applied: number;
  billing_reason: string | null;
  allow_late_payment: boolean;
}

export interface BillingCharge {
  status: string;              // succeeded | pending | failed
  paid: boolean;
  amount: number;
  currency: string;
  created_at: string;
  method: string;              // credit_card | pix | boleto | ''
  card_brand: string | null;
  card_last4: string | null;
  installments: number | null; // parcelas do cartão
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

// ─── Cliente MCP (JSON-RPC sobre Streamable HTTP) ─────────────────────────────

interface McpToolResult {
  result?: { structuredContent?: unknown; isError?: boolean };
  error?: { message?: string };
}

interface ListResponse<T> {
  data?: T[];
  has_more?: boolean;
}

let rpcId = 0;

async function mcpCall<T>(
  apiKey: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);

  try {
    const res = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[chargefy] ${toolName} HTTP ${res.status}`);
      return null;
    }

    const body = await res.json() as McpToolResult;

    if (body.error) {
      console.warn(`[chargefy] ${toolName} erro RPC: ${body.error.message ?? 'desconhecido'}`);
      return null;
    }
    if (body.result?.isError) {
      console.warn(`[chargefy] ${toolName} retornou isError`);
      return null;
    }

    return (body.result?.structuredContent ?? null) as T | null;
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError'
      ? `timeout após ${MCP_TIMEOUT_MS}ms`
      : (err instanceof Error ? err.message : 'desconhecido');
    console.warn(`[chargefy] ${toolName} falhou: ${reason}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Executa uma operação GET (risco R0) da API pública via MCP. */
function readOp<T>(
  apiKey: string,
  operation: string,
  filters?: Record<string, string>,
  limit?: number,
): Promise<ListResponse<T> | null> {
  const args: Record<string, unknown> = { operation };
  if (filters) args.filters = filters;
  if (limit)   args.limit = limit;
  return mcpCall<ListResponse<T>>(apiKey, 'chargefy_api_read', args);
}

// ─── Cache de produtos (catálogo é global, não por cliente) ───────────────────

const PRODUCT_CACHE_TTL_MS = 10 * 60 * 1000;
let productCache: Map<string, string> | null = null;
let productCacheAt = 0;

interface ChargefyProduct { id: string; name?: string | null }

async function getProductNames(apiKey: string): Promise<Map<string, string>> {
  const now = Date.now();
  if (productCache && now - productCacheAt < PRODUCT_CACHE_TTL_MS) return productCache;

  const res = await readOp<ChargefyProduct>(apiKey, 'products.list', undefined, 100);
  const map = new Map<string, string>();
  for (const p of res?.data ?? []) {
    if (p.id && p.name) map.set(p.id, p.name);
  }

  // Só promove a cache se veio algo; falha transitória não apaga o cache bom.
  if (map.size > 0) {
    productCache = map;
    productCacheAt = now;
    return map;
  }
  return productCache ?? map;
}

// ─── Helpers de normalização ──────────────────────────────────────────────────

/** Valores monetários da Chargefy são inteiros em centavos. */
function fromCents(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v / 100 : 0;
}

function currencyUp(v: unknown): string {
  return typeof v === 'string' ? v.toUpperCase() : '';
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ─── Shapes brutos (só o que consumimos) ──────────────────────────────────────

interface RawCustomer {
  id: string;
  email?: string;
  phone?: string | null;
  created_at?: string;
}

interface RawSubItem {
  product?: string | null;
  amount_total?: number;
  currency?: string;
  quantity?: number;
  recurring?: { interval?: string } | null;
}

interface RawSubscription {
  status?: string;
  start_date?: string;
  next_billing_at?: string;
  current_period_end?: string;
  trial_end?: string | null;
  cancel_at?: string | null;
  cancel_at_period_end?: boolean;
  pending_update?: unknown;
  items?: { data?: RawSubItem[] };
}

interface RawInvoice {
  number?: string;
  status?: string;
  amount_total?: number;
  amount_due?: number;
  amount_discount?: number;
  currency?: string;
  due_date?: string | null;
  paid_at?: string | null;
  hosted_invoice_url?: string | null;
  invoice_pdf_url?: string | null;
  interest_amount?: number | null;
  late_fee_amount?: number | null;
  amount_credit_balance_applied?: number;
  billing_reason?: string | null;
  allow_late_payment?: boolean;
}

interface RawCharge {
  status?: string;
  paid?: boolean;
  amount?: number;
  currency?: string;
  created_at?: string;
  receipt_url?: string | null;
  payment_error?: { message?: string | null; code?: string | null } | null;
  payment_method_details?: {
    type?: string | null;
    card?: {
      brand?: string | null;
      last4?: string | null;
      installments?: number | { count?: number } | null;
    } | null;
  } | null;
}

/** `installments` pode vir como número ou objeto — normaliza para número. */
function parseInstallments(v: RawCharge['payment_method_details']): number | null {
  const inst = v?.card?.installments;
  if (typeof inst === 'number') return inst;
  if (inst && typeof inst === 'object' && typeof inst.count === 'number') return inst.count;
  return null;
}

// ─── API pública do módulo ────────────────────────────────────────────────────

/**
 * Busca os dados de cobrança do cliente na Chargefy pelo e-mail.
 *
 * Retorna null quando: secret ausente, cliente não cadastrado na Chargefy
 * (maioria dos casos durante a migração) ou falha de rede. Em todos eles o
 * chamador deve seguir normalmente com os dados do banco de produção.
 */
export async function fetchBillingInfo(email: string): Promise<BillingInfo | null> {
  const apiKey = Deno.env.get('CHARGEFY_API_KEY');
  if (!apiKey) return null;
  if (!email) return null;

  // Porteiro: 1 chamada. Sem cadastro na Chargefy, encerra sem gastar as outras.
  const customers = await readOp<RawCustomer>(apiKey, 'customers.list', { email }, 1);
  const customer = customers?.data?.[0];
  if (!customer?.id) return null;

  const customerId = customer.id;

  const [subsRes, invRes, chgRes, productNames] = await Promise.all([
    readOp<RawSubscription>(apiKey, 'subscriptions.list', { customer: customerId, status: 'all' }, 10),
    readOp<RawInvoice>(apiKey, 'invoices.list', { customer: customerId }, 5),
    readOp<RawCharge>(apiKey, 'charges.list', { customer: customerId }, 5),
    getProductNames(apiKey),
  ]);

  const subscriptions: BillingSubscription[] = (subsRes?.data ?? []).map((s) => {
    const item = s.items?.data?.[0];
    const productId = str(item?.product);
    return {
      status:               str(s.status),
      product_name:         productNames.get(productId) ?? productId,
      amount:               fromCents(item?.amount_total),
      currency:             currencyUp(item?.currency),
      interval:             str(item?.recurring?.interval),
      quantity:             typeof item?.quantity === 'number' ? item.quantity : 1,
      started_at:           str(s.start_date),
      next_billing_at:      str(s.next_billing_at),
      current_period_end:   str(s.current_period_end),
      trial_end:            strOrNull(s.trial_end),
      cancel_at_period_end: s.cancel_at_period_end === true,
      cancel_at:            strOrNull(s.cancel_at),
      has_pending_update:   s.pending_update != null,
    };
  });

  const invoices: BillingInvoice[] = (invRes?.data ?? []).map((i) => ({
    number:             str(i.number),
    status:             str(i.status),
    amount_total:       fromCents(i.amount_total),
    amount_due:         fromCents(i.amount_due),
    amount_discount:    fromCents(i.amount_discount),
    currency:           currencyUp(i.currency),
    due_date:           strOrNull(i.due_date),
    paid_at:            strOrNull(i.paid_at),
    hosted_url:         strOrNull(i.hosted_invoice_url),
    pdf_url:            strOrNull(i.invoice_pdf_url),
    interest_amount:    fromCents(i.interest_amount),
    late_fee_amount:    fromCents(i.late_fee_amount),
    credit_applied:     fromCents(i.amount_credit_balance_applied),
    billing_reason:     strOrNull(i.billing_reason),
    allow_late_payment: i.allow_late_payment === true,
  }));

  const charges: BillingCharge[] = (chgRes?.data ?? []).map((c) => {
    const pmd = c.payment_method_details;
    return {
      status:        str(c.status),
      paid:          c.paid === true,
      amount:        fromCents(c.amount),
      currency:      currencyUp(c.currency),
      created_at:    str(c.created_at),
      method:        str(pmd?.type),
      card_brand:    strOrNull(pmd?.card?.brand),
      card_last4:    strOrNull(pmd?.card?.last4),
      installments:  parseInstallments(pmd),
      receipt_url:   strOrNull(c.receipt_url),
      error_message: strOrNull(c.payment_error?.message),
      error_code:    strOrNull(c.payment_error?.code),
    };
  });

  return {
    customer_since: str(customer.created_at),
    phone:          strOrNull(customer.phone),
    subscriptions,
    invoices,
    charges,
  };
}
