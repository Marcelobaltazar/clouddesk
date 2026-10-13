// ─── Testes do rate limit em memória ──────────────────────────────────────────
// Rodar: npx deno@2.1.4 test supabase/functions/_shared/rate-limit.test.ts

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { _resetMemoryRateLimit, checkRateRules, memoryRateLimitHit, type RateRule } from './rate-limit.ts';
import type { ServiceClient } from './supabase.ts';

Deno.test('memória: permite até o teto e bloqueia o seguinte na mesma janela', () => {
  _resetMemoryRateLimit();
  const t0 = 1_000_000;
  for (let i = 1; i <= 3; i++) assertEquals(memoryRateLimitHit('k', 3, 60, t0 + i), true, `chamada ${i}`);
  assertEquals(memoryRateLimitHit('k', 3, 60, t0 + 10), false);
});

Deno.test('memória: janela vencida recomeça a contagem', () => {
  _resetMemoryRateLimit();
  const t0 = 2_000_000;
  memoryRateLimitHit('k', 1, 60, t0);
  assertEquals(memoryRateLimitHit('k', 1, 60, t0 + 1_000), false);
  assertEquals(memoryRateLimitHit('k', 1, 60, t0 + 60_000), true);
});

Deno.test('memória: chaves diferentes não se misturam', () => {
  _resetMemoryRateLimit();
  const t0 = 3_000_000;
  assertEquals(memoryRateLimitHit('a', 1, 60, t0), true);
  assertEquals(memoryRateLimitHit('b', 1, 60, t0), true);
  assertEquals(memoryRateLimitHit('a', 1, 60, t0 + 1), false);
});

Deno.test('checkRateRules: regra em memória não chama o banco; regra padrão chama', async () => {
  _resetMemoryRateLimit();
  let rpcCalls = 0;
  const fakeService = {
    rpc: () => {
      rpcCalls += 1;
      return Promise.resolve({ data: true, error: null });
    },
  } as unknown as ServiceClient;

  const reads: RateRule[] = [{ name: 'hello', max: 60, windowSeconds: 300, store: 'memory' }];
  for (let i = 0; i < 5; i++) assertEquals(await checkRateRules(fakeService, 'a@b.com', reads), null);
  assertEquals(rpcCalls, 0, 'leitura não pode gravar no banco');

  const writes: RateRule[] = [{ name: 'msg', max: 10, windowSeconds: 60 }];
  assertEquals(await checkRateRules(fakeService, 'a@b.com', writes), null);
  assertEquals(rpcCalls, 1, 'envio continua no banco');
});

Deno.test('checkRateRules: devolve a regra em memória que estourou', async () => {
  _resetMemoryRateLimit();
  const fakeService = { rpc: () => Promise.resolve({ data: true, error: null }) } as unknown as ServiceClient;
  const rule: RateRule = { name: 'camp', max: 2, windowSeconds: 300, store: 'memory' };
  assertEquals(await checkRateRules(fakeService, 'x@y.com', [rule]), null);
  assertEquals(await checkRateRules(fakeService, 'x@y.com', [rule]), null);
  assertEquals((await checkRateRules(fakeService, 'x@y.com', [rule]))?.name, 'camp');
});
