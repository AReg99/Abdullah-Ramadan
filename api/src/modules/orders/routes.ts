import type { FastifyInstance } from "fastify";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { discard, isAllowed, readUpload, storeFile } from "../../lib/uploads.js";
import { record } from "../../lib/events.js";
import { SELL } from "../../auth/scopes.js";
import { READ_ORDERS, seesMoney } from "../../auth/scopes.js";

export default async function orderRoutes(app: FastifyInstance) {
  app.get("/orders", { preHandler: guard(READ_ORDERS) }, async (req) => {
    const user = (req as any).user;
    // The factory runs the order; it does not need to know what it sold for.
    const money = seesMoney(user.role.key);
    // Showroom staff see their own showroom's orders. Everyone else, and anyone
    // not tied to a showroom, sees all of them.
    const scoped = ["SHOWROOM_MANAGER", "SALES_REP"].includes(user.role.key) && user.locationId;
    const orders = await db.order.findMany({
      where: scoped ? { showroomId: user.locationId } : {},
      orderBy: { createdAt: "desc" },
      include: { customer: true, lines: { include: { product: true } } },
    });
    return orders.map((o) => ({
      id: o.id, code: o.code, status: o.status, kind: o.kind,
      customer: o.customer.name, promisedDate: o.promisedDate,
      ...(money ? { total: Number(o.total) } : {}),
      lines: o.lines.map((l) => ({
        id: l.id, status: l.status, qty: l.qty,
        productAr: l.product.nameAr, productEn: l.product.nameEn,
      })),
    }));
  });

  /** The order timeline is a projection of the event stream, filtered by role. */
  app.get("/orders/:id", { preHandler: guard() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const order = await db.order.findUnique({
      where: { id },
      include: {
        customer: true,
        attachments: { orderBy: { uploadedAt: "asc" } },
        lines: { include: { product: true, workOrders: { include: { stages: { include: { routingStage: true, photos: true }, orderBy: { seq: "asc" } } } } } },
      },
    });
    if (!order) return reply.code(404).send({ error: "not_found" });

    const customerOnly = !READ_ORDERS.includes(user.role.key);
    const events = await db.trackingEvent.findMany({
      where: { orderId: id, ...(customerOnly ? { isCustomerVisible: true } : {}) },
      orderBy: { occurredAt: "desc" },
      include: { actor: true, station: true },
    });

    return {
      id: order.id, code: order.code, status: order.status,
      customer: { name: order.customer.name, phone: order.customer.phone },
      promisedDate: order.promisedDate,
      ...(seesMoney(user.role.key) ? { total: Number(order.total) } : {}),
      lines: order.lines.map((l) => ({
        id: l.id, qty: l.qty, status: l.status,
        productAr: l.product.nameAr, productEn: l.product.nameEn,
        workOrders: l.workOrders.map((w) => ({
          code: w.code, status: w.status,
          stages: w.stages.map((s) => ({
            seq: s.seq, status: s.status,
            nameAr: s.routingStage.nameAr, nameEn: s.routingStage.nameEn,
            actualMinutes: s.actualMinutes, stdMinutes: s.routingStage.stdMinutes,
            photos: s.photos.map((p) => ({ kind: p.kind, path: p.path })),
          })),
        })),
      })),
      attachments: order.attachments.map((a) => ({
        id: a.id, kind: a.kind, filename: a.filename, path: a.path,
        mime: a.mime, bytes: a.bytes, note: a.note, uploadedAt: a.uploadedAt,
      })),
      events: events.map((e) => ({
        id: e.id, code: e.code, occurredAt: e.occurredAt, payload: e.payload,
        actor: e.actor ? { nameAr: e.actor.nameAr, nameEn: e.actor.nameEn } : null,
        station: e.station ? { nameAr: e.station.nameAr, nameEn: e.station.nameEn } : null,
      })),
    };
  });

  /**
   * What arrived with the order: the photo of the piece to copy, the room
   * measurements, the signed quotation. Attached to the order rather than to a
   * stage, because it is true of the whole job and the factory needs it weeks
   * after the showroom took it.
   */
  app.post("/orders/:id/attachments", { preHandler: guard(SELL) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const order = await db.order.findUnique({ where: { id } });
    if (!order) return reply.code(404).send({ error: "order_not_found" });

    const { buf, filename, mime, fields } = await readUpload(req);
    if (!buf?.byteLength) return reply.code(400).send({ error: "no_file" });
    if (!isAllowed(mime)) return reply.code(415).send({ error: "unsupported_type", mime });

    const { rel } = await storeFile(buf, mime, "orders");
    try {
      const att = await db.orderAttachment.create({
        data: {
          orderId: order.id,
          kind: mime.startsWith("image/") ? "IMAGE" : "DOCUMENT",
          filename: filename.slice(0, 200),
          path: rel, mime, bytes: buf.byteLength,
          note: fields.note?.slice(0, 500) || null,
          actorId: user.id,
        },
      });
      await record({
        code: "ORDER_ATTACHMENT_ADDED", entityType: "order_attachment", entityId: att.id,
        orderId: order.id, actorId: user.id,
        payload: { filename: att.filename, kind: att.kind },
      });
      return att;
    } catch (e) {
      // Don't leave an orphan on disk if the row could not be written.
      await discard(rel);
      throw e;
    }
  });

  app.delete("/orders/:id/attachments/:attId", { preHandler: guard(SELL) }, async (req, reply) => {
    const { id, attId } = req.params as { id: string; attId: string };
    const att = await db.orderAttachment.findUnique({ where: { id: attId } });
    if (!att || att.orderId !== id) return reply.code(404).send({ error: "not_found" });
    await db.orderAttachment.delete({ where: { id: attId } });
    await discard(att.path);
    return { removed: true };
  });
}
