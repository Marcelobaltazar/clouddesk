// ─── Testes da busca da IA (fatiamento, fusão, seletor, revisor) ───────────────
// Rodar: npx deno@2.1.4 test supabase/functions/_shared/ai-retrieval.test.ts
//
// A qualidade da busca em si é medida contra a base real num laboratório à
// parte (ver o PR). Aqui ficam os contratos: o que entra e sai de cada peça, e
// o comportamento quando o LLM falha ou devolve lixo.

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { chunkArticle, chunkSnippet, cleanArticleText } from './kb-chunker.ts';
import {
  fuseHits,
  initialQueries,
  parseSelectorVerdict,
  retrieveKnowledge,
  type RetrievalDeps,
  type SearchHit,
} from './ai-retrieval.ts';
import { buildCorrectionInstruction, parseAuditVerdict } from './ai-verify.ts';

// ── kb-chunker ────────────────────────────────────────────────────────────────

Deno.test('chunker: tira imagem, URL de link, separador e escape do Intercom', () => {
  const out = cleanArticleText('Veja ![print](https://x.com/a.png) e [o painel](https://cloudfy.space)\n\n* * *\n\n1\\. Passo **um**​');
  assertEquals(out.includes('https://x.com'), false);
  assertEquals(out.includes('https://cloudfy.space'), false);
  assertStringIncludes(out, 'o painel');
  assertStringIncludes(out, '1. Passo um');
  assertEquals(out.includes('* * *'), false);
});

Deno.test('chunker: título repetido na 1ª linha (artigo colado) não duplica', () => {
  const chunks = chunkArticle('Como eu revogo o acesso do MCP?', 'Como eu revogo o acesso do MCP?\nDepende de onde você conectou.');
  assertEquals(chunks[0].content, 'Depende de onde você conectou.');
  assertEquals(chunks[0].embedText, 'Como eu revogo o acesso do MCP?\nDepende de onde você conectou.');
});

Deno.test('chunker: artigo longo vira vários trechos ≤ ~900 chars, todos com o título na frente', () => {
  const secao = (n: number) => `## Seção ${n}\n\n${'Texto explicativo sobre o plano. '.repeat(20)}`;
  const chunks = chunkArticle('Planos da Cloudfy', [1, 2, 3, 4].map(secao).join('\n\n'));
  const body = chunks.filter((c) => c.content !== 'Planos da Cloudfy');
  assert(body.length >= 3, `esperava ≥ 3 trechos, veio ${body.length}`);
  for (const c of body) {
    assert(c.content.length <= 1000, `trecho com ${c.content.length} chars`);
    assert(c.embedText.startsWith('Planos da Cloudfy\n'));
  }
  // a seção é o título Markdown em que o trecho começa
  assertEquals(body[0].heading, 'Seção 1');
});

Deno.test('chunker: seção de uma linha junta com a próxima (vetor fraco isolado)', () => {
  const chunks = chunkArticle('Guia', '## A\n\nCurta.\n\n## B\n\nOutra curta.');
  const body = chunks.filter((c) => c.content !== 'Guia');
  assertEquals(body.length, 1);
  assertStringIncludes(body[0].content, 'Curta.');
  assertStringIncludes(body[0].content, 'Outra curta.');
});

Deno.test('chunker: artigo ganha um trecho extra só com o título', () => {
  const chunks = chunkArticle('Preciso pagar o Claude para usar o MCP?', 'Não. O MCP da Cloudfy não tem custo adicional.');
  const last = chunks[chunks.length - 1];
  assertEquals(last.content, 'Preciso pagar o Claude para usar o MCP?');
  assertEquals(last.embedText, 'Preciso pagar o Claude para usar o MCP?');
  assertEquals(chunks.map((c) => c.index), chunks.map((_, i) => i));
});

Deno.test('chunker: snippet é um trecho só, com o título', () => {
  const chunks = chunkSnippet('MCP - CLOUDFY', 'Todos os clientes tem acesso e podem utilizar MCP da Cloudfy.');
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].embedText, 'MCP - CLOUDFY\nTodos os clientes tem acesso e podem utilizar MCP da Cloudfy.');
});

// ── fusão (RRF) ───────────────────────────────────────────────────────────────

function hit(docId: string, chunk: string, vec: number | null, txt: number | null, docType: 'article' | 'snippet' = 'article'): SearchHit {
  return {
    chunk_id: chunk, doc_type: docType, doc_id: docId, chunk_index: 0, title: `Doc ${docId}`, heading: null,
    content: `conteúdo ${chunk}`, vec_rank: vec, vec_similarity: vec ? 0.9 : null, text_rank: txt, text_score: txt ? 5 : null,
  };
}

