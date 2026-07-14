// ─── desk-resend-credentials (LEGADO — mantido por compatibilidade) ─────────────
//
// O caminho oficial do widget é a ação `resend_credentials` da desk-widget-api.
// Esta função permanece deployada para não quebrar bundles antigos, mas agora
// exige identidade verificada (HMAC user_hash ou operador logado) — antes,
// qualquer pessoa podia disparar reenvio de e-mail para qualquer cliente.
//
// A validação de posse (infra pertence ao e-mail + está DEPLOYED) e a chamada ao
// partner API vivem em _shared/contact-info.ts (compartilhadas com o gateway).

import { corsHeaders } from '../_shared/cors.ts';
import { resolveWidgetIdentity } from '../_shared/widget-auth.ts';
import { validateAndResendCredentials } from '../_shared/contact-info.ts';

interface ResendRequest {
  infra_id?: string;
  email?: string;
  user_hash?: string;
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: ResendRequest = await req.json().catch(() => ({}));

    if (!body.infra_id || typeof body.infra_id !== 'string') {
      return json({ error: 'Missing infra_id' }, 400);
    }

    // Identidade verificada: HMAC do e-mail (widget) ou operador logado (painel)
    const identity = await resolveWidgetIdentity(req, body.email, body.user_hash);
    if (!identity.ok) {
      return json({ error: identity.error }, identity.status);
    }

    const outcome = await validateAndResendCredentials(body.infra_id, identity.email);
    if (!outcome.success) {
      return json({ error: outcome.error ?? 'Falha no reenvio' }, outcome.status);
    }

    return json({ success: true }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[desk-resend-credentials] error:', msg);
    return json({ error: msg }, 500);
  }
});
