import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { LEADS, LEAD_REPORT } from "../../auth/scopes.js";
import { nextNumber } from "../../lib/sequence.js";
import { allSettings, applyVat, vatPolicy } from "../../lib/settings.js";
import { checkDiscount, claimApproval } from "../../lib/limits.js";

/**
 * العملاء المحتملين وعروض الأسعار.
 *
 * The showroom could record exactly one thing: a confirmed order. A customer
 * who walked in, was given a price and said they would think about it left no
 * trace whatever — nobody could be followed up, nobody knew how many walk-ins
 * became sales, and the next quote was retyped from nothing.
 *
 * Two objects, because they answer different questions. The lead is the person
 * and the follow-up. The quotation is the paper. One lead can be quoted twice —
 * they asked for a bedroom, then a bedroom and a dressing table.
 */

const n = (d: unknown) => Number(d ?? 0);
const DAY = 86_400_000;

const SOURCES = ["WALK_IN", "PHONE", "WHATSAPP", "INSTAGRAM",
                 "FACEBOOK", "REFERRAL", "OTHER"] as const;
const LOST = ["PRICE", "LEAD_TIME", "BOUGHT_ELSEWHERE",
              "CHANGED_MIND", "NO_CONTACT", "OTHER"] as const;

export default async function leadRoutes(app: FastifyInstance) {
  // ─────────────────────────────────────────────── العملاء المحتملين

  /**
   * The board.
   *
   * Ordered by what has to be done today: anybody overdue a call first, then
   * whoever is due next, then everybody else. A list of names sorted by when
   * they walked in is a list nobody works from.
   */
  app.get("/leads", { preHandler: guard(LEADS) }, async (req) => {
    const q = z.object({
      status: z.string().optional(), mine: z.string().optional(),
      due: z.string().optional(),
    }).parse(req.query ?? {});
    const user = (req as any).user;

    const rows = await db.lead.findMany({
      where: {
        ...(q.status ? { status: q.status as any } : {}),
        ...(q.mine === "1" ? { ownerId: user.id } : {}),
        ...(q.due === "1"
          ? { nextFollowUp: { lte: new Date() }, status: { notIn: ["WON", "LOST"] } }
          : {}),
      },
      include: LEAD, orderBy: { createdAt: "desc" }, take: 300,
    });

    const now = Date.now();
    const view = rows.map(leadView);
    const rank = (l: ReturnType<typeof leadView>) => {
      if (l.status === "WON" || l.status === "LOST") return 3;
      if (l.nextFollowUp == null) return 2;
      return l.nextFollowUp.getTime() <= now ? 0 : 1;
    };
    return {
      totals: {
        open: view.filter((l) => !["WON", "LOST"].includes(l.status)).length,
        due: view.filter((l) => l.dueNow).length,
        won: view.filter((l) => l.status === "WON").length,
        lost: view.filter((l) => l.status === "LOST").length,
        noFollowUp: view.filter((l) =>
          !["WON", "LOST"].includes(l.status) && l.nextFollowUp == null).length,
      },
      rows: view.sort((a, b) =>
        rank(a) - rank(b)
        || (a.nextFollowUp?.getTime() ?? 9e15) - (b.nextFollowUp?.getTime() ?? 9e15)
        || b.createdAt.getTime() - a.createdAt.getTime()),
    };
  });

  app.get("/leads/:id", { preHandler: guard(LEADS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const l = await db.lead.findUnique({ where: { id }, include: LEAD });
    if (!l) return reply.code(404).send({ error: "not_found" });
    return leadView(l);
  });

  app.post("/leads", { preHandler: guard(LEADS) }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(1).max(120),
      phone: z.string().min(6).max(30),
      whatsapp: z.string().max(30).optional(),
      source: z.enum(SOURCES).default("WALK_IN"),
      interest: z.string().max(500).optional(),
      estimateValue: z.number().nonnegative().optional(),
      showroomId: z.string().optional(),
      ownerId: z.string().optional(),
      nextFollowUp: z.string().datetime().optional(),
      note: z.string().max(1000).optional(),
    }).parse(req.body);

    const user = (req as any).user;
    if (b.ownerId && !(await db.user.findUnique({ where: { id: b.ownerId } }))) {
      return reply.code(404).send({ error: "person_not_found" });
    }
    // Somebody who already bought from us is not a new name to be typed again.
    const existing = await db.customer.findFirst({ where: { phone: b.phone } });

    const made = await db.lead.create({
      data: {
        number: await nextNumber("LEAD"),
        name: b.name, phone: b.phone, whatsapp: b.whatsapp ?? null,
        customerId: existing?.id ?? null,
        source: b.source, interest: b.interest ?? null,
        estimateValue: b.estimateValue != null ? String(b.estimateValue) : null,
        showroomId: b.showroomId ?? user.locationId ?? null,
        // Whoever took the call, unless somebody else is named. A lead with no
        // owner is a lead nobody rings.
        ownerId: b.ownerId ?? user.id,
        nextFollowUp: b.nextFollowUp ? new Date(b.nextFollowUp) : null,
        ...(b.note ? { notes: { create: { note: b.note, actorId: user.id } } } : {}),
      },
      include: LEAD,
    });
    return leadView(made);
  });

  app.patch("/leads/:id", { preHandler: guard(LEADS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      name: z.string().min(1).max(120).optional(),
      phone: z.string().min(6).max(30).optional(),
      whatsapp: z.string().max(30).nullable().optional(),
      source: z.enum(SOURCES).optional(),
      status: z.enum(["NEW", "QUOTED", "NEGOTIATING"]).optional(),
      interest: z.string().max(500).nullable().optional(),
      estimateValue: z.number().nonnegative().nullable().optional(),
      ownerId: z.string().optional(),
      nextFollowUp: z.string().datetime().nullable().optional(),
    }).parse(req.body);

    const l = await db.lead.findUnique({ where: { id } });
    if (!l) return reply.code(404).send({ error: "not_found" });
    // Won and lost are endings, reached through their own routes so the reason
    // and the order behind them cannot be skipped.
    if (l.status === "WON" || l.status === "LOST") {
      return reply.code(409).send({ error: "already_settled", status: l.status });
    }
    if (b.ownerId && !(await db.user.findUnique({ where: { id: b.ownerId } }))) {
      return reply.code(404).send({ error: "person_not_found" });
    }

    const saved = await db.lead.update({
      where: { id },
      data: {
        ...(b.name ? { name: b.name } : {}),
        ...(b.phone ? { phone: b.phone } : {}),
        ...(b.whatsapp !== undefined ? { whatsapp: b.whatsapp } : {}),
        ...(b.source ? { source: b.source } : {}),
        ...(b.status ? { status: b.status } : {}),
        ...(b.interest !== undefined ? { interest: b.interest } : {}),
        ...(b.estimateValue !== undefined
          ? { estimateValue: b.estimateValue == null ? null : String(b.estimateValue) } : {}),
        ...(b.ownerId ? { ownerId: b.ownerId } : {}),
        ...(b.nextFollowUp !== undefined
          ? { nextFollowUp: b.nextFollowUp ? new Date(b.nextFollowUp) : null } : {}),
      },
      include: LEAD,
    });
    return leadView(saved);
  });

  /**
   * A conversation. Append-only — what was said in March is not edited in May,
   * and the trail is the only thing that makes a follow-up in June sensible.
   */
  app.post("/leads/:id/notes", { preHandler: guard(LEADS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      note: z.string().min(1).max(1000),
      /** Ringing somebody almost always ends in agreeing to ring again. */
      nextFollowUp: z.string().datetime().nullable().optional(),
    }).parse(req.body);

    if (!(await db.lead.findUnique({ where: { id } }))) {
      return reply.code(404).send({ error: "not_found" });
    }
    await db.leadNote.create({
      data: { leadId: id, note: b.note, actorId: (req as any).user.id },
    });
    if (b.nextFollowUp !== undefined) {
      await db.lead.update({
        where: { id },
        data: { nextFollowUp: b.nextFollowUp ? new Date(b.nextFollowUp) : null },
      });
    }
    return leadView((await db.lead.findUnique({ where: { id }, include: LEAD }))!);
  });

  /**
   * Losing one.
   *
   * A reason from a list of six rather than a free box: a reason nobody can
   * count is a reason nobody acts on, and "the price" being half of them is a
   * different decision from "the lead time" being half.
   */
  app.post("/leads/:id/lost", { preHandler: guard(LEADS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      reason: z.enum(LOST),
      note: z.string().max(500).optional(),
    }).parse(req.body);

    const l = await db.lead.findUnique({ where: { id } });
    if (!l) return reply.code(404).send({ error: "not_found" });
    if (l.status === "WON") return reply.code(409).send({ error: "already_won" });
    if (l.status === "LOST") return reply.code(409).send({ error: "already_settled" });

    const saved = await db.lead.update({
      where: { id },
      data: {
        status: "LOST", lostReason: b.reason, lostNote: b.note ?? null,
        // Nobody rings a lost lead. Leaving the date on is how a dead list
        // fills up the follow-up screen until nobody reads it.
        nextFollowUp: null,
      },
      include: LEAD,
    });
    return leadView(saved);
  });

  // ─────────────────────────────────────────────── عروض الأسعار

  app.get("/quotes", { preHandler: guard(LEADS) }, async (req) => {
    const q = z.object({ leadId: z.string().optional(), status: z.string().optional() })
      .parse(req.query ?? {});
    const rows = await db.quotation.findMany({
      where: {
        ...(q.leadId ? { leadId: q.leadId } : {}),
        ...(q.status ? { status: q.status as any } : {}),
      },
      include: QUOTE, orderBy: { createdAt: "desc" }, take: 200,
    });
    return rows.map(quoteView);
  });

  /**
   * One quote, with the letterhead — this is the page the customer is handed,
   * and it is printed in the browser like the invoice so a phone can turn it
   * into a PDF without a rendering service.
   */
  app.get("/quotes/:id", { preHandler: guard(LEADS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const qu = await db.quotation.findUnique({ where: { id }, include: QUOTE });
    if (!qu) return reply.code(404).send({ error: "not_found" });
    const s = await allSettings();
    return {
      ...quoteView(qu),
      company: {
        nameAr: s["company.name"], nameEn: s["company.nameEn"],
        address: s["company.address"], phone: s["company.phone"],
        email: s["company.email"], vatNumber: s["vat.number"],
      },
    };
  });

  /**
   * Writing a price.
   *
   * The discount ceiling applies here, not at the order. A quote is a price
   * promise on paper: letting a rep write 20% off and only refusing it when
   * the customer comes back to buy hands them a document the business will not
   * honour, which is worse than refusing at the counter.
   */
  app.post("/quotes", { preHandler: guard(LEADS) }, async (req, reply) => {
    const b = z.object({
      leadId: z.string().optional(),
      customerId: z.string().optional(),
      validUntil: z.string().datetime().optional(),
      note: z.string().max(1000).optional(),
      approvalId: z.string().optional(),
      lines: z.array(z.object({
        productId: z.string(),
        qty: z.number().int().positive().default(1),
        unitPrice: z.number().nonnegative().optional(),
        discount: z.number().nonnegative().default(0),
        specNotes: z.string().max(500).optional(),
      })).min(1),
    }).parse(req.body);

    if (!b.leadId && !b.customerId) {
      return reply.code(400).send({ error: "lead_or_customer_required" });
    }
    if (b.leadId && !(await db.lead.findUnique({ where: { id: b.leadId } }))) {
      return reply.code(404).send({ error: "lead_not_found" });
    }
    if (b.customerId && !(await db.customer.findUnique({ where: { id: b.customerId } }))) {
      return reply.code(404).send({ error: "customer_not_found" });
    }

    const products = await db.product.findMany({
      where: { id: { in: b.lines.map((l) => l.productId) } },
    });
    if (products.length !== new Set(b.lines.map((l) => l.productId)).size) {
      return reply.code(400).send({ error: "unknown_product" });
    }
    const off = products.find((p) => !p.isActive);
    if (off) return reply.code(400).send({ error: "product_not_active", sku: off.sku });

    const priceOf = (id: string) => n(products.find((p) => p.id === id)!.basePrice);
    const gross = (l: { productId: string; qty: number; unitPrice?: number }) =>
      (l.unitPrice ?? priceOf(l.productId)) * l.qty;
    const overdone = b.lines.find((l) => l.discount > gross(l) + 0.005);
    if (overdone) return reply.code(400).send({ error: "discount_exceeds_line" });

    const grossTotal = b.lines.reduce((s, l) => s + gross(l), 0);
    const discountTotal = b.lines.reduce((s, l) => s + l.discount, 0);
    const user = (req as any).user;
    const allowance = await checkDiscount(user.role.key, grossTotal, discountTotal);
    let approval: { id: string } | null = null;
    if (!allowance.ok) {
      if (!b.approvalId) {
        return reply.code(409).send({
          error: "discount_needs_approval",
          limitPct: allowance.limitPct, allowed: allowance.allowed,
          asked: allowance.asked, gross: Math.round(grossTotal * 100) / 100,
        });
      }
      const claim = await claimApproval({
        id: b.approvalId, kind: "ORDER_DISCOUNT",
        amount: discountTotal, actorId: user.id,
      });
      if (!claim.ok) return reply.code(409).send(claim);
      approval = { id: claim.approval.id };
    }

    const linesTotal = grossTotal - discountTotal;
    const tax = applyVat(linesTotal, await vatPolicy());
    const s = await allSettings();
    const days = Number(s["quote.validDays"]) || 14;

    const made = await db.quotation.create({
      data: {
        number: await nextNumber("QUO"),
        leadId: b.leadId ?? null, customerId: b.customerId ?? null,
        validUntil: b.validUntil ? new Date(b.validUntil)
                                 : new Date(Date.now() + days * DAY),
        subtotal: String(tax.subtotal), discountTotal: String(discountTotal),
        taxRate: String(tax.rate), taxTotal: String(tax.taxTotal),
        total: String(tax.total),
        note: b.note ?? null, actorId: user.id,
        lines: {
          create: b.lines.map((l) => ({
            productId: l.productId, qty: l.qty,
            unitPrice: String(l.unitPrice ?? priceOf(l.productId)),
            discount: String(l.discount), specNotes: l.specNotes ?? null,
          })),
        },
      },
      include: QUOTE,
    });

    if (approval) {
      await db.approval.update({
        where: { id: approval.id },
        data: { status: "USED", usedAt: new Date() },
      });
    }
    // Quoting somebody moves them along the board by itself: a rep who has to
    // remember to also change a status is a rep whose board goes stale.
    if (b.leadId) {
      await db.lead.updateMany({
        where: { id: b.leadId, status: "NEW" }, data: { status: "QUOTED" },
      });
    }
    return quoteView(made);
  });

  /** Handed over, so the clock on it is real. */
  app.post("/quotes/:id/sent", { preHandler: guard(LEADS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const qu = await db.quotation.findUnique({ where: { id } });
    if (!qu) return reply.code(404).send({ error: "not_found" });
    if (qu.status !== "DRAFT") {
      return reply.code(409).send({ error: "already_sent", status: qu.status });
    }
    return quoteView(await db.quotation.update({
      where: { id }, data: { status: "SENT" }, include: QUOTE,
    }));
  });

  app.post("/quotes/:id/rejected", { preHandler: guard(LEADS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const qu = await db.quotation.findUnique({ where: { id } });
    if (!qu) return reply.code(404).send({ error: "not_found" });
    if (qu.orderId) return reply.code(409).send({ error: "already_converted" });
    return quoteView(await db.quotation.update({
      where: { id }, data: { status: "REJECTED" }, include: QUOTE,
    }));
  });

  /**
   * The quote becomes the order.
   *
   * The prices are copied from the paper the customer is holding, not looked
   * up again: the whole value of a written quote is that it is still true when
   * they come back, and re-pricing at today's list would quietly break that.
   */
  app.post("/quotes/:id/convert", { preHandler: guard(LEADS) }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const qu = await db.quotation.findUnique({
      where: { id },
      include: { lines: true, lead: true, customer: true },
    });
    if (!qu) return reply.code(404).send({ error: "not_found" });
    if (qu.orderId) return reply.code(409).send({ error: "already_converted" });
    if (qu.status === "REJECTED") return reply.code(409).send({ error: "quote_rejected" });
    // An expired price is not a price. Re-quote rather than let a document from
    // March become an order in September at March's timber cost.
    if (qu.validUntil.getTime() < Date.now()) {
      return reply.code(409).send({ error: "quote_expired", validUntil: qu.validUntil });
    }

    // Whoever this is for, as a customer: the lead becomes one at the moment
    // they buy, which is the only moment the distinction stops mattering.
    let customerId = qu.customerId ?? qu.lead?.customerId ?? null;
    if (!customerId) {
      if (!qu.lead) return reply.code(400).send({ error: "lead_or_customer_required" });
      const made = await db.customer.create({
        data: { name: qu.lead.name, phone: qu.lead.phone,
                whatsapp: qu.lead.whatsapp ?? null },
      });
      customerId = made.id;
      await db.lead.update({ where: { id: qu.lead.id }, data: { customerId } });
    }

    // What the order form should be filled in with. The order itself is
    // written by the order route, which also creates the work orders, the
    // stages and the labels; the quote is linked there in the same request.
    return {
      customerId,
      quotationId: qu.id,
      leadId: qu.leadId,
      lines: qu.lines.map((l) => ({
        productId: l.productId, qty: l.qty,
        unitPrice: n(l.unitPrice), discount: n(l.discount),
        specNotes: l.specNotes ?? undefined,
      })),
    };
  });

  /**
   * تقرير التحويل — how many of the people who walked in bought something.
   *
   * The figure the showroom has never had. A month of orders says what was
   * sold; it says nothing about the four people who came in for the same
   * bedroom and went somewhere else, or why.
   */
  app.get("/leads/report", { preHandler: guard(LEAD_REPORT) }, async (req) => {
    const q = z.object({ from: z.string().optional(), to: z.string().optional() })
      .parse(req.query ?? {});
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 180 * DAY);
    const to = q.to ? new Date(`${q.to}T23:59:59`) : new Date();

    const rows = await db.lead.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { owner: true, wonOrder: { select: { total: true } } },
    });

    const settled = rows.filter((l) => l.status === "WON" || l.status === "LOST");
    const won = rows.filter((l) => l.status === "WON");
    const rate = (w: number, all: number) =>
      all > 0 ? Math.round((w / all) * 1000) / 10 : null;

    const group = <T extends string>(key: (l: any) => T | null) => {
      const m = new Map<string, { total: number; won: number; value: number }>();
      for (const l of rows) {
        const k = key(l);
        if (!k) continue;
        const cur = m.get(k) ?? { total: 0, won: 0, value: 0 };
        m.set(k, {
          total: cur.total + 1,
          won: cur.won + (l.status === "WON" ? 1 : 0),
          value: cur.value + (l.status === "WON" ? n(l.wonOrder?.total) : 0),
        });
      }
      return [...m.entries()]
        .map(([name, v]) => ({ name, ...v, value: Math.round(v.value * 100) / 100,
                               rate: rate(v.won, v.total) }))
        .sort((a, b) => b.total - a.total);
    };

    // How long they took to make their minds up, which is how long a follow-up
    // is worth continuing.
    const days = won.filter((l) => l.updatedAt)
      .map((l) => (l.updatedAt.getTime() - l.createdAt.getTime()) / DAY);

    return {
      totals: {
        leads: rows.length,
        open: rows.filter((l) => !["WON", "LOST"].includes(l.status)).length,
        won: won.length,
        lost: rows.filter((l) => l.status === "LOST").length,
        // Out of the ones that reached an answer. Counting the undecided as
        // losses reads as a collapse every time the showroom has a busy week.
        conversion: rate(won.length, settled.length),
        wonValue: Math.round(won.reduce((s, l) => s + n(l.wonOrder?.total), 0) * 100) / 100,
        avgDaysToWin: days.length
          ? Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10 : null,
      },
      bySource: group((l) => l.source),
      byRep: group((l) => l.owner?.nameAr ?? null),
      lostReasons: (() => {
        const m = new Map<string, number>();
        for (const l of rows) {
          if (l.status !== "LOST" || !l.lostReason) continue;
          m.set(l.lostReason, (m.get(l.lostReason) ?? 0) + 1);
        }
        return [...m.entries()].map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);
      })(),
    };
  });
}

