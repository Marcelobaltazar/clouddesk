// ─── Testes das respostas fixas dos guards (cobrança / cancelamento) ──────────
// Rodar: npx deno@2.1.4 test --allow-env supabase/functions/_shared/ai-guards.test.ts
//
// O que se protege aqui é o combinado com a operação em 13/10/2026:
//   • nunca prometer prazo que a equipe não cumpre ("4 horas");
//   • nunca dizer que o problema é da Cloudfy;
//   • link de pagamento vem dos dados, escrito exatamente como veio;
//   • sem fórmulas de robô.

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { _test } from './ai-pipeline.ts';
import type { BillingInfo, BillingInvoice, BillingSubscription } from './chargefy.ts';

const sub = (over: Partial<BillingSubscription> = {}): BillingSubscription => ({
  status: 'active',
  product_name: 'Cloud Advanced - Mensal',
  amount: 84.9,
  currency: 'BRL',
  interval: 'month',
  quantity: 1,
  started_at: '2026-09-11T00:00:00Z',
  next_billing_at: '2026-11-11T00:00:00Z',
  current_period_end: '2026-11-11T03:00:00Z',
  trial_end: null,
  cancel_at_period_end: false,
  cancel_at: null,
  has_pending_update: false,
  ...over,
});

const invoice = (over: Partial<BillingInvoice> = {}): BillingInvoice => ({
  number: 'INV-0001',
  status: 'open',
  amount_total: 63.67,
  amount_due: 63.67,
  amount_discount: 0,
  currency: 'BRL',
  due_date: '2026-10-11T15:00:00Z',
  paid_at: null,
  hosted_url: 'https://pay.chargefy.io/i/abc123',
  pdf_url: null,
  interest_amount: 0,
  late_fee_amount: 0,
  credit_applied: 0,
  billing_reason: null,
  allow_late_payment: true,
  ...over,
});

const billing = (over: Partial<BillingInfo> = {}): BillingInfo => ({
  customer_since: '2026-09-11T00:00:00Z',
  phone: null,
  subscriptions: [sub()],
  invoices: [],
  charges: [],
  ...over,
});

/** Frases que não podem aparecer em nenhuma resposta fixa. */
const FORBIDDEN = [
  /4 horas/i,
  /nosso lado/i,
  /falha nossa|erro nosso|culpa (é )?nossa/i,
  /Entendi que a sua d[úu]vida/i,
  /Fico à disposição|Espero ter ajudado/i,
];

function assertTone(text: string) {
  for (const re of FORBIDDEN) assertEquals(re.test(text), false, `frase proibida ${re} em: ${text}`);
  const emojis = text.match(/\p{Extended_Pictographic}/gu) ?? [];
  assert(emojis.length <= 1, `mais de 1 emoji: ${text}`);
}

Deno.test('guard: infra bloqueada com fatura em aberto manda o link exato', () => {
  const inv = _test.openInvoicesToPay(billing({ invoices: [invoice()] }));
  assertEquals(inv.length, 1);
  const reply = _test.blockedWithInvoiceReply('sua infraestrutura **minhainfra**', inv);
  assertStringIncludes(reply, '(https://pay.chargefy.io/i/abc123)');
  assertStringIncludes(reply, 'R$');
  assertStringIncludes(reply, '11/10/2026');
  assertTone(reply);
});

Deno.test('guard: fatura paga, sem valor ou sem link não entra como "a pagar"', () => {
  const inv = _test.openInvoicesToPay(billing({
    invoices: [
      invoice({ status: 'paid', amount_due: 0 }),
      invoice({ amount_due: 0 }),
      invoice({ hosted_url: null }),
    ],
  }));
  assertEquals(inv.length, 0);
  assertEquals(_test.openInvoicesToPay(null).length, 0);
});

Deno.test('guard: faturas em aberto saem da mais antiga para a mais nova, no máximo 2', () => {
  const inv = _test.openInvoicesToPay(billing({
    invoices: [
      invoice({ number: 'C', due_date: '2026-12-11T00:00:00Z' }),
      invoice({ number: 'A', due_date: '2026-10-11T00:00:00Z' }),
      invoice({ number: 'B', due_date: '2026-11-11T00:00:00Z' }),
    ],
  }));
  assertEquals(inv.map((i) => i.number), ['A', 'B']);
});

