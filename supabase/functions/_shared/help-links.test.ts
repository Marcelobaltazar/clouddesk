// Rodar: npx deno@2.1.4 test supabase/functions/_shared/help-links.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { HELP_CENTER_URL, hasLegacyHelpLink, legacyIntercomIds, rewriteLegacyHelpLinks } from './help-links.ts';

const published = new Set(['12292983', '12281907']);

Deno.test('help-links: domínio da Central é o da Vercel', () => {
  assertEquals(HELP_CENTER_URL, 'https://clouddesk-omega.vercel.app');
});

Deno.test('help-links: link de fonte no domínio antigo mantém o caminho do artigo', () => {
  const out = rewriteLegacyHelpLinks(
    '📚 Fonte: [Planos](https://clouddesk.apps.cloudfy.cloud/ajuda/12292983-starter-vs-advanced)',
    published,
  );
  assertEquals(out, '📚 Fonte: [Planos](https://clouddesk-omega.vercel.app/ajuda/12292983-starter-vs-advanced)');
});

Deno.test('help-links: artigo do Intercom que existe vai direto para o mesmo artigo', () => {
  const out = rewriteLegacyHelpLinks(
    'Veja: https://ajuda.cloudfy.cloud/pt-BR/articles/12281907-acessando-o-cloudfy-console.',
    published,
  );
  assertEquals(out, 'Veja: https://clouddesk-omega.vercel.app/ajuda/12281907-acessando-o-cloudfy-console.');
});

Deno.test('help-links: artigo do Intercom que não foi importado vai para a Central, não para um 404', () => {
  const out = rewriteLegacyHelpLinks('https://ajuda.cloudfy.cloud/pt-BR/articles/99999-sumiu', published);
  assertEquals(out, 'https://clouddesk-omega.vercel.app/ajuda');
});

Deno.test('help-links: raiz da Central antiga vira a raiz da nova', () => {
  const out = rewriteLegacyHelpLinks('[Central](https://ajuda.cloudfy.cloud/pt-BR/) e https://clouddesk.apps.cloudfy.cloud', published);
  assertEquals(out, '[Central](https://clouddesk-omega.vercel.app/ajuda) e https://clouddesk-omega.vercel.app/ajuda');
});

Deno.test('help-links: texto sem link antigo passa intacto', () => {
  const txt = 'Acesse https://cloudfy.space/#pricing e https://clouddesk-omega.vercel.app/ajuda/1-x';
  assertEquals(hasLegacyHelpLink(txt), false);
  assertEquals(rewriteLegacyHelpLinks(txt, published), txt);
});

Deno.test('help-links: ids do Intercom citados, sem repetir', () => {
  assertEquals(
    legacyIntercomIds('https://ajuda.cloudfy.cloud/pt-BR/articles/1-a https://ajuda.cloudfy.cloud/pt-BR/articles/1-a https://ajuda.cloudfy.cloud/articles/2-b'),
    ['1', '2'],
  );
});
