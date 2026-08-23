import type { FastifyInstance } from "fastify";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";

export default async function orderRoutes(app: FastifyInstance) {
  app.get("/orders", { preHandler: guard(["OWNER", "FACTORY_MANAGER", "SUPERVISOR", "SALES_REP", "ACCOUNTANT"]) },
    async () => {
      const orders = await db.order.findMany({
        orderBy: { createdAt: "desc" },
        include: { customer: true, lines: { include: { product: true } } },
      });
      return orders.map((o) => ({
        id: o.id, code: o.code, status: o.status, kind: o.kind,
        customer: o.customer.name, total: Number(o.total), promisedDate: o.promisedDate,
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
        lines: { include: { product: true, workOrders: { include: { stages: { include: { routingStage: true, photos: true }, orderBy: { seq: "asc" } } } } } },
      },
    });
    if (!order) return reply.code(404).send({ error: "not_found" });

    const customerOnly = !["OWNER", "FACTORY_MANAGER", "SUPERVISOR", "SALES_REP", "ACCOUNTANT"].includes(user.role.key);
    const events = await db.trackingEvent.findMany({
      where: { orderId: id, ...(customerOnly ? { isCustomerVisible: true } : {}) },
      orderBy: { occurredAt: "desc" },
      include: { actor: true, station: true },
    });

    return {
      id: order.id, code: order.code, status: order.status,
      customer: { name: order.customer.name, phone: order.customer.phone },
      total: Number(order.total), promisedDate: order.promisedDate,
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
      events: events.map((e) => ({
        id: e.id, code: e.code, occurredAt: e.occurredAt, payload: e.payload,
        actor: e.actor ? { nameAr: e.actor.nameAr, nameEn: e.actor.nameEn } : null,
        station: e.station ? { nameAr: e.station.nameAr, nameEn: e.station.nameEn } : null,
      })),
    };
  });
}
