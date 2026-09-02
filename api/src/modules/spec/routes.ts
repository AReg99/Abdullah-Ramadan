import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { CATALOGUE, SPEC_ANSWER, SPEC_ASK, SPEC_READ } from "../../auth/scopes.js";
import { record } from "../../lib/events.js";

/**
 * المواصفات — what a piece is meant to be, between the counter and the bench.
 *
 * The showroom takes an order and the factory makes it, and between those two
 * sentences the app previously carried one free-text box. That is where orders
 * go wrong: not because anybody is careless, but because a sentence cannot be
 * checked. "The colour was never written down" and "the colour was written down
 * and nobody read it" leave the same evidence afterwards — none — and neither
 * can be prevented by trying harder.
 *
 * Four things here, which are four holes in the same road:
 *
 *   1. A product says what has to be decided about it. An order cannot be
 *      taken with one of those blank. (Enforced in admin/orders, using
 *      `missingSpecs` below.)
 *   2. An answer can be changed after the order, and the change is recorded
 *      rather than telephoned. If the piece is already being made, the floor is
 *      told rather than finding out at delivery.
 *   3. The bench can ask the counter a question and get an answer, both of
 *      which stay on the job card and in the order's history.
 *   4. All of it reaches the worker's screen, which previously showed one grey
 *      line of notes.
 */

// ------------------------------------------------------------------ helpers

const nm = (ar: string, en: string) => ({ nameAr: ar, nameEn: en });

/** The fields a product still needs answers to, given what the line has. */
export async function missingSpecs(productId: string, given: Record<string, string>) {
  const fields = await db.specField.findMany({
    where: { productId, isActive: true, required: true },
    orderBy: { position: "asc" },
  });
  return fields
    .filter((f) => !(given[f.code] ?? "").trim())
    .map((f) => ({ code: f.code, nameAr: f.nameAr, nameEn: f.nameEn }));
}

/**
 * Write the answers for a line, and the change record for each one that moved.
 *
 * Used both when the order is taken (nothing there before, so every answer is
 * a first answer) and when the counter revises one later. Shared on purpose:
 * two code paths writing the same rows is how the history ends up with gaps in
 * it exactly where somebody later needs to look.
 */
export async function writeSpecs(opts: {
  orderLineId: string;
  productId: string;
  answers: Record<string, string>;
  actorId: string;
  orderId: string;
  reason?: string | null;
  /** Already in production: this is rework, not a correction. */
  afterStart: boolean;
}) {
  const fields = await db.specField.findMany({
    where: { productId: opts.productId, isActive: true }, orderBy: { position: "asc" },
  });
  const byCode = new Map(fields.map((f) => [f.code, f]));
  const existing = await db.lineSpec.findMany({ where: { orderLineId: opts.orderLineId } });
  const was = new Map(existing.map((e) => [e.fieldCode, e]));

  const changes: { code: string; from: string | null; to: string }[] = [];
  for (const [code, raw] of Object.entries(opts.answers)) {
    const value = (raw ?? "").trim();
    const f = byCode.get(code);
    // An answer to a field this product does not have is a client bug, not a
    // fact about the order; dropping it silently would hide it forever.
    if (!f) continue;
    const before = was.get(code);
    if (before && before.valueAr === value) continue;
    if (!before && !value) continue;

    await db.lineSpec.upsert({
      where: { orderLineId_fieldCode: { orderLineId: opts.orderLineId, fieldCode: code } },
      create: {
        orderLineId: opts.orderLineId, fieldId: f.id, fieldCode: code,
        labelAr: f.nameAr, labelEn: f.nameEn, valueAr: value, valueEn: value,
      },
      update: { valueAr: value, valueEn: value, labelAr: f.nameAr, labelEn: f.nameEn },
    });
    await db.specChange.create({
      data: {
        orderLineId: opts.orderLineId, fieldCode: code,
        labelAr: f.nameAr, labelEn: f.nameEn,
        fromAr: before?.valueAr ?? null, fromEn: before?.valueEn ?? null,
        toAr: value, toEn: value,
        reason: opts.reason ?? null, afterStart: opts.afterStart,
        actorId: opts.actorId,
      },
    });
    changes.push({ code, from: before?.valueAr ?? null, to: value });
  }

  if (changes.length) {
    await record({
      code: opts.afterStart ? "SPEC_CHANGED_IN_PRODUCTION" : "SPEC_SET",
      entityType: "order_line", entityId: opts.orderLineId,
      orderId: opts.orderId, actorId: opts.actorId,
      payload: { changes, reason: opts.reason ?? null },
      isCustomerVisible: false,
    });
  }
  return changes;
}

