import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { CROSS_STATION } from "../../auth/scopes.js";
import { record } from "../../lib/events.js";
import { consumeForWorkOrder } from "../../lib/stock.js";
import { syncOrderStatus } from "../../lib/order-status.js";

const REASONS = ["NO_MATERIAL","MACHINE_DOWN","AWAITING_DRAWING","AWAITING_QC","AWAITING_CUSTOMER",
  "MISSING_COMPONENT","POWER","LABOUR_SHORT","OTHER"] as const;

/**
 * Offline envelope. The worker app queues actions locally and replays them when
 * the network returns, so every mutation carries the client's own id and the
 * device clock. Replaying is a no-op; a double tap cannot double-count.
 */
const offline = z.object({
  clientEventId: z.string().min(8).optional(),
  occurredAt: z.string().datetime().optional(),
}).optional();

type Envelope = { clientEventId?: string; occurredAt?: string };

/** Returns the stage unchanged if this exact action already landed. */
async function alreadyApplied(clientEventId: string | undefined, stageId: string) {
  if (!clientEventId) return null;
  const seen = await db.trackingEvent.findUnique({ where: { clientEventId } });
  if (!seen) return null;
  return db.workOrderStage.findUnique({ where: { id: stageId } });
}

const deviceTime = (e: Envelope | undefined) =>
  e?.occurredAt ? new Date(e.occurredAt) : new Date();

const startBody = z.object({
  clientEventId: z.string().min(8).optional(),
  occurredAt: z.string().datetime().optional(),
  /** Who was actually on the job. Defaults to the leader's whole crew. */
  workerIds: z.array(z.string()).optional(),
});

/** A leader works their group's station; other roles fall back to their own. */
async function stationFor(user: { stationId: string | null; groupId: string | null }) {
  if (user.groupId) {
    const g = await db.group.findUnique({ where: { id: user.groupId } });
    if (g) return g.stationId;
  }
  return user.stationId;
}

/** A stage becomes READY only when every earlier stage is DONE. */
/**
 * Open every stage whose predecessors are all done.
 *
 * Exported because the QC verdict closes a stage without going through the
 * finish route, and a second copy of this is how a work order ends up moving
 * on one path and stalling on the other.
 */
