// ─── Date helpers (pt-BR) ──────────────────────────────────────────────────────
// Centralized timestamp formatting for the inbox UI. All output is pt-BR.

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

const absoluteFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns a relative pt-BR string ("há 2 minutos", "há 3 horas", "há 2 dias").
 * For dates older than 7 days, returns an absolute date ("12/05/2026 às 14:30").
 */
export function timeAgo(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();

  // Older than 7 days → absolute date
  if (diffMs >= SEVEN_DAYS_MS) {
    const parts = absoluteFormatter.formatToParts(d);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    return `${get("day")}/${get("month")}/${get("year")} às ${get("hour")}:${get("minute")}`;
  }

  // "agora mesmo" for very recent timestamps
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 45) return "agora mesmo";

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return rtf.format(-diffMin, "minute");

  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return rtf.format(-diffHour, "hour");

  const diffDay = Math.round(diffHour / 24);
  return rtf.format(-diffDay, "day");
}

/**
 * Short relative label without the "há" prefix — for tight spaces like the
 * conversation list ("2 min", "3 h", "2 d").
 */
export function timeAgoShort(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();

  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return "agora";

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min`;

  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} h`;

  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 7) return `${diffDay} d`;

  const diffWeek = Math.round(diffDay / 7);
  return `${diffWeek} sem`;
}

/**
 * Absolute pt-BR date/time: "12/05/2026 às 14:30".
 */
export function formatDateTimeBR(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const parts = absoluteFormatter.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} às ${get("hour")}:${get("minute")}`;
}

/**
 * Remaining-time label for snoozed conversations ("2h", "45min", "3d").
 * Returns "agora" when the deadline has passed.
 */
export function timeUntilShort(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return "agora";

  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}min`;

  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;

  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d`;
}
