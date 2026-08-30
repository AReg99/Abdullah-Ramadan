import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { APPROVE, LIMITS, SELL, PURCHASING } from "../../auth/scopes.js";
import { nextNumber } from "../../lib/sequence.js";
import { APPROVAL_HOURS, checkDiscount, checkPurchaseValue, limitsFor } from "../../lib/limits.js";

/**
 * الحدود والموافقات.
 *
 * Two routes matter here and the rest is plumbing: **ask**, which anybody who
 * has hit a ceiling may call, and **decide**, which only the owner may.
 *
 * The showroom already rings the owner when a customer pushes for more off the
 * price. This does not replace that call — it records its answer, so the
 * concession has a name against it and cannot be spent twice.
 */

const n = (d: unknown) => Number(d ?? 0);

/** Who may ask for what. */
const KIND_SCOPE: Record<string, string[]> = {
  ORDER_DISCOUNT: SELL,
  PURCHASE_ORDER_VALUE: PURCHASING,
};

export default async function approvalRoutes(app: FastifyInstance) {
  // ───────────────────────────────────────────────── what I may do

  /**
   * My own ceilings.
   *
   * The showroom screen reads this before it lets a discount be typed, so the
   * rep is told where the line is rather than discovering it when the sale is
   * refused in front of the customer.
   */
  app.get("/limits/mine", { preHandler: guard() }, async (req) => {
    const user = (req as any).user;
    const l = await limitsFor(user.role.key);
    return { role: user.role.key, ...l, approvalHours: APPROVAL_HOURS };
  });

  /**
   * Every role and its ceilings.
   *
   * A role with no row has no ceiling — that is the shipped state and the
   * screen has to be able to show it, so the list is built from the roles
   * rather than from whatever rows happen to exist. The owner is left out
   * because a ceiling on the person who lifts ceilings is a loop.
   */
  app.get("/limits", { preHandler: guard(LIMITS) }, async () => {
    const [roles, rows] = await Promise.all([
      db.role.findMany({ orderBy: { key: "asc" } }),
      db.roleLimit.findMany(),
    ]);
    return roles.filter((r) => r.key !== "OWNER").map((r) => {
      const set = rows.find((x) => x.role === r.key);
      return {
        role: r.key, nameAr: r.nameAr, nameEn: r.nameEn,
        discountPct: set?.discountPct == null ? null : n(set.discountPct),
        purchaseCeiling: set?.purchaseCeiling == null ? null : n(set.purchaseCeiling),
        // Only the people who sell can give a discount, and only the people
        // who buy can commit a purchase order. Showing both to everybody
        // invites limits that can never apply.
        sells: SELL.includes(r.key),
        buys: PURCHASING.includes(r.key),
      };
    });
  });

  /**
   * Setting one.
   *
   * Null clears the ceiling rather than setting it to zero — those are
   * opposite instructions and a form that cannot say "no limit" ends up
   * saying "none allowed".
   */
  app.put("/limits/:role", { preHandler: guard(LIMITS) }, async (req, reply) => {
    const { role } = req.params as { role: string };
    const b = z.object({
      discountPct: z.number().min(0).max(100).nullable().optional(),
      purchaseCeiling: z.number().nonnegative().nullable().optional(),
    }).parse(req.body);

    // The owner grants the permissions; a ceiling on them would be a loop.
    if (role === "OWNER") return reply.code(400).send({ error: "owner_has_no_ceiling" });
    if (!(await db.role.findUnique({ where: { key: role as any } }))) {
      return reply.code(404).send({ error: "role_not_found" });
    }

    const data = {
      ...(b.discountPct !== undefined
        ? { discountPct: b.discountPct === null ? null : String(b.discountPct) }
        : {}),
      ...(b.purchaseCeiling !== undefined
        ? { purchaseCeiling: b.purchaseCeiling === null ? null : String(b.purchaseCeiling) }
        : {}),
    };
    const saved = await db.roleLimit.upsert({
      where: { role: role as any },
      create: { role: role as any, ...data },
      update: data,
    });
    return {
      role: saved.role,
      discountPct: saved.discountPct == null ? null : n(saved.discountPct),
      purchaseCeiling: saved.purchaseCeiling == null ? null : n(saved.purchaseCeiling),
    };
  });

  // ───────────────────────────────────────────────── asking

  /**
   * Asking for one.
   *
   * The request is checked against the asker's own ceiling first: somebody who
   * is already allowed does not need permission, and letting them ask anyway
   * fills the owner's inbox with questions that answer themselves.
   */
  app.post("/approvals", { preHandler: guard() }, async (req, reply) => {
    const user = (req as any).user;
    const b = z.object({
      kind: z.enum(["ORDER_DISCOUNT", "PURCHASE_ORDER_VALUE"]),
      amount: z.number().positive(),
      /** The order's gross, for a discount — the ceiling is a percent of it. */
      gross: z.number().positive().optional(),
      subject: z.string().min(1).max(200),
      reason: z.string().max(500).optional(),
    }).parse(req.body);

    const allowedRoles = KIND_SCOPE[b.kind];
    if (!allowedRoles.includes(user.role.key)) return reply.code(403).send({ error: "forbidden" });

    let ceiling: number;
    if (b.kind === "ORDER_DISCOUNT") {
      if (!b.gross) return reply.code(400).send({ error: "gross_required" });
      const c = await checkDiscount(user.role.key, b.gross, b.amount);
      if (c.ok) return reply.code(400).send({ error: "within_your_limit" });
      ceiling = c.allowed;
    } else {
      const c = await checkPurchaseValue(user.role.key, b.amount);
      if (c.ok) return reply.code(400).send({ error: "within_your_limit" });
      ceiling = c.allowed;
    }

    const made = await db.approval.create({
      data: {
        number: await nextNumber("APR"),
        kind: b.kind, amount: String(b.amount), ceiling: String(ceiling),
        subject: b.subject, reason: b.reason ?? null,
        requestedById: user.id,
        expiresAt: new Date(Date.now() + APPROVAL_HOURS * 3_600_000),
      },
      include: VIEW,
    });
    return view(made);
  });

  // ───────────────────────────────────────────────── the inbox

  /**
   * What is waiting on somebody.
   *
   * The owner sees everything; everyone else sees what they asked for, because
   * the second half of this feature is the rep being able to check whether the
   * answer has come back without ringing again.
   */
  app.get("/approvals", { preHandler: guard() }, async (req) => {
    const user = (req as any).user;
    const q = z.object({ status: z.string().optional(), mine: z.string().optional() })
      .parse(req.query ?? {});
    const owner = APPROVE.includes(user.role.key);
    const rows = await db.approval.findMany({
      where: {
        ...(q.status ? { status: q.status as any } : {}),
        ...(owner && q.mine !== "1" ? {} : { requestedById: user.id }),
      },
      orderBy: { createdAt: "desc" }, take: 100, include: VIEW,
    });
    return rows.map(view);
  });

  /**
   * How many are waiting, for the badge on the owner's nav.
   *
   * Purchase requests count too. They are a different table with their own
   * screen, but from the owner's side they are the same question — somebody is
   * standing still until an answer comes back — and splitting that across two
   * places is how one of them gets forgotten.
   */
  app.get("/approvals/waiting", { preHandler: guard(APPROVE) }, async () => {
    const now = new Date();
    const [approvals, requests] = await Promise.all([
      db.approval.count({ where: { status: "PENDING", expiresAt: { gt: now } } }),
      db.purchaseRequest.count({ where: { status: "SUBMITTED" } }),
    ]);
    return { approvals, purchaseRequests: requests, total: approvals + requests };
  });

  /**
   * Answering one.
   *
   * A refusal carries a reason for the same worn reason it does everywhere
   * else in this system: one without gets asked again tomorrow.
   */
  app.post("/approvals/:id/decide", { preHandler: guard(APPROVE) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      approve: z.boolean(),
      /** Grant less than was asked for. Haggling is the normal outcome. */
      amount: z.number().positive().optional(),
      note: z.string().max(500).optional(),
    }).parse(req.body);

    const a = await db.approval.findUnique({ where: { id } });
    if (!a) return reply.code(404).send({ error: "not_found" });
    if (a.status !== "PENDING") {
      return reply.code(409).send({ error: "already_decided", status: a.status });
    }
    if (a.expiresAt.getTime() < Date.now()) {
      await db.approval.update({ where: { id }, data: { status: "EXPIRED" } });
      return reply.code(409).send({ error: "approval_expired" });
    }
    if (!b.approve && !b.note?.trim()) {
      return reply.code(400).send({ error: "reason_required" });
    }
    // Granting more than was asked for is not a decision anybody makes on
    // purpose; it is a decimal point in the wrong place.
    if (b.amount != null && b.amount > n(a.amount) + 0.005) {
      return reply.code(400).send({ error: "more_than_asked", asked: n(a.amount) });
    }

    const saved = await db.approval.update({
      where: { id },
      data: {
        status: b.approve ? "APPROVED" : "REJECTED",
        ...(b.approve && b.amount != null ? { amount: String(b.amount) } : {}),
        decidedById: (req as any).user.id,
        decidedAt: new Date(),
        decisionNote: b.note ?? null,
        // The clock starts at the answer, not at the question: an approval
        // that sat unanswered for two days is not one you get to spend in
        // the next five minutes.
        expiresAt: new Date(Date.now() + APPROVAL_HOURS * 3_600_000),
      },
      include: VIEW,
    });
    return view(saved);
  });

  /** Withdrawing a question, when the customer walked away. */
  app.post("/approvals/:id/cancel", { preHandler: guard() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const a = await db.approval.findUnique({ where: { id } });
    if (!a) return reply.code(404).send({ error: "not_found" });
    if (a.requestedById !== user.id && !APPROVE.includes(user.role.key)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (a.status !== "PENDING") {
      return reply.code(409).send({ error: "already_decided", status: a.status });
    }
    return db.approval.update({ where: { id }, data: { status: "EXPIRED" } });
  });
}

const VIEW = {
  requestedBy: true, decidedBy: true,
  order: { select: { id: true, code: true } },
  purchaseOrder: { select: { id: true, number: true } },
};

function view(a: any) {
  return {
    id: a.id, number: a.number, kind: a.kind,
    // An approval nobody answered in time is refused by the clock. Saying so
    // here means the screen does not have to know what the clock is for.
    status: a.status === "PENDING" && a.expiresAt.getTime() < Date.now()
      ? "EXPIRED" : a.status,
    amount: n(a.amount), ceiling: n(a.ceiling),
    subject: a.subject, reason: a.reason,
    requestedBy: a.requestedBy?.nameAr ?? null,
    decidedBy: a.decidedBy?.nameAr ?? null,
    decidedAt: a.decidedAt, decisionNote: a.decisionNote,
    usedAt: a.usedAt,
    spentOn: a.order?.code ?? a.purchaseOrder?.number ?? null,
    expiresAt: a.expiresAt, createdAt: a.createdAt,
  };
}
