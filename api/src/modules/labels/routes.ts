import type { FastifyInstance } from "fastify";
import { z } from "zod";
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

  /**
   * A batch, because printing is a batch: somebody ticks the six labels for an
   * order, sends them to the printer, and those six are printed together. One
   * request per label would leave half of them marked if the network dropped
   * in the middle.
   *
   * Marking is not the same as printing — the browser cannot tell us whether
   * paper came out — so this is the operator saying "those came out", and it
   * can be said again. Reprinting a label that got soaked is normal, and moves
   * the date forward rather than being refused.
   */
  app.post("/labels/printed", { preHandler: guard(LABELS) }, async (req, reply) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) })
      .parse(req.body ?? {});
    const labels = await db.unitLabel.findMany({
      where: { id: { in: ids } },
      include: { workOrder: { include: { orderLine: true } } },
    });
    if (labels.length === 0) return reply.code(404).send({ error: "not_found" });

    const at = new Date();
    await db.unitLabel.updateMany({
      where: { id: { in: labels.map((l) => l.id) } }, data: { printedAt: at },
    });
    for (const l of labels) {
      await record({
        code: "LABEL_PRINTED", entityType: "unit_label", entityId: l.id,
        orderId: l.workOrder.orderLine.orderId, actorId: (req as any).user.id,
        payload: { serial: l.serial },
      });
    }
    // Which ones did not exist, so the screen can say so rather than quietly
    // marking five of six.
    const found = new Set(labels.map((l) => l.id));
    return { printedAt: at, count: labels.length, missing: ids.filter((i) => !found.has(i)) };
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
