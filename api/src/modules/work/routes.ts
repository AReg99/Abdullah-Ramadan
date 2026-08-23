import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { record } from "../../lib/events.js";

const REASONS = ["NO_MATERIAL","MACHINE_DOWN","AWAITING_DRAWING","AWAITING_QC","AWAITING_CUSTOMER",
  "MISSING_COMPONENT","POWER","LABOUR_SHORT","OTHER"] as const;

/** A stage becomes READY only when every earlier stage is DONE. */
async function refreshReadiness(workOrderId: string) {
  const stages = await db.workOrderStage.findMany({ where: { workOrderId }, orderBy: { seq: "asc" } });
  for (const s of stages) {
    if (s.status !== "PENDING") continue;
    const earlier = stages.filter((x) => x.seq < s.seq);
    if (earlier.every((x) => x.status === "DONE")) {
      await db.workOrderStage.update({ where: { id: s.id }, data: { status: "READY" } });
    }
  }
}

export default async function workRoutes(app: FastifyInstance) {
  /** The worker's list: stages ready or already in hand at their station. */
  app.get("/work/today", { preHandler: guard() }, async (req) => {
    const user = (req as any).user;
    const stages = await db.workOrderStage.findMany({
      where: {
        status: { in: ["READY", "IN_PROGRESS", "PAUSED"] },
        routingStage: user.stationId ? { stationId: user.stationId } : {},
      },
      include: {
        routingStage: { include: { station: true } },
        workOrder: { include: { product: true, orderLine: { include: { order: true } }, labels: true } },
        photos: true,
      },
      orderBy: [{ workOrder: { priority: "desc" } }, { seq: "asc" }],
    });
    return stages.map(view);
  });

  app.get("/work/stages/:id", { preHandler: guard() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await db.workOrderStage.findUnique({
      where: { id },
      include: {
        routingStage: { include: { station: true } },
        workOrder: { include: { product: true, orderLine: { include: { order: true } }, labels: true } },
        photos: true,
      },
    });
    if (!s) return reply.code(404).send({ error: "not_found" });
    const prev = await db.workOrderStage.findFirst({
      where: { workOrderId: s.workOrderId, seq: { lt: s.seq } },
      orderBy: { seq: "desc" },
      include: { photos: true, routingStage: true },
    });
    return { ...view(s), previousAfterPhoto: prev?.photos.find((p) => p.kind === "AFTER")?.path ?? null };
  });

  /** Scanning a unit label is how a worker reaches a job. The label is the system. */
  app.get("/work/label/:serial", { preHandler: guard() }, async (req, reply) => {
    const { serial } = req.params as { serial: string };
    const label = await db.unitLabel.findUnique({ where: { serial } });
    if (!label) return reply.code(404).send({ error: "unknown_label" });
    const stage = await db.workOrderStage.findFirst({
      where: { workOrderId: label.workOrderId, status: { in: ["READY", "IN_PROGRESS", "PAUSED"] } },
      orderBy: { seq: "asc" },
    });
    if (!stage) return reply.code(409).send({ error: "no_open_stage" });
    return { stageId: stage.id };
  });

  app.post("/work/stages/:id/start", { preHandler: guard() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const s = await db.workOrderStage.findUnique({
      where: { id },
      include: { routingStage: true, workOrder: { include: { orderLine: true } }, photos: true },
    });
    if (!s) return reply.code(404).send({ error: "not_found" });
    if (s.status !== "READY") return reply.code(409).send({ error: "not_ready", status: s.status });

    // Hard gate: no Start without the arrival photo where the stage requires one.
    if (s.routingStage.photoBefore === "REQUIRED" && !s.photos.some((p) => p.kind === "BEFORE")) {
      return reply.code(428).send({ error: "photo_before_required" });
    }

    const updated = await db.workOrderStage.update({
      where: { id },
      data: { status: "IN_PROGRESS", startedAt: new Date(), assignedToId: user.id },
    });
    await db.workOrder.updateMany({
      where: { id: s.workOrderId, actualStart: null },
      data: { actualStart: new Date(), status: "IN_PROGRESS" },
    });
    await db.orderLine.update({ where: { id: s.workOrder.orderLineId }, data: { status: "IN_PRODUCTION" } });
    await record({
      code: "STAGE_STARTED", entityType: "work_order_stage", entityId: id,
      orderId: s.workOrder.orderLine.orderId, actorId: user.id, stationId: s.routingStage.stationId,
      payload: { stage: s.routingStage.key },
    });
    return updated;
  });

  app.post("/work/stages/:id/pause", { preHandler: guard() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason, note } = z.object({
      reason: z.enum(REASONS), note: z.string().optional(),
    }).parse(req.body);
    const user = (req as any).user;
    const s = await db.workOrderStage.findUnique({
      where: { id }, include: { routingStage: true, workOrder: { include: { orderLine: true } } },
    });
    if (!s) return reply.code(404).send({ error: "not_found" });
    if (s.status !== "IN_PROGRESS") return reply.code(409).send({ error: "not_running" });

    const mins = s.startedAt ? Math.round((Date.now() - s.startedAt.getTime()) / 60000) : 0;
    const updated = await db.workOrderStage.update({
      where: { id },
      data: {
        status: "PAUSED", pausedAt: new Date(), blockedReason: reason, blockedNote: note ?? null,
        actualMinutes: { increment: mins }, startedAt: null,
      },
    });
    await record({
      code: "STAGE_BLOCKED", entityType: "work_order_stage", entityId: id,
      orderId: s.workOrder.orderLine.orderId, actorId: user.id, stationId: s.routingStage.stationId,
      payload: { reason, note: note ?? null },
    });
    return updated;
  });

  app.post("/work/stages/:id/resume", { preHandler: guard() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const s = await db.workOrderStage.findUnique({
      where: { id }, include: { routingStage: true, workOrder: { include: { orderLine: true } } },
    });
    if (!s) return reply.code(404).send({ error: "not_found" });
    if (s.status !== "PAUSED") return reply.code(409).send({ error: "not_paused" });

    const blocked = s.pausedAt ? Math.round((Date.now() - s.pausedAt.getTime()) / 60000) : 0;
    const updated = await db.workOrderStage.update({
      where: { id },
      data: {
        status: "IN_PROGRESS", startedAt: new Date(), pausedAt: null,
        blockedMinutes: { increment: blocked }, blockedReason: null, blockedNote: null,
      },
    });
    await record({
      code: "STAGE_UNBLOCKED", entityType: "work_order_stage", entityId: id,
      orderId: s.workOrder.orderLine.orderId, actorId: user.id, stationId: s.routingStage.stationId,
      payload: { blockedMinutes: blocked, reason: s.blockedReason },
    });
    return updated;
  });

  app.post("/work/stages/:id/finish", { preHandler: guard() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const s = await db.workOrderStage.findUnique({
      where: { id },
      include: { routingStage: true, workOrder: { include: { orderLine: true } }, photos: true },
    });
    if (!s) return reply.code(404).send({ error: "not_found" });
    if (s.status !== "IN_PROGRESS") return reply.code(409).send({ error: "not_running" });

    // Hard gate: no Finish without the completion photo where the stage requires one.
    if (s.routingStage.photoAfter === "REQUIRED" && !s.photos.some((p) => p.kind === "AFTER")) {
      return reply.code(428).send({ error: "photo_after_required" });
    }

    const mins = s.startedAt ? Math.round((Date.now() - s.startedAt.getTime()) / 60000) : 0;
    const updated = await db.workOrderStage.update({
      where: { id },
      data: { status: "DONE", finishedAt: new Date(), actualMinutes: { increment: mins } },
    });
    await record({
      code: "STAGE_FINISHED", entityType: "work_order_stage", entityId: id,
      orderId: s.workOrder.orderLine.orderId, actorId: user.id, stationId: s.routingStage.stationId,
      payload: { stage: s.routingStage.key, minutes: updated.actualMinutes, stdMinutes: s.routingStage.stdMinutes },
      isCustomerVisible: s.routingStage.isCustomerVisible,
    });
    await refreshReadiness(s.workOrderId);

    const remaining = await db.workOrderStage.count({
      where: { workOrderId: s.workOrderId, status: { not: "DONE" } },
    });
    if (remaining === 0) {
      await db.workOrder.update({
        where: { id: s.workOrderId }, data: { status: "DONE", actualEnd: new Date() },
      });
      await db.orderLine.update({ where: { id: s.workOrder.orderLineId }, data: { status: "FINISHED" } });
      await record({
        code: "PRODUCTION_FINISHED", entityType: "work_order", entityId: s.workOrderId,
        orderId: s.workOrder.orderLine.orderId, actorId: user.id, isCustomerVisible: true,
      });
    }
    return updated;
  });
}

