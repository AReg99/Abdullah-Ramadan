import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../../db.js";
import { env } from "../../env.js";
import { guard } from "../../auth/jwt.js";
import { record } from "../../lib/events.js";

/**
 * Photos are the heaviest thing the system moves and the worker apps are on the
 * worst network in the business, so the image is decoupled from the event: the
 * client compresses on device, and a stage is never held up by an upload.
 */
export default async function photoRoutes(app: FastifyInstance) {
  app.post("/photos", { preHandler: guard() }, async (req, reply) => {
    const user = (req as any).user;
    const parts = req.parts();
    let buf: Buffer | null = null;
    let filename = "photo.jpg";
    const f: Record<string, string> = {};

    for await (const part of parts) {
      if (part.type === "file") {
        buf = await part.toBuffer();
        filename = part.filename || filename;
      } else {
        f[part.fieldname] = String(part.value);
      }
    }
    if (!buf) return reply.code(400).send({ error: "no_file" });
    if (!f.stageId || !f.kind) return reply.code(400).send({ error: "stageId_and_kind_required" });

    const clientEventId = f.clientEventId || randomUUID();
    const existing = await db.stagePhoto.findUnique({ where: { clientEventId } });
    if (existing) return existing; // idempotent: a retried sync is a no-op

    const stage = await db.workOrderStage.findUnique({
      where: { id: f.stageId },
      include: { routingStage: true, workOrder: { include: { orderLine: true, labels: true } } },
    });
    if (!stage) return reply.code(404).send({ error: "stage_not_found" });

    const dir = path.join(env.uploadDir, new Date().toISOString().slice(0, 10));
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}${path.extname(filename) || ".jpg"}`;
    await writeFile(path.join(dir, name), buf);
    const rel = path.posix.join(new Date().toISOString().slice(0, 10), name);

    const photo = await db.stagePhoto.create({
      data: {
        workOrderStageId: stage.id,
        workOrderId: stage.workOrderId,
        unitLabelId: stage.workOrder.labels[0]?.id ?? null,
        kind: f.kind as any,
        path: rel,
        bytes: buf.byteLength,
        width: Number(f.width ?? 0),
        height: Number(f.height ?? 0),
        // Device clock, so an offline capture keeps the minute it happened.
        capturedAt: f.capturedAt ? new Date(f.capturedAt) : new Date(),
        actorId: user.id,
        clientEventId,
        // The after photo of a customer-visible stage is the milestone image
        // on the tracking page. One capture, several uses.
        isCustomerVisible: f.kind === "AFTER" && stage.routingStage.isCustomerVisible,
      },
    });

    await record({
      code: f.kind === "BEFORE" ? "STAGE_PHOTO_BEFORE" : "STAGE_PHOTO_AFTER",
      entityType: "stage_photo", entityId: photo.id,
      orderId: stage.workOrder.orderLine.orderId, actorId: user.id,
      stationId: stage.routingStage.stationId,
      payload: { kind: f.kind, path: rel },
      occurredAt: photo.capturedAt,
      isCustomerVisible: photo.isCustomerVisible,
      clientEventId: `photo:${clientEventId}`,
    });
    return photo;
  });
}
