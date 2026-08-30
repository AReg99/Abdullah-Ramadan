import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { BOOKS, PURCHASING, PURCHASE_APPROVE, STOCK } from "../../auth/scopes.js";
import { nextNumber } from "../../lib/sequence.js";
import { checkPurchaseValue, claimApproval } from "../../lib/limits.js";

/**
 * Buying things.
 *
 * The system used to learn about a purchase from the supplier's invoice, which
 * is the last possible moment: by then the money is owed, nobody approved it,
 * and there is nothing to check the delivery against.
 *
 *   طلب شراء → أمر شراء → إذن استلام → الفاتورة
 *
 * Each step exists because of something the one before it cannot answer. The
 * request says somebody wanted it. The order says what was agreed and at what
 * price. The receipt says what actually turned up. Only then does an invoice
 * have anything to be checked against.
 */

const n = (d: unknown) => Number(d ?? 0);
const qty = () => z.number().positive().max(1e9);

export default async function purchasingRoutes(app: FastifyInstance) {
  // ─────────────────────────────────────────────── طلب شراء (the request)

  app.get("/purchasing/requests", { preHandler: guard(PURCHASING) }, async (req) => {
    const q = z.object({ status: z.string().optional() }).parse(req.query ?? {});
    const rows = await db.purchaseRequest.findMany({
      where: q.status ? { status: q.status as any } : {},
      orderBy: { createdAt: "desc" }, take: 100,
      include: {
        warehouse: true, requestedBy: true, decidedBy: true,
        lines: { include: { stockItem: true } },
        orders: { select: { id: true, number: true } },
      },
    });
    return rows.map(requestView);
  });

  app.get("/purchasing/requests/:id", { preHandler: guard(PURCHASING) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db.purchaseRequest.findUnique({
      where: { id },
      include: {
        warehouse: true, requestedBy: true, decidedBy: true,
        lines: { include: { stockItem: true } },
        orders: { select: { id: true, number: true } },
      },
    });
    if (!r) return reply.code(404).send({ error: "not_found" });
    return requestView(r);
  });

  app.post("/purchasing/requests", { preHandler: guard(PURCHASING) }, async (req, reply) => {
    const b = z.object({
      warehouseId: z.string().optional(),
      neededBy: z.string().datetime().optional(),
      note: z.string().max(500).optional(),
      lines: z.array(z.object({
        stockItemId: z.string(),
        qty: qty(),
        note: z.string().max(200).optional(),
      })).min(1),
    }).parse(req.body);

    const ids = b.lines.map((l) => l.stockItemId);
    if (new Set(ids).size !== ids.length) {
      return reply.code(400).send({ error: "duplicate_item" });
    }
    const found = await db.stockItem.findMany({ where: { id: { in: ids } } });
    if (found.length !== ids.length) return reply.code(404).send({ error: "item_not_found" });

    const made = await db.purchaseRequest.create({
      data: {
        number: await nextNumber("PR"),
        warehouseId: b.warehouseId ?? null,
        neededBy: b.neededBy ? new Date(b.neededBy) : null,
        note: b.note ?? null,
        requestedById: (req as any).user.id,
        lines: {
          create: b.lines.map((l) => ({
            stockItemId: l.stockItemId, qty: String(l.qty), note: l.note ?? null,
          })),
        },
      },
      include: {
        warehouse: true, requestedBy: true, decidedBy: true,
        lines: { include: { stockItem: true } }, orders: true,
      },
    });
    return requestView(made);
  });

  /**
   * Approving or refusing.
   *
   * A refusal carries a reason, because one without gets asked again next week
   * by the same person for the same thing.
   */
  app.post("/purchasing/requests/:id/decide", { preHandler: guard(PURCHASE_APPROVE) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = z.object({
        approve: z.boolean(),
        note: z.string().max(500).optional(),
      }).parse(req.body);

      const r = await db.purchaseRequest.findUnique({ where: { id } });
      if (!r) return reply.code(404).send({ error: "not_found" });
      if (r.status !== "SUBMITTED") {
        return reply.code(409).send({ error: "already_decided", status: r.status });
      }
      if (!b.approve && !b.note?.trim()) {
        return reply.code(400).send({ error: "reason_required" });
      }

      return db.purchaseRequest.update({
        where: { id },
        data: {
          status: b.approve ? "APPROVED" : "REJECTED",
          decidedById: (req as any).user.id,
          decidedAt: new Date(),
          decisionNote: b.note ?? null,
        },
      });
    });

  // ──────────────────────────────────────────── أمر شراء (the order)

  app.get("/purchasing/orders", { preHandler: guard(PURCHASING) }, async (req) => {
    const q = z.object({ status: z.string().optional() }).parse(req.query ?? {});
    const rows = await db.purchaseOrder.findMany({
      where: q.status ? { status: q.status as any } : {},
      orderBy: { createdAt: "desc" }, take: 100,
      include: ORDER_INCLUDE,
    });
    return rows.map(orderView);
  });

  app.get("/purchasing/orders/:id", { preHandler: guard(PURCHASING) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const o = await db.purchaseOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!o) return reply.code(404).send({ error: "not_found" });
    return orderView(o);
  });

  /** What was agreed, and at what price. Only the books commit money. */
  app.post("/purchasing/orders", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const b = z.object({
      supplierId: z.string(),
      requestId: z.string().optional(),
      warehouseId: z.string().optional(),
      expectedOn: z.string().datetime().optional(),
      note: z.string().max(500).optional(),
      lines: z.array(z.object({
        stockItemId: z.string(),
        qty: qty(),
        unitPrice: z.number().nonnegative(),
        note: z.string().max(200).optional(),
      })).min(1),
      /** A permission slip, where the order is worth more than this person may commit. */
      approvalId: z.string().optional(),
    }).parse(req.body);

    if (!(await db.supplier.findUnique({ where: { id: b.supplierId } }))) {
      return reply.code(404).send({ error: "supplier_not_found" });
    }
    if (b.requestId) {
      const r = await db.purchaseRequest.findUnique({ where: { id: b.requestId } });
      if (!r) return reply.code(404).send({ error: "request_not_found" });
      // Ordering against something nobody approved is exactly what this whole
      // cycle exists to prevent.
      if (r.status !== "APPROVED" && r.status !== "ORDERED") {
        return reply.code(409).send({ error: "request_not_approved", status: r.status });
      }
    }
    const ids = b.lines.map((l) => l.stockItemId);
    if (new Set(ids).size !== ids.length) {
      return reply.code(400).send({ error: "duplicate_item" });
    }
    const found = await db.stockItem.findMany({ where: { id: { in: ids } } });
    if (found.length !== ids.length) return reply.code(404).send({ error: "item_not_found" });

    /**
     * The size of the commitment, against what this person may make alone.
     *
     * A purchase order is a promise to pay somebody, and until now anyone who
     * kept the books could make one of any size with nobody else's name on it.
     * As with a discount, nothing bites until a ceiling has been set.
     */
    const value = b.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const allowance = await checkPurchaseValue((req as any).user.role.key, value);
    let approval: { id: string } | null = null;
    if (!allowance.ok) {
      if (!b.approvalId) {
        return reply.code(409).send({
          error: "order_needs_approval",
          allowed: allowance.allowed, asked: allowance.asked,
        });
      }
      const claim = await claimApproval({
        id: b.approvalId, kind: "PURCHASE_ORDER_VALUE",
        amount: value, actorId: (req as any).user.id,
      });
      if (!claim.ok) return reply.code(409).send(claim);
      approval = { id: claim.approval.id };
    }

    const made = await db.purchaseOrder.create({
      data: {
        number: await nextNumber("PO"),
        supplierId: b.supplierId,
        requestId: b.requestId ?? null,
        warehouseId: b.warehouseId ?? null,
        expectedOn: b.expectedOn ? new Date(b.expectedOn) : null,
        note: b.note ?? null,
        actorId: (req as any).user.id,
        lines: {
          create: b.lines.map((l) => ({
            stockItemId: l.stockItemId, qty: String(l.qty),
            unitPrice: String(l.unitPrice), note: l.note ?? null,
          })),
        },
      },
      include: ORDER_INCLUDE,
    });
    if (b.requestId) {
      await db.purchaseRequest.update({
        where: { id: b.requestId }, data: { status: "ORDERED" },
      });
    }
    if (approval) {
      await db.approval.update({
        where: { id: approval.id },
        data: { status: "USED", usedAt: new Date(), purchaseOrderId: made.id },
      });
    }
    return orderView(made);
  });

  app.post("/purchasing/orders/:id/cancel", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const o = await db.purchaseOrder.findUnique({
      where: { id }, include: { receipts: true },
    });
    if (!o) return reply.code(404).send({ error: "not_found" });
    // Something already came in against it; cancelling would leave the stock
    // that arrived pointing at an order that says it never existed.
    if (o.receipts.length > 0) {
      return reply.code(409).send({ error: "already_received" });
    }
    return db.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
  });

  // ───────────────────────────────────── إذن استلام (the goods receipt)

  /**
   * What actually turned up.
   *
   * Kept apart from the invoice on purpose: without it nothing says what
   * arrived as opposed to what was billed, and nothing stops the business
   * paying for a delivery that never came.
   *
   * The stock goes on the shelf here, not when the bill is recorded.
   */
  app.post("/purchasing/orders/:id/receive", { preHandler: guard(STOCK) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = z.object({
        warehouseId: z.string().optional(),
        receivedOn: z.string().datetime().optional(),
        note: z.string().max(500).optional(),
        lines: z.array(z.object({
          orderLineId: z.string(),
          qty: qty(),
          batch: z.string().max(40).optional(),
          note: z.string().max(200).optional(),
        })).min(1),
      }).parse(req.body);

      const order = await db.purchaseOrder.findUnique({
        where: { id },
        include: {
          lines: { include: { stockItem: true, receiptLines: true } },
        },
      });
      if (!order) return reply.code(404).send({ error: "not_found" });
      if (order.status === "CANCELLED") {
        return reply.code(409).send({ error: "order_cancelled" });
      }

      const warehouseId = b.warehouseId ?? order.warehouseId;
      if (!warehouseId) return reply.code(400).send({ error: "warehouse_required" });
      if (!(await db.location.findUnique({ where: { id: warehouseId } }))) {
        return reply.code(404).send({ error: "warehouse_not_found" });
      }

      // Receiving more than was ordered is nearly always a mistyped quantity,
      // and it is the one that ends up paid for.
      for (const l of b.lines) {
        const ol = order.lines.find((x) => x.id === l.orderLineId);
        if (!ol) return reply.code(404).send({ error: "order_line_not_found" });
        const already = ol.receiptLines.reduce((s, r) => s + n(r.qty), 0);
        if (already + l.qty > n(ol.qty) + 0.0005) {
          return reply.code(400).send({
            error: "more_than_ordered",
            item: ol.stockItem.nameAr,
            ordered: n(ol.qty), alreadyReceived: already,
          });
        }
      }

      const receipt = await db.goodsReceipt.create({
        data: {
          number: await nextNumber("GRN"),
          orderId: id, warehouseId,
          receivedOn: b.receivedOn ? new Date(b.receivedOn) : new Date(),
          note: b.note ?? null, actorId: (req as any).user.id,
          lines: {
            create: b.lines.map((l) => ({
              orderLineId: l.orderLineId, qty: String(l.qty),
              batch: l.batch ?? null, note: l.note ?? null,
            })),
          },
        },
        include: { lines: true },
      });

      // On the shelf, at what this delivery actually cost.
      for (const l of b.lines) {
        const ol = order.lines.find((x) => x.id === l.orderLineId)!;
        await db.stockMovement.create({
          data: {
            itemId: ol.stockItemId, warehouseId, direction: "IN",
            qty: String(l.qty), reason: "PURCHASE", unitCost: ol.unitPrice,
            batch: l.batch ?? null,
            occurredOn: receipt.receivedOn,
            actorId: (req as any).user.id,
            note: `${order.number} · ${receipt.number}`,
          },
        });
      }

      await refreshOrderStatus(id);
      const fresh = await db.purchaseOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
      return { receipt: { id: receipt.id, number: receipt.number }, order: orderView(fresh!) };
    });

  app.get("/purchasing/receipts", { preHandler: guard(PURCHASING) }, async () => {
    const rows = await db.goodsReceipt.findMany({
      orderBy: { receivedOn: "desc" }, take: 100,
      include: {
        warehouse: true, actor: true,
        order: { include: { supplier: true } },
        lines: { include: { orderLine: { include: { stockItem: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id, number: r.number, receivedOn: r.receivedOn,
      order: { id: r.orderId, number: r.order.number },
      supplier: r.order.supplier.name,
      warehouse: r.warehouse.nameAr,
      by: r.actor?.nameAr ?? null,
      note: r.note,
      lines: r.lines.map((l) => ({
        item: l.orderLine.stockItem.nameAr, unit: l.orderLine.stockItem.unit,
        qty: n(l.qty), batch: l.batch,
      })),
    }));
  });

  /**
   * المطابقة الثلاثية — the order, the receipt and the bill, side by side.
   *
   * Three questions a business cannot answer without all three documents: were
   * these goods ordered, did they arrive, and is the price the one agreed. Any
   * two of them can agree while the third disagrees, which is precisely the
   * case worth catching.
   */
  app.get("/purchasing/orders/:id/match", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = await db.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        lines: { include: { stockItem: true, receiptLines: true } },
        invoices: { include: { lines: true } },
      },
    });
    if (!order) return reply.code(404).send({ error: "not_found" });

    const lines = order.lines.map((l) => {
      const received = l.receiptLines.reduce((s, r) => s + n(r.qty), 0);
      return {
        item: l.stockItem.nameAr, sku: l.stockItem.sku, unit: l.stockItem.unit,
        ordered: n(l.qty), received,
        shortfall: Math.round((n(l.qty) - received) * 1000) / 1000,
        unitPrice: n(l.unitPrice),
        orderedValue: Math.round(n(l.qty) * n(l.unitPrice) * 100) / 100,
        receivedValue: Math.round(received * n(l.unitPrice) * 100) / 100,
      };
    });

    const receivedValue = lines.reduce((s, l) => s + l.receivedValue, 0);
    const billed = order.invoices.reduce((s, i) => s + n(i.amount), 0);
    const gap = Math.round((billed - receivedValue) * 100) / 100;

    return {
      order: { id: order.id, number: order.number, status: order.status,
               supplier: order.supplier.name },
      lines,
      totals: {
        ordered: lines.reduce((s, l) => s + l.orderedValue, 0),
        received: receivedValue,
        billed,
        gap,
      },
      invoices: order.invoices.map((i) => ({
        id: i.id, number: i.number, date: i.issuedOn, amount: n(i.amount),
      })),
      // The three answers, in the words somebody would use out loud.
      verdict: {
        fullyReceived: lines.every((l) => l.shortfall <= 0.0005),
        billedMoreThanArrived: gap > 0.005,
        notYetBilled: billed <= 0.005,
      },
    };
  });

  /**
   * اللي لازم يتشترى — what to buy.
   *
   * Computable at last: the reorder level says what the shelf should not drop
   * below, and the bill of materials says what the orders in production will
   * eat. Both existed already and nothing was doing the subtraction.
   */
  app.get("/purchasing/suggest", { preHandler: guard(PURCHASING) }, async () => {
    const items = await db.stockItem.findMany({ where: { isActive: true } });
    const sums = await db.stockMovement.groupBy({
      by: ["itemId", "direction"], _sum: { qty: true },
    });
    const onHandOf = (id: string) =>
      n(sums.find((g) => g.itemId === id && g.direction === "IN")?._sum.qty)
      - n(sums.find((g) => g.itemId === id && g.direction === "OUT")?._sum.qty);

    // What the work still in the factory will consume.
    const open = await db.workOrder.findMany({
      where: { status: { notIn: ["DONE", "CANCELLED"] } },
      select: { productId: true, qty: true },
    });
    const boms = await db.bomLine.findMany({
      where: { productId: { in: [...new Set(open.map((w) => w.productId))] } },
    });
    const committed = new Map<string, number>();
    for (const w of open) {
      for (const b of boms.filter((x) => x.productId === w.productId)) {
        committed.set(b.stockItemId, (committed.get(b.stockItemId) ?? 0) + n(b.qty) * w.qty);
      }
    }

    // Already on the way, so a second order is not raised for the same gap.
    const onOrder = new Map<string, number>();
    const openLines = await db.purchaseOrderLine.findMany({
      where: { order: { status: { in: ["OPEN", "PART_RECEIVED"] } } },
      include: { receiptLines: true },
    });
    for (const l of openLines) {
      const got = l.receiptLines.reduce((s, r) => s + n(r.qty), 0);
      const left = Math.max(0, n(l.qty) - got);
      if (left > 0) onOrder.set(l.stockItemId, (onOrder.get(l.stockItemId) ?? 0) + left);
    }

    const rows = items.map((i) => {
      const onHand = onHandOf(i.id);
      const need = committed.get(i.id) ?? 0;
      const coming = onOrder.get(i.id) ?? 0;
      const level = n(i.reorderLevel);
      // Enough to cover what production will eat and still sit on the level.
      const shortBy = Math.round((need + level - onHand - coming) * 1000) / 1000;
      return {
        id: i.id, sku: i.sku, name: i.nameAr, unit: i.unit,
        onHand, committed: need, onOrder: coming, reorderLevel: level,
        suggest: shortBy > 0 ? shortBy : 0,
        unitCost: n(i.unitCost),
      };
    }).filter((r) => r.suggest > 0);

    return {
      totals: {
        items: rows.length,
        value: Math.round(rows.reduce((s, r) => s + r.suggest * r.unitCost, 0) * 100) / 100,
      },
      rows: rows.sort((a, b) => b.suggest * b.unitCost - a.suggest * a.unitCost),
    };
  });
}

