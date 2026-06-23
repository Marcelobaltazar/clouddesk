import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { corsHeaders } from '../_shared/cors.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResendRequest {
  infra_id: string;
  // E-mail do cliente identificado na conversa. OBRIGATÓRIO: usado para validar
  // que a infraestrutura realmente pertence a ele antes de disparar o reenvio.
  email: string;
}

interface ResendResult {
  success?: true;
  error?: string;
}

interface CloudfyResponse {
  success?: boolean;
  message?: string;
  error?: string;
  data?: { infrastructureId?: string };
}

// ─── Config ─────────────────────────────────────────────────────────────────

const CLOUDFY_BASE = 'https://partner.cloudfy.space';
const REQUEST_TIMEOUT_MS = 10_000;

// ─── Handler ──────────────────────────────────────────────────────────────────
// Triggers Cloudfy's own credential-resend flow for a given infrastructure.
// Cloudfy sends the email itself — this function only forwards the request,
// authenticated with the server-side CLOUDFY_PARTNER_KEY secret sent in the
// X-Partner-Key header (NOT Authorization: Bearer).

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const json = (body: ResendResult, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const { infra_id, email }: ResendRequest = await req.json();

    if (!infra_id || typeof infra_id !== 'string') {
      return json({ error: 'Missing infra_id' }, 400);
    }
    if (!email || typeof email !== 'string') {
      return json({ error: 'Missing email' }, 400);
    }

    const partnerKey = Deno.env.get('CLOUDFY_PARTNER_KEY');
    if (!partnerKey) {
      console.error('[desk-resend-credentials] Missing CLOUDFY_PARTNER_KEY');
      return json({ error: 'Server configuration error' }, 500);
    }

    // ── Validação de posse ──────────────────────────────────────────────────
    // O reenvio só dispara se a infraestrutura está ATIVA (DEPLOYED) e pertence
    // ao e-mail do cliente. Isso impede que um infra_id arbitrário seja enviado
    // por alguém que não é o dono. Fonte: Supabase de produção da Cloudfy.
    const prodUrl = Deno.env.get('CLOUDFY_SUPABASE_URL');
    const prodKey = Deno.env.get('CLOUDFY_SUPABASE_SERVICE_ROLE_KEY');
    if (!prodUrl || !prodKey) {
      console.error('[desk-resend-credentials] Missing CLOUDFY_SUPABASE_* secrets');
      return json({ error: 'Server configuration error' }, 500);
    }

    const prodClient = createClient(prodUrl, prodKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: infraRow, error: infraErr } = await prodClient
      .from('infrastructure')
      .select(
        'id, deployment_status, ' +
        'purchase:purchases!infrastructure_purchase_id_fkey!inner(client_email)',
      )
      .eq('id', infra_id)
      .eq('purchase.client_email', email)
      .maybeSingle<{ id: string; deployment_status: string | null }>();

    if (infraErr) {
      console.error(`[desk-resend-credentials] ownership query error: ${infraErr.message}`);
      return json({ error: 'Não foi possível validar a infraestrutura' }, 502);
    }

    if (!infraRow) {
      console.warn(`[desk-resend-credentials] DENIED: infra ${infra_id} não pertence a ${email}`);
      return json({ error: 'Infraestrutura não encontrada para este cliente' }, 403);
    }

    if (String(infraRow.deployment_status ?? '').toUpperCase() !== 'DEPLOYED') {
      console.warn(`[desk-resend-credentials] DENIED: infra ${infra_id} não está ativa (${infraRow.deployment_status})`);
      return json({ error: 'Esta infraestrutura não está ativa' }, 409);
    }

    const url = `${CLOUDFY_BASE}/api/partners/infrastructure/${encodeURIComponent(infra_id)}/resend-credentials`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Partner-Key': partnerKey,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'AbortError'
        ? `timeout after ${REQUEST_TIMEOUT_MS}ms`
        : (err instanceof Error ? err.message : 'unknown');
      console.error(`[desk-resend-credentials] fetch failed: ${reason}`);
      return json({ error: 'Não foi possível contatar o serviço da Cloudfy' }, 502);
    } finally {
      clearTimeout(timer);
    }

    // Cloudfy returns a JSON body on both success and error. Parse it once so
    // we can surface the upstream `error` message to the client instead of a
    // generic status code.
    let body: CloudfyResponse | null = null;
    try {
      body = await res.json() as CloudfyResponse;
    } catch {
      // Non-JSON body — fall through with body=null
    }

    if (!res.ok || body?.success === false) {
      const upstreamError = body?.error ?? body?.message ?? `HTTP ${res.status}`;
      console.error(`[desk-resend-credentials] Cloudfy ${res.status} for infra ${infra_id}: ${upstreamError}`);
      return json({ error: upstreamError }, 502);
    }

    console.log(`[desk-resend-credentials] OK for infra ${infra_id}`);
    return json({ success: true }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[desk-resend-credentials] error:', msg);
    return json({ error: msg }, 500);
  }
});
