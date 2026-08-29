import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { DELIVERY } from "../../auth/scopes.js";
import { record } from "../../lib/events.js";
import { syncOrderStatus } from "../../lib/order-status.js";
import { releaseOnDelivery } from "../../lib/stock.js";
import { isAllowed, readUpload, storeFile } from "../../lib/uploads.js";

/**
 * The driver's day.
 *
 * The driver had one screen — the same board the showroom manager reads — and
 * handed pieces over with no record beyond a timestamp. No route, no phone
 * number, no photograph, no signature, and nowhere to say why a delivery did
 * not happen. Everything a delivery app exists to do was missing.
 */

const FAIL_REASONS = ["CUSTOMER_ABSENT", "REFUSED", "DAMAGED", "WRONG_ADDRESS",
                      "NO_ACCESS", "RESCHEDULED", "OTHER"] as const;

const LINE = {
  product: true,
  order: { include: { customer: true, showroom: true } },
  deliveries: { orderBy: { occurredAt: "desc" as const }, include: { driver: true } },
};

/** What the driver needs in their hand, rather than what the office reads. */
const stop = (l: any) => ({
  id: l.id,
  status: l.status,
  qty: l.qty,
  product: { nameAr: l.product.nameAr, nameEn: l.product.nameEn, sku: l.product.sku },
  order: { id: l.orderId, code: l.order.code, invoiceNo: l.order.invoiceNo },
  // The three things a driver actually needs and never had: who, where, and
  // the number to ring when the street turns out to be one-way.
  customer: {
    name: l.order.customer.name,
    phone: l.order.customer.phone,
    whatsapp: l.order.customer.whatsapp,
    address: l.order.customer.address,
  },
  showroom: l.order.showroom?.nameAr ?? null,
  promisedDate: l.promisedDate,
  specNotes: l.specNotes,
  attempts: l.deliveries.map((d: any) => ({
    id: d.id, delivered: d.delivered, failReason: d.failReason,
    recipientName: d.recipientName, note: d.note,
    photo: d.photoPath, signature: d.signaturePath,
    at: d.occurredAt, by: d.driver?.nameAr ?? null,
  })),
});

