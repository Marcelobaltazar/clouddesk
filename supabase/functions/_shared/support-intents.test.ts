// ─── Testes da detecção de cobrança (guard P7-B) e da contestação ─────────────
// Rodar: npx deno@2.1.4 test supabase/functions/_shared/support-intents.test.ts
//
// Os exemplos reproduzem (sem dados de cliente) mensagens reais de set–out/2026.
// Os "não deve transferir" são os falsos positivos da regra antiga: problema
// técnico mandado para a fila financeira.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { claimsAlreadyPaid, contestsBillingReading, detectBillingChange, wantsAddonCancel } from './support-intents.ts';

Deno.test('cobrança: problema técnico NÃO vai para a fila financeira', () => {
  for (const msg of [
    'Preciso liberar uma auditoria somente leitura do meu n8n. A consulta GET /api/v1/workflows retorna HTTP 403.',
    'Desde hoje o n8n devolve erro getaddrinfo EAI_AGAIN nas chamadas HTTP.',
    'Minha instância n8n aparece como Executando no painel, mas o endereço retorna erro Cloudflare 524.',
    'acho que apaguei a configuracao do openrouter que vem pronta, pode me ajudar',
    'nao, vou apagar todo meu trabalho e comecar de novo',
    'O container do meu WAHA travou e a URL do Dashboard responde 404. Preciso que reiniciem.',
    'URGENTE: nosso n8n e a Evolution estão fora do ar hoje.',
    'Por exigência da LGPD preciso que liberem o acesso ao banco só para leitura.',
    'quem vai pagar meu dia de trabalho perdido?',
    'reativar minha i.a ilimitada',
    'Contratei a IA ilimitada, mas o n8n parou com o erro de limite de orçamento da chave.',
  ]) {
    assertEquals(detectBillingChange(msg), null, `não deveria transferir: "${msg}"`);
  }
});

Deno.test('cobrança: dúvida de plano/consulta fica com a IA (ela responde com a base)', () => {
  for (const msg of [
    'Posso fazer o upgrade do meu plano ultra para o plano max?',
    'como fazer upgrade, o que esta incluso',
    'Consigo trocar o plano da minha infra de advanced para o max?',
    'preciso trocar meu meio de pagamento',
    'quero trocar o cartão de pagamento',
    'tem como pagar minha fatura no pix',
    'minha fatura desse mês não chegou',
    'Se o WhatsApp bloquear o número, vocês trocam por outro ou devolvem o valor?',
  ]) {
    assertEquals(detectBillingChange(msg), null, `deveria ficar com a IA: "${msg}"`);
  }
});

Deno.test('cobrança: pedido de reembolso vai para a equipe', () => {
  for (const msg of [
    'quero reembolso, pois cancelei há muito tempo',
    'Foi feita uma renovação que não autorizei. Quero cancelamento e estorno do cartão.',
    'eu gostaria do ressarcimento do valor pago',
    'Como faço pra solicitar reembolso?',
    'Cancelei no dia da cobrança e até agora não recebemos a devolução dos valores.',
  ]) {
    assertEquals(detectBillingChange(msg), 'refund', `deveria ser reembolso: "${msg}"`);
  }
});

Deno.test('cobrança: cobrança indevida vai para a equipe', () => {
  for (const msg of ['Cobrança indevida', 'fui cobrado duas vezes este mês', 'não reconheço essa cobrança']) {
    assertEquals(detectBillingChange(msg), 'wrong_charge', `deveria ser cobrança indevida: "${msg}"`);
  }
});

Deno.test('cobrança: "já paguei e continua bloqueada" vai para a equipe', () => {
  for (const msg of [
    'MINHA INFRA ESTA BLOQUEADA, JA ESTA PAGA',
    'teve uma falha no pagamento e minha infra foi bloqueada, o pagamneto ja foi realizado',
    'tive problema com o pagamento mas ja foi resolvido e minha infra continua bloqueada',
    'Estou com minha conta bloqueada, com o pagamento em dia.',
    'paguei hoje cedo mas nao liberou ainda',
  ]) {
    assertEquals(detectBillingChange(msg), 'paid_but_blocked', `deveria ser pago+bloqueado: "${msg}"`);
  }
});

Deno.test('cobrança: "já paguei" sem bloqueio não força transferência', () => {
  const msg = 'fiz o pagamento do meu plano porém ainda não recebi meus dados de acesso';
  assertEquals(claimsAlreadyPaid(msg), true);
  assertEquals(detectBillingChange(msg), null);
});

Deno.test('contestação: cliente corrige a leitura "cobrança"', () => {
  for (const msg of [
    'Não é sobre pagamento ou cobrança. É suporte técnico do n8n.',
    'Complementando: não é uma dúvida de pagamento ou cobrança. É um incidente técnico.',
    'Esclarecendo: NÃO é cobrança nem pagamento.',
    'o assunto NÃO é pagamento/cobrança, é um chamado técnico',
    'Só corrigindo a classificação automática: meu chamado é técnico.',
    'próximo pagamento só em 30/10, então não é problema de cobrança.',
    'vc entendeu errado',
  ]) {
    assertEquals(contestsBillingReading(msg), true, `deveria detectar contestação: "${msg}"`);
  }
});

Deno.test('contestação: frases parecidas que NÃO são contestação', () => {
  for (const msg of [
    'Mas eu não pedi cancelamento, e como fica o reembolso?',
    'o que não é viável é permanecer com a cobrança do plano anual',
    'meu pagamento não é aprovado no cartão',
  ]) {
    assertEquals(contestsBillingReading(msg), false, `não deveria detectar: "${msg}"`);
  }
});

Deno.test('adicional: pedido de cancelar número/IA/backup vai para a equipe', () => {
  for (const msg of [
    'Como faço para cancelar meu número virtual? Eu contratei por engano',
    'preciso cancelar o numero de WhatsApp e a IA ilimitada',
    'gostaria de cancelar uns números virtuais sem derrubar minha infra',
    'quero cancelar o backup diário',
    'tem como cancelar IA ilimitada? solicitei sem querer',
    'não quero mais o número virtual',
    'desejo cancelar a contratação desse número, a plataforma não dá opção',
  ]) {
    assertEquals(wantsAddonCancel(msg), true, `deveria ir para a equipe: "${msg}"`);
  }
});

Deno.test('adicional: cancelar o plano, ou mexer no número na Evolution, não é adicional', () => {
  for (const msg of [
    'quero cancelar meu plano',
    'como cancelo a assinatura da minha infra?',
    'preciso remover o número da instância da Evolution',
    'o número foi bloqueado pela Meta, o que faço?',
    'a IA ilimitada está dando erro de limite',
    'vai conseguir resolver a questão da IA Ilimitada, ou vou precisar cancelar?',
    'quero cancelar o plano e manter o número, dá?',
  ]) {
    assertEquals(wantsAddonCancel(msg), false, `não deveria ser adicional: "${msg}"`);
  }
});