Deno.test('fusão: trecho bem colocado nos DOIS rankings ganha de quem é 1º em um só', () => {
  const ranked = fuseHits([[hit('A', 'a1', 1, null), hit('B', 'b1', 2, 2)]]);
  assertEquals(ranked[0].doc_id, 'B');
});

Deno.test('fusão: documento vale o melhor trecho, e soma entre consultas', () => {
  const q1 = [hit('A', 'a1', 1, 1), hit('B', 'b1', 3, null)];
  const q2 = [hit('B', 'b1', 1, 1)];
  const ranked = fuseHits([q1, q2]);
  assertEquals(ranked[0].doc_id, 'B');
  assertEquals(ranked[0].chunks.length, 1);
});

Deno.test('fusão: snippet e artigo com o mesmo id não se misturam', () => {
  const ranked = fuseHits([[hit('X', 'c1', 1, null, 'article'), hit('X', 'c2', 2, null, 'snippet')]]);
  assertEquals(ranked.length, 2);
});

Deno.test('consultas: continuação curta leva a fala anterior do cliente junto', () => {
  const qs = initialQueries('e no advanced?', [
    { role: 'user', content: 'O MCP está incluso?' },
    { role: 'assistant', content: 'Sim…' },
  ]);
  assertEquals(qs.length, 2);
  assertEquals(qs[0], 'e no advanced?');
  assertStringIncludes(qs[1], 'O MCP está incluso?');
});

Deno.test('consultas: início de conversa = só a mensagem', () => {
  assertEquals(initialQueries('oi', []), ['oi']);
});

// ── seletor ───────────────────────────────────────────────────────────────────

Deno.test('seletor: lê JSON dentro de cerca de código e ignora número fora da lista', () => {
  const v = parseSelectorVerdict('```json\n{"pergunta":"O MCP está incluso no plano Advanced?","precisa_base":true,"relevantes":[2, 9, 2, "1"],"cobertura":"total","nova_busca":[]}\n```', 3);
  assert(v);
  assertEquals(v.relevant, [2, 1]);
  assertEquals(v.coverage, 'total');
  assertEquals(v.question, 'O MCP está incluso no plano Advanced?');
});

Deno.test('seletor: sem relevante não existe cobertura, diga o modelo o que disser', () => {
  const v = parseSelectorVerdict('{"pergunta":"x","relevantes":[],"cobertura":"total"}', 5);
  assertEquals(v?.coverage, 'nenhuma');
});

Deno.test('seletor: lixo → null (o pipeline cai no ranking puro)', () => {
  assertEquals(parseSelectorVerdict('não sei', 5), null);
  assertEquals(parseSelectorVerdict('{"pergunta": ', 5), null);
});

// ── orquestração ──────────────────────────────────────────────────────────────

function fakeDeps(index: Record<string, SearchHit[]>, selectorReplies: string[]): RetrievalDeps & { selectCalls: string[]; searched: string[] } {
  const selectCalls: string[] = [];
  const searched: string[] = [];
  return {
    selectCalls,
    searched,
    embed: () => Promise.resolve([0.1, 0.2]),
    search: (q) => {
      searched.push(q);
      return Promise.resolve(index[q] ?? []);
    },
    select: (_system, user) => {
      selectCalls.push(user);
      const next = selectorReplies.shift();
      return next === undefined ? Promise.reject(new Error('sem resposta')) : Promise.resolve(next);
    },
  };
}

Deno.test('orquestração: seletor aprova o documento certo mesmo fora do topo do ranking', async () => {
  const deps = fakeDeps(
    { 'o mcp esta incluso no advanced?': [hit('revogar', 'r1', 1, 1), hit('preco', 'p1', 2, 3)] },
    ['{"pergunta":"O MCP está incluso no plano Advanced?","precisa_base":true,"relevantes":[2],"cobertura":"total","nova_busca":[]}'],
  );
  const r = await retrieveKnowledge(deps, 'o mcp esta incluso no advanced?', []);
  assertEquals(r.docs.map((d) => d.doc_id), ['preco']);
  assertEquals(r.coverage, 'total');
  assertEquals(r.rounds, 1);
});