export default async function deliveryRoutes(app: FastifyInstance) {
  /**
   * تسليمات النهارده — the run.
   *
   * Two lists, because they are two different journeys: what is on the van
   * coming from the factory, and what is waiting at the showroom to go out to
   * customers. Ordered by promise date, so the ones already late are first.
   */
  app.get("/delivery/run", { preHandler: guard(DELIVERY) }, async (req) => {
    const user = (req as any).user;
    const mine = user.locationId ? { order: { showroomId: user.locationId } } : {};
    const since = new Date(Date.now() - 3 * 86_400_000);

    const [onVan, toDeliver, done] = await Promise.all([
      db.orderLine.findMany({
        where: { ...mine, status: "IN_TRANSIT" },
        include: LINE, orderBy: [{ promisedDate: "asc" }, { id: "asc" }],
      }),
      db.orderLine.findMany({
        where: { ...mine, status: "READY" },
        include: LINE, orderBy: [{ promisedDate: "asc" }, { id: "asc" }],
      }),
      db.orderLine.findMany({
        where: { ...mine, status: "DELIVERED", deliveredAt: { gte: since } },
        include: LINE, orderBy: { deliveredAt: "desc" },
      }),
    ]);

    // A delivery that was attempted and failed is still on the list — it has
    // to be, or a customer who was out once is never visited again.
    const attempted = new Set(
      (await db.deliveryAttempt.findMany({
        where: { delivered: false, orderLineId: { in: toDeliver.map((l) => l.id) } },
        select: { orderLineId: true },
      })).map((a) => a.orderLineId));

    return {
      onVan: onVan.map(stop),
      toDeliver: toDeliver.map((l) => ({ ...stop(l), retry: attempted.has(l.id) })),
      done: done.map(stop),
      totals: { onVan: onVan.length, toDeliver: toDeliver.length, done: done.length },
    };
  });

  /**
   * The proof.
   *
   * A photograph of the piece where it was left, or the customer's signature,
   * uploaded before the handover is recorded. Either is enough on its own —
   * demanding both would mean a driver standing in a stairwell unable to close
   * the job because a phone camera failed.
   */
  app.post("/delivery/proof", { preHandler: guard(DELIVERY) }, async (req, reply) => {
    const up = await readUpload(req);
    if (!up.buf) return reply.code(400).send({ error: "file_required" });
    if (!isAllowed(up.mime)) {
      return reply.code(415).send({ error: "unsupported_type", mime: up.mime });
    }
    const kind = up.fields.kind === "SIGNATURE" ? "SIGNATURE" : "PHOTO";
    const stored = await storeFile(up.buf, up.mime, "delivery");
    return { path: stored.rel, kind };
  });

  /**
   * Handed over.
   *
   * Replaces the bare deliver action for anybody on the road: the same
   * transition, plus who took it and what proves it.
   */
  app.post("/delivery/lines/:id/delivered", { preHandler: guard(DELIVERY) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const b = z.object({
      recipientName: z.string().min(1).max(120),
      note: z.string().max(500).optional(),
      photoPath: z.string().max(300).optional(),
      signaturePath: z.string().max(300).optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      occurredAt: z.string().datetime().optional(),
    }).parse(req.body);

    // Something has to prove it. A timestamp on its own is what the driver had
    // before, and it settles no argument at all.
    if (!b.photoPath && !b.signaturePath) {
      return reply.code(428).send({ error: "proof_required" });
    }

    const line = await db.orderLine.findUnique({
      where: { id }, include: { order: true },
    });
    if (!line) return reply.code(404).send({ error: "not_found" });
    if (line.status !== "READY") {
      return reply.code(409).send({ error: "not_ready", status: line.status });
    }
    if (user.locationId && line.order.showroomId !== user.locationId) {
      return reply.code(404).send({ error: "not_found" });
    }

    const at = b.occurredAt ? new Date(b.occurredAt) : new Date();
    await db.deliveryAttempt.create({
      data: {
        orderLineId: id, driverId: user.id, delivered: true,
        recipientName: b.recipientName, note: b.note ?? null,
        photoPath: b.photoPath ?? null, signaturePath: b.signaturePath ?? null,
        lat: b.lat ?? null, lng: b.lng ?? null, occurredAt: at,
      },
    });
    await db.orderLine.update({
      where: { id }, data: { status: "DELIVERED", deliveredAt: at },
    });
    await record({
      code: "DELIVERED_TO_CUSTOMER", entityType: "order_line", entityId: id,
      orderId: line.orderId, actorId: user.id, locationId: line.order.showroomId,
      isCustomerVisible: true,
      payload: { recipient: b.recipientName, note: b.note ?? null },
      occurredAt: at,
    });
    await syncOrderStatus(line.orderId);
    // Best-effort: the customer has the piece whether or not the shelf figure
    // could be updated.
    await releaseOnDelivery(id, user.id).catch(() => {});

    const fresh = await db.orderLine.findUnique({ where: { id }, include: LINE });
    return stop(fresh);
  });

  /**
   * Not handed over.
   *
   * The piece stays at the showroom and stays on the run, because a customer
   * who was out once has to be visited again. Without this the driver's only
   * options were to lie or to say nothing.
   */
  app.post("/delivery/lines/:id/failed", { preHandler: guard(DELIVERY) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const b = z.object({
      reason: z.enum(FAIL_REASONS),
      note: z.string().max(500).optional(),
      photoPath: z.string().max(300).optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      occurredAt: z.string().datetime().optional(),
    }).parse(req.body);

    const line = await db.orderLine.findUnique({
      where: { id }, include: { order: true },
    });
    if (!line) return reply.code(404).send({ error: "not_found" });
    if (line.status !== "READY") {
      return reply.code(409).send({ error: "not_ready", status: line.status });
    }
    if (user.locationId && line.order.showroomId !== user.locationId) {
      return reply.code(404).send({ error: "not_found" });
    }

    const at = b.occurredAt ? new Date(b.occurredAt) : new Date();
    const attempt = await db.deliveryAttempt.create({
      data: {
        orderLineId: id, driverId: user.id, delivered: false,
        failReason: b.reason, note: b.note ?? null,
        photoPath: b.photoPath ?? null,
        lat: b.lat ?? null, lng: b.lng ?? null, occurredAt: at,
      },
    });
    // The customer is told the attempt happened. Silence after a missed
    // delivery is what turns a small problem into a complaint.
    await record({
      code: "DELIVERY_FAILED", entityType: "order_line", entityId: id,
      orderId: line.orderId, actorId: user.id, locationId: line.order.showroomId,
      isCustomerVisible: true,
      payload: { reason: b.reason, note: b.note ?? null },
      occurredAt: at,
    });
    return attempt;
  });

  /** Every attempt on one piece, for the showroom answering the phone. */
  app.get("/delivery/lines/:id/attempts", { preHandler: guard(DELIVERY) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const line = await db.orderLine.findUnique({ where: { id }, include: LINE });
    if (!line) return reply.code(404).send({ error: "not_found" });
    return stop(line);
  });

  /**
   * تقرير التسليم — how the road is going.
   *
   * The number worth watching is not how many were delivered but how many took
   * more than one visit, and why: a van going out twice for the same piece is
   * a cost nobody was measuring.
   */
  app.get("/delivery/report", { preHandler: guard(DELIVERY) }, async (req) => {
    const q = z.object({ from: z.string().optional(), to: z.string().optional() })
      .parse(req.query ?? {});
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
    to.setHours(23, 59, 59, 999);
    from.setHours(0, 0, 0, 0);

    const attempts = await db.deliveryAttempt.findMany({
      where: { occurredAt: { gte: from, lte: to } },
      include: { driver: true, orderLine: { include: { order: { include: { customer: true } } } } },
      orderBy: { occurredAt: "desc" },
    });

    const failed = attempts.filter((a) => !a.delivered);
    const byReason = new Map<string, number>();
    for (const a of failed) {
      if (!a.failReason) continue;
      byReason.set(a.failReason, (byReason.get(a.failReason) ?? 0) + 1);
    }
    const byDriver = new Map<string, { name: string; delivered: number; failed: number }>();
    for (const a of attempts) {
      const k = a.driver?.nameAr ?? "—";
      const cur = byDriver.get(k) ?? { name: k, delivered: 0, failed: 0 };
      if (a.delivered) cur.delivered++; else cur.failed++;
      byDriver.set(k, cur);
    }
    // Pieces that needed more than one visit.
    const perLine = new Map<string, number>();
    for (const a of attempts) perLine.set(a.orderLineId, (perLine.get(a.orderLineId) ?? 0) + 1);
    const repeats = [...perLine.values()].filter((n) => n > 1).length;

    return {
      from, to,
      totals: {
        attempts: attempts.length,
        delivered: attempts.length - failed.length,
        failed: failed.length,
        repeats,
        firstTimeRate: perLine.size > 0
          ? Math.round((perLine.size - repeats) / perLine.size * 1000) / 10 : 0,
      },
      byReason: [...byReason.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      byDriver: [...byDriver.values()].sort((a, b) => b.delivered - a.delivered),
      rows: attempts.slice(0, 100).map((a) => ({
        id: a.id, at: a.occurredAt, delivered: a.delivered, reason: a.failReason,
        customer: a.orderLine.order.customer.name,
        order: a.orderLine.order.code,
        recipient: a.recipientName, note: a.note,
        by: a.driver?.nameAr ?? null,
      })),
    };
  });
}
