/**
 * Pay periods.
 *
 * A furniture factory pays its floor weekly against the days they turned up,
 * and its office monthly. Both live in the same payroll, so a period is a key
 * that says which it is: "2026-08" for a month, "2026-W35" for a week.
 */
export type PeriodKind = "WEEKLY" | "MONTHLY";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const WEEK = /^(\d{4})-W(\d{2})$/;

/** Midday UTC, so a timezone can never shift a day onto its neighbour. */
export const atMidday = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));

/**
 * The days a period covers, and what to call it.
 *
 * Weeks run Saturday to Friday, which is the working week in Egypt — an
 * ISO week starting on Monday would cut every Egyptian week in half.
 */
export function resolvePeriod(key: string):
  | { ok: true; kind: PeriodKind; start: Date; end: Date; days: Date[] }
  | { ok: false } {
  const m = MONTH.exec(key);
  if (m) {
    const [y, mo] = [Number(m[1]), Number(m[2])];
    const start = new Date(Date.UTC(y, mo - 1, 1, 12));
    const end = new Date(Date.UTC(y, mo, 0, 12));
    return { ok: true, kind: "MONTHLY", start, end, days: daysBetween(start, end) };
  }
  const w = WEEK.exec(key);
  if (w) {
    const [y, wk] = [Number(w[1]), Number(w[2])];
    if (wk < 1 || wk > 53) return { ok: false };
    const start = weekStart(y, wk);
    const end = new Date(start.getTime() + 6 * 86_400_000);
    return { ok: true, kind: "WEEKLY", start, end, days: daysBetween(start, end) };
  }
  return { ok: false };
}

/**
 * Week 1 is the one containing the 1st of January; weeks start on Saturday.
 *
 * Deliberately not ISO 8601: ISO starts weeks on Monday, which would split
 * every Egyptian working week across two pay periods.
 */
function weekStart(year: number, week: number) {
  const jan1 = new Date(Date.UTC(year, 0, 1, 12));
  // getUTCDay: 0 Sun … 6 Sat. Saturday is 6, so this is how far back to go.
  const back = (jan1.getUTCDay() + 1) % 7;
  const firstSaturday = new Date(jan1.getTime() - back * 86_400_000);
  return new Date(firstSaturday.getTime() + (week - 1) * 7 * 86_400_000);
}

/** The week key a given day falls in. */
export function weekKeyOf(d: Date) {
  const day = atMidday(d);
  const year = day.getUTCFullYear();
  for (const y of [year, year - 1, year + 1]) {
    for (let w = 1; w <= 53; w++) {
      const s = weekStart(y, w);
      const e = new Date(s.getTime() + 6 * 86_400_000);
      if (day >= s && day <= e) return `${y}-W${String(w).padStart(2, "0")}`;
    }
  }
  return `${year}-W01`;
}

function daysBetween(start: Date, end: Date) {
  const out: Date[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) out.push(new Date(t));
  return out;
}

/** What a day of attendance is worth, as a fraction of a full day's pay. */
export const dayValue = (status: string) =>
  status === "PRESENT" || status === "LEAVE" ? 1 : status === "HALF" ? 0.5 : 0;
