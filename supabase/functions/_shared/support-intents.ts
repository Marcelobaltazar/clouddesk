// ─── Detecção determinística de intenções sensíveis (cobrança) ────────────────
// Estes testes decidem se a IA nem chega a responder: o cliente é transferido
// para a equipe antes. Por isso são estreitos de propósito — na dúvida, quem
// decide é o modelo, que lê a frase inteira e tem a regra de transferência.
//
// Histórico (set–out/2026): a regra antiga casava pedaços de palavra e ~metade
// das transferências "de cobrança" eram problemas técnicos —
//   "preciso LIBERAR uma auditoria do n8n"   → liberar = desbloqueio
//   "o n8n DEVOLVE erro 403"                 → devolver = reembolso
//   "vou APAGAR meu trabalho"                → contém "pagar"
//   "acho que APAGUEI a credencial"          → contém "paguei"
//   "posso fazer UPGRADE pro Max?"           → upgrade = alteração de cobrança
//
// Tudo roda sobre o texto sem acento e em minúsculas, com limites de palavra.

/** Minúsculas e sem acento, para os testes não dependerem de grafia. */
export function normalizeForIntent(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** PEDIDO de reembolso. Pergunta sobre a política ("se o número for bloqueado,
 *  vocês devolvem o valor?") fica com o modelo — há snippet oficial para isso. */
const REFUND_RE =
  /\b(quero|queria|gostaria|preciso|solicito|solicitei|solicitar|pedir|pedi|pedido|aguardo|aguardando|cade|receb\w*)\b[^.?!]{0,30}\b(reembols\w*|estorn\w*|ressarc\w*|devoluc\w*|dinheiro de volta)\b|\b(estornar|estornem|estorne|reembolsar|reembolsem|reembolse|devolvam)\b|\bme devolv\w* (o |meu )?(dinheiro|valor|pagamento)\b/;

const WRONG_CHARGE_RE =
  /\b(cobranc\w* (indevida|duplicada|em dobro|errada|a mais)|cobrad[oa]s? (a mais|duas vezes|em dobro|2x|indevidamente|errado)|cobra(ram|ndo|ou) (a mais|duas vezes|em dobro|2x|errado)|nao reconheco (essa |esta |a |uma )?(cobranca|compra|fatura|transacao)|contestar (a |essa |esta )?(cobranca|compra|fatura))\b/;

/** O cliente afirma que já pagou / regularizou. */
const PAID_CLAIM_RE =
  /\b(ja paguei|paguei|quitei|regularizei|ja resolvi|pagamento (ja )?(foi |esta |ta )?(feito|realizado|efetuado|aprovado|confirmado|compensado|em dia)|ja foi (realizad|feit|efetuad|pag|resolvid|quitad|regularizad|aprovad|compensad)\w*|(fiz|efetuei|realizei) o pagamento|(ja )?(esta|ta|estava|tava) (tudo )?pag[oa]|(plano|fatura|assinatura|mensalidade) (esta |ta )?(pag[oa]|em dia)|pagamento em dia|atualizei o cartao)\b/;

/** …e que o acesso continua bloqueado. */
const STILL_BLOCKED_RE =
  /\b(bloquead\w*|bloqueio|bloqueou|desbloque\w*|suspens\w*|nao (voltou|liberou|reativou|desbloqueou|foi liberad\w*)|continua (bloquead\w*|parad\w*|fora|inativ\w*))\b/;

/** Menção a pagamento — só usada quando a infra está REALMENTE bloqueada
 *  (dado do banco), então pode ser mais ampla. */
const PAYMENT_MENTION_RE =
  /\b(paguei|pagamento|pagar|pagou|pago|paga|fatura\w*|boleto|pix|cobranc\w*|cobrad\w*|cartao|bloquead\w*|bloqueio|desbloque\w*|inadimpl\w*|regulariz\w*|reativ\w*|liber\w*|vencid\w*|atrasad\w*|mensalidade)\b/;

/** O cliente diz que a transferência "de cobrança" entendeu errado. */
/** Só palavras de ligação entre o "não é" e o tema: "o que não é viável é
 *  manter a cobrança" não é contestação. */
const CONTEST_BILLING_RE =
  /\bnao (e|eh|era|se trata)((\s|\/)+(sobre|de|do|da|um|uma|questao|duvida|assunto|caso|problema|chamado|nem|isso|referente|a|o))*(\s|\/)+(pagamento|cobranca|financeiro|fatura|billing)\b|\b(nao tem (nada )?a ver|nada a ver|nao tem relacao) com (o |a )?(pagamento|cobranca|financeiro|fatura)\b|\b(entendeu|entenderam|interpretou|classificou|classificacao( automatica)?) errad\w*|\bcorrigindo a classificacao\b/;

/** Cancelar um ADICIONAL que só a equipe de suporte consegue cancelar (IA
 *  Ilimitada, backup). Número virtual NÃO entra: desde 13/10/2026 o próprio
 *  cliente cancela em Números Virtuais, no painel — a IA orienta pela base. */
const ADDON_NOUN = String.raw`(ia ilimitada|i\.?a\.? ilimitada|llm unlimited|backup|adicion(al|ais)|add-?ons?)`;
/** Exige pedido ("quero", "como faço", "tem como"…): "ou vou precisar
 *  cancelar?" é desabafo. Entre o verbo e o adicional não pode aparecer o plano
 *  ("posso cancelar o plano e manter o número?" não é cancelar o número). */
const ADDON_CANCEL_RE = new RegExp(
  String.raw`\b(quero|queria|gostaria|preciso|desejo|solicito|solicitar|pedir|como|tem como|da pra|consigo|podem)\b[^.?!]{0,25}\bcancel\w*\b((?!plano|assinatura|infra)[^.?!]){0,25}\b${ADDON_NOUN}\b` +
  String.raw`|\bnao quero mais\b((?!plano|assinatura|infra)[^.?!]){0,20}\b${ADDON_NOUN}\b`,
);

export type BillingChangeKind = 'refund' | 'wrong_charge' | 'paid_but_blocked';

export function wantsAddonCancel(text: string): boolean {
  return ADDON_CANCEL_RE.test(normalizeForIntent(text));
}

/**
 * Pedido de cobrança que só a equipe resolve. A IA consulta a Chargefy, mas
 * não altera nada; dúvidas de consulta (valor, vencimento, 2ª via, como trocar
 * o cartão, upgrade) seguem para o modelo, que responde com os dados e a base.
 */
export function detectBillingChange(text: string): BillingChangeKind | null {
  const t = normalizeForIntent(text);
  if (REFUND_RE.test(t)) return 'refund';
  if (WRONG_CHARGE_RE.test(t)) return 'wrong_charge';
  if (PAID_CLAIM_RE.test(t) && STILL_BLOCKED_RE.test(t)) return 'paid_but_blocked';
  return null;
}

export function claimsAlreadyPaid(text: string): boolean {
  return PAID_CLAIM_RE.test(normalizeForIntent(text));
}

export function mentionsPayment(text: string): boolean {
  return PAYMENT_MENTION_RE.test(normalizeForIntent(text));
}

export function contestsBillingReading(text: string): boolean {
  return CONTEST_BILLING_RE.test(normalizeForIntent(text));
}

// ─── Operações que só a equipe executa (vale também para o Starter) ───────────
// No Starter o atendimento é a Luna, sem equipe humana — exceto pedidos que o
// cliente não consegue fazer sozinho e a Luna não executa (13/10/2026). O
// modelo decide se é o caso; este teste só confere que o ASSUNTO apareceu na
// conversa antes de deixar um Starter ir para a equipe. Por isso é amplo:
// errar para mais custa uma transferência; para menos, um cliente sem saída.
//   • senha do n8n (trocou/esqueceu e ficou sem acesso — a equipe reseta);
//   • restaurar backup;
//   • credencial da IA Ilimitada apagada ou alterada (a equipe recria).
// Reembolso, cobrança indevida, adicional e infra paga bloqueada já têm guard
// próprio (detectBillingChange / wantsAddonCancel / P7-A) para todos os planos.
const N8N_PASSWORD_TOPIC_RE =
  /\b(senha|password)\b[^.?!]{0,60}\bn8n\b|\bn8n\b[^.?!]{0,60}\b(senha|password)\b/;
const BACKUP_RESTORE_TOPIC_RE =
  /\b(restaur\w*|recuper\w*|volt\w*|revert\w*)\b[^.?!]{0,40}\bbackups?\b|\bbackups?\b[^.?!]{0,40}\b(restaur\w*|recuper\w*|volt\w*|revert\w*)\b/;
const AI_CREDENTIAL_TOPIC_RE = new RegExp(
  String.raw`\b(credencia\w*|chave)\b[^.?!]{0,60}\b(ia ilimitada|i\.?a\.? ilimitada|llm unlimited|openrouter)\b` +
  String.raw`|\b(ia ilimitada|i\.?a\.? ilimitada|llm unlimited|openrouter)\b[^.?!]{0,60}\b(credencia\w*|chave)\b`,
);

export type TeamOnlyTopic = 'n8n_password' | 'backup_restore' | 'ai_credential';

export function teamOnlyTopic(text: string): TeamOnlyTopic | null {
  const t = normalizeForIntent(text);
  if (N8N_PASSWORD_TOPIC_RE.test(t)) return 'n8n_password';
  if (BACKUP_RESTORE_TOPIC_RE.test(t)) return 'backup_restore';
  if (AI_CREDENTIAL_TOPIC_RE.test(t)) return 'ai_credential';
  return null;
}
