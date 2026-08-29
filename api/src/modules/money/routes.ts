import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { BOOKS, COLLECT } from "../../auth/scopes.js";
import { record } from "../../lib/events.js";

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
    where: { orderId }, select: { direction: true, amount: true },
  });
  const paid = rows.reduce((s, r) => s + (r.direction === "IN" ? n(r.amount) : -n(r.amount)), 0);
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

  // ───────────────────────────────────────────── collections (تحصيل من عميل)
  app.post("/money/collect", { preHandler: guard(COLLECT) }, async (req, reply) => {
    const b = z.object({
      orderId: z.string(),
      accountId: z.string(),
      amount: money(),
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
    if (already + b.amount > total + 0.005) {
      return reply.code(400).send({
        error: "exceeds_outstanding", outstanding: Math.max(0, total - already),
      });
    }

    const entry = await db.cashEntry.create({
      data: {
        accountId: b.accountId, direction: "IN", amount: String(b.amount),
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
      reference: z.string().max(80).optional(),
      note: z.string().max(300).optional(),
    }).parse(req.body);

    if (!(await db.cashAccount.findUnique({ where: { id: b.accountId } }))) {
      return reply.code(404).send({ error: "account_not_found" });
    }
    if (b.purchaseInvoiceId &&
        !(await db.purchaseInvoice.findUnique({ where: { id: b.purchaseInvoiceId } }))) {
      return reply.code(404).send({ error: "invoice_not_found" });
    }
    return db.cashEntry.create({
      data: {
        accountId: b.accountId, direction: "OUT", amount: String(b.amount),
        method: b.method, occurredOn: b.occurredOn ? new Date(b.occurredOn) : new Date(),
        category: b.category, purchaseInvoiceId: b.purchaseInvoiceId ?? null,
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
      amount: money(),
      note: z.string().max(300).optional(),
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
    return db.purchaseInvoice.create({
      data: {
        supplierId: b.supplierId, number: b.number, issuedOn: new Date(b.issuedOn),
        amount: String(b.amount), note: b.note ?? null, actorId: (req as any).user.id,
      },
    });
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
      report: z.enum(["sales", "purchases", "cashbox", "collections", "receivables"]),
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
