// ─── desk-ai-lab — laboratório da IA contra a base de PRODUÇÃO ─────────────────
//
// Roda o turno da IA (busca híbrida → seletor → resposta → revisor → fonte)
// com o MESMO código do pipeline, a base real e o LLM real, e devolve tudo o
// que aconteceu. Não grava nada: não cria conversa, não insere mensagem, não
// loga interação, não transfere. Serve para validar mudança de prompt/busca
// com o gabarito de perguntas reais ANTES de ela chegar ao widget.
//
// POST { message, history?: [{ role: 'user' | 'assistant', content }] }
// Auth: operador logado ou chave de serviço.
//
// Deploy manual (fora do deploy.ps1 de propósito — não é caminho de cliente):
//   npx supabase functions deploy desk-ai-lab --project-ref tgjvjgvbqckoqjtgbjqx

import { corsHeaders } from '../_shared/cors.ts';
import { newServiceClient } from '../_shared/supabase.ts';
import { isServiceRoleRequest, verifyOperator } from '../_shared/widget-auth.ts';
import { _test as P, sanitizeContactText } from '../_shared/ai-pipeline.ts';
import type { ContactInfoResult } from '../_shared/contact-info.ts';

interface LabRequest {
  message?: string;
  history?: Array<{ role?: string; content?: string }>;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Cliente fictício com o perfil do caso que originou o laboratório (Advanced,
// infra no ar). Nenhum dado de cliente real é lido.
const DEMO_CLIENT: ContactInfoResult = {
  customer: { name: 'Cliente Teste', email: 'teste@exemplo.com', customer_id: 'lab', referral: '' },
  subscriptions: [{
    subscription_id: 'lab', status: 'active', infra_status: 'DEPLOYED', product: 'n8n-advanced',
    mrr: 0, interval: 'month', promocode: '', created_at: '2026-03-15T00:00:00Z',
  }],
  infras: [{
    subscription_id: 'lab', infra_id: 'lab', purchase_code: 'infrateste', default_domain: 'infrateste',
    status: 'DEPLOYED', requests_24h: 0, requests_7d: 0, requests_30d: 0,
  }],
  billing: null,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!(await verifyOperator(req)) && !(await isServiceRoleRequest(req))) {
      return json({ error: 'Apenas operadores autenticados' }, 401);
    }

    const body: LabRequest = await req.json().catch(() => ({}));
    const message = sanitizeContactText(body.message ?? '');
    if (!message) return json({ error: 'Missing field: message' }, 400);

    const turns = (body.history ?? [])
      .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
      .slice(-10)
      .map((t) => ({
        role: t.role as 'user' | 'assistant',
        content: t.role === 'user' ? sanitizeContactText(t.content!) : t.content!.slice(0, 6000),
      }));

    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY secret');

    let tokens = 0;
    const onUsage = (u: { total_tokens?: number } | null) => { tokens += u?.total_tokens ?? 0; };

    const t0 = Date.now();
    const { retrieval, knowledge } = await P.consultKnowledge(newServiceClient(), apiKey, message, turns, onUsage);
    const t1 = Date.now();

    const systemPrompt = P.buildSystemPrompt(knowledge, DEMO_CLIENT.customer?.name, DEMO_CLIENT, turns.length === 0, '') +
      `\n${P.META_INSTRUCTION()}`;
    const out = await P.writeAuditedReply(apiKey, systemPrompt, [...turns, { role: 'user', content: message }], {
      message, question: knowledge.question ?? message,
      evidence: P.buildAuditEvidence(knowledge, DEMO_CLIENT, ''),
    }, onUsage);
    const t2 = Date.now();

    // Mesma pós-produção do pipeline para o texto que o cliente veria.
    let reply = out.rawReply.replace(/\[OPCOES:[^\]]*\]|\[OFERECER_CREDENCIAIS\s*\]|\[ILUSTRAR\s*\]/gi, '');
    const sources = P.resolveSourceMarkers(reply, knowledge.articles);
    // Marcador que sobrou (ex.: [FONTE:SNIPPET]) sai, como no pipeline.
    reply = sources.text.replace(/\[\s*(?:FONTE\s*:[^\]]*|TRANSFERIR)\s*\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
    if (sources.cited === 0) reply = P.ensureSourceLink(reply, knowledge);
    reply = await P.modernizeHelpLinks(newServiceClient(), reply);

    return json({
      reply,
      handoff: out.rawReply.includes('[TRANSFERIR]'),
      question: retrieval?.question ?? null,
      coverage: knowledge.coverage,
      rounds: retrieval?.rounds ?? 0,
      queries: retrieval?.queries ?? [],
      selected: [
        ...knowledge.snippets.map((s) => `snippet: ${s.title}`),
        ...knowledge.articles.map((a) => `artigo: ${a.title}`),
      ],
      candidates: (retrieval?.candidates ?? []).map((d) => `${d.doc_type}: ${d.title}`),
      audit: out.audit,
      ms_retrieval: t1 - t0,
      ms_answer: t2 - t1,
      tokens,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[desk-ai-lab] Error:', msg);
    return json({ error: msg }, 500);
  }
});
