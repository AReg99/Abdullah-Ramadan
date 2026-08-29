import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { BOOKS, COLLECT } from "../../auth/scopes.js";
import { record } from "../../lib/events.js";
import { nextNumber } from "../../lib/sequence.js";
import { receiveOnPurchase } from "../../lib/stock.js";
import { allSettings, applyVat } from "../../lib/settings.js";

/**
 * The books.
 *
 * Every movement of money is one CashEntry against one account: a collection
 * from a customer, a payment to a supplier, an expense out of the drawer. Same
 * shape, one direction field. That is what lets the cash box be re-derived from
 * the entries instead of being a running total somebody has to trust.
 *
 * Entries are never edited or deleted. A mistake is corrected by its reverse,
 * which is how a cash book stays auditable — the wrong figure and its
 * correction both remain visible, and the balance still comes out right.
 */

const money = () => z.number().finite().positive().max(1e12);
const day = () => z.string().datetime().optional();

/** Half-open [from, to): the whole of the "to" day belongs in the period. */
function period(q: any) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  from.setHours(0, 0, 0, 0);
  return { from, to: end };
}

const n = (d: unknown) => Number(d ?? 0);

/** An order's paid figure is the sum of what actually came in against it. */
async function syncPaid(orderId: string) {
  const rows = await db.cashEntry.findMany({
    where: { orderId }, select: { direction: true, amount: true, discount: true },
  });
  // A settlement discount closes the balance as surely as cash does — that is
  // the whole point of allowing one — so it counts here too.
  const paid = rows.reduce((s, r) => {
    const settled = n(r.amount) + n(r.discount);
    return s + (r.direction === "IN" ? settled : -settled);
  }, 0);
  await db.order.update({ where: { id: orderId }, data: { paidTotal: String(paid) } });
  return paid;
}

