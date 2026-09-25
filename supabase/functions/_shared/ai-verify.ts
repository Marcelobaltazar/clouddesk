// ─── Auditoria da resposta antes de ela chegar ao cliente ──────────────────────
//
// Mesmo com o contexto certo, um modelo às vezes "completa" o que a fonte não
// diz — foi assim que o MCP virou "produto descontinuado". A defesa é uma
// segunda leitura, com outro papel: um revisor que recebe SÓ as fontes, os
// dados do cliente e a resposta, e aponta cada afirmação sobre a Cloudfy que
// não está escrita ali (técnica conhecida como chain-of-verification /
// self-check). Reprovada, a resposta é reescrita uma vez com os apontamentos.
//
// Módulo PURO: quem chama o LLM é o pipeline.

export interface AuditVerdict {
  approved: boolean;
  /** Afirmações sem apoio nas fontes, com o motivo. Vazio quando aprovada. */
  problems: string[];
}

export const AUDIT_SYSTEM_PROMPT = `Você é o revisor de qualidade do suporte da Cloudfy. Uma IA escreveu uma resposta para um cliente; antes de ela ser enviada, você confere se cada afirmação sobre a Cloudfy está sustentada pelas FONTES e pelos DADOS DO CLIENTE que a IA recebeu. Você não reescreve a resposta — só aponta problemas.

É PROBLEMA (reprove):
- Qualquer afirmação sobre a Cloudfy que não esteja escrita nas fontes ou nos dados do cliente: produtos, planos, o que está incluso em cada plano, preços, limites, disponibilidade, prazos, políticas, e passo a passo/menus/botões do console da Cloudfy.
- Dizer que algo foi descontinuado, não existe, não está incluso, é cobrado à parte, não é possível ou está indisponível sem uma fonte dizendo exatamente isso.
- Contradizer uma fonte ou os dados do cliente (ex.: fonte diz "sem custo adicional" e a resposta diz que precisa contratar).
- Passo a passo técnico apresentado como o jeito de fazer na Cloudfy sem estar nas fontes.

NÃO é problema (aprove):
- Saudação, agradecimento, despedida, empatia, perguntas ao cliente, pedido de mais detalhes ou de print.
- Saudação que resume o perfil do cliente ("Vi aqui no seu perfil: • <produto> (sua infraestrutura: <nome>)") com os nomes do bloco DADOS DO CLIENTE — é o formato padrão do atendimento.
- Dizer que não tem a informação confirmada, oferecer ajuda ou encaminhar para a equipe.
- Dados da conta do próprio cliente que estão em DADOS DO CLIENTE.
- Conceitos gerais amplamente conhecidos que não afirmam nada sobre como a Cloudfy funciona (ex.: o que é um webhook).
- Paráfrase fiel de uma fonte, resumo, ou omissão de detalhes.

Na dúvida sobre uma paráfrase razoável, aprove. Na dúvida sobre um FATO da Cloudfy que você não encontra nas fontes, reprove.

Responda SOMENTE com um JSON válido, sem texto antes ou depois:
{"aprovada": true, "problemas": []}
ou
{"aprovada": false, "problemas": ["<trecho da resposta> — <por que não tem apoio>"]}`;

/** Cabe a evidência inteira de um turno (dados do cliente + até 4 artigos de
 *  7 mil caracteres). Cortar aqui faria o revisor reprovar o que está na
 *  parte cortada. */
const MAX_EVIDENCE_CHARS = 40_000;

export function buildAuditUserPrompt(params: {
  /** O que o cliente escreveu, literalmente. */
  message: string;
  /** A pergunta como o seletor a entendeu (resolve "isso", "e no meu?"). */
  question: string;
  answer: string;
  evidence: string;
}): string {
  const evidence = params.evidence.trim() || '(nenhuma fonte foi fornecida à IA)';
  const interpreted = params.question && params.question !== params.message
    ? `\n(interpretação automática a partir da conversa: ${params.question})`
    : '';
  return [
    `[FONTES E DADOS DO CLIENTE QUE A IA RECEBEU]\n${evidence.slice(0, MAX_EVIDENCE_CHARS)}`,
    `[MENSAGEM DO CLIENTE]\n${params.message}${interpreted}`,
    `[RESPOSTA A REVISAR]\n${params.answer}`,
  ].join('\n\n');
}

/** Lê o JSON do revisor. null = resposta inutilizável (a resposta segue sem auditoria). */
export function parseAuditVerdict(raw: string): AuditVerdict | null {
  const text = String(raw ?? '').replace(/```(?:json)?/gi, '');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (typeof parsed.aprovada !== 'boolean') return null;
    const problems = Array.isArray(parsed.problemas)
      ? parsed.problemas.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean).slice(0, 6)
      : [];
    // "Reprovada" sem apontar o quê não dá para corrigir: trata como aprovada.
    return { approved: parsed.aprovada || problems.length === 0, problems: parsed.aprovada ? [] : problems };
  } catch {
    return null;
  }
}

/** Bloco anexado ao system prompt para a reescrita de uma resposta reprovada. */
export function buildCorrectionInstruction(rejectedAnswer: string, problems: string[]): string {
  return `

[REVISÃO OBRIGATÓRIA — SUA RESPOSTA ANTERIOR FOI REPROVADA]
Um revisor comparou sua resposta com as fontes e encontrou afirmações sem apoio:
${problems.map((p) => `- ${p}`).join('\n')}

Resposta reprovada (NÃO repita as afirmações apontadas):
"""
${rejectedAnswer.slice(0, 3000)}
"""

Escreva a resposta de novo, seguindo TODAS as regras acima. Mantenha só o que as fontes e os dados do cliente sustentam. NÃO acrescente nenhuma informação que não estava na resposta reprovada — apenas remova ou corrija o que foi apontado (esta reescrita não passa por nova revisão). Onde a base não confirma, diga com naturalidade que não tem essa informação confirmada e ofereça encaminhar para a equipe. Continue usando os marcadores exigidos ([FONTE:n] quando um artigo sustentar a resposta, e o bloco [META: ...] no final).`;
}
