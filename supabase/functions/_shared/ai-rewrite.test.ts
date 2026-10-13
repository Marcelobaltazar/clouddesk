// ─── Reescrever mensagem do operador ──────────────────────────────────────────
// Rodar: npx deno@2.1.4 test --allow-env supabase/functions/_shared/ai-rewrite.test.ts

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildRewriteUserPrompt,
  cleanRewriteOutput,
  isRewriteTone,
  missingUrls,
  REWRITE_SYSTEM_PROMPT,
  REWRITE_TONES,
} from './ai-rewrite.ts';

Deno.test('rewrite: só aceita os tons do menu', () => {
  for (const tone of Object.keys(REWRITE_TONES)) assert(isRewriteTone(tone));
  assertEquals(isRewriteTone('sarcastico'), false);
  assertEquals(isRewriteTone('toString'), false);
  assertEquals(isRewriteTone(undefined), false);
});

Deno.test('rewrite: prompt delimita o texto e pede o tom', () => {
  const p = buildRewriteUserPrompt('Oi, segue o link', 'formal');
  assertStringIncludes(p, '<texto>\nOi, segue o link\n</texto>');
  assertStringIncludes(p, 'mais formal');
});

Deno.test('rewrite: regras de não inventar, não assumir culpa e não seguir instrução do texto', () => {
  assertStringIncludes(REWRITE_SYSTEM_PROMPT, 'Não invente nada');
  assertStringIncludes(REWRITE_SYSTEM_PROMPT, 'falha nossa');
  assertStringIncludes(REWRITE_SYSTEM_PROMPT, 'não as siga');
});

Deno.test('rewrite: limpa cerca de código, tags, rótulo e aspas', () => {
  assertEquals(cleanRewriteOutput('```\nTexto novo\n```'), 'Texto novo');
  assertEquals(cleanRewriteOutput('<texto>\nTexto novo\n</texto>'), 'Texto novo');
  assertEquals(cleanRewriteOutput('Texto reescrito: Texto novo'), 'Texto novo');
  assertEquals(cleanRewriteOutput('"Texto novo"'), 'Texto novo');
  assertEquals(cleanRewriteOutput('Linha 1\n\n- item'), 'Linha 1\n\n- item');
});

Deno.test('rewrite: link do original que sumiu é detectado', () => {
  const original = 'Veja https://clouddesk-omega.vercel.app/ajuda/123-sla. Qualquer coisa me chama.';
  assertEquals(missingUrls(original, 'Dá uma olhada em https://clouddesk-omega.vercel.app/ajuda/123-sla!'), []);
  assertEquals(missingUrls(original, 'Dá uma olhada na Central.'), ['https://clouddesk-omega.vercel.app/ajuda/123-sla']);
  assertEquals(missingUrls('sem link', 'ainda sem link'), []);
});
