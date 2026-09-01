import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { PRODUCTION, QUALITY, SERVICE, SETUP } from "../../auth/scopes.js";
import { record } from "../../lib/events.js";
import { syncOrderStatus } from "../../lib/order-status.js";
import { consumeForWorkOrder } from "../../lib/stock.js";
import { refreshReadiness } from "../work/routes.js";

/**
 * Quality.
 *
 * The inspector used to close a QC stage exactly like anybody else, which made
 * "it passed" and "somebody tapped finish" the same event — so there was no
 * quality record to report on at all.
 *
 * Now a QC gate takes a verdict: it passed, it goes back to a named station, or
 * it is written off. Every verdict is its own row, because a piece can be
 * inspected, rejected, reworked and inspected again, and "how many went back"
 * is only answerable if each pass is kept.
 */

const n = (d: unknown) => Number(d ?? 0);

export default async function qualityRoutes(app: FastifyInstance) {
  // ─────────────────────────────────────────────── the vocabulary of faults
  app.get("/quality/defect-types",
    { preHandler: guard([...new Set([...PRODUCTION, ...QUALITY, ...SERVICE])]) }, async () =>
    db.defectType.findMany({ where: { isActive: true }, orderBy: { nameAr: "asc" } }));

  app.post("/quality/defect-types", { preHandler: guard(SETUP) }, async (req, reply) => {
    const b = z.object({
      code: z.string().min(1).max(24),
      nameAr: z.string().min(1), nameEn: z.string().min(1).optional(),
    }).parse(req.body);
    if (await db.defectType.findUnique({ where: { code: b.code } })) {
      return reply.code(409).send({ error: "code_taken" });
    }
    return db.defectType.create({ data: { ...b, nameEn: b.nameEn ?? b.nameAr } });
  });

  app.delete("/quality/defect-types/:id", { preHandler: guard(SETUP) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await db.defectType.findUnique({ where: { id } }))) {
      return reply.code(404).send({ error: "not_found" });
    }
    // A fault type that has been used is retired, not deleted: the defect
    // reports behind it would otherwise start describing nothing.
    const used = await db.inspectionDefect.count({ where: { defectTypeId: id } });
    if (used > 0) {
      await db.defectType.update({ where: { id }, data: { isActive: false } });
      return { removed: "retired", used };
    }
    await db.defectType.delete({ where: { id } });
    return { removed: "deleted" };
  });

  /**
   * What the inspector is standing in front of: the piece, and the stations it
   * has already been through — because a rework has to name one of them, and
   * the inspector should not have to remember the routing.
   */
  app.get("/quality/stages/:id", { preHandler: guard(QUALITY) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const stage = await db.workOrderStage.findUnique({
      where: { id },
      include: {
        routingStage: true,
        workOrder: {
          include: {
            product: true,
            orderLine: { include: { order: { include: { customer: true } } } },
            stages: { include: { routingStage: true }, orderBy: { seq: "asc" } },
          },
        },
      },
    });
    if (!stage) return reply.code(404).send({ error: "not_found" });

    const past = stage.workOrder.stages.filter((x) => x.seq < stage.seq);
    const history = await db.inspection.findMany({
      where: { workOrderId: stage.workOrderId },
      orderBy: { createdAt: "desc" },
      include: { defects: { include: { defectType: true } }, inspector: true },
    });

    return {
      stageId: stage.id,
      isQcGate: stage.routingStage.isQcGate,
      status: stage.status,
      workOrder: { id: stage.workOrderId, code: stage.workOrder.code, qty: stage.workOrder.qty },
      product: { nameAr: stage.workOrder.product.nameAr, sku: stage.workOrder.product.sku },
      order: {
        id: stage.workOrder.orderLine.orderId,
        code: stage.workOrder.orderLine.order.code,
        customer: stage.workOrder.orderLine.order.customer.name,
      },
      // Only stages already worked can be sent back to; a rework cannot go
      // forward, and offering one would be a promise the server refuses.
      reworkTargets: past.map((x) => ({
        seq: x.seq, nameAr: x.routingStage.nameAr, nameEn: x.routingStage.nameEn,
        stationId: x.routingStage.stationId, groupId: x.groupId, status: x.status,
      })),
      history: history.map((h) => ({
        id: h.id, result: h.result, qty: h.qty, reworkToSeq: h.reworkToSeq,
        note: h.note, at: h.createdAt, by: h.inspector?.nameAr ?? null,
        defects: h.defects.map((d) => ({
          nameAr: d.defectType.nameAr, code: d.defectType.code, qty: d.qty, note: d.note,
        })),
      })),
    };
  });

  /**
   * The verdict.
   *
   * PASS finishes the gate. REWORK reopens the named station and puts the gate
   * back in the queue behind it. SCRAP stops the piece.
   */
  app.post("/quality/stages/:id/verdict", { preHandler: guard(QUALITY) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const b = z.object({
      result: z.enum(["PASS", "REWORK", "SCRAP"]),
      qty: z.number().int().positive().optional(),
      /** Which station it goes back to, by its sequence in the routing. */
      reworkToSeq: z.number().int().positive().optional(),
      note: z.string().max(500).optional(),
      defects: z.array(z.object({
        defectTypeId: z.string(),
        qty: z.number().int().positive().default(1),
        /**
         * Who is answerable — not always where it was found. Null is accepted
         * as well as absent, because the screen sends back the stage it read,
         * and a stage worked by no named crew has a null there.
         */
        stationId: z.string().nullable().optional(),
        groupId: z.string().nullable().optional(),
        note: z.string().max(300).optional(),
      })).default([]),
    }).parse(req.body);

    const stage = await db.workOrderStage.findUnique({
      where: { id },
      include: {
        routingStage: true,
        workOrder: { include: { orderLine: true, stages: true } },
      },
    });
    if (!stage) return reply.code(404).send({ error: "not_found" });
    if (!stage.routingStage.isQcGate) return reply.code(400).send({ error: "not_a_qc_gate" });
    if (stage.status !== "IN_PROGRESS") return reply.code(409).send({ error: "not_running" });

    // Sending it back needs somewhere to send it, and a fault needs naming.
    if (b.result === "REWORK") {
      if (b.reworkToSeq === undefined) return reply.code(400).send({ error: "rework_target_required" });
      if (b.reworkToSeq >= stage.seq) return reply.code(400).send({ error: "rework_must_go_back" });
      if (!stage.workOrder.stages.some((x) => x.seq === b.reworkToSeq)) {
        return reply.code(404).send({ error: "stage_not_found" });
      }
    }
    if (b.result !== "PASS" && b.defects.length === 0) {
      return reply.code(400).send({ error: "defect_required" });
    }
    if (b.defects.length) {
      const ids = b.defects.map((d) => d.defectTypeId);
      const found = await db.defectType.findMany({ where: { id: { in: ids } } });
      if (found.length !== new Set(ids).size) {
        return reply.code(404).send({ error: "defect_type_not_found" });
      }
    }

    const qty = b.qty ?? stage.workOrder.qty;
    const inspection = await db.inspection.create({
      data: {
        stageId: id, workOrderId: stage.workOrderId, result: b.result, qty,
        reworkToSeq: b.result === "REWORK" ? b.reworkToSeq! : null,
        note: b.note ?? null, inspectorId: user.id,
        defects: {
          create: b.defects.map((d) => ({
            defectTypeId: d.defectTypeId, qty: d.qty,
            stationId: d.stationId ?? null, groupId: d.groupId ?? null,
            note: d.note ?? null,
          })),
        },
      },
      include: { defects: true },
    });

    const at = new Date();
    const orderId = stage.workOrder.orderLine.orderId;

    if (b.result === "PASS") {
      const mins = stage.startedAt
        ? Math.max(0, Math.round((at.getTime() - stage.startedAt.getTime()) / 60000)) : 0;
      await db.workOrderStage.update({
        where: { id },
        data: { status: "DONE", finishedAt: at, actualMinutes: { increment: mins } },
      });
      await record({
        code: "QC_PASSED", entityType: "work_order_stage", entityId: id,
        orderId, actorId: user.id, stationId: stage.routingStage.stationId,
        payload: { qty }, isCustomerVisible: stage.routingStage.isCustomerVisible,
        occurredAt: at,
      });
      // Everything else that happens when a stage closes — opening the next
      // one, finishing the work order, consuming materials — is the finish
      // route's job, so this asks it rather than repeating it.
      await afterStageDone(stage.workOrderId, orderId, user.id);
      return { ...inspection, stageStatus: "DONE" };
    }

    if (b.result === "REWORK") {
      // The piece goes back: the named station reopens, everything after it
      // waits again, and the gate itself returns to the queue.
      await db.workOrderStage.updateMany({
        where: { workOrderId: stage.workOrderId, seq: { gte: b.reworkToSeq! } },
        data: { status: "PENDING", startedAt: null, finishedAt: null },
      });
      await db.workOrderStage.updateMany({
        where: { workOrderId: stage.workOrderId, seq: b.reworkToSeq! },
        data: { status: "READY" },
      });
      await db.workOrder.update({
        where: { id: stage.workOrderId }, data: { status: "IN_PROGRESS", actualEnd: null },
      });
      await db.orderLine.update({
        where: { id: stage.workOrder.orderLineId }, data: { status: "IN_PRODUCTION" },
      });
      await record({
        code: "QC_REWORK", entityType: "work_order_stage", entityId: id,
        orderId, actorId: user.id, stationId: stage.routingStage.stationId,
        payload: { qty, backToSeq: b.reworkToSeq, note: b.note ?? null },
        occurredAt: at,
      });
      await syncOrderStatus(orderId);
      return { ...inspection, stageStatus: "REWORK" };
    }

    // SCRAP: the piece is not going to the customer. The stage closes so the
    // floor is not left holding a job it cannot finish, and the write-off is
    // on the record with a reason.
    await db.workOrderStage.update({
      where: { id }, data: { status: "DONE", finishedAt: at },
    });
    await record({
      code: "QC_SCRAPPED", entityType: "work_order_stage", entityId: id,
      orderId, actorId: user.id, stationId: stage.routingStage.stationId,
      payload: { qty, note: b.note ?? null },
      occurredAt: at,
    });
    await afterStageDone(stage.workOrderId, orderId, user.id);
    return { ...inspection, stageStatus: "SCRAPPED" };
  });

  /**
   * تقرير الجودة — where faults come from.
   *
   * Grouped by fault, by station and by crew, because a total with nobody
   * attached to it changes nothing on the floor.
   */
  app.get("/quality/report", { preHandler: guard(PRODUCTION) }, async (req) => {
    const q = z.object({ from: z.string().optional(), to: z.string().optional() })
      .parse(req.query ?? {});
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
    to.setHours(23, 59, 59, 999);
    from.setHours(0, 0, 0, 0);

    const inspections = await db.inspection.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: {
        defects: { include: { defectType: true, station: true, group: true } },
        workOrder: { include: { product: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const passed = inspections.filter((i) => i.result === "PASS");
    const rework = inspections.filter((i) => i.result === "REWORK");
    const scrap = inspections.filter((i) => i.result === "SCRAP");
    const checked = inspections.reduce((s, i) => s + i.qty, 0);

    const tally = (key: (d: (typeof inspections)[number]["defects"][number]) => string | null) => {
      const m = new Map<string, number>();
      for (const i of inspections) {
        for (const d of i.defects) {
          const k = key(d);
          if (!k) continue;
          m.set(k, (m.get(k) ?? 0) + d.qty);
        }
      }
      return [...m.entries()]
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty);
    };

    const byProduct = new Map<string, { name: string; checked: number; failed: number }>();
    for (const i of inspections) {
      const k = i.workOrder.product.nameAr;
      const cur = byProduct.get(k) ?? { name: k, checked: 0, failed: 0 };
      cur.checked += i.qty;
      if (i.result !== "PASS") cur.failed += i.qty;
      byProduct.set(k, cur);
    }

    return {
      from, to,
      totals: {
        inspections: inspections.length,
        checked,
        passed: passed.reduce((s, i) => s + i.qty, 0),
        rework: rework.reduce((s, i) => s + i.qty, 0),
        scrap: scrap.reduce((s, i) => s + i.qty, 0),
        // The number a factory manager actually watches.
        passRate: checked > 0
          ? Math.round(passed.reduce((s, i) => s + i.qty, 0) / checked * 1000) / 10 : 0,
      },
      byDefect: tally((d) => d.defectType.nameAr),
      byStation: tally((d) => d.station?.nameAr ?? null),
      byCrew: tally((d) => d.group?.nameAr ?? null),
      byProduct: [...byProduct.values()]
        .map((p) => ({ ...p, failRate: p.checked > 0 ? Math.round(p.failed / p.checked * 1000) / 10 : 0 }))
        .sort((a, b) => b.failRate - a.failRate),
      rows: inspections.slice(0, 100).map((i) => ({
        id: i.id, at: i.createdAt, result: i.result, qty: i.qty,
        product: i.workOrder.product.nameAr, workOrder: i.workOrder.code,
        defects: i.defects.map((d) => d.defectType.nameAr).join("، ") || null,
        note: i.note,
      })),
    };
  });
}

/**
 * Everything that has to happen once a stage is genuinely done.
 *
 * The QC verdict closes a stage without going through the finish route, so
 * this is the one place that decides what follows — opening the next stage,
 * finishing the work order, consuming what it was made of.
 */
async function afterStageDone(workOrderId: string, orderId: string, actorId: string) {
  await refreshReadiness(workOrderId);

  const open = await db.workOrderStage.count({
    where: { workOrderId, status: { notIn: ["DONE", "CANCELLED"] } },
  });
  if (open > 0) return;

  const wo = await db.workOrder.findUnique({ where: { id: workOrderId } });
  if (!wo || wo.status === "DONE") return;

  await db.workOrder.update({
    where: { id: workOrderId }, data: { status: "DONE", actualEnd: new Date() },
  });
  await db.orderLine.update({ where: { id: wo.orderLineId }, data: { status: "FINISHED" } });
  await record({
    code: "PRODUCTION_FINISHED", entityType: "work_order", entityId: workOrderId,
    orderId, actorId, isCustomerVisible: true,
  });
  await syncOrderStatus(orderId);
  // The piece is built, so what it is made of has left the shelf. Best-effort:
  // a material the store is short of must never block the floor.
  await consumeForWorkOrder(workOrderId, actorId).catch(() => {});
}