Deno.test('orquestração: sem cobertura → busca recursiva com as consultas do seletor', async () => {
  const deps = fakeDeps(
    {
      'como entro em contato?': [hit('conta', 'c1', 1, 1)],
      'canais de suporte da Cloudfy': [hit('sla', 's1', 1, 1)],
    },
    [
      '{"pergunta":"Como falar com o suporte da Cloudfy?","precisa_base":true,"relevantes":[],"cobertura":"nenhuma","nova_busca":["canais de suporte da Cloudfy"]}',
      '{"pergunta":"Como falar com o suporte da Cloudfy?","precisa_base":true,"relevantes":[1],"cobertura":"total","nova_busca":[]}',
    ],
  );
  const r = await retrieveKnowledge(deps, 'como entro em contato?', []);
  assertEquals(r.rounds, 2);
  assertEquals(r.docs.map((d) => d.doc_id), ['sla']);
  assert(deps.searched.includes('canais de suporte da Cloudfy'));
  // a pergunta reescrita também vira consulta
  assert(deps.searched.includes('Como falar com o suporte da Cloudfy?'));
});

Deno.test('orquestração: no máximo 2 rodadas, mesmo que o seletor peça mais', async () => {
  const nada = '{"pergunta":"x","relevantes":[],"cobertura":"nenhuma","nova_busca":["outra coisa"]}';
  const deps = fakeDeps({}, [nada, nada, nada]);
  const r = await retrieveKnowledge(deps, 'pergunta sem resposta', []);
  assertEquals(r.rounds, 2);
  assertEquals(deps.selectCalls.length, 2);
  assertEquals(r.coverage, 'nenhuma');
  assertEquals(r.docs, []);
});

Deno.test('orquestração: saudação não carrega documento nenhum', async () => {
  const deps = fakeDeps(
    { 'obrigado!': [hit('a', 'a1', 1, null)] },
    ['{"pergunta":"agradecimento","precisa_base":false,"relevantes":[1],"cobertura":"total","nova_busca":[]}'],
  );
  const r = await retrieveKnowledge(deps, 'obrigado!', []);
  assertEquals(r.needsKnowledge, false);
  assertEquals(r.docs, []);
});

Deno.test('orquestração: seletor fora do ar → top 4 do ranking, cobertura desconhecida', async () => {
  const hits = ['a', 'b', 'c', 'd', 'e'].map((id, i) => hit(id, `${id}1`, i + 1, null));
  const deps = fakeDeps({ 'pergunta': hits }, []);
  const r = await retrieveKnowledge(deps, 'pergunta', []);
  assertEquals(r.coverage, 'desconhecida');
  assertEquals(r.docs.map((d) => d.doc_id), ['a', 'b', 'c', 'd']);
});

Deno.test('orquestração: embedding falhou → segue só com BM25', async () => {
  const deps = fakeDeps({ 'mcp': [hit('m', 'm1', null, 1)] }, []);
  deps.embed = () => Promise.reject(new Error('modelo indisponível'));
  let received: number[] | null | undefined;
  const search = deps.search;
  deps.search = (q, e) => { received = e; return search(q, e); };
  const r = await retrieveKnowledge(deps, 'mcp', []);
  assertEquals(received, null);
  assertEquals(r.docs.map((d) => d.doc_id), ['m']);
});

// ── revisor ───────────────────────────────────────────────────────────────────

Deno.test('revisor: aprovada', () => {
  assertEquals(parseAuditVerdict('{"aprovada": true, "problemas": []}'), { approved: true, problems: [] });
});

Deno.test('revisor: reprovada com apontamentos', () => {
  const v = parseAuditVerdict('```json\n{"aprovada": false, "problemas": ["\\"foi descontinuado\\" — nenhuma fonte diz isso"]}\n```');
  assertEquals(v?.approved, false);
  assertEquals(v?.problems.length, 1);
});

Deno.test('revisor: reprovada sem dizer o quê não dá para corrigir → conta como aprovada', () => {
  assertEquals(parseAuditVerdict('{"aprovada": false, "problemas": []}')?.approved, true);
});

Deno.test('revisor: lixo → null (resposta segue sem revisão)', () => {
  assertEquals(parseAuditVerdict('ok'), null);
  assertEquals(parseAuditVerdict('{"problemas": []}'), null);
});

Deno.test('revisor: instrução de correção leva os apontamentos e a resposta reprovada', () => {
  const txt = buildCorrectionInstruction('O MCP foi descontinuado.', ['"foi descontinuado" — sem fonte']);
  assertStringIncludes(txt, 'foi descontinuado');
  assertStringIncludes(txt, 'REPROVADA');
  assertStringIncludes(txt, '[META: ...]');
});
