// ─── Client Supabase para Edge Functions (Deno) ────────────────────────────────
// Não há typegen do schema no runtime Deno — o tipo do banco é permissivo e a
// validação real é feita pelo Postgres (constraints/RLS). Centraliza a criação
// para todos os módulos usarem o MESMO tipo de client (evita conflitos de
// generics entre resoluções do esm.sh).

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';

// deno-lint-ignore no-explicit-any
type AnyDb = any;

export type ServiceClient = SupabaseClient<AnyDb, 'public', AnyDb>;

export function newClient(
  url: string,
  key: string,
  opts?: Parameters<typeof createClient>[2],
): ServiceClient {
  return createClient<AnyDb>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(opts ?? {}),
  }) as unknown as ServiceClient;
}

/** Client service-role do PRÓPRIO projeto CloudDesk (bypassa RLS). */
export function newServiceClient(): ServiceClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return newClient(url, key);
}