const view = (s: any) => ({
  id: s.id,
  seq: s.seq,
  status: s.status,
  startedAt: s.startedAt,
  actualMinutes: s.actualMinutes,
  blockedReason: s.blockedReason,
  stage: {
    key: s.routingStage.key,
    nameAr: s.routingStage.nameAr,
    nameEn: s.routingStage.nameEn,
    stdMinutes: s.routingStage.stdMinutes,
    photoBefore: s.routingStage.photoBefore,
    photoAfter: s.routingStage.photoAfter,
    station: s.routingStage.station
      ? { code: s.routingStage.station.code, nameAr: s.routingStage.station.nameAr, nameEn: s.routingStage.station.nameEn }
      : null,
  },
  workOrder: {
    id: s.workOrder.id,
    code: s.workOrder.code,
    qty: s.workOrder.qty,
    serial: s.workOrder.labels?.[0]?.serial ?? null,
    product: { sku: s.workOrder.product.sku, nameAr: s.workOrder.product.nameAr, nameEn: s.workOrder.product.nameEn },
    order: {
      code: s.workOrder.orderLine.order.code,
      promisedDate: s.workOrder.orderLine.order.promisedDate,
    },
    specNotes: s.workOrder.orderLine.specNotes,
  },
  photos: (s.photos ?? []).map((p: any) => ({ id: p.id, kind: p.kind, path: p.path })),
});