const LEAD = {
  owner: true, showroom: true, customer: true,
  notes: { include: { actor: true }, orderBy: { at: "desc" as const }, take: 20 },
  quotes: { select: { id: true, number: true, status: true, total: true,
                      validUntil: true, createdAt: true },
            orderBy: { createdAt: "desc" as const } },
};

function leadView(l: any) {
  const now = Date.now();
  const live = l.status !== "WON" && l.status !== "LOST";
  return {
    id: l.id, number: l.number, name: l.name, phone: l.phone, whatsapp: l.whatsapp,
    source: l.source, status: l.status, interest: l.interest,
    estimateValue: l.estimateValue == null ? null : n(l.estimateValue),
    showroom: l.showroom?.nameAr ?? null,
    owner: l.owner?.nameAr ?? null, ownerId: l.ownerId,
    customerId: l.customerId,
    nextFollowUp: l.nextFollowUp as Date | null,
    dueNow: Boolean(live && l.nextFollowUp && l.nextFollowUp.getTime() <= now),
    lostReason: l.lostReason, lostNote: l.lostNote,
    wonOrderId: l.wonOrderId,
    createdAt: l.createdAt as Date,
    notes: (l.notes ?? []).map((x: any) => ({
      id: x.id, note: x.note, by: x.actor?.nameAr ?? null, at: x.at,
    })),
    quotes: (l.quotes ?? []).map((x: any) => ({
      id: x.id, number: x.number,
      status: x.validUntil.getTime() < now && x.status === "SENT" ? "EXPIRED" : x.status,
      total: n(x.total), validUntil: x.validUntil, createdAt: x.createdAt,
    })),
  };
}