export default async function moneyRoutes(app: FastifyInstance) {
  // ───────────────────────────────────────────────────── accounts (الخزنة)
  app.get("/money/accounts", { preHandler: guard(COLLECT) }, async () => {
    const accounts = await db.cashAccount.findMany({ orderBy: { code: "asc" } });
    const sums = await db.cashEntry.groupBy({
      by: ["accountId", "direction"], _sum: { amount: true },
    });
    return accounts.map((a) => {
      const inn = n(sums.find((s) => s.accountId === a.id && s.direction === "IN")?._sum.amount);
      const out = n(sums.find((s) => s.accountId === a.id && s.direction === "OUT")?._sum.amount);
      return {
        id: a.id, code: a.code, nameAr: a.nameAr, nameEn: a.nameEn, kind: a.kind,
        isActive: a.isActive,
        openingBalance: n(a.openingBalance),
        totalIn: inn, totalOut: out,
        balance: n(a.openingBalance) + inn - out,
      };
    });
  });

  app.post("/money/accounts", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const b = z.object({
      code: z.string().min(1).max(12),
      nameAr: z.string().min(1), nameEn: z.string().min(1).optional(),
      kind: z.enum(["CASH", "BANK"]).default("CASH"),
      openingBalance: z.number().finite().default(0),
    }).parse(req.body);
    if (await db.cashAccount.findUnique({ where: { code: b.code } })) {
      return reply.code(409).send({ error: "code_taken" });
    }
    return db.cashAccount.create({
      data: { ...b, nameEn: b.nameEn ?? b.nameAr, openingBalance: String(b.openingBalance) },
    });
  });

  /**
   * What was in the drawer the day the books opened here, and the drawer's own
   * details. This is the one figure that is not derived from entries, because
   * there is nothing behind it to derive it from — the business existed before
   * the software did.
   */
  app.patch("/money/accounts/:id", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      nameAr: z.string().min(1).optional(),
      nameEn: z.string().min(1).optional(),
      openingBalance: z.number().finite().optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body ?? {});
    if (!(await db.cashAccount.findUnique({ where: { id } }))) {
      return reply.code(404).send({ error: "account_not_found" });
    }
    return db.cashAccount.update({
      where: { id },
      data: {
        ...(b.nameAr ? { nameAr: b.nameAr } : {}),
        ...(b.nameEn ? { nameEn: b.nameEn } : {}),
        ...(b.openingBalance !== undefined ? { openingBalance: String(b.openingBalance) } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
  });

  /**
   * Money into the drawer that is not a customer paying for an order: the owner
   * putting capital in, a supplier refunding, a sale of scrap. Without this the
   * cash box can only ever be right by accident — every real drawer takes money
   * from somewhere other than the till.
   */
  app.post("/money/receive", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const b = z.object({
      accountId: z.string(),
      amount: money(),
      category: z.enum(["CAPITAL", "REFUND", "OTHER_INCOME"]).default("OTHER_INCOME"),
      method: z.enum(["CASH", "BANK_TRANSFER", "INSTAPAY", "CHEQUE", "CARD"]).default("CASH"),
      occurredOn: day(),
      reference: z.string().max(80).optional(),
      note: z.string().max(300).optional(),
    }).parse(req.body);

    if (!(await db.cashAccount.findUnique({ where: { id: b.accountId } }))) {
      return reply.code(404).send({ error: "account_not_found" });
    }
    return db.cashEntry.create({
      data: {
        accountId: b.accountId, direction: "IN", amount: String(b.amount),
        method: b.method, occurredOn: b.occurredOn ? new Date(b.occurredOn) : new Date(),
        category: b.category, reference: b.reference ?? null, note: b.note ?? null,
        actorId: (req as any).user.id,
      },
    });
  });

  /**
   * Moving money between your own accounts — cash banked, cash drawn out.
   *
   * Two entries sharing one transferId, because a transfer is not income to one
   * drawer and expense from another: recorded as two unrelated movements it
   * inflates both the income and the expense figures, and every report built on
   * them is then wrong.
   */
  app.post("/money/transfer", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const b = z.object({
      fromAccountId: z.string(),
      toAccountId: z.string(),
      amount: money(),
      occurredOn: day(),
      note: z.string().max(300).optional(),
    }).parse(req.body);
    if (b.fromAccountId === b.toAccountId) {
      return reply.code(400).send({ error: "same_account" });
    }
    const [from, to] = await Promise.all([
      db.cashAccount.findUnique({ where: { id: b.fromAccountId } }),
      db.cashAccount.findUnique({ where: { id: b.toAccountId } }),
    ]);
    if (!from || !to) return reply.code(404).send({ error: "account_not_found" });

    const transferId = randomUUID();
    const on = b.occurredOn ? new Date(b.occurredOn) : new Date();
    const common = {
      amount: String(b.amount), method: "BANK_TRANSFER" as const, occurredOn: on,
      category: "TRANSFER" as const, transferId, note: b.note ?? null,
      actorId: (req as any).user.id,
    };
    const [out, inn] = await db.$transaction([
      db.cashEntry.create({ data: { ...common, accountId: from.id, direction: "OUT" } }),
      db.cashEntry.create({ data: { ...common, accountId: to.id, direction: "IN" } }),
    ]);
    return { transferId, out, in: inn };
  });

  // ───────────────────────────────────────────── collections (تحصيل من عميل)
  app.post("/money/collect", { preHandler: guard(COLLECT) }, async (req, reply) => {
    const b = z.object({
      orderId: z.string(),
      accountId: z.string(),
      amount: money(),
      /**
       * Money written off to close the balance. A customer who owes 10,000 and
       * hands over 9,500 by agreement has settled; without this the 500 sits
       * for ever as a debt nobody intends to chase.
       */
      discount: z.number().nonnegative().default(0),
      method: z.enum(["CASH", "BANK_TRANSFER", "INSTAPAY", "CHEQUE", "CARD"]).default("CASH"),
      occurredOn: day(),
      reference: z.string().max(80).optional(),
      note: z.string().max(300).optional(),
    }).parse(req.body);
    const user = (req as any).user;

    const order = await db.order.findUnique({ where: { id: b.orderId } });
    if (!order) return reply.code(404).send({ error: "order_not_found" });
    if (!(await db.cashAccount.findUnique({ where: { id: b.accountId } }))) {
      return reply.code(404).send({ error: "account_not_found" });
    }
    // The showroom collects for its own branch only, as everywhere else.
    if (["SHOWROOM_MANAGER", "SALES_REP"].includes(user.role.key) &&
        user.locationId && order.showroomId !== user.locationId) {
      return reply.code(404).send({ error: "order_not_found" });
    }

    const already = n((await db.order.findUnique({ where: { id: b.orderId } }))!.paidTotal);
    const total = n(order.total);
    // Overpaying is nearly always a typo — an extra zero — and it is far
    // cheaper to refuse it than to unpick it from the books later.
    // The discount settles part of the balance too, so it is the pair that
    // must not exceed what is owed.
    if (already + b.amount + b.discount > total + 0.005) {
      return reply.code(400).send({
        error: "exceeds_outstanding", outstanding: Math.max(0, total - already),
      });
    }

    const entry = await db.cashEntry.create({
      data: {
        accountId: b.accountId, direction: "IN", amount: String(b.amount),
        discount: String(b.discount), voucherNo: await nextNumber("RV"),
        method: b.method, occurredOn: b.occurredOn ? new Date(b.occurredOn) : new Date(),
        orderId: b.orderId, reference: b.reference ?? null, note: b.note ?? null,
        actorId: user.id,
      },
    });
    const paid = await syncPaid(b.orderId);
    await record({
      code: "PAYMENT_RECEIVED", entityType: "cash_entry", entityId: entry.id,
      orderId: b.orderId, actorId: user.id, isCustomerVisible: true,
      payload: { amount: b.amount, method: b.method, paidTotal: paid, total },
    });
    return { id: entry.id, paidTotal: paid, outstanding: total - paid };
  });

  /** Money out that is not a supplier invoice: refunds, wages, rent, fuel. */
  app.post("/money/spend", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const b = z.object({
      accountId: z.string(),
      amount: money(),
      category: z.enum(["MATERIALS", "SALARIES", "RENT", "UTILITIES", "TRANSPORT",
                        "MAINTENANCE", "MARKETING", "OTHER"]).default("OTHER"),
      method: z.enum(["CASH", "BANK_TRANSFER", "INSTAPAY", "CHEQUE", "CARD"]).default("CASH"),
      occurredOn: day(),
      purchaseInvoiceId: z.string().optional(),
      /** Named on the voucher. A payment with nobody on it is not a voucher. */
      supplierId: z.string().optional(),
      /** Settlement discount the supplier allowed us. */
      discount: z.number().nonnegative().default(0),
      reference: z.string().max(80).optional(),
      note: z.string().max(300).optional(),
    }).parse(req.body);

    if (!(await db.cashAccount.findUnique({ where: { id: b.accountId } }))) {
      return reply.code(404).send({ error: "account_not_found" });
    }
    if (b.supplierId && !(await db.supplier.findUnique({ where: { id: b.supplierId } }))) {
      return reply.code(404).send({ error: "supplier_not_found" });
    }
    if (b.purchaseInvoiceId &&
        !(await db.purchaseInvoice.findUnique({ where: { id: b.purchaseInvoiceId } }))) {
      return reply.code(404).send({ error: "invoice_not_found" });
    }
    return db.cashEntry.create({
      data: {
        accountId: b.accountId, direction: "OUT", amount: String(b.amount),
        discount: String(b.discount), voucherNo: await nextNumber("PV"),
        method: b.method, occurredOn: b.occurredOn ? new Date(b.occurredOn) : new Date(),
        category: b.category, purchaseInvoiceId: b.purchaseInvoiceId ?? null,
        supplierId: b.supplierId
          ?? (b.purchaseInvoiceId
              ? (await db.purchaseInvoice.findUnique({ where: { id: b.purchaseInvoiceId } }))!.supplierId
              : null),
        reference: b.reference ?? null, note: b.note ?? null,
        actorId: (req as any).user.id,
      },
    });
  });

  /**
   * Undo an entry by writing its opposite. Both stay on the record: a cash book
   * that can be quietly edited is not a record of anything.
   */
  app.post("/money/entries/:id/reverse", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(req.body ?? {});
    const original = await db.cashEntry.findUnique({ where: { id }, include: { reversedBy: true } });
    if (!original) return reply.code(404).send({ error: "not_found" });
    if (original.reversedBy) return reply.code(409).send({ error: "already_reversed" });
    if (original.reversesId) return reply.code(409).send({ error: "cannot_reverse_a_reversal" });

    const entry = await db.cashEntry.create({
      data: {
        accountId: original.accountId,
        direction: original.direction === "IN" ? "OUT" : "IN",
        amount: original.amount, method: original.method,
        // The discount goes back too, or reversing a settled invoice would
        // leave the written-off part still settled.
        discount: original.discount,
        voucherNo: await nextNumber(original.direction === "IN" ? "PV" : "RV"),
        occurredOn: new Date(), orderId: original.orderId,
        purchaseInvoiceId: original.purchaseInvoiceId, category: original.category,
        note: reason, reversesId: original.id, actorId: (req as any).user.id,
      },
    });
    if (original.orderId) await syncPaid(original.orderId);
    return entry;
  });

  // ───────────────────────────────────────── suppliers & purchase invoices
  app.get("/money/suppliers", { preHandler: guard(BOOKS) }, async () =>
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }));

  app.post("/money/suppliers", { preHandler: guard(BOOKS) }, async (req) => {
    const b = z.object({
      name: z.string().min(1), phone: z.string().max(30).optional(), note: z.string().max(300).optional(),
    }).parse(req.body);
    return db.supplier.create({ data: { ...b, phone: b.phone ?? null, note: b.note ?? null } });
  });

  app.post("/money/purchases", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const b = z.object({
      supplierId: z.string(),
      number: z.string().min(1).max(60),
      issuedOn: z.string().datetime(),
      warehouseId: z.string().optional(),
      /** The tax the supplier charged us. Zero for an unregistered supplier. */
      taxRate: z.number().min(0).max(100).default(0),
      note: z.string().max(300).optional(),
      /**
       * What was on their paper. An invoice with no lines is still accepted
       * with a bare amount, because half the bills a factory receives are a
       * handwritten total — refusing those would just mean they go unrecorded.
       */
      lines: z.array(z.object({
        description: z.string().min(1).max(200),
        qty: z.number().positive().default(1),
        unitPrice: z.number().nonnegative(),
        discount: z.number().nonnegative().default(0),
        warehouseId: z.string().optional(),
        /** Name a stock item and the goods land on that shelf. */
        stockItemId: z.string().optional(),
      })).default([]),
      amount: money().optional(),
      discount: z.number().nonnegative().default(0),
    }).parse(req.body);

    if (!(await db.supplier.findUnique({ where: { id: b.supplierId } }))) {
      return reply.code(404).send({ error: "supplier_not_found" });
    }
    // The same supplier cannot bill the same number twice; catching it here
    // stops the duplicate that gets paid a second time a month later.
    if (await db.purchaseInvoice.findFirst({
          where: { supplierId: b.supplierId, number: b.number } })) {
      return reply.code(409).send({ error: "invoice_number_taken" });
    }

    const fromLines = b.lines.reduce((s, l) => s + l.unitPrice * l.qty - l.discount, 0);
    const subtotal = b.lines.length ? fromLines : (b.amount ?? 0);
    const net = subtotal - b.discount;
    if (net <= 0) return reply.code(400).send({ error: "amount_required" });
    const taxTotal = Math.round(net * (b.taxRate / 100) * 100) / 100;

    const invoice = await db.purchaseInvoice.create({
      data: {
        supplierId: b.supplierId, number: b.number, issuedOn: new Date(b.issuedOn),
        warehouseId: b.warehouseId ?? null,
        subtotal: String(subtotal), discount: String(b.discount),
        taxRate: String(b.taxRate), taxTotal: String(taxTotal),
        amount: String(net + taxTotal),
        note: b.note ?? null, actorId: (req as any).user.id,
        lines: {
          create: b.lines.map((l) => ({
            description: l.description, qty: String(l.qty),
            unitPrice: String(l.unitPrice), discount: String(l.discount),
            warehouseId: l.warehouseId ?? null,
            stockItemId: l.stockItemId ?? null,
          })),
        },
      },
      include: { lines: true },
    });

    // Anything on the bill that a shelf actually holds arrives now.
    await receiveOnPurchase(invoice.id, (req as any).user.id).catch(() => {});
    return invoice;
  });

  /** One supplier bill in full, for the screen and for the printed copy. */
  app.get("/money/purchases/:id", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const inv = await db.purchaseInvoice.findUnique({
      where: { id },
      include: {
        supplier: true,
        lines: { include: { warehouse: true } },
        entries: { orderBy: { occurredOn: "asc" }, include: { account: true } },
      },
    });
    if (!inv) return reply.code(404).send({ error: "not_found" });

    const s = await allSettings();
    const paid = inv.entries.reduce(
      (t, e) => t + (e.direction === "OUT" ? n(e.amount) + n(e.discount) : -(n(e.amount) + n(e.discount))), 0);
    const store = inv.warehouseId
      ? await db.location.findUnique({ where: { id: inv.warehouseId } }) : null;

    return {
      company: {
        nameAr: s["company.name"], nameEn: s["company.nameEn"],
        address: s["company.address"], phone: s["company.phone"],
        email: s["company.email"], vatNumber: s["vat.number"],
      },
      invoice: {
        id: inv.id, number: inv.number, date: inv.issuedOn, note: inv.note,
        warehouse: store?.nameAr ?? null,
      },
      supplier: { name: inv.supplier.name, phone: inv.supplier.phone },
      lines: inv.lines.map((l) => ({
        description: l.description, qty: n(l.qty), unitPrice: n(l.unitPrice),
        discount: n(l.discount), lineTotal: n(l.unitPrice) * n(l.qty) - n(l.discount),
        warehouse: l.warehouse?.nameAr ?? null,
      })),
      totals: {
        subtotal: n(inv.subtotal), discount: n(inv.discount),
        taxRate: n(inv.taxRate), taxTotal: n(inv.taxTotal), total: n(inv.amount),
        paid, outstanding: Math.max(0, n(inv.amount) - paid),
      },
      payments: inv.entries.map((e) => ({
        voucherNo: e.voucherNo, date: e.occurredOn, amount: n(e.amount),
        discount: n(e.discount), method: e.method, account: e.account.nameAr,
      })),
    };
  });

  /**
   * One voucher — a receipt from a customer, or a payment to a supplier —
   * with everything the printed slip has to carry.
   *
   * Both directions share this route because they are the same document with
   * the name changed: a date, a party, an amount, a discount, how it was paid,
   * and room for a note. Two near-identical routes would drift.
   */
  app.get("/money/vouchers/:id", { preHandler: guard(COLLECT) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const e = await db.cashEntry.findUnique({
      where: { id },
      include: {
        account: true, actor: true, supplier: true,
        order: { include: { customer: true } },
        purchaseInvoice: { include: { supplier: true } },
      },
    });
    if (!e) return reply.code(404).send({ error: "not_found" });

    // A transfer is a movement, not a voucher — nobody signs for it.
    if (e.transferId) return reply.code(400).send({ error: "not_a_voucher" });

    const user = (req as any).user;
    // The counter prints receipts for its own branch and nothing else. The
    // books, and payments out, are not the showroom's to see.
    if (["SHOWROOM_MANAGER", "SALES_REP"].includes(user.role.key)) {
      if (e.direction !== "IN") return reply.code(403).send({ error: "forbidden" });
      if (user.locationId && e.order?.showroomId !== user.locationId) {
        return reply.code(404).send({ error: "not_found" });
      }
    }

    const s = await allSettings();
    const party = e.direction === "IN"
      ? { name: e.order?.customer.name ?? null, phone: e.order?.customer.phone ?? null }
      : { name: e.supplier?.name ?? e.purchaseInvoice?.supplier.name ?? null,
          phone: e.supplier?.phone ?? e.purchaseInvoice?.supplier.phone ?? null };

    return {
      company: {
        nameAr: s["company.name"], nameEn: s["company.nameEn"],
        address: s["company.address"], phone: s["company.phone"],
      },
      voucher: {
        id: e.id, kind: e.direction === "IN" ? "RECEIPT" : "PAYMENT",
        number: e.voucherNo, date: e.occurredOn,
        amount: n(e.amount), discount: n(e.discount),
        settled: n(e.amount) + n(e.discount),
        method: e.method, category: e.category,
        reference: e.reference, note: e.note,
        isReversal: Boolean(e.reversesId),
      },
      party,
      against: {
        orderCode: e.order?.code ?? null,
        orderInvoiceNo: e.order?.invoiceNo ?? null,
        purchaseNumber: e.purchaseInvoice?.number ?? null,
      },
      account: { nameAr: e.account.nameAr, nameEn: e.account.nameEn },
      by: e.actor?.nameAr ?? null,
    };
  });

  // ──────────────────────────────────────────────────────── payroll (المرتبات)

  /**
   * Who is on the payroll and what they are owed this month.
   *
   * A wage lives on the person, so this is a view rather than a list to be
   * maintained separately — the two would drift the first time someone got a
   * rise.
   */
  app.get("/money/payroll/:month", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const { month } = req.params as { month: string };
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return reply.code(400).send({ error: "bad_month" });
    }
    const run = await db.payrollRun.findUnique({
      where: { month },
      include: { lines: { include: { user: true } }, account: true },
    });
    // Once posted, the run is the record — not today's salaries, which may
    // have changed since. An old month must reprint as it was paid.
    if (run) {
      return {
        month, posted: true, postedAt: run.postedAt,
        account: { id: run.account.id, nameAr: run.account.nameAr, nameEn: run.account.nameEn },
        total: run.lines.reduce((s, l) => s + n(l.amount), 0),
        lines: run.lines.map((l) => ({
          userId: l.userId, nameAr: l.user.nameAr, nameEn: l.user.nameEn,
          baseSalary: n(l.baseSalary), overtime: n(l.overtime), bonus: n(l.bonus),
          advance: n(l.advance), deduction: n(l.deduction), insurance: n(l.insurance),
          amount: n(l.amount),
        })),
      };
    }
    const staff = await db.user.findMany({
      where: { isActive: true, salary: { not: null } },
      include: { role: true },
      orderBy: { nameAr: "asc" },
    });
    const adj = await db.payrollAdjustment.findMany({ where: { month } });
    const lines = staff.map((u) => {
      const a = adj.find((x) => x.userId === u.id);
      const base = n(u.salary);
      const add = n(a?.overtime) + n(a?.bonus);
      const off = n(a?.advance) + n(a?.deduction) + n(a?.insurance);
      return {
        userId: u.id, nameAr: u.nameAr, nameEn: u.nameEn, role: u.role.key,
        baseSalary: base,
        overtime: n(a?.overtime), bonus: n(a?.bonus),
        advance: n(a?.advance), deduction: n(a?.deduction), insurance: n(a?.insurance),
        // Never below zero: an advance larger than the wage is carried by the
        // next month, not clawed back out of the drawer.
        amount: Math.max(0, Math.round((base + add - off) * 100) / 100),
      };
    });
    return { month, posted: false, total: lines.reduce((s, l) => s + l.amount, 0), lines };
  });

  /**
   * What changes about one person's pay this month: overtime, a bonus, an
   * advance already handed over, a deduction, insurance withheld.
   *
   * Kept apart from the salary itself, because next month starts clean — an
   * advance taken in July must not quietly repeat in August.
   */
  app.put("/money/payroll/:month/:userId", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const { month, userId } = req.params as { month: string; userId: string };
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return reply.code(400).send({ error: "bad_month" });
    }
    if (await db.payrollRun.findUnique({ where: { month } })) {
      return reply.code(409).send({ error: "month_already_paid" });
    }
    if (!(await db.user.findUnique({ where: { id: userId } }))) {
      return reply.code(404).send({ error: "not_found" });
    }
    const b = z.object({
      overtime: z.number().nonnegative().default(0),
      bonus: z.number().nonnegative().default(0),
      advance: z.number().nonnegative().default(0),
      deduction: z.number().nonnegative().default(0),
      insurance: z.number().nonnegative().default(0),
      note: z.string().max(300).optional(),
    }).parse(req.body ?? {});
    const data = {
      overtime: String(b.overtime), bonus: String(b.bonus), advance: String(b.advance),
      deduction: String(b.deduction), insurance: String(b.insurance), note: b.note ?? null,
    };
    return db.payrollAdjustment.upsert({
      where: { month_userId: { month, userId } },
      update: data,
      create: { month, userId, ...data },
    });
  });

  /**
   * Pay the month. One entry per person so a single payslip can be reversed
   * without unpicking the rest, and unique on the month so August cannot be
   * paid twice — which is the mistake this whole record exists to prevent.
   */
  app.post("/money/payroll/:month", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const { month } = req.params as { month: string };
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return reply.code(400).send({ error: "bad_month" });
    }
    const b = z.object({
      accountId: z.string(),
      note: z.string().max(300).optional(),
      /** Leave someone out this month without touching their salary. */
      skip: z.array(z.string()).default([]),
    }).parse(req.body);

    if (await db.payrollRun.findUnique({ where: { month } })) {
      return reply.code(409).send({ error: "month_already_paid" });
    }
    if (!(await db.cashAccount.findUnique({ where: { id: b.accountId } }))) {
      return reply.code(404).send({ error: "account_not_found" });
    }
    const adj = await db.payrollAdjustment.findMany({ where: { month } });
    const staff = (await db.user.findMany({
      where: { isActive: true, salary: { not: null } },
    })).filter((u) => !b.skip.includes(u.id) && n(u.salary) > 0);
    if (staff.length === 0) return reply.code(400).send({ error: "nobody_on_payroll" });

    // One place computes a payslip, so the screen and the posting cannot
    // disagree about what somebody is owed.
    const slip = (u: (typeof staff)[number]) => {
      const a = adj.find((x) => x.userId === u.id);
      const base = n(u.salary);
      const net = base + n(a?.overtime) + n(a?.bonus)
                  - n(a?.advance) - n(a?.deduction) - n(a?.insurance);
      return {
        baseSalary: base, overtime: n(a?.overtime), bonus: n(a?.bonus),
        advance: n(a?.advance), deduction: n(a?.deduction), insurance: n(a?.insurance),
        amount: Math.max(0, Math.round(net * 100) / 100),
      };
    };

    // The last day of the month being paid: wages belong to the month worked,
    // not the day the transfer happened to clear.
    const [y, m] = month.split("-").map(Number);
    const occurredOn = new Date(Date.UTC(y, m, 0, 12));

    const run = await db.payrollRun.create({
      data: { month, accountId: b.accountId, actorId: (req as any).user.id, note: b.note ?? null },
    });
    let total = 0;
    for (const u of staff) {
      const p = slip(u);
      // Somebody whose advances swallowed the whole wage is paid nothing, and
      // no empty voucher is written for them.
      if (p.amount <= 0) continue;
      const entry = await db.cashEntry.create({
        data: {
          accountId: b.accountId, direction: "OUT", amount: String(p.amount),
          voucherNo: await nextNumber("PV"),
          method: "CASH", occurredOn, category: "SALARIES",
          note: `${month} · ${u.nameAr}`, actorId: (req as any).user.id,
        },
      });
      await db.payrollLine.create({
        data: {
          runId: run.id, userId: u.id, entryId: entry.id,
          baseSalary: String(p.baseSalary), overtime: String(p.overtime),
          bonus: String(p.bonus), advance: String(p.advance),
          deduction: String(p.deduction), insurance: String(p.insurance),
          amount: String(p.amount),
        },
      });
      total += p.amount;
    }
    return { month, paid: staff.length, total };
  });

  // ───────────────────────────────────────────────────────────── reports
  // Every one takes ?from=&to= and answers the same shape: a few totals a
  // person can read at a glance, then the rows behind them.

  /** فواتير المبيعات — what was sold, what came in, what is still owed. */
  app.get("/money/reports/sales", { preHandler: guard(BOOKS) }, async (req) => {
    const { from, to } = period(req.query);
    const orders = await db.order.findMany({
      where: { createdAt: { gte: from, lte: to }, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      include: { customer: true, showroom: true },
    });
    const rows = orders.map((o) => ({
      id: o.id, code: o.code, date: o.createdAt,
      customer: o.customer.name, showroom: o.showroom?.nameAr ?? null,
      status: o.status,
      total: n(o.total), paid: n(o.paidTotal), outstanding: n(o.total) - n(o.paidTotal),
    }));
    return {
      from, to,
      totals: {
        count: rows.length,
        total: rows.reduce((s, r) => s + r.total, 0),
        paid: rows.reduce((s, r) => s + r.paid, 0),
        outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
      },
      rows,
    };
  });

  /** فواتير المشتريات — what suppliers billed, and how much of it is settled. */
  app.get("/money/reports/purchases", { preHandler: guard(BOOKS) }, async (req) => {
    const { from, to } = period(req.query);
    const invoices = await db.purchaseInvoice.findMany({
      where: { issuedOn: { gte: from, lte: to } },
      orderBy: { issuedOn: "desc" },
      include: { supplier: true, entries: true },
    });
    const rows = invoices.map((i) => {
      const paid = i.entries.reduce(
        (s, e) => s + (e.direction === "OUT" ? n(e.amount) : -n(e.amount)), 0);
      return {
        id: i.id, number: i.number, date: i.issuedOn, supplier: i.supplier.name,
        amount: n(i.amount), paid, outstanding: n(i.amount) - paid, note: i.note,
      };
    });
    return {
      from, to,
      totals: {
        count: rows.length,
        amount: rows.reduce((s, r) => s + r.amount, 0),
        paid: rows.reduce((s, r) => s + r.paid, 0),
        outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
      },
      rows,
    };
  });

  /**
   * الخزنة — opening, everything that moved, closing. Opening is the account's
   * own opening balance plus everything before the period, so the statement
   * reconciles whatever window is asked for.
   */
  app.get("/money/reports/cashbox", { preHandler: guard(BOOKS) }, async (req) => {
    const { from, to } = period(req.query);
    const accounts = await db.cashAccount.findMany({ orderBy: { code: "asc" } });

    const before = await db.cashEntry.groupBy({
      by: ["accountId", "direction"], _sum: { amount: true },
      where: { occurredOn: { lt: from } },
    });
    const within = await db.cashEntry.findMany({
      where: { occurredOn: { gte: from, lte: to } },
      orderBy: { occurredOn: "asc" },
      include: {
        account: true,
        order: { include: { customer: true } },
        purchaseInvoice: { include: { supplier: true } },
        actor: true,
      },
    });

    const summary = accounts.map((a) => {
      const priorIn = n(before.find((b) => b.accountId === a.id && b.direction === "IN")?._sum.amount);
      const priorOut = n(before.find((b) => b.accountId === a.id && b.direction === "OUT")?._sum.amount);
      const opening = n(a.openingBalance) + priorIn - priorOut;
      const mine = within.filter((e) => e.accountId === a.id);
      const inn = mine.filter((e) => e.direction === "IN").reduce((s, e) => s + n(e.amount), 0);
      const out = mine.filter((e) => e.direction === "OUT").reduce((s, e) => s + n(e.amount), 0);
      return {
        id: a.id, code: a.code, nameAr: a.nameAr, nameEn: a.nameEn, kind: a.kind,
        opening, in: inn, out, closing: opening + inn - out,
      };
    });

    return {
      from, to,
      totals: {
        opening: summary.reduce((s, a) => s + a.opening, 0),
        in: summary.reduce((s, a) => s + a.in, 0),
        out: summary.reduce((s, a) => s + a.out, 0),
        closing: summary.reduce((s, a) => s + a.closing, 0),
      },
      accounts: summary,
      rows: within.map((e) => ({
        id: e.id, date: e.occurredOn, account: e.account.nameAr, direction: e.direction,
        amount: n(e.amount), method: e.method, category: e.category,
        orderCode: e.order?.code ?? null,
        party: e.order?.customer.name ?? e.purchaseInvoice?.supplier.name ?? null,
        invoiceNumber: e.purchaseInvoice?.number ?? null,
        reference: e.reference, note: e.note,
        reversal: Boolean(e.reversesId),
        by: e.actor?.nameAr ?? null,
      })),
    };
  });

  /** التحصيلات — money in from customers, by day and by method. */
  app.get("/money/reports/collections", { preHandler: guard(BOOKS) }, async (req) => {
    const { from, to } = period(req.query);
    const entries = await db.cashEntry.findMany({
      where: { direction: "IN", orderId: { not: null }, occurredOn: { gte: from, lte: to } },
      orderBy: { occurredOn: "desc" },
      include: { order: { include: { customer: true } }, account: true, actor: true },
    });
    const byMethod: Record<string, number> = {};
    for (const e of entries) byMethod[e.method] = (byMethod[e.method] ?? 0) + n(e.amount);
    return {
      from, to,
      totals: { count: entries.length, amount: entries.reduce((s, e) => s + n(e.amount), 0) },
      byMethod,
      rows: entries.map((e) => ({
        id: e.id, date: e.occurredOn, amount: n(e.amount), method: e.method,
        orderCode: e.order?.code ?? null, customer: e.order?.customer.name ?? null,
        account: e.account.nameAr, reference: e.reference, by: e.actor?.nameAr ?? null,
      })),
    };
  });

  /**
   * المديونيات — who still owes, and how long it has been owed. Aged from the
   * order date, which is the question actually asked when chasing money.
   */
  app.get("/money/reports/receivables", { preHandler: guard(BOOKS) }, async () => {
    const orders = await db.order.findMany({
      where: { status: { not: "CANCELLED" } },
      include: { customer: true },
      orderBy: { createdAt: "asc" },
    });
    const now = Date.now();
    const open = orders
      .map((o) => ({
        id: o.id, code: o.code, date: o.createdAt, customer: o.customer.name,
        phone: o.customer.phone, status: o.status,
        total: n(o.total), paid: n(o.paidTotal),
        outstanding: n(o.total) - n(o.paidTotal),
        ageDays: Math.floor((now - o.createdAt.getTime()) / 86_400_000),
      }))
      .filter((r) => r.outstanding > 0.005);

    const bucket = (d: number) => d <= 30 ? "d0_30" : d <= 60 ? "d31_60" : d <= 90 ? "d61_90" : "d90plus";
    const buckets: Record<string, number> = { d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    for (const r of open) buckets[bucket(r.ageDays)] += r.outstanding;

    return {
      totals: { count: open.length, outstanding: open.reduce((s, r) => s + r.outstanding, 0) },
      buckets,
      rows: open.sort((a, b) => b.ageDays - a.ageDays),
    };
  });

  /**
   * الأرباح — what was sold, what it cost to make, and what is left.
   *
   * Cost comes off the order line, captured on the day it was sold, so last
   * year's margin does not move when this year's timber does. Revenue is net of
   * tax: VAT collected is the government's money passing through, and counting
   * it as income overstates every margin on the page.
   *
   * Expenses are the period's own cash out, less anything already counted as
   * cost of goods — a supplier bill for timber is in the cost of the piece it
   * became, and adding it again would double-count it.
   */
  app.get("/money/reports/profit", { preHandler: guard(BOOKS) }, async (req) => {
    const { from, to } = period(req.query);
    const orders = await db.order.findMany({
      where: { createdAt: { gte: from, lte: to }, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      include: { customer: true, lines: true },
    });

    const rows = orders.map((o) => {
      const cost = o.lines.reduce((s, l) => s + n(l.unitCost) * l.qty, 0);
      const revenue = n(o.subtotal) || n(o.total);
      return {
        id: o.id, code: o.code, date: o.createdAt, customer: o.customer.name,
        revenue, tax: n(o.taxTotal), cost,
        profit: revenue - cost,
        margin: revenue > 0 ? Math.round((revenue - cost) / revenue * 1000) / 10 : 0,
      };
    });

    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const cogs = rows.reduce((s, r) => s + r.cost, 0);
    // Cash out in the period, excluding what is already inside cost of goods
    // and excluding transfers, which move money without spending it.
    const spend = await db.cashEntry.groupBy({
      by: ["category"], _sum: { amount: true },
      where: {
        direction: "OUT", occurredOn: { gte: from, lte: to },
        category: { notIn: ["MATERIALS", "TRANSFER"] },
      },
    });
    const expenses = spend.reduce((s, g) => s + n(g._sum.amount), 0);
    const byCategory = Object.fromEntries(
      spend.filter((g) => g.category).map((g) => [g.category!, n(g._sum.amount)]));

    return {
      from, to,
      totals: {
        revenue, cogs,
        gross: revenue - cogs,
        expenses,
        net: revenue - cogs - expenses,
        margin: revenue > 0 ? Math.round((revenue - cogs) / revenue * 1000) / 10 : 0,
      },
      byCategory,
      rows,
    };
  });

  /**
   * الضريبة — what was charged on sales in the period. A tax return needs one
   * number and the invoices behind it, and it needs them separated from the
   * money that was actually earned.
   */
  app.get("/money/reports/vat", { preHandler: guard(BOOKS) }, async (req) => {
    const { from, to } = period(req.query);
    const orders = await db.order.findMany({
      where: {
        createdAt: { gte: from, lte: to }, status: { not: "CANCELLED" },
        taxTotal: { gt: 0 },
      },
      orderBy: { createdAt: "desc" },
      include: { customer: true },
    });
    const rows = orders.map((o) => ({
      id: o.id, code: o.code, date: o.createdAt, customer: o.customer.name,
      subtotal: n(o.subtotal), rate: n(o.taxRate), tax: n(o.taxTotal), total: n(o.total),
    }));
    // Input tax: what suppliers charged us, which is deductible against what
    // we charged our own customers. A return that shows only output tax
    // overstates what is actually owed.
    const purchases = await db.purchaseInvoice.findMany({
      where: { issuedOn: { gte: from, lte: to }, taxTotal: { gt: 0 } },
      include: { supplier: true }, orderBy: { issuedOn: "desc" },
    });
    const outputTax = rows.reduce((s, r) => s + r.tax, 0);
    const inputTax = purchases.reduce((s, p) => s + n(p.taxTotal), 0);
    return {
      from, to,
      totals: {
        count: rows.length,
        subtotal: rows.reduce((s, r) => s + r.subtotal, 0),
        outputTax, inputTax,
        payable: Math.round((outputTax - inputTax) * 100) / 100,
      },
      inputRows: purchases.map((p) => ({
        id: p.id, number: p.number, date: p.issuedOn, supplier: p.supplier.name,
        subtotal: n(p.subtotal) - n(p.discount), rate: n(p.taxRate), tax: n(p.taxTotal),
      })),
      rows,
    };
  });

  /**
   * ملخص الحسابات — the whole business on one screen.
   *
   * Not another report: the answer to "how are we doing", which today needs
   * five tabs opened and four numbers held in your head. What is in the
   * drawers, what the month did, who owes us, who we owe, and the handful of
   * names behind each — enough to know whether to worry, and where to look if
   * the answer is yes.
   */
  app.get("/money/summary", { preHandler: guard(BOOKS) }, async (req) => {
    const q = z.object({ month: z.string().optional() }).parse(req.query ?? {});
    const now = new Date();
    const month = q.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month)
      ? q.month : now.toISOString().slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

    // ── what is in the drawers, right now
    const accounts = await db.cashAccount.findMany({ orderBy: { code: "asc" } });
    const sums = await db.cashEntry.groupBy({ by: ["accountId", "direction"], _sum: { amount: true } });
    const cash = accounts.map((a) => {
      const inn = n(sums.find((s) => s.accountId === a.id && s.direction === "IN")?._sum.amount);
      const out = n(sums.find((s) => s.accountId === a.id && s.direction === "OUT")?._sum.amount);
      return {
        id: a.id, nameAr: a.nameAr, nameEn: a.nameEn, kind: a.kind,
        balance: n(a.openingBalance) + inn - out,
      };
    });

    // ── what the month did
    const orders = await db.order.findMany({
      where: { createdAt: { gte: from, lte: to }, status: { not: "CANCELLED" } },
      include: { lines: true },
    });
    const sales = orders.reduce((s, o) => s + (n(o.subtotal) || n(o.total)), 0);
    const cogs = orders.reduce(
      (s, o) => s + o.lines.reduce((t, l) => t + n(l.unitCost) * l.qty, 0), 0);
    const collected = (await db.cashEntry.aggregate({
      _sum: { amount: true },
      where: { direction: "IN", orderId: { not: null }, occurredOn: { gte: from, lte: to } },
    }))._sum.amount;
    const spendRows = await db.cashEntry.groupBy({
      by: ["category"], _sum: { amount: true },
      where: {
        direction: "OUT", occurredOn: { gte: from, lte: to },
        category: { notIn: ["MATERIALS", "TRANSFER"] },
      },
    });
    const expenses = spendRows.reduce((s, g) => s + n(g._sum.amount), 0);

    // ── who owes us, and who we owe
    const openOrders = await db.order.findMany({
      where: { status: { not: "CANCELLED" } },
      include: { customer: true }, orderBy: { createdAt: "asc" },
    });
    const debts = openOrders
      .map((o) => ({
        id: o.id, code: o.code, customer: o.customer.name,
        outstanding: n(o.total) - n(o.paidTotal),
        ageDays: Math.floor((now.getTime() - o.createdAt.getTime()) / 86_400_000),
      }))
      .filter((r) => r.outstanding > 0.005);

    const bills = await db.purchaseInvoice.findMany({
      include: { supplier: true, entries: true }, orderBy: { issuedOn: "asc" },
    });
    const owed = bills
      .map((i) => {
        const paid = i.entries.reduce(
          (s, e) => s + (e.direction === "OUT" ? n(e.amount) + n(e.discount)
                                               : -(n(e.amount) + n(e.discount))), 0);
        return {
          id: i.id, number: i.number, supplier: i.supplier.name,
          outstanding: n(i.amount) - paid,
          ageDays: Math.floor((now.getTime() - i.issuedOn.getTime()) / 86_400_000),
        };
      })
      .filter((r) => r.outstanding > 0.005);

    // What is on the shelves is part of what the business is worth, and what
    // is running out is the thing an owner most wants to be told before a
    // customer asks for it.
    const stockItems = await db.stockItem.findMany({ where: { isActive: true } });
    const stockSums = await db.stockMovement.groupBy({
      by: ["itemId", "direction"], _sum: { qty: true },
    });
    const onHandOf = (id: string) =>
      n(stockSums.find((g) => g.itemId === id && g.direction === "IN")?._sum.qty)
      - n(stockSums.find((g) => g.itemId === id && g.direction === "OUT")?._sum.qty);
    const stock = stockItems.map((i) => ({
      id: i.id, name: i.nameAr, unit: i.unit,
      onHand: onHandOf(i.id), reorderLevel: n(i.reorderLevel),
      value: Math.round(onHandOf(i.id) * n(i.unitCost) * 100) / 100,
    }));
    const stockValue = Math.round(stock.reduce((s, r) => s + r.value, 0) * 100) / 100;
    const lowStock = stock
      .filter((r) => r.reorderLevel > 0 && r.onHand <= r.reorderLevel)
      .sort((a, b) => a.onHand - b.onHand)
      .slice(0, 5);

    const receivable = debts.reduce((s, r) => s + r.outstanding, 0);
    const payable = owed.reduce((s, r) => s + r.outstanding, 0);
    const inHand = cash.reduce((s, a) => s + a.balance, 0);

    return {
      month,
      cash,
      totals: {
        inHand,
        sales, cogs,
        gross: sales - cogs,
        expenses,
        profit: sales - cogs - expenses,
        collected: n(collected),
        receivable, payable, stockValue,
        // What the business is worth on paper today: the drawer plus what is
        // owed to it, less what it owes. The one number an owner asks for.
        net: inHand + receivable - payable,
      },
      // The names behind the numbers, worst first — a total with nobody
      // attached to it cannot be acted on.
      topDebtors: [...debts].sort((a, b) => b.outstanding - a.outstanding).slice(0, 5),
      oldestDebts: [...debts].sort((a, b) => b.ageDays - a.ageDays).slice(0, 5),
      topBills: [...owed].sort((a, b) => b.outstanding - a.outstanding).slice(0, 5),
      lowStock,
      byExpense: Object.fromEntries(
        spendRows.filter((g) => g.category).map((g) => [g.category!, n(g._sum.amount)])),
    };
  });

  /** كشف حساب عميل — one customer, everything billed and everything paid. */
  app.get("/money/reports/customer/:id", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const customer = await db.customer.findUnique({
      where: { id },
      include: {
        orders: {
          where: { status: { not: "CANCELLED" } },
          orderBy: { createdAt: "asc" },
          include: { payments: { orderBy: { occurredOn: "asc" } } },
        },
      },
    });
    if (!customer) return reply.code(404).send({ error: "not_found" });

    type Row = { date: Date; kind: "INVOICE" | "PAYMENT"; ref: string;
                 debit: number; credit: number; balance: number };
    const flat: Omit<Row, "balance">[] = [];
    for (const o of customer.orders) {
      flat.push({ date: o.createdAt, kind: "INVOICE", ref: o.code, debit: n(o.total), credit: 0 });
      for (const p of o.payments) {
        const amt = n(p.amount);
        flat.push({
          date: p.occurredOn, kind: "PAYMENT", ref: o.code,
          debit: p.direction === "OUT" ? amt : 0,
          credit: p.direction === "IN" ? amt : 0,
        });
      }
    }
    flat.sort((a, b) => a.date.getTime() - b.date.getTime());
    let running = 0;
    const rows: Row[] = flat.map((r) => {
      running += r.debit - r.credit;
      return { ...r, balance: running };
    });

    return {
      customer: { id: customer.id, name: customer.name, phone: customer.phone },
      totals: {
        invoiced: rows.reduce((s, r) => s + r.debit, 0),
        paid: rows.reduce((s, r) => s + r.credit, 0),
        balance: running,
      },
      rows,
    };
  });

  /**
   * The same reports as a spreadsheet. Rather than a second copy of every
   * query — which is how the printed figure and the screen figure start to
   * disagree — this asks the report route for its own answer and lays the rows
   * out as CSV, carrying the caller's own credentials so it can never widen
   * what they are allowed to read.
   */
  app.get("/money/export", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const q = z.object({
      report: z.enum(["sales", "purchases", "cashbox", "collections",
                      "receivables", "profit", "vat"]),
      from: z.string().optional(), to: z.string().optional(),
    }).parse(req.query);

    const qs = new URLSearchParams();
    if (q.from) qs.set("from", q.from);
    if (q.to) qs.set("to", q.to);
    const res = await app.inject({
      method: "GET",
      url: `/money/reports/${q.report}${qs.toString() ? `?${qs}` : ""}`,
      headers: { authorization: req.headers.authorization ?? "" },
    });
    if (res.statusCode !== 200) return reply.code(res.statusCode).send(res.json());

    const rows: Record<string, unknown>[] = res.json().rows ?? [];
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="aura-${q.report}-${stamp}.csv"`)
      .send(toCsv(rows));
  });
}

/**
 * Rows to CSV, with a BOM so Excel opens Arabic as Arabic rather than as
 * mojibake — without it every customer name arrives unreadable.
 */
function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "\uFEFF";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    // A leading =, + or - makes Excel treat the cell as a formula.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "\uFEFF" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}
