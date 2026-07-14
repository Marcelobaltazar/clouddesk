// ─── Rate limiting persistente (janela fixa, via Postgres) ─────────────────────
// Backend: função SQL desk_rate_limit_hit (migration 20260714000000). Chamada
// sempre com service role. Fail-open: se o RPC falhar (rede/limite), a chamada
// é permitida e o erro logado — a requisição inteira já falharia se o banco
// estivesse fora.

import type { ServiceClient } from './supabase.ts';

export interface RateRule {
  /** sufixo da chave, ex: 'msg' → chave final 'wapi:msg:{email}' */
  name: string;
  max: number;
  windowSeconds: number;
}

/** true = permitido; false = limite estourado. */
export async function rateLimitHit(
  service: ServiceClient,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await service.rpc('desk_rate_limit_hit', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.warn(`[rate-limit] RPC falhou para ${key}: ${error.message} — permitindo (fail-open)`);
      return true;
    }
    return data === true;
  } catch (e) {
    console.warn(`[rate-limit] erro para ${key}:`, e instanceof Error ? e.message : e, '— permitindo (fail-open)');
    return true;
  }
}

/** Aplica várias regras; retorna a primeira que estourou (ou null se tudo ok). */
export async function checkRateRules(
  service: ServiceClient,
  subject: string,
  rules: RateRule[],
): Promise<RateRule | null> {
  for (const rule of rules) {
    const allowed = await rateLimitHit(
      service,
      `wapi:${rule.name}:${subject}:${rule.windowSeconds}`,
      rule.max,
      rule.windowSeconds,
    );
    if (!allowed) return rule;
  }
  return null;
}
