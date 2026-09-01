import type { FastifyInstance } from "fastify";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { LABELS } from "../../auth/scopes.js";
import { record } from "../../lib/events.js";

/**
 * The unit label is the system. It is printed when the work order is created,
 * attached to the piece, and scanned at every stage until installation.
 */
export default async function labelRoutes(app: FastifyInstance) {
  app.get("/labels", { preHandler: guard(LABELS) }, async () => {
    const labels = await db.unitLabel.findMany({
      orderBy: { serial: "asc" },
      include: {
        workOrder: {
          include: { product: true, orderLine: { include: { order: { include: { customer: true } } } } },
        },
      },
    });
    return labels.map((l) => ({
      id: l.id,
      serial: l.serial,
      printedAt: l.printedAt,
      workOrderCode: l.workOrder.code,
      orderCode: l.workOrder.orderLine.order.code,
      customer: l.workOrder.orderLine.order.customer.name,
      productAr: l.workOrder.product.nameAr,
      productEn: l.workOrder.product.nameEn,
      qty: l.workOrder.qty,
      promisedDate: l.workOrder.orderLine.order.promisedDate,
    }));
  });

  app.post("/labels/:id/printed", { preHandler: guard(LABELS) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const label = await db.unitLabel.findUnique({
        where: { id }, include: { workOrder: { include: { orderLine: true } } },
      });
      if (!label) return reply.code(404).send({ error: "not_found" });
      const updated = await db.unitLabel.update({ where: { id }, data: { printedAt: new Date() } });
      await record({
        code: "LABEL_PRINTED", entityType: "unit_label", entityId: id,
        orderId: label.workOrder.orderLine.orderId, actorId: (req as any).user.id,
        payload: { serial: label.serial },
      });
      return updated;
    });
}