const ORDER_INCLUDE = {
  supplier: true, warehouse: true, actor: true, request: true,
  lines: { include: { stockItem: true, receiptLines: true } },
  receipts: { select: { id: true, number: true, receivedOn: true } },
  invoices: { select: { id: true, number: true, amount: true } },
};

function requestView(r: any) {
  return {
    id: r.id, number: r.number, status: r.status,
    warehouse: r.warehouse?.nameAr ?? null, warehouseId: r.warehouseId,
    neededBy: r.neededBy, note: r.note,
    requestedBy: r.requestedBy?.nameAr ?? null,
    decidedBy: r.decidedBy?.nameAr ?? null,
    decidedAt: r.decidedAt, decisionNote: r.decisionNote,
    createdAt: r.createdAt,
    orders: r.orders ?? [],
    lines: r.lines.map((l: any) => ({
      id: l.id, stockItemId: l.stockItemId,
      item: l.stockItem.nameAr, sku: l.stockItem.sku, unit: l.stockItem.unit,
      qty: Number(l.qty), note: l.note,
    })),
  };
}

function orderView(o: any) {
  const lines = o.lines.map((l: any) => {
    const received = l.receiptLines.reduce((s: number, r: any) => s + Number(r.qty), 0);
    return {
      id: l.id, stockItemId: l.stockItemId,
      item: l.stockItem.nameAr, sku: l.stockItem.sku, unit: l.stockItem.unit,
      qty: Number(l.qty), received,
      outstanding: Math.round((Number(l.qty) - received) * 1000) / 1000,
      unitPrice: Number(l.unitPrice),
      lineTotal: Math.round(Number(l.qty) * Number(l.unitPrice) * 100) / 100,
      note: l.note,
    };
  });
  return {
    id: o.id, number: o.number, status: o.status,
    supplier: o.supplier?.name ?? null, supplierId: o.supplierId,
    warehouse: o.warehouse?.nameAr ?? null, warehouseId: o.warehouseId,
    requestNumber: o.request?.number ?? null,
    expectedOn: o.expectedOn, note: o.note,
    by: o.actor?.nameAr ?? null, createdAt: o.createdAt,
    lines,
    total: Math.round(lines.reduce((s: number, l: any) => s + l.lineTotal, 0) * 100) / 100,
    receipts: o.receipts ?? [],
    invoices: (o.invoices ?? []).map((i: any) => ({
      id: i.id, number: i.number, amount: Number(i.amount),
    })),
  };
}

/** An order is received when nothing is still outstanding on any line. */
async function refreshOrderStatus(orderId: string) {
  const order = await db.purchaseOrder.findUnique({
    where: { id: orderId },
    include: { lines: { include: { receiptLines: true } } },
  });
  if (!order || order.status === "CANCELLED") return;
  let anything = false;
  let complete = true;
  for (const l of order.lines) {
    const got = l.receiptLines.reduce((s, r) => s + Number(r.qty), 0);
    if (got > 0) anything = true;
    if (got + 0.0005 < Number(l.qty)) complete = false;
  }
  await db.purchaseOrder.update({
    where: { id: orderId },
    data: { status: complete ? "RECEIVED" : anything ? "PART_RECEIVED" : "OPEN" },
  });
}
