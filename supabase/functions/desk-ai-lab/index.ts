// ─── desk-ai-lab — laboratório da IA contra a base de PRODUÇÃO ─────────────────
//
// Roda o turno da IA (busca híbrida → seletor → resposta → revisor → fonte)
// com o MESMO código do pipeline, a base real e o LLM real, e devolve tudo o
// que aconteceu. Não grava nada: não cria conversa, não insere mensagem, não
// loga interação, não transfere. Serve para validar mudança de prompt/busca
// com o gabarito de perguntas reais ANTES de ela chegar ao widget.
//
// POST { message, history?: [{ role: 'user' | 'assistant', content }],
//        model?, aux_model?, plan? }
// model/aux_model trocam o modelo SÓ nesta chamada (ex.: comparar
// google/gemini-3.5-flash-lite com o atual antes de mudar o secret LLM_MODEL).
// plan ('starter' | 'advanced' | 'ultra' | 'max', padrão advanced) troca o
// plano do cliente fictício — o Starter é atendido só pela Luna.
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
  model?: string;
  aux_model?: string;
  plan?: string;
}

/** Formato de id da OpenRouter (provedor/modelo). */
const MODEL_ID_RE = /^[a-z0-9-]+\/[a-z0-9.:-]+$/;
const pickModel = (v: unknown): string | undefined =>
  typeof v === 'string' && MODEL_ID_RE.test(v) ? v : undefined;

const LAB_PLANS = ['starter', 'advanced', 'ultra', 'max'] as const;
const pickPlan = (v: unknown): typeof LAB_PLANS[number] =>
  LAB_PLANS.find((p) => p === v) ?? 'advanced';

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Cliente fictício com o perfil do caso que originou o laboratório (infra no
// ar; plano escolhido na chamada). Nenhum dado de cliente real é lido.
const demoClient = (plan: string): ContactInfoResult => ({
  customer: { name: 'Cliente Teste', email: 'teste@exemplo.com', customer_id: 'lab', referral: '' },
  subscriptions: [{
    subscription_id: 'lab', status: 'active', infra_status: 'DEPLOYED', product: `n8n-${plan}`,
    mrr: 0, interval: 'month', promocode: '', created_at: '2026-03-15T00:00:00Z',
  }],
  infras: [{
    subscription_id: 'lab', infra_id: 'lab', purchase_code: 'infrateste', default_domain: 'infrateste',
    status: 'DEPLOYED', requests_24h: 0, requests_7d: 0, requests_30d: 0,
  }],
  billing: null,
});

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
    const models = { main: pickModel(body.model), aux: pickModel(body.aux_model) ?? pickModel(body.model) };
    const { retrieval, knowledge } = await P.consultKnowledge(newServiceClient(), apiKey, message, turns, onUsage, models);
    const t1 = Date.now();

    const plan = pickPlan(body.plan);
    const client = demoClient(plan);
    const systemPrompt = P.buildSystemPrompt(knowledge, client.customer?.name, client, turns.length === 0, '') +
      `\n${P.META_INSTRUCTION()}`;
    const out = await P.writeAuditedReply(apiKey, systemPrompt, [...turns, { role: 'user', content: message }], {
      message, question: knowledge.question ?? message,
      evidence: P.buildAuditEvidence(knowledge, client, ''),
    }, onUsage, models);
    const t2 = Date.now();

    // Mesma pós-produção do pipeline para o texto que o cliente veria.
    let reply = out.rawReply.replace(/\[OPCOES:[^\]]*\]|\[OFERECER_CREDENCIAIS\s*\]|\[ILUSTRAR\s*\]/gi, '');
    const sources = P.resolveSourceMarkers(reply, knowledge.articles);
    // Marcador que sobrou (ex.: [FONTE:SNIPPET]) sai, como no pipeline.
    reply = sources.text.replace(/\[\s*(?:FONTE\s*:[^\]]*|TRANSFERIR)\s*\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
    if (sources.cited === 0) reply = P.ensureSourceLink(reply, knowledge);
    reply = await P.modernizeHelpLinks(newServiceClient(), reply);
    // Starter que tentou transferir: o cliente veria o texto de reserva.
    if (P.isStarterOnlyClient(client) && out.rawReply.includes('[TRANSFERIR]')) reply = P.starterFallbackReply();

    return json({
      model: out.llm.model,
      aux_model: models.aux ?? null,
      plan,
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
