// ─── Prazo de atendimento humano que a IA pode prometer ───────────────────────
// Política (13/10/2026): a equipe resolve em até 12 horas; em fim de semana e
// feriado, só no próximo dia útil. O texto é calculado aqui, nunca pelo modelo:
// em set/2026 as mensagens prometiam "até 4h" e a espera real mediana foi 18h.
// Promessa que a equipe não cumpre é pior do que nenhuma promessa.

export const SLA_HOURS = 12;

/** Brasília não tem horário de verão desde 2019. */
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Feriados nacionais de data fixa (MM-DD). */
const FIXED_HOLIDAYS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

/** Carnaval (segunda e terça), Sexta-feira Santa e Corpus Christi, em dias a
 *  partir do domingo de Páscoa. Não são todos feriados nacionais por lei, mas a
 *  equipe não conta como dia útil — prometer o dia seguinte é mais seguro. */
const EASTER_OFFSETS = [-48, -47, -2, 60];

const pad = (n: number): string => String(n).padStart(2, '0');

interface CivilDate {
  y: number;
  m: number;   // 1-12
  d: number;
  wd: number;  // 0 = domingo
}

function brt(date: Date): CivilDate {
  const b = new Date(date.getTime() + BRT_OFFSET_MS);
  return { y: b.getUTCFullYear(), m: b.getUTCMonth() + 1, d: b.getUTCDate(), wd: b.getUTCDay() };
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), em UTC 00:00. */
function easterSunday(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

const holidayCache = new Map<number, Set<string>>();

function holidaysOf(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const set = new Set(FIXED_HOLIDAYS);
  const easter = easterSunday(year);
  for (const offset of EASTER_OFFSETS) {
    const d = new Date(easter + offset * DAY_MS);
    set.add(`${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  holidayCache.set(year, set);
  return set;
}

export function isBusinessDay(date: Date): boolean {
  const c = brt(date);
  if (c.wd === 0 || c.wd === 6) return false;
  return !holidaysOf(c.y).has(`${pad(c.m)}-${pad(c.d)}`);
}

function nextBusinessDay(from: Date): Date {
  let d = new Date(from.getTime() + DAY_MS);
  while (!isBusinessDay(d)) d = new Date(d.getTime() + DAY_MS);
  return d;
}

/**
 * Quando a equipe responde, pronto para entrar numa frase depois de
 * "alguém te responde por aqui …":
 *   "em até 12 horas"                         (dia útil, prazo cai em dia útil)
 *   "amanhã (terça, 14/10)"                    (próximo dia útil é amanhã)
 *   "no próximo dia útil (segunda, 19/10)"     (fim de semana/feriado no meio)
 */
export function humanReplyWindow(now: Date = new Date()): string {
  const deadline = new Date(now.getTime() + SLA_HOURS * 60 * 60 * 1000);
  if (isBusinessDay(now) && isBusinessDay(deadline)) return `em até ${SLA_HOURS} horas`;

  const next = nextBusinessDay(now);
  const c = brt(next);
  const label = `${WEEKDAYS[c.wd]}, ${pad(c.d)}/${pad(c.m)}`;
  const tomorrow = brt(new Date(now.getTime() + DAY_MS));
  const isTomorrow = tomorrow.y === c.y && tomorrow.m === c.m && tomorrow.d === c.d;
  return isTomorrow ? `amanhã (${label})` : `no próximo dia útil (${label})`;
}
