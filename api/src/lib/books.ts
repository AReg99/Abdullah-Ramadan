import { z } from "zod";

/**
 * The few primitives both halves of the books need.
 *
 * Accounting and payroll are separate apps — a workshop can run one without the
 * other — but they read the same money and the same dates, and a validator or a
 * date window written twice is one that will differ. It has already happened
 * elsewhere in this codebase often enough to be worth a file.
 */

/** A positive amount somebody typed. Rejects NaN, negatives and silly figures. */
export const money = () => z.number().finite().positive().max(1e12);

/** An optional ISO date somebody typed. */
export const day = () => z.string().datetime().optional();

/** Prisma decimals arrive as objects; this is the number underneath. */
export const n = (d: unknown) => Number(d ?? 0);

/**
 * The window a report covers, from ?from= and ?to=.
 *
 * Closed at both ends: the whole of the "to" day belongs in the period, because
 * a person asking for "up to the 30th" means the 30th, and a half-open window
 * silently drops that day's takings.
 */
export function period(q: any) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  from.setHours(0, 0, 0, 0);
  return { from, to: end };
}
