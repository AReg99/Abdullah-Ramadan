import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { record } from "../../lib/events.js";
import { syncOrderStatus } from "../../lib/order-status.js";

/**
 * The half of the journey that happens after the last station: factory →
 * showroom → customer. Production used to end at FINISHED and nothing moved a
 * line any further, so an order that was made was indistinguishable from one
 * sitting in a van or already in a customer's living room.
 *
 * Three transitions, each one a person physically handing something over, and
 * each one recorded so the owner and the customer see the same story:
 *
 *   FINISHED --dispatch--> IN_TRANSIT --receive--> READY --deliver--> DELIVERED
 */

const FACTORY_SIDE = ["OWNER", "FACTORY_MANAGER", "SUPERVISOR", "STOREKEEPER"];
const SHOWROOM_SIDE = ["OWNER", "FACTORY_MANAGER", "SHOWROOM_MANAGER", "SALES_REP"];

const envelope = z.object({
  clientEventId: z.string().min(8).optional(),
  occurredAt: z.string().datetime().optional(),
});

const lineView = (l: any) => ({
  id: l.id,
  qty: l.qty,
  status: l.status,
  specNotes: l.specNotes,
  productAr: l.product.nameAr,
  productEn: l.product.nameEn,
  sku: l.product.sku,
  dispatchedAt: l.dispatchedAt,
  receivedAt: l.receivedAt,
  deliveredAt: l.deliveredAt,
  promisedDate: l.promisedDate ?? l.order.promisedDate,
  order: {
    id: l.order.id,
    code: l.order.code,
    customer: l.order.customer.name,
    phone: l.order.customer.phone,
    showroomAr: l.order.showroom?.nameAr ?? null,
    showroomEn: l.order.showroom?.nameEn ?? null,
  },
  serials: l.workOrders.flatMap((w: any) => w.labels.map((u: any) => u.serial)),
});

const INCLUDE = {
  product: true,
  order: { include: { customer: true, showroom: true } },
  workOrders: { include: { labels: true } },
} as const;

type Line = Awaited<ReturnType<typeof db.orderLine.findFirstOrThrow<{ include: typeof INCLUDE }>>>;
type Moved = { ok: true; line: Line; already: boolean };
type Refused = { ok: false; code: number; error: string; status?: string };

/**
 * A line only moves if it is where the caller thinks it is. Repeating a
 * transition that already happened is not an error — a driver tapping twice, or
 * a queued action replaying, must not read as a failure.
 */
async function transition(
  id: string, from: string, to: string, extra: Record<string, unknown>,
): Promise<Moved | Refused> {
  const line = await db.orderLine.findUnique({ where: { id }, include: INCLUDE });
  if (!line) return { ok: false, code: 404, error: "not_found" };
  if (line.status === to) return { ok: true, line, already: true };
  if (line.status !== from) {
    return { ok: false, code: 409, error: "wrong_status", status: line.status };
  }
  const updated = await db.orderLine.update({
    where: { id }, data: { status: to as any, ...extra }, include: INCLUDE,
  });
  return { ok: true, line: updated, already: false };
}

export default async function flowRoutes(app: FastifyInstance) {
  /** Factory side: made and still here, waiting to go out. */
  app.get("/flow/dispatch", { preHandler: guard(FACTORY_SIDE) }, async () => {
    const lines = await db.orderLine.findMany({
      where: { status: { in: ["FINISHED", "IN_TRANSIT"] } },
      include: INCLUDE,
      orderBy: [{ promisedDate: "asc" }, { id: "asc" }],
    });
    return lines.map(lineView);
  });

  /**
   * Showroom side. Staff tied to one showroom see only theirs; the owner and
   * anyone unassigned see every showroom, which is the right default while
   * Aura has one.
   */
  app.get("/flow/showroom", { preHandler: guard(SHOWROOM_SIDE) }, async (req) => {
    const user = (req as any).user;
    const mine = user.locationId ? { order: { showroomId: user.locationId } } : {};
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const lines = await db.orderLine.findMany({
      where: {
        ...mine,
        OR: [
          { status: { in: ["IN_TRANSIT", "READY"] } },
          { status: "DELIVERED", deliveredAt: { gte: since } },
        ],
      },
      include: INCLUDE,
      orderBy: [{ promisedDate: "asc" }, { id: "asc" }],
    });
    return lines.map(lineView);
  });

  /** Left the factory. */
  app.post("/flow/lines/:id/dispatch", { preHandler: guard(FACTORY_SIDE) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const env = envelope.parse(req.body ?? {});
    const at = env.occurredAt ? new Date(env.occurredAt) : new Date();
    const r = await transition(id, "FINISHED", "IN_TRANSIT", { dispatchedAt: at });
    if (!r.ok) return reply.code(r.code).send({ error: r.error, status: r.status });
    if (!r.already) {
      await record({
        code: "DISPATCHED_TO_SHOWROOM", entityType: "order_line", entityId: id,
        orderId: r.line.orderId, actorId: (req as any).user.id,
        locationId: r.line.order.showroomId, isCustomerVisible: true,
        occurredAt: at, clientEventId: env.clientEventId ?? null,
      });
      await syncOrderStatus(r.line.orderId);
    }
    return lineView(r.line);
  });

  /** Signed for at the showroom. */
  app.post("/flow/lines/:id/receive", { preHandler: guard(SHOWROOM_SIDE) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const env = envelope.parse(req.body ?? {});
    const at = env.occurredAt ? new Date(env.occurredAt) : new Date();
    const r = await transition(id, "IN_TRANSIT", "READY", { receivedAt: at });
    if (!r.ok) return reply.code(r.code).send({ error: r.error, status: r.status });
    if (!r.already) {
      await record({
        code: "RECEIVED_AT_SHOWROOM", entityType: "order_line", entityId: id,
        orderId: r.line.orderId, actorId: (req as any).user.id,
        locationId: r.line.order.showroomId, isCustomerVisible: true,
        occurredAt: at, clientEventId: env.clientEventId ?? null,
      });
      await syncOrderStatus(r.line.orderId);
    }
    return lineView(r.line);
  });

  /** Handed to the customer. The end of the journey the owner asked to see. */
  app.post("/flow/lines/:id/deliver", { preHandler: guard(SHOWROOM_SIDE) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = envelope.extend({ note: z.string().max(500).optional() }).parse(req.body ?? {});
    const at = body.occurredAt ? new Date(body.occurredAt) : new Date();
    const r = await transition(id, "READY", "DELIVERED", { deliveredAt: at });
    if (!r.ok) return reply.code(r.code).send({ error: r.error, status: r.status });
    if (!r.already) {
      await record({
        code: "DELIVERED_TO_CUSTOMER", entityType: "order_line", entityId: id,
        orderId: r.line.orderId, actorId: (req as any).user.id,
        locationId: r.line.order.showroomId, isCustomerVisible: true,
        payload: { note: body.note ?? null },
        occurredAt: at, clientEventId: body.clientEventId ?? null,
      });
      await syncOrderStatus(r.line.orderId);
    }
    return lineView(r.line);
  });
}
