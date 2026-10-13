// ─── Testes do diagnóstico de servidor e dos avisos de incidente ──────────────
// Rodar: npx deno@2.1.4 test --allow-env supabase/functions/_shared/server-health.test.ts

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  checkServer,
  isValidPortainerUrl,
  isValidServerName,
  portainerResponds,
  sendServerRestart,
} from './server-health.ts';
import { incidentDetectedReply, incidentRecoveredReply, incidentUnresolvedReply } from './server-incidents.ts';

const DOWN = 'https://portainer661.cloudfy.live';
const CONTROL = 'https://portainer866.cloudfy.live';
const noSleep = () => Promise.resolve();

/** Fetch falso: URLs em `up` respondem 200; o resto falha como timeout. */
function fakeFetch(up: string[], calls: string[] = []) {
  return (input: string) => {
    calls.push(input);
    return up.some((u) => input.startsWith(u))
      ? Promise.resolve(new Response('{"Version":"2"}', { status: 200 }))
      : Promise.reject(new Error('timeout'));
  };
}

Deno.test('servidor: só formatos conhecidos viram requisição', () => {
  assert(isValidPortainerUrl('https://portainer661.cloudfy.live'));
  assert(isValidPortainerUrl('https://portainer661.cloudfy.live/'));
  assertEquals(isValidPortainerUrl('https://evil.com'), false);
  assertEquals(isValidPortainerUrl('http://portainer661.cloudfy.live'), false);
  assert(isValidServerName('server-portainer-live-661'));
  assertEquals(isValidServerName('server-portainer-live-661; drop'), false);
});

Deno.test('servidor: caiu = todas as tentativas falham E o controle responde', async () => {
  const calls: string[] = [];
  const v = await checkServer(DOWN, [CONTROL], { fetcher: fakeFetch([CONTROL], calls), sleep: noSleep });
  assertEquals(v.attempts, [false, false, false]);
  assertEquals(v.serverDown, true);
  assertEquals(v.controlOk, true);
  assertEquals(calls.filter((c) => c.startsWith(DOWN)).length, 3);
  assert(calls.every((c) => c.endsWith('/api/status')));
});

Deno.test('servidor: uma resposta basta para estar no ar (para de tentar)', async () => {
  let n = 0;
  const flaky = (input: string) => {
    if (input.startsWith(DOWN) && n++ === 0) return Promise.reject(new Error('timeout'));
    return Promise.resolve(new Response('ok', { status: 200 }));
  };
  const v = await checkServer(DOWN, [CONTROL], { fetcher: flaky, sleep: noSleep });
  assertEquals(v.attempts, [false, true]);
  assertEquals(v.serverDown, false);
});

Deno.test('servidor: controle também fora = não dá para concluir (nada de incidente)', async () => {
  const v = await checkServer(DOWN, [CONTROL], { fetcher: fakeFetch([]), sleep: noSleep });
  assertEquals(v.serverDown, true);
  assertEquals(v.controlOk, false);
});

Deno.test('servidor: URL fora do padrão nem é testada', async () => {
  const calls: string[] = [];
  assertEquals(await portainerResponds('https://evil.com', 1000, fakeFetch(['https://evil.com'], calls)), false);
  assertEquals(calls.length, 0);
});

Deno.test('reinício: sem o secret do formulário, nada é enviado', async () => {
  Deno.env.delete('SERVER_RESTART_FORM_URL');
  const calls: string[] = [];
  const r = await sendServerRestart('server-portainer-live-661', fakeFetch(['https://'], calls));
  assertEquals(r.ok, false);
  assertEquals(calls.length, 0);
});

Deno.test('reinício: envia o nome do servidor no campo field-0', async () => {
  Deno.env.set('SERVER_RESTART_FORM_URL', 'https://forms.example/form/abc');
  let body: FormData | null = null;
  const r = await sendServerRestart('server-portainer-live-661', (_url, init) => {
    body = init?.body as FormData;
    return Promise.resolve(new Response('ok', { status: 200 }));
  });
  Deno.env.delete('SERVER_RESTART_FORM_URL');
  assertEquals(r.ok, true);
  assertEquals((body as unknown as FormData).get('field-0'), 'server-portainer-live-661');
});

Deno.test('reinício: nome fora do padrão é recusado', async () => {
  Deno.env.set('SERVER_RESTART_FORM_URL', 'https://forms.example/form/abc');
  const r = await sendServerRestart('qualquer-coisa', () => Promise.resolve(new Response('ok')));
  Deno.env.delete('SERVER_RESTART_FORM_URL');
  assertEquals(r.ok, false);
});

Deno.test('avisos: nada de servidor, provedor, Portainer ou culpa', () => {
  const label = 'sua infraestrutura **minhainfra**';
  const texts = [
    incidentDetectedReply(label),
    incidentRecoveredReply(label),
    incidentUnresolvedReply('em até 12 horas'),
  ];
  for (const t of texts) {
    assertEquals(/portainer|hetzner|servidor|server-|nosso lado|falha nossa|erro nosso/i.test(t), false, t);
  }
  assertStringIncludes(texts[0], '20 a 30 minutos');
  assertStringIncludes(texts[2], 'em até 12 horas');
});
