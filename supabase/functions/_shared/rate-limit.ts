// ─── Rate limiting (janela fixa) ───────────────────────────────────────────────
// Dois backends:
//   • Postgres (padrão) — função SQL desk_rate_limit_hit (migration
//     20260714000000). Exato entre instâncias. Chamada sempre com service role.
//     Fail-open: se o RPC falhar (rede/limite), a chamada é permitida e o erro
//     logado — a requisição inteira já falharia se o banco estivesse fora.
//   • Memória ('memory') — contador por instância da Edge Function, sem tocar no
//     banco. Para as LEITURAS do widget: elas rodam a cada página aberta no app
//     do cliente e respondiam por ~85% das gravações do rate limit, o que ajudou
//     a esgotar o Disk IO Budget do projeto (13/10/2026). Leitura já exige
//     identidade verificada; o teto aqui só segura abuso, e cada instância
//     contar sozinha deixa o limite real um pouco mais folgado — aceitável.
// Envio de mensagem (custa LLM), CSAT e reenvio de credenciais ficam no banco.

import type { ServiceClient } from './supabase.ts';

export interface RateRule {
  /** sufixo da chave, ex: 'msg' → chave final 'wapi:msg:{email}' */
  name: string;
  max: number;
  windowSeconds: number;
  /** 'memory' = contador na instância, sem gravar no banco. Padrão: banco. */
  store?: 'memory';
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

interface MemoryWindow {
  start: number;
  windowMs: number;
  count: number;
}

const memoryWindows = new Map<string, MemoryWindow>();

/** Teto de chaves na instância. Passou disso, as janelas vencidas saem; se
 *  ainda assim estiver cheio (ataque com muitos e-mails), zera — o banco não é
 *  afetado e o pior caso é um limite mais folgado por alguns minutos. */
const MAX_MEMORY_KEYS = 20_000;

function pruneMemoryWindows(now: number): void {
  for (const [key, w] of memoryWindows) {
    if (now - w.start >= w.windowMs) memoryWindows.delete(key);
  }
  if (memoryWindows.size >= MAX_MEMORY_KEYS) memoryWindows.clear();
}

/** Mesma janela fixa da função SQL, em memória. true = permitido. */
export function memoryRateLimitHit(key: string, max: number, windowSeconds: number, now = Date.now()): boolean {
  const windowMs = windowSeconds * 1000;
  const current = memoryWindows.get(key);
  if (current && now - current.start < windowMs) {
    current.count += 1;
    return current.count <= max;
  }
  if (!current && memoryWindows.size >= MAX_MEMORY_KEYS) pruneMemoryWindows(now);
  memoryWindows.set(key, { start: now, windowMs, count: 1 });
  return 1 <= max;
}

/** Só para testes. */
export function _resetMemoryRateLimit(): void {
  memoryWindows.clear();
}

/** Aplica várias regras; retorna a primeira que estourou (ou null se tudo ok). */
export async function checkRateRules(
  service: ServiceClient,
  subject: string,
  rules: RateRule[],
): Promise<RateRule | null> {
  for (const rule of rules) {
    const key = `wapi:${rule.name}:${subject}:${rule.windowSeconds}`;
    const allowed = rule.store === 'memory'
      ? memoryRateLimitHit(key, rule.max, rule.windowSeconds)
      : await rateLimitHit(service, key, rule.max, rule.windowSeconds);
    if (!allowed) return rule;
  }
  return null;
}
