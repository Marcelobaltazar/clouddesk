// ─── Testes do prazo que a IA promete (support-sla.ts) ────────────────────────
// Rodar: npx deno@2.1.4 test supabase/functions/_shared/support-sla.test.ts
// Horários em Brasília (UTC-3) escritos como ISO com -03:00.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { humanReplyWindow, isBusinessDay } from './support-sla.ts';

const at = (iso: string) => new Date(iso);

Deno.test('sla: dia útil com prazo caindo em dia útil → "em até 12 horas"', () => {
  assertEquals(humanReplyWindow(at('2026-10-14T10:00:00-03:00')), 'em até 12 horas'); // quarta
  assertEquals(humanReplyWindow(at('2026-10-15T20:00:00-03:00')), 'em até 12 horas'); // quinta → sexta 08h
});

Deno.test('sla: sexta à noite → segunda (prazo cairia no sábado)', () => {
  assertEquals(humanReplyWindow(at('2026-10-16T20:00:00-03:00')), 'no próximo dia útil (segunda, 19/10)');
});

Deno.test('sla: sábado → segunda; domingo → amanhã (segunda)', () => {
  assertEquals(humanReplyWindow(at('2026-10-17T11:00:00-03:00')), 'no próximo dia útil (segunda, 19/10)');
  assertEquals(humanReplyWindow(at('2026-10-18T15:00:00-03:00')), 'amanhã (segunda, 19/10)');
});

Deno.test('sla: feriado de 12/10 → amanhã (terça)', () => {
  assertEquals(isBusinessDay(at('2026-10-12T10:19:00-03:00')), false);
  assertEquals(humanReplyWindow(at('2026-10-12T10:19:00-03:00')), 'amanhã (terça, 13/10)');
});

Deno.test('sla: feriados móveis (Carnaval, Sexta-feira Santa, Corpus Christi 2027)', () => {
  // Páscoa de 2027: 28/03
  assertEquals(isBusinessDay(at('2027-02-08T12:00:00-03:00')), false); // segunda de Carnaval
  assertEquals(isBusinessDay(at('2027-02-09T12:00:00-03:00')), false); // terça de Carnaval
  assertEquals(isBusinessDay(at('2027-03-26T12:00:00-03:00')), false); // Sexta-feira Santa
  assertEquals(isBusinessDay(at('2027-05-27T12:00:00-03:00')), false); // Corpus Christi
  assertEquals(isBusinessDay(at('2027-02-10T12:00:00-03:00')), true);  // quarta de cinzas conta
});

Deno.test('sla: véspera de feriado à noite pula o feriado', () => {
  // 01/11/2026 é domingo, 02/11 (Finados) segunda → sexta 30/10 20h vai pra terça
  assertEquals(humanReplyWindow(at('2026-10-30T20:00:00-03:00')), 'no próximo dia útil (terça, 03/11)');
});

Deno.test('sla: o fuso é Brasília, não UTC (23h de sexta em BRT já é sábado em UTC)', () => {
  assertEquals(isBusinessDay(at('2026-10-16T23:30:00-03:00')), true);
  assertEquals(isBusinessDay(at('2026-10-17T00:30:00-03:00')), false);
});
