import { db } from "../db.js";

/**
 * Ceilings, and the approvals that lift them.
 *
 * Two things were unbounded. A sales rep could take any amount off an order —
 * the only check was that the discount did not exceed the line itself — so a
 * concession nobody would have agreed to only surfaced weeks later in the
 * profit report, by which point it was a customer's expectation. And whoever
 * kept the books could commit the business to a purchase order of any size
 * with nobody else's name on it.
 *
 * The rule here is narrow on purpose:
 *
 *   A ceiling that has never been set is not a ceiling of zero.
 *
 * Nothing bites until the owner sets a figure. A business that upgrades on a
 * Thursday must not find its showroom unable to sell on Friday morning because
 * a release introduced a limit it had never heard of.
 *
 * The owner is never checked. Asking somebody for permission to do the thing
 * only they can grant is a loop, not a control.
 */

const n = (d: unknown) => Number(d ?? 0);

/** Approvals go stale, so a yes cannot be spent on a different sale later. */
export const APPROVAL_HOURS = 48;

export type Ceiling = { discountPct: number | null; purchaseCeiling: number | null };

export async function limitsFor(role: string): Promise<Ceiling> {
  if (role === "OWNER") return { discountPct: null, purchaseCeiling: null };
  const row = await db.roleLimit.findUnique({ where: { role: role as any } });
  return {
    discountPct: row?.discountPct == null ? null : n(row.discountPct),
    purchaseCeiling: row?.purchaseCeiling == null ? null : n(row.purchaseCeiling),
  };
}

/**
 * May this person take this much off, and if not, what were they allowed?
 *
 * The ceiling is a percent of the gross rather than a sum in pounds: a hundred
 * off a bedroom suite and a hundred off a stool are not the same concession,
 * and a rule expressed in pounds says they are.
 */
export async function checkDiscount(role: string, gross: number, discount: number) {
  const { discountPct } = await limitsFor(role);
  if (discountPct == null || discount <= 0) return { ok: true as const };
  // A ceiling on nothing is not a ceiling; an order that is entirely a
  // discount is caught upstream as a typo.
  const allowed = Math.round(gross * (discountPct / 100) * 100) / 100;
  if (discount <= allowed + 0.005) return { ok: true as const };
  return {
    ok: false as const,
    limitPct: discountPct,
    allowed,
    asked: Math.round(discount * 100) / 100,
  };
}

export async function checkPurchaseValue(role: string, value: number) {
  const { purchaseCeiling } = await limitsFor(role);
  if (purchaseCeiling == null) return { ok: true as const };
  if (value <= purchaseCeiling + 0.005) return { ok: true as const };
  return {
    ok: false as const,
    allowed: purchaseCeiling,
    asked: Math.round(value * 100) / 100,
  };
}

/**
 * Spending an approval.
 *
 * Everything that can go wrong with a permission slip: it was never answered,
 * it was refused, it has already been used, it has gone stale, it belongs to
 * somebody else's request, it is for a different kind of thing, or it is for
 * less than is being asked. Each is its own answer, because "no" without a
 * reason sends somebody back to the owner to ask the same question again.
 *
 * Returns the approval to consume, or the reason it cannot be.
 */
export async function claimApproval(opts: {
  id: string;
  kind: "ORDER_DISCOUNT" | "PURCHASE_ORDER_VALUE";
  amount: number;
  actorId: string;
}) {
  const a = await db.approval.findUnique({ where: { id: opts.id } });
  if (!a) return { ok: false as const, error: "approval_not_found" };
  if (a.kind !== opts.kind) return { ok: false as const, error: "approval_wrong_kind" };
  if (a.status === "USED" || a.usedAt) return { ok: false as const, error: "approval_already_used" };
  if (a.status === "REJECTED") return { ok: false as const, error: "approval_refused" };
  if (a.status !== "APPROVED") return { ok: false as const, error: "approval_not_decided" };
  if (a.expiresAt.getTime() < Date.now()) return { ok: false as const, error: "approval_expired" };
  // The slip belongs to the person who asked for it. Otherwise one approval
  // circulates round a showroom.
  if (a.requestedById !== opts.actorId) {
    return { ok: false as const, error: "approval_not_yours" };
  }
  // Approved for three thousand means three thousand or less, never more.
  if (opts.amount > n(a.amount) + 0.005) {
    return { ok: false as const, error: "approval_too_small", approved: n(a.amount) };
  }
  return { ok: true as const, approval: a };
}
