// ─── Identidade verificada do widget (estilo Intercom Identity Verification) ───
//
// O cliente do widget NÃO tem sessão Supabase neste projeto (ele vive no Supabase
// de produção da Cloudfy). A identidade dele é provada por um HMAC calculado
// SERVER-SIDE pelo backend do cloudfy.space:
//
//   user_hash = HMAC_SHA256(WIDGET_IDENTITY_SECRET, lowercase(email))  // hex
//
// Sem o hash correto, nenhuma ação do widget é aceita — isso impede que qualquer
// pessoa com a anon key (pública no bundle) converse/leia dados em nome de outro
// e-mail.
//
// Caminho alternativo: um OPERADOR logado no painel (JWT do Supabase Auth deste
// projeto + registro em desk_agents) pode agir em nome de qualquer e-mail — usado
// pelo Widget Preview e por testes internos.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';

const encoder = new TextEncoder();

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Comparação em tempo constante (evita timing attack no hash). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

export type IdentityResult =
  | { ok: true; email: string; via: 'hmac' | 'operator' | 'unsigned' }
  | { ok: false; status: number; error: string };

/**
 * Verifica se o Authorization header pertence a um OPERADOR (desk_agents).
 * Retorna o auth_user_id do operador ou null.
 */
export async function verifyOperator(req: Request): Promise<string | null> {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return null;

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) return null;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return null;

    const service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: agent } = await service
      .from('desk_agents')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    return agent ? user.id : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a identidade de uma chamada do widget.
 *
 * Ordem:
 *  1. Operador logado (JWT deste projeto + desk_agents) → pode impersonar
 *     qualquer e-mail (preview/testes internos).
 *  2. user_hash HMAC válido para o e-mail.
 *  3. Sem WIDGET_IDENTITY_SECRET configurado: permite APENAS se
 *     WIDGET_ALLOW_UNSIGNED=true (rollout inicial) — com warning no log.
 */
export async function resolveWidgetIdentity(
  req: Request,
  rawEmail: unknown,
  userHash: unknown,
): Promise<IdentityResult> {
  if (typeof rawEmail !== 'string' || !isValidEmail(rawEmail)) {
    return { ok: false, status: 400, error: 'E-mail inválido' };
  }
  const email = normalizeEmail(rawEmail);

  // 1. Operador logado no painel (preview/testes)
  const operatorId = await verifyOperator(req);
  if (operatorId) {
    return { ok: true, email, via: 'operator' };
  }

  // 2. HMAC
  const secret = Deno.env.get('WIDGET_IDENTITY_SECRET');
  if (secret) {
    if (typeof userHash !== 'string' || userHash.length < 32) {
      return { ok: false, status: 401, error: 'Identidade não verificada (user_hash ausente)' };
    }
    const expected = await hmacSha256Hex(secret, email);
    if (!timingSafeEqual(expected, userHash.toLowerCase())) {
      console.warn(`[widget-auth] user_hash inválido para ${email}`);
      return { ok: false, status: 401, error: 'Identidade não verificada (user_hash inválido)' };
    }
    return { ok: true, email, via: 'hmac' };
  }

  // 3. Sem secret configurado
  if ((Deno.env.get('WIDGET_ALLOW_UNSIGNED') ?? '').toLowerCase() === 'true') {
    console.warn('[widget-auth] WIDGET_IDENTITY_SECRET ausente — aceitando chamada NÃO assinada (WIDGET_ALLOW_UNSIGNED=true). Não usar em produção.');
    return { ok: true, email, via: 'unsigned' };
  }

  console.error('[widget-auth] WIDGET_IDENTITY_SECRET não configurado e WIDGET_ALLOW_UNSIGNED != true — bloqueando');
  return { ok: false, status: 500, error: 'Verificação de identidade não configurada no servidor' };
}
