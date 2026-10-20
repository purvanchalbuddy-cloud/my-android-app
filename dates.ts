export const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export type DateContext = { month: number; year: number };

export type ParsedDate =
  | { ok: true; iso: string; source: "day" | "full" }
  | { ok: false; error: string };

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function shiftMonth(month: number, year: number, delta: number): { month: number; year: number } {
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return { month: m, year: y };
}

export function formatDMY(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function formatPretty(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const name = MONTH_SHORT[m - 1] ?? "";
  return `${d} ${name} ${y}`;
}

export function formatStamp(ts: number): string {
  const date = new Date(ts);
  return formatPretty(toIso(date.getFullYear(), date.getMonth() + 1, date.getDate()));
}

export function isoToUtcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function utcDateToIso(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const iso = toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  const check = makeDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  return check.ok ? iso : null;
}

export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function makeDate(year: number, month: number, day: number): ParsedDate {
  if (!Number.isInteger(year) || year < 1980 || year > 2100) {
    return { ok: false, error: "Year must be between 1980 and 2100" };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, error: "Month must be from 1 to 12" };
  }
  const max = daysInMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > max) {
    return {
      ok: false,
      error: `${MONTH_LONG[month - 1]} ${year} has no day ${day}`,
    };
  }
  return { ok: true, iso: toIso(year, month, day), source: "full" };
}

function expandYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function monthIndex(token: string): number | null {
  const t = token.toLowerCase().replace(/\./g, "");
  if (!t) return null;
  const short = MONTH_SHORT.findIndex((m) => m.toLowerCase() === t);
  if (short >= 0) return short + 1;
  const long = MONTH_LONG.findIndex((m) => m.toLowerCase() === t);
  if (long >= 0) return long + 1;
  if (t.length >= 3) {
    const prefix = MONTH_LONG.findIndex((m) => m.toLowerCase().startsWith(t));
    if (prefix >= 0) return prefix + 1;
  }
  return null;
}

export function parseFlexibleDate(raw: string, ctx: DateContext): ParsedDate {
  const s = raw.trim().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s) return { ok: false, error: "Enter a day or a full date" };

  if (/^\d{1,2}$/.test(s)) {
    const day = Number(s);
    const made = makeDate(ctx.year, ctx.month, day);
    if (!made.ok) return made;
    return { ok: true, iso: made.iso, source: "day" };
  }

  const numeric = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (numeric) {
    return makeDate(expandYear(Number(numeric[3])), Number(numeric[2]), Number(numeric[1]));
  }

  const dayMonth = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (dayMonth) {
    return makeDate(ctx.year, Number(dayMonth[2]), Number(dayMonth[1]));
  }

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const dayName = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-zA-Z]+)(?:\s+(\d{2,4}))?$/);
  if (dayName) {
    const month = monthIndex(dayName[2]);
    if (!month) return { ok: false, error: `Unknown month “${dayName[2]}”` };
    const year = dayName[3] ? expandYear(Number(dayName[3])) : ctx.year;
    return makeDate(year, month, Number(dayName[1]));
  }

  const nameDay = s.match(/^([a-zA-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{2,4}))?$/);
  if (nameDay) {
    const month = monthIndex(nameDay[1]);
    if (!month) return { ok: false, error: `Unknown month “${nameDay[1]}”` };
    const year = nameDay[3] ? expandYear(Number(nameDay[3])) : ctx.year;
    return makeDate(year, month, Number(nameDay[2]));
  }

  return { ok: false, error: "Use a day like 2, or a full date like 02/08/2026" };
}
