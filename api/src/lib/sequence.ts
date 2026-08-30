import { db } from "../db.js";
import { allSettings } from "./settings.js";

/**
 * Document numbers.
 *
 * Every counted document — a sales invoice, a receipt, a payment — needs a
 * number that is its own, unbroken, and never handed out twice. Deriving one
 * from a count of rows looks simpler until two people invoice in the same
 * second and both get the same number, or something is deleted and the series
 * silently repeats.
 *
 * So the counter is a row, and it is incremented inside a transaction.
 */
export async function nextNumber(
  series: "INV" | "RV" | "PV" | "PR" | "PO" | "GRN" | "APR",
  year = new Date().getFullYear(),
) {
  const s = await allSettings();
  const prefix = {
    INV: s["series.invoice"], RV: s["series.receipt"], PV: s["series.payment"],
    PR: s["series.request"], PO: s["series.order"], GRN: s["series.goodsReceipt"],
    APR: s["series.approval"],
  }[series];
  const key = `${series}-${year}`;

  const row = await db.$transaction(async (tx) => {
    const existing = await tx.documentSequence.findUnique({ where: { key } });
    if (!existing) return tx.documentSequence.create({ data: { key, next: 2 } });
    return tx.documentSequence.update({ where: { key }, data: { next: { increment: 1 } } });
  });
  // `next` is the value after the increment, so the number just allocated is
  // one behind it — and 1 for a series that has only now been created.
  const n = row.next - 1;
  return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}
