/**
 * ai-lab-compare.ts
 *
 * Compara modelos da IA ANTES de mudar o secret LLM_MODEL. Roda perguntas
 * reais de clientes (anonimizadas) pelo desk-ai-lab — mesma busca, mesmo
 * prompt e mesmo revisor do atendimento, sem gravar nada e sem tocar em
 * conversa de cliente — uma vez para cada modelo, e mostra lado a lado:
 * tempo, se transferiu, documentos usados e a resposta.
 *
 * O desk-ai-lab precisa estar publicado com o código que você quer testar:
 *   npx supabase functions deploy desk-ai-lab --project-ref tgjvjgvbqckoqjtgbjqx
 * (publicar o laboratório NÃO muda a IA do widget — cada função leva a sua
 * própria cópia do código.)
 *
 * Uso:
 *   npx tsx scripts/ai-lab-compare.ts                       (atual × 3.5 Flash Lite)
 *   npx tsx scripts/ai-lab-compare.ts google/gemini-3.8-flash
 *   npx tsx scripts/ai-lab-compare.ts --plan=starter         (só o modelo atual,
 *     cliente Starter, perguntas que testam o atendimento sem equipe humana)
 *
 * Variáveis (.env ou shell): VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
 */

import 'dotenv/config';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error('\n❌  Defina VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const PLAN = args.find((a) => a.startsWith('--plan='))?.slice('--plan='.length);
const positional = args.filter((a) => !a.startsWith('--'));
// Com --plan e sem modelo informado, roda só o modelo atual.
const CANDIDATE = positional[0] ?? (PLAN ? undefined : 'google/gemini-3.5-flash-lite');
const BASELINE = positional[1]; // vazio = o modelo do secret LLM_MODEL

/** Perguntas reais de set–out/2026, sem nome, e-mail ou infra de cliente. */
const QUESTIONS = [
  'Olá',
  'posso fazer upgrade do meu plano advanced pro ultra?',
  'Boa noite. Minha infra está caindo muito. n8n dando timeout ao receber mensagem pela evolution e quando acesso o n8n dá erro 404. O que está acontecendo?',
  'a mensagem sai da evolution mas não chega no whatsapp',
  'Contratei a IA ilimitada, mas o n8n parou com o erro de limite de orçamento da chave de API',
  'onde eu acho as credenciais do meu n8n?',
  'quero cancelar meu número virtual',
  'como faço para cancelar meu plano?',
  'Preciso liberar uma auditoria somente leitura do meu n8n. A consulta GET /api/v1/workflows retorna HTTP 403 com e sem a chave. O que pode ser?',
  'como atualizo a versão do meu n8n?',
  'o MCP da Cloudfy está incluso no meu plano?',
  'quero falar com um atendente',
];

/** Starter: atendimento só com a Luna — nunca oferecer equipe, sempre um caminho
 *  (MCP, Central). Inclui o caso real de 13/10 (pediu logs, ouviu "não consigo
 *  encaminhar"). */
const STARTER_QUESTIONS = [
  'quero falar com um atendente',
  'tem como alguém da equipe olhar meu fluxo?',
  'a Evolution não chama meu webhook do n8n. Já conferi a URL de produção e a instância está conectada',
  'podem conferir nos logs da minha infra se chegaram requisições POST no meu webhook ontem à tarde?',
  'meu fluxo do n8n parou de funcionar do nada, o que eu faço?',
  'como faço pra criar um fluxo que responde no WhatsApp com IA?',
  'o MCP da Cloudfy está incluso no meu plano?',
  // Exceção: só a equipe executa — aqui a Luna DEVE transferir.
  'alterei a senha do n8n e agora não consigo mais entrar',
];

interface LabResult {
  model?: string;
  reply?: string;
  handoff?: boolean;
  selected?: string[];
  audit?: { approved: boolean | null; rewritten: boolean } | null;
  ms_retrieval?: number;
  ms_answer?: number;
  error?: string;
}

async function ask(message: string, model?: string): Promise<LabResult & { ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/desk-ai-lab`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ message, ...(model ? { model } : {}), ...(PLAN ? { plan: PLAN } : {}) }),
  }).catch((e) => ({ ok: false, json: async () => ({ error: String(e) }) }) as unknown as Response);
  const data = (await res.json().catch(() => ({ error: 'resposta inválida' }))) as LabResult;
  return { ...data, ms: Date.now() - t0 };
}

const s = (ms?: number) => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}s`);

async function main() {
  const totals: Record<string, number[]> = {};
  const questions = PLAN === 'starter' ? STARTER_QUESTIONS : QUESTIONS;
  const models = CANDIDATE ? [BASELINE, CANDIDATE] : [BASELINE];
  if (PLAN) console.log(`\n👤 Cliente fictício no plano: ${PLAN}`);
  for (const q of questions) {
    console.log(`\n${'═'.repeat(90)}\n❓ ${q}`);
    for (const model of models) {
      const r = await ask(q, model);
      const label = r.model ?? model ?? 'atual';
      (totals[label] ??= []).push(r.ms);
      if (r.error) {
        console.log(`\n── ${label}: ❌ ${r.error}`);
        continue;
      }
      console.log(
        `\n── ${label} · total ${s(r.ms)} (busca ${s(r.ms_retrieval)}, resposta ${s(r.ms_answer)})` +
        ` · transferiu=${r.handoff ? 'sim' : 'não'} · revisor=${r.audit?.approved ?? '—'}${r.audit?.rewritten ? ' (reescrita)' : ''}`,
      );
      console.log(`   docs: ${(r.selected ?? []).join(' | ') || '(nenhum)'}`);
      console.log(`   ${String(r.reply ?? '').replace(/\n/g, '\n   ')}`);
    }
  }
  console.log(`\n${'═'.repeat(90)}\n⏱  Tempo total por pergunta (mediana / pior):`);
  for (const [label, arr] of Object.entries(totals)) {
    const sorted = [...arr].sort((a, b) => a - b);
    console.log(`   ${label.padEnd(36)} ${s(sorted[Math.floor(sorted.length / 2)])} / ${s(sorted[sorted.length - 1])}`);
  }
}

main().catch((err) => {
  console.error('\n❌  Erro inesperado:', err);
  process.exit(1);
});