/** Has anybody actually started making this line? */
async function inProduction(orderLineId: string) {
  const started = await db.workOrderStage.findFirst({
    where: {
      workOrder: { orderLineId },
      OR: [{ status: "IN_PROGRESS" }, { status: "DONE" }, { NOT: { startedAt: null } }],
    },
    select: { id: true },
  });
  return !!started;
}

// ------------------------------------------------------------------- routes

export default async function specRoutes(app: FastifyInstance) {
  // ------------------------------------------------- what a product needs
  app.get("/spec/fields/:productId", { preHandler: guard(SPEC_READ) }, async (req) => {
    const { productId } = req.params as { productId: string };
    const fields = await db.specField.findMany({
      where: { productId, isActive: true },
      orderBy: { position: "asc" },
      include: { options: { orderBy: { position: "asc" } } },
    });
    return fields.map((f) => ({
      id: f.id, code: f.code, ...nm(f.nameAr, f.nameEn),
      kind: f.kind, unit: f.unit, required: f.required, position: f.position,
      options: f.options.map((o) => ({ id: o.id, ...nm(o.nameAr, o.nameEn) })),
    }));
  });

  /**
   * Define them. The whole list for one product, replaced as a set: an editor
   * that adds and removes rows one call at a time leaves the list in states
   * nobody chose if the connection drops halfway.
   */
  app.put("/spec/fields/:productId", { preHandler: guard(CATALOGUE) }, async (req, reply) => {
    const { productId } = req.params as { productId: string };
    const b = z.object({
      fields: z.array(z.object({
        code: z.string().trim().min(1).max(40)
          .regex(/^[A-Z0-9_]+$/, "code_must_be_upper_snake"),
        nameAr: z.string().trim().min(1).max(80),
        nameEn: z.string().trim().min(1).max(80),
        kind: z.enum(["CHOICE", "TEXT", "NUMBER"]).default("CHOICE"),
        unit: z.string().trim().max(12).optional(),
        required: z.boolean().default(true),
        options: z.array(z.object({
          nameAr: z.string().trim().min(1).max(80),
          nameEn: z.string().trim().min(1).max(80),
        })).default([]),
      })).max(30),
    }).parse(req.body ?? {});

    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) return reply.code(404).send({ error: "not_found" });

    const dupes = b.fields.map((f) => f.code)
      .filter((c, i, a) => a.indexOf(c) !== i);
    if (dupes.length) return reply.code(400).send({ error: "duplicate_field", detail: { dupes } });

    // A CHOICE with no options is a field nobody can answer, which would make
    // every order for this product impossible to take.
    const empty = b.fields.filter((f) => f.kind === "CHOICE" && f.options.length === 0);
    if (empty.length) {
      return reply.code(400).send({
        error: "choice_needs_options", detail: { fields: empty.map((f) => f.code) },
      });
    }

    const keep = new Set(b.fields.map((f) => f.code));
    const current = await db.specField.findMany({ where: { productId } });

    await db.$transaction(async (tx) => {
      // Retired, not deleted: answers already given point at these rows, and
      // the order they belong to still has to read correctly.
      for (const f of current) {
        if (!keep.has(f.code)) {
          await tx.specField.update({ where: { id: f.id }, data: { isActive: false } });
        }
      }
      for (const [i, f] of b.fields.entries()) {
        const row = await tx.specField.upsert({
          where: { productId_code: { productId, code: f.code } },
          create: {
            productId, code: f.code, nameAr: f.nameAr, nameEn: f.nameEn,
            kind: f.kind, unit: f.unit ?? null, required: f.required,
            position: i, isActive: true,
          },
          update: {
            nameAr: f.nameAr, nameEn: f.nameEn, kind: f.kind,
            unit: f.unit ?? null, required: f.required, position: i, isActive: true,
          },
        });
        await tx.specOption.deleteMany({ where: { fieldId: row.id } });
        if (f.options.length) {
          await tx.specOption.createMany({
            data: f.options.map((o, k) => ({
              fieldId: row.id, nameAr: o.nameAr, nameEn: o.nameEn, position: k,
            })),
          });
        }
      }
    });

    await record({
      code: "SPEC_FIELDS_SET", entityType: "product", entityId: productId,
      actorId: (req as any).user.id,
      payload: { count: b.fields.length },
    });
    return { ok: true, count: b.fields.length };
  });

  // ------------------------------------------------ what one line says today
  app.get("/spec/lines/:id", { preHandler: guard(SPEC_READ) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const line = await db.orderLine.findUnique({
      where: { id },
      include: {
        order: { include: { customer: true } },
        product: true,
        specs: true,
        specChanges: { orderBy: { createdAt: "desc" }, include: { actor: true }, take: 40 },
        questions: {
          orderBy: { askedAt: "desc" },
          include: { askedBy: true, answeredBy: true },
        },
      },
    });
    if (!line) return reply.code(404).send({ error: "not_found" });

    const fields = await db.specField.findMany({
      where: { productId: line.productId, isActive: true }, orderBy: { position: "asc" },
      include: { options: { orderBy: { position: "asc" } } },
    });
    const byCode = new Map(line.specs.map((s) => [s.fieldCode, s]));

    return {
      orderLineId: line.id,
      orderId: line.orderId,
      orderCode: line.order.code,
      customer: line.order.customer.name,
      product: { id: line.productId, ...nm(line.product.nameAr, line.product.nameEn) },
      inProduction: await inProduction(line.id),
      /** Every field the product asks for, answered or not — a blank is the point. */
      specs: fields.map((f) => {
        const a = byCode.get(f.code);
        return {
          code: f.code, ...nm(f.nameAr, f.nameEn), kind: f.kind, unit: f.unit,
          required: f.required,
          options: f.options.map((o) => ({ ...nm(o.nameAr, o.nameEn) })),
          value: a?.valueAr ?? "",
          answered: !!a?.valueAr,
        };
      }),
      /** Answers to fields the product no longer asks for, so nothing vanishes. */
      retired: line.specs
        .filter((s) => !fields.some((f) => f.code === s.fieldCode))
        .map((s) => ({ code: s.fieldCode, ...nm(s.labelAr, s.labelEn), value: s.valueAr })),
      specNotes: line.specNotes,
      changes: line.specChanges.map((c) => ({
        id: c.id, code: c.fieldCode, ...nm(c.labelAr, c.labelEn),
        from: c.fromAr, to: c.toAr, reason: c.reason,
        afterStart: c.afterStart, seenAt: c.seenAt,
        by: c.actor.nameAr, byEn: c.actor.nameEn, at: c.createdAt,
      })),
      questions: line.questions.map(viewQuestion),
    };
  });

  /**
   * Change an answer. The counter's, because it is the counter the customer
   * rang — and every move is written down, with what it was, what it became,
   * and why.
   */
  app.put("/spec/lines/:id", { preHandler: guard(SPEC_ANSWER) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      answers: z.record(z.string().max(200)),
      reason: z.string().trim().max(300).optional(),
      specNotes: z.string().max(1000).optional(),
    }).parse(req.body ?? {});

    const line = await db.orderLine.findUnique({ where: { id } });
    if (!line) return reply.code(404).send({ error: "not_found" });
    if (line.status === "CANCELLED") {
      return reply.code(409).send({ error: "line_cancelled" });
    }

    const started = await inProduction(id);
    // Changing what a piece is meant to be, once it is being made, is a
    // decision with a cost. Saying why is the least it can carry.
    if (started && !b.reason?.trim()) {
      return reply.code(400).send({ error: "reason_required_in_production" });
    }

    const changes = await writeSpecs({
      orderLineId: id, productId: line.productId, answers: b.answers,
      actorId: (req as any).user.id, orderId: line.orderId,
      reason: b.reason ?? null, afterStart: started,
    });
    if (b.specNotes !== undefined) {
      await db.orderLine.update({ where: { id }, data: { specNotes: b.specNotes || null } });
    }
    return { ok: true, changed: changes.length, afterStart: started };
  });

  // -------------------------------------------------- changes the floor owes
  /**
   * Spec changes the floor has not taken in yet. A change that lands while the
   * piece is on the bench is the one that costs money, so those come first and
   * the rest are there for context.
   */
  app.get("/spec/changes/unseen", { preHandler: guard(SPEC_READ) }, async () => {
    const rows = await db.specChange.findMany({
      where: { seenAt: null, afterStart: true },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        actor: true,
        orderLine: { include: { order: { include: { customer: true } }, product: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id, orderLineId: c.orderLineId,
      orderCode: c.orderLine.order.code,
      customer: c.orderLine.order.customer.name,
      product: { ...nm(c.orderLine.product.nameAr, c.orderLine.product.nameEn) },
      code: c.fieldCode, ...nm(c.labelAr, c.labelEn),
      from: c.fromAr, to: c.toAr, reason: c.reason,
      by: c.actor.nameAr, byEn: c.actor.nameEn, at: c.createdAt,
    }));
  });

  app.post("/spec/changes/seen", { preHandler: guard(SPEC_ASK) }, async (req) => {
    const b = z.object({ ids: z.array(z.string()).min(1).max(200) }).parse(req.body ?? {});
    const r = await db.specChange.updateMany({
      where: { id: { in: b.ids }, seenAt: null },
      data: { seenAt: new Date(), seenById: (req as any).user.id },
    });
    return { seen: r.count };
  });

  // ------------------------------------------------------------- questions
  /**
   * The bench asks. Blocking means somebody is standing still over it, which is
   * the difference between a question and an emergency.
   */
  app.post("/spec/questions", { preHandler: guard(SPEC_ASK) }, async (req, reply) => {
    const b = z.object({
      orderLineId: z.string(),
      workOrderId: z.string().optional(),
      question: z.string().trim().min(3).max(600),
      blocking: z.boolean().default(false),
    }).parse(req.body ?? {});

    const line = await db.orderLine.findUnique({ where: { id: b.orderLineId } });
    if (!line) return reply.code(404).send({ error: "not_found" });

    const q = await db.specQuestion.create({
      data: {
        orderLineId: b.orderLineId, workOrderId: b.workOrderId ?? null,
        question: b.question, blocking: b.blocking,
        askedById: (req as any).user.id,
      },
      include: { askedBy: true, answeredBy: true },
    });
    await record({
      code: "SPEC_QUESTION_ASKED", entityType: "order_line", entityId: b.orderLineId,
      orderId: line.orderId, actorId: (req as any).user.id,
      payload: { question: b.question, blocking: b.blocking },
    });
    return viewQuestion(q);
  });

  /** The counter's queue: what the factory is waiting to be told. */
  app.get("/spec/questions", { preHandler: guard(SPEC_READ) }, async (req) => {
    const q = z.object({ open: z.enum(["1", "0"]).optional() }).parse(req.query ?? {});
    const rows = await db.specQuestion.findMany({
      where: q.open === "0" ? {} : { answeredAt: null },
      // Somebody standing still first, then oldest — a question asked this
      // morning that nobody answered is worse than one asked five minutes ago.
      orderBy: [{ blocking: "desc" }, { askedAt: "asc" }],
      take: 200,
      include: {
        askedBy: true, answeredBy: true,
        orderLine: { include: { order: { include: { customer: true } }, product: true } },
      },
    });
    return rows.map((r) => ({
      ...viewQuestion(r),
      orderLineId: r.orderLineId,
      orderCode: r.orderLine.order.code,
      customer: r.orderLine.order.customer.name,
      product: { ...nm(r.orderLine.product.nameAr, r.orderLine.product.nameEn) },
    }));
  });

  app.post("/spec/questions/:id/answer", { preHandler: guard(SPEC_ANSWER) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = z.object({ answer: z.string().trim().min(1).max(600) }).parse(req.body ?? {});
      const q = await db.specQuestion.findUnique({
        where: { id }, include: { orderLine: true },
      });
      if (!q) return reply.code(404).send({ error: "not_found" });
      // Answered once. A second answer overwriting the first would leave the
      // bench having acted on something no longer in the record.
      if (q.answeredAt) return reply.code(409).send({ error: "already_answered" });

      const saved = await db.specQuestion.update({
        where: { id },
        data: {
          answer: b.answer, answeredById: (req as any).user.id, answeredAt: new Date(),
        },
        include: { askedBy: true, answeredBy: true },
      });
      await record({
        code: "SPEC_QUESTION_ANSWERED", entityType: "order_line", entityId: q.orderLineId,
        orderId: q.orderLine.orderId, actorId: (req as any).user.id,
        payload: { question: q.question, answer: b.answer },
      });
      return viewQuestion(saved);
    });
}

const viewQuestion = (q: any) => ({
  id: q.id,
  question: q.question,
  blocking: q.blocking,
  askedBy: q.askedBy?.nameAr ?? "", askedByEn: q.askedBy?.nameEn ?? "",
  askedAt: q.askedAt,
  answer: q.answer,
  answeredBy: q.answeredBy?.nameAr ?? null, answeredByEn: q.answeredBy?.nameEn ?? null,
  answeredAt: q.answeredAt,
});