Deno.test('guard: cancelamento já agendado é reconhecido só se TODAS as assinaturas vivas estão agendadas', () => {
  const end = '2026-11-11T03:00:00Z';
  assertEquals(
    _test.scheduledCancellationEnd(billing({ subscriptions: [sub({ cancel_at_period_end: true, cancel_at: end })] })),
    end,
  );
  assertEquals(
    _test.scheduledCancellationEnd(billing({
      subscriptions: [sub({ cancel_at_period_end: true, cancel_at: end }), sub()],
    })),
    null,
  );
  // assinatura já cancelada não conta como "viva"
  assertEquals(
    _test.scheduledCancellationEnd(billing({
      subscriptions: [sub({ cancel_at_period_end: true, cancel_at: end }), sub({ status: 'canceled' })],
    })),
    end,
  );
  assertEquals(_test.scheduledCancellationEnd(null), null);

  const reply = _test.cancelScheduledReply(end);
  assertStringIncludes(reply, '11/11/2026');
  assertStringIncludes(reply, 'não vai ter nova cobrança');
  assertTone(reply);
});

Deno.test('guard: mensalidade em aberto explica por que o cancelamento travou', () => {
  assertEquals(_test.hasUnpaidSubscription(billing({ subscriptions: [sub({ status: 'unpaid' })] })), true);
  assertEquals(_test.hasUnpaidSubscription(billing({ subscriptions: [sub({ status: 'past_due' })] })), true);
  assertEquals(_test.hasUnpaidSubscription(billing()), false);

  const withReason = _test.cancelHandoffReply(true, 'em até 12 horas');
  assertStringIncludes(withReason, 'mensalidade em aberto');
  assertStringIncludes(withReason, 'em até 12 horas');
  assertTone(withReason);
  assertTone(_test.cancelHandoffReply(false, 'amanhã (terça, 14/10)'));
});

Deno.test('guard: todas as respostas fixas respeitam o tom e trazem o prazo calculado', () => {
  const w = 'no próximo dia útil (segunda, 19/10)';
  for (const reply of [
    _test.blockedSelfServiceReply('sua infraestrutura'),
    _test.blockedAfterPaymentReply('sua infraestrutura', w),
    _test.billingChangeReply('refund', w),
    _test.billingChangeReply('wrong_charge', w),
    _test.billingChangeReply('paid_but_blocked', w),
    _test.addonCancelReply(w),
  ]) {
    assertTone(reply);
  }
  for (const reply of [
    _test.blockedAfterPaymentReply('sua infraestrutura', w),
    _test.billingChangeReply('refund', w),
    _test.addonCancelReply(w),
  ]) {
    assertStringIncludes(reply, w);
  }
});

Deno.test('prompt: regras de tom e de responsabilidade estão no prompt base', () => {
  const p = _test.BASE_SYSTEM_PROMPT();
  assertStringIncludes(p, '[JEITO DE FALAR]');
  assertStringIncludes(p, 'NUNCA diga que o problema é da Cloudfy');
  assertStringIncludes(p, 'NUNCA fale de servidor, provedor de hospedagem');
  assertEquals(/Ao final, pergunte se o cliente precisa de mais ajuda/.test(p), false);
});

Deno.test('guard: "paguei" só vira "aguarde" com pagamento confirmado na última hora', () => {
  const now = new Date('2026-10-13T15:00:00Z').getTime();
  const paidInvoice = billing({ invoices: [invoice({ status: 'paid', amount_due: 0, paid_at: '2026-10-13T14:40:00Z' })] });
  const oldInvoice = billing({ invoices: [invoice({ status: 'paid', amount_due: 0, paid_at: '2026-10-13T12:00:00Z' })] });
  assertEquals(_test.recentPaymentConfirmed(paidInvoice, 60, now), true);
  assertEquals(_test.recentPaymentConfirmed(oldInvoice, 60, now), false);
  assertEquals(_test.recentPaymentConfirmed(null, 60, now), false);

  const reply = _test.paymentConfirmedWaitReply('sua infraestrutura **minhainfra**');
  assertStringIncludes(reply, 'pagamento já foi confirmado');
  assertStringIncludes(reply, '10 minutinhos');
  // o "aguarde" não pode conter o trecho que marca a orientação de bloqueio,
  // senão a próxima mensagem do cliente seria lida como insistência errada
  assertEquals(reply.includes('tá bloqueada'), false);
  assertTone(reply);
});
