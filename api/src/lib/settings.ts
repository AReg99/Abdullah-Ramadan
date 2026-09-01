import { db } from "../db.js";

/**
 * Company configuration.
 *
 * The numbers a business changes without a deploy: the tax rate, the name on
 * the invoice, the registration number. Stored as key/value because the
 * alternative — a column per setting — is a migration every time the tax law
 * moves.
 */
export const DEFAULTS = {
  "vat.enabled": "0",
  /** Egypt's standard rate. Meaningless until vat.enabled is 1. */
  "vat.rate": "14",
  /**
   * Whether the price typed on an order already includes the tax.
   *
   * This is the decision that changes every total, so it is asked once and
   * stored rather than assumed. Egyptian retail prices are usually quoted
   * inclusive — the customer is told one number and pays it — so that is the
   * default, but a business that quotes ex-VAT flips it here.
   */
  "vat.inclusive": "1",
  "vat.number": "",
  "company.name": "أورا للأثاث",
  "company.nameEn": "Aura Furniture",
  "company.address": "٦ أكتوبر، الجيزة",
  "company.phone": "",
  "company.email": "",
  /**
   * Document number prefixes. Separate series because they are counted
   * separately on paper, and a tax authority asks about invoices without
   * caring how many receipts were written.
   */
  "series.invoice": "INV",
  "series.receipt": "RV",
  "series.payment": "PV",
  /**
   * How stock is valued: CURRENT (today's cost), AVERAGE (weighted average of
   * what was actually paid), or FIFO (what remains is the newest receipts).
   * Businesses genuinely disagree about which is honest, so it is a choice.
   */
  "stock.valuation": "CURRENT",
  /**
   * Document prefixes for the purchasing cycle. Named goodsReceipt rather than
   * receipt because series.receipt is already the money receipt voucher, and
   * reusing it would have silently renamed every RV to a GRN.
   */
  "series.request": "PR",
  "series.order": "PO",
  "series.goodsReceipt": "GRN",
  "series.approval": "APR",
  "series.service": "SRV",
  /**
   * The warranty a model carries when its own is not set. Months, from the
   * day the customer took it — not from the order, which can be six weeks
   * earlier and is not when they got anything.
   */
  "warranty.months": "24",
} as const;

export type SettingKey = keyof typeof DEFAULTS;

export async function allSettings(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany();
  const out: Record<string, string> = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** The tax rules in force right now, resolved once so callers cannot disagree. */
export async function vatPolicy() {
  const s = await allSettings();
  const rate = Number(s["vat.rate"]) || 0;
  return {
    enabled: s["vat.enabled"] === "1" && rate > 0,
    rate,
    inclusive: s["vat.inclusive"] === "1",
    number: s["vat.number"],
  };
}

/**
 * Split a set of lines into subtotal, tax and grand total.
 *
 * With tax off, or a rate of zero, the total is exactly what was typed — which
 * is what makes turning VAT on a decision rather than a surprise.
 */
export function applyVat(
  linesTotal: number,
  policy: { enabled: boolean; rate: number; inclusive: boolean },
) {
  const round = (n: number) => Math.round(n * 100) / 100;
  if (!policy.enabled) {
    return { subtotal: round(linesTotal), taxTotal: 0, total: round(linesTotal), rate: 0 };
  }
  const f = policy.rate / 100;
  if (policy.inclusive) {
    // The typed price is what the customer pays; the tax is carved out of it.
    const subtotal = round(linesTotal / (1 + f));
    return { subtotal, taxTotal: round(linesTotal - subtotal), total: round(linesTotal), rate: policy.rate };
  }
  const tax = round(linesTotal * f);
  return { subtotal: round(linesTotal), taxTotal: tax, total: round(linesTotal + tax), rate: policy.rate };
}