export async function refreshReadiness(workOrderId: string) {
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
  /** The group leader's list: stages ready or in hand at their group's station. */
  app.get("/work/today", { preHandler: guard() }, async (req) => {
    const user = (req as any).user;
    const stationId = await stationFor(user);
    if (!stationId && !CROSS_STATION.includes(user.role.key)) return [];
    const stages = await db.workOrderStage.findMany({
      where: {
        status: { in: ["READY", "IN_PROGRESS", "PAUSED"] },
        routingStage: stationId ? { stationId } : {},
      },
      include: {
        routingStage: { include: { station: true } },
        workOrder: { include: {
          // The reference picture: what the finished piece should look like.
          product: { include: { photos: { orderBy: { sortOrder: "asc" }, take: 1 } } },
          orderLine: { include: {
            order: true,
            // A change that landed after this piece was already on the bench,
            // which nobody on the floor has taken in yet. This is the thing
            // the worker most needs to know and least expects to be told.
            specChanges: { where: { seenAt: null, afterStart: true }, select: { id: true } },
            questions: { where: { answeredAt: null }, select: { id: true } },
          } }, labels: true } },
        photos: true,
        workers: { include: { user: true } },
      },
      orderBy: [{ workOrder: { priority: "desc" } }, { seq: "asc" }],
    });
    return stages.map(view);
  });

  app.get("/work/stages/:id", { preHandler: guard() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const s = await db.workOrderStage.findUnique({
      where: { id },
      include: {
        routingStage: { include: { station: true } },
        workOrder: { include: {
          // The reference picture: what the finished piece should look like.
          product: { include: { photos: { orderBy: { sortOrder: "asc" }, take: 1 } } },
          orderLine: { include: {
            order: true,
            // A change that landed after this piece was already on the bench,
            // which nobody on the floor has taken in yet. This is the thing
            // the worker most needs to know and least expects to be told.
            specChanges: { where: { seenAt: null, afterStart: true }, select: { id: true } },
            questions: { where: { answeredAt: null }, select: { id: true } },
          } }, labels: true } },
        photos: true,
        workers: { include: { user: true } },
      },
    });
    if (!s) return reply.code(404).send({ error: "not_found" });
    const prev = await db.workOrderStage.findFirst({
      where: { workOrderId: s.workOrderId, seq: { lt: s.seq } },
      orderBy: { seq: "desc" },
      include: { photos: true, routingStage: true },
    });
    // The leader picks who is on the job from their own crew.
    const crew = await db.user.findMany({
      where: { groupId: user.groupId ?? "-", isActive: true, canLogin: false },
      orderBy: { nameAr: "asc" },
    });
    /**
     * Everything about what this piece is meant to be, in the one place the
     * person making it is already looking.
     *
     * Before this the card carried a single line of free text and the product's
     * catalogue photo. The drawing the customer actually approved lived on the
     * order, where nobody at a bench has ever looked, and a spec change lived
     * in a telephone call.
     */
    const line = await db.orderLine.findUnique({
      where: { id: s.workOrder.orderLineId },
      include: {
        specs: true,
        specChanges: { orderBy: { createdAt: "desc" }, take: 10, include: { actor: true } },
        questions: {
          orderBy: { askedAt: "desc" }, take: 20,
          include: { askedBy: true, answeredBy: true },
        },
        order: { include: { attachments: { orderBy: { uploadedAt: "desc" } } } },
      },
    });
    const fields = await db.specField.findMany({
      where: { productId: s.workOrder.productId, isActive: true },
      orderBy: { position: "asc" },
    });
    const byCode = new Map((line?.specs ?? []).map((x) => [x.fieldCode, x]));

    return {
      ...view(s),
      previousAfterPhoto: prev?.photos.find((p) => p.kind === "AFTER")?.path ?? null,
      crew: crew.map((c) => ({ id: c.id, nameAr: c.nameAr, nameEn: c.nameEn })),
      specs: fields.map((f) => ({
        code: f.code, nameAr: f.nameAr, nameEn: f.nameEn, unit: f.unit,
        value: byCode.get(f.code)?.valueAr ?? "",
      })),
      // Answers to fields the product has since stopped asking for. This piece
      // was still ordered with them, so the bench still needs to see them.
      retiredSpecs: (line?.specs ?? [])
        .filter((x) => !fields.some((f) => f.code === x.fieldCode))
        .map((x) => ({ code: x.fieldCode, nameAr: x.labelAr, nameEn: x.labelEn,
                       unit: null, value: x.valueAr })),
      specChanges: (line?.specChanges ?? []).map((c) => ({
        id: c.id, nameAr: c.labelAr, nameEn: c.labelEn,
        from: c.fromAr, to: c.toAr, reason: c.reason,
        afterStart: c.afterStart, seenAt: c.seenAt,
        by: c.actor.nameAr, byEn: c.actor.nameEn, at: c.createdAt,
      })),
      questions: (line?.questions ?? []).map((q) => ({
        id: q.id, question: q.question, blocking: q.blocking,
        askedBy: q.askedBy.nameAr, askedByEn: q.askedBy.nameEn, askedAt: q.askedAt,
        answer: q.answer,
        answeredBy: q.answeredBy?.nameAr ?? null, answeredByEn: q.answeredBy?.nameEn ?? null,
        answeredAt: q.answeredAt,
      })),
      // The drawing the customer signed off, which never used to leave the
      // order screen.
      attachments: (line?.order.attachments ?? []).map((a) => ({
        id: a.id, kind: a.kind, filename: a.filename, path: a.path, note: a.note,
      })),
    };
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
    const body = startBody.parse(req.body ?? {});
    const env = body as Envelope;
    const replayed = await alreadyApplied(env?.clientEventId, id);
    if (replayed) return replayed;
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
      data: {
        status: "IN_PROGRESS", startedAt: deviceTime(env),
        assignedToId: user.id, groupId: user.groupId ?? null,
      },
    });

    // Record the crew, so output and rework stay attributable to the people who
    // did the work even though only the leader signs in.
    const crewIds = body.workerIds?.length
      ? body.workerIds
      : (await db.user.findMany({
          where: { groupId: user.groupId ?? "-", isActive: true, canLogin: false },
          select: { id: true },
        })).map((u) => u.id);
    if (crewIds.length) {
      // Replace rather than upsert: createMany's skipDuplicates is not
      // supported on SQLite, and a stage only reaches this point from READY.
      await db.stageWorker.deleteMany({ where: { workOrderStageId: id } });
      await db.stageWorker.createMany({
        data: [...new Set(crewIds)].map((userId) => ({ workOrderStageId: id, userId })),
      });
    }
    await db.workOrder.updateMany({
      where: { id: s.workOrderId, actualStart: null },
      data: { actualStart: new Date(), status: "IN_PROGRESS" },
    });
    await db.orderLine.update({ where: { id: s.workOrder.orderLineId }, data: { status: "IN_PRODUCTION" } });
    await syncOrderStatus(s.workOrder.orderLine.orderId);
    await record({
      code: "STAGE_STARTED", entityType: "work_order_stage", entityId: id,
      orderId: s.workOrder.orderLine.orderId, actorId: user.id, stationId: s.routingStage.stationId,
      payload: { stage: s.routingStage.key, crewSize: crewIds.length },
      occurredAt: deviceTime(env), clientEventId: env?.clientEventId ?? null,
    });
    return updated;
  });

  app.post("/work/stages/:id/pause", { preHandler: guard() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      reason: z.enum(REASONS), note: z.string().optional(),
      clientEventId: z.string().min(8).optional(), occurredAt: z.string().datetime().optional(),
    }).parse(req.body);
    const { reason, note } = body;
    const user = (req as any).user;
    const replayed = await alreadyApplied(body.clientEventId, id);
    if (replayed) return replayed;
    const s = await db.workOrderStage.findUnique({
      where: { id }, include: { routingStage: true, workOrder: { include: { orderLine: true } } },
    });
    if (!s) return reply.code(404).send({ error: "not_found" });
    if (s.status !== "IN_PROGRESS") return reply.code(409).send({ error: "not_running" });

    const at = deviceTime(body);
    const mins = s.startedAt ? Math.max(0, Math.round((at.getTime() - s.startedAt.getTime()) / 60000)) : 0;
    const updated = await db.workOrderStage.update({
      where: { id },
      data: {
        status: "PAUSED", pausedAt: at, blockedReason: reason, blockedNote: note ?? null,
        actualMinutes: { increment: mins }, startedAt: null,
      },
    });
    await record({
      code: "STAGE_BLOCKED", entityType: "work_order_stage", entityId: id,
      orderId: s.workOrder.orderLine.orderId, actorId: user.id, stationId: s.routingStage.stationId,
      payload: { reason, note: note ?? null },
      occurredAt: at, clientEventId: body.clientEventId ?? null,
    });
    return updated;
  });

  app.post("/work/stages/:id/resume", { preHandler: guard() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const env = offline.parse(req.body ?? {}) as Envelope | undefined;
    const replayed = await alreadyApplied(env?.clientEventId, id);
    if (replayed) return replayed;
    const s = await db.workOrderStage.findUnique({
      where: { id }, include: { routingStage: true, workOrder: { include: { orderLine: true } } },
    });
    if (!s) return reply.code(404).send({ error: "not_found" });
    if (s.status !== "PAUSED") return reply.code(409).send({ error: "not_paused" });

    const at = deviceTime(env);
    const blocked = s.pausedAt ? Math.max(0, Math.round((at.getTime() - s.pausedAt.getTime()) / 60000)) : 0;
    const updated = await db.workOrderStage.update({
      where: { id },
      data: {
        status: "IN_PROGRESS", startedAt: at, pausedAt: null,
        blockedMinutes: { increment: blocked }, blockedReason: null, blockedNote: null,
      },
    });
    await record({
      code: "STAGE_UNBLOCKED", entityType: "work_order_stage", entityId: id,
      orderId: s.workOrder.orderLine.orderId, actorId: user.id, stationId: s.routingStage.stationId,
      payload: { blockedMinutes: blocked, reason: s.blockedReason },
      occurredAt: at, clientEventId: env?.clientEventId ?? null,
    });
    return updated;
  });

  app.post("/work/stages/:id/finish", { preHandler: guard() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const env = offline.parse(req.body ?? {}) as Envelope | undefined;
    const replayed = await alreadyApplied(env?.clientEventId, id);
    if (replayed) return replayed;
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
    // A QC gate is not finished by tapping finish. Without this, "it passed"
    // and "somebody closed the stage" are the same event, and there is no
    // quality record at all.
    if (s.routingStage.isQcGate) {
      return reply.code(428).send({ error: "verdict_required" });
    }

    const at = deviceTime(env);
    const mins = s.startedAt ? Math.max(0, Math.round((at.getTime() - s.startedAt.getTime()) / 60000)) : 0;
    const updated = await db.workOrderStage.update({
      where: { id },
      data: { status: "DONE", finishedAt: at, actualMinutes: { increment: mins } },
    });
    await record({
      code: "STAGE_FINISHED", entityType: "work_order_stage", entityId: id,
      orderId: s.workOrder.orderLine.orderId, actorId: user.id, stationId: s.routingStage.stationId,
      payload: { stage: s.routingStage.key, minutes: updated.actualMinutes, stdMinutes: s.routingStage.stdMinutes },
      isCustomerVisible: s.routingStage.isCustomerVisible,
      occurredAt: at, clientEventId: env?.clientEventId ?? null,
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
      await syncOrderStatus(s.workOrder.orderLine.orderId);
      // The piece is built, so what it is made of has left the shelf.
      // Best-effort: a material the store is short of must never block the
      // floor from recording that the work is done.
      await consumeForWorkOrder(s.workOrderId, user.id).catch(() => {});
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
    // The screen has to know before the button is pressed: a QC gate takes a
    // verdict, and queueing a plain finish for one would fail silently in the
    // outbox with nobody the wiser.
    isQcGate: s.routingStage.isQcGate,
    station: s.routingStage.station
      ? { code: s.routingStage.station.code, nameAr: s.routingStage.station.nameAr, nameEn: s.routingStage.station.nameEn }
      : null,
  },
  workOrder: {
    id: s.workOrder.id,
    code: s.workOrder.code,
    qty: s.workOrder.qty,
    serial: s.workOrder.labels?.[0]?.serial ?? null,
    product: {
      sku: s.workOrder.product.sku,
      nameAr: s.workOrder.product.nameAr,
      nameEn: s.workOrder.product.nameEn,
      photo: s.workOrder.product.photos?.[0]?.path ?? null,
    },
    order: {
      code: s.workOrder.orderLine.order.code,
      promisedDate: s.workOrder.orderLine.order.promisedDate,
    },
    specNotes: s.workOrder.orderLine.specNotes,
    orderLineId: s.workOrder.orderLineId,
    /**
     * Somebody changed what this piece is meant to be after it was already
     * being made. Carried on the list as well as the card: a worker who has to
     * open a job to find out it changed will find out after they have made it.
     */
    specAlert: (s.workOrder.orderLine.specChanges ?? []).length,
    openQuestions: (s.workOrder.orderLine.questions ?? []).length,
  },
  photos: (s.photos ?? []).map((p: any) => ({ id: p.id, kind: p.kind, path: p.path })),
  workers: (s.workers ?? []).map((w: any) => ({
    id: w.user.id, nameAr: w.user.nameAr, nameEn: w.user.nameEn,
  })),
});