const QUOTE = {
  lines: { include: { product: true } },
  lead: true, customer: true, actor: true,
  order: { select: { id: true, code: true } },
};

function quoteView(q: any) {
  const expired = q.validUntil.getTime() < Date.now();
  return {
    id: q.id, number: q.number,
    // Nobody sets EXPIRED; it is what the date says, and storing it would mean
    // a nightly job whose absence quietly makes old quotes look live.
    status: expired && (q.status === "SENT" || q.status === "DRAFT") ? "EXPIRED" : q.status,
    stored: q.status,
    lead: q.lead ? { id: q.lead.id, number: q.lead.number, name: q.lead.name } : null,
    customer: q.customer ? { id: q.customer.id, name: q.customer.name } : null,
    who: q.lead?.name ?? q.customer?.name ?? "—",
    phone: q.lead?.phone ?? q.customer?.phone ?? null,
    validUntil: q.validUntil, expired,
    daysLeft: Math.ceil((q.validUntil.getTime() - Date.now()) / DAY),
    subtotal: n(q.subtotal), discountTotal: n(q.discountTotal),
    taxRate: n(q.taxRate), taxTotal: n(q.taxTotal), total: n(q.total),
    note: q.note, by: q.actor?.nameAr ?? null,
    order: q.order ?? null,
    createdAt: q.createdAt,
    lines: (q.lines ?? []).map((l: any) => ({
      id: l.id, productId: l.productId,
      product: { nameAr: l.product.nameAr, nameEn: l.product.nameEn, sku: l.product.sku },
      qty: l.qty, unitPrice: n(l.unitPrice), discount: n(l.discount),
      lineTotal: Math.round((n(l.unitPrice) * l.qty - n(l.discount)) * 100) / 100,
      specNotes: l.specNotes,
    })),
  };
}
