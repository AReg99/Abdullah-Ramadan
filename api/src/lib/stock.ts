import { db } from "../db.js";

/**
 * Stock movements the system makes for itself.
 *
 * Kept out of the routes because the interesting part is what happens when
 * conditions are not met: none of these may ever fail the thing that triggered
 * them. A delivery to a customer has happened whether or not the shelf figure
 * could be updated, and refusing the delivery — or worse, crashing it — would
 * be the software arguing with reality.
 *
 * So every function here is best-effort and says what it did.
 */

/** The stock item standing for a catalogue product, if there is one. */
export async function stockItemForProduct(productId: string) {
  return db.stockItem.findUnique({ where: { productId } });
}

/**
 * A piece handed to the customer leaves the store it was held in.
 *
 * Silent when the product is not stocked, which is the normal case for
 * made-to-order furniture: it was never on a shelf to come off one.
 */
export async function releaseOnDelivery(orderLineId: string, actorId?: string) {
  const line = await db.orderLine.findUnique({
    where: { id: orderLineId },
    include: { order: true },
  });
  if (!line) return { moved: false, why: "no_line" };

  const item = await stockItemForProduct(line.productId);
  if (!item) return { moved: false, why: "not_stocked" };

  // The store named on the line, or the showroom the order belongs to.
  const warehouseId = line.warehouseId ?? line.order.showroomId;
  if (!warehouseId) return { moved: false, why: "no_warehouse" };

  // Delivering twice must not take it off the shelf twice.
  const already = await db.stockMovement.findFirst({
    where: { orderLineId, reason: "SALE" },
  });
  if (already) return { moved: false, why: "already_released" };

  await db.stockMovement.create({
    data: {
      itemId: item.id, warehouseId, direction: "OUT", qty: String(line.qty),
      reason: "SALE", unitCost: item.unitCost, occurredOn: new Date(),
      orderLineId, actorId: actorId ?? null,
      note: line.order.code,
    },
  });
  return { moved: true, itemId: item.id, qty: line.qty };
}

/**
 * Goods on a supplier's invoice arrive in the store that took them in.
 *
 * Only the lines that name a stock item move; the rest of a bill is usually a
 * service or a one-off that no shelf holds.
 */
export async function receiveOnPurchase(purchaseInvoiceId: string, actorId?: string) {
  const inv = await db.purchaseInvoice.findUnique({
    where: { id: purchaseInvoiceId },
    include: { lines: true },
  });
  if (!inv) return { moved: 0 };

  let moved = 0;
  for (const l of inv.lines) {
    if (!l.stockItemId) continue;
    const warehouseId = l.warehouseId ?? inv.warehouseId;
    if (!warehouseId) continue;
    const already = await db.stockMovement.findFirst({
      where: { purchaseInvoiceId, itemId: l.stockItemId, reason: "PURCHASE" },
    });
    if (already) continue;
    await db.stockMovement.create({
      data: {
        itemId: l.stockItemId, warehouseId, direction: "IN",
        qty: String(l.qty), reason: "PURCHASE",
        // What it actually cost this time, not the standing figure.
        unitCost: l.unitPrice, occurredOn: inv.issuedOn,
        purchaseInvoiceId, actorId: actorId ?? null, note: inv.number,
      },
    });
    moved++;
  }
  return { moved };
}


/**
 * Building a piece consumes what it is made of.
 *
 * Called when a work order finishes. Without this a work order knows what it
 * is building but not what goes into it, and materials only ever come off the
 * shelf by hand — which means mostly they do not, and the timber figure drifts
 * until a stocktake finds it months later.
 *
 * Best-effort like the rest: the piece was built whether or not the shelf could
 * be squared, and a missing material must never block the floor. Anything it
 * could not take is reported so it can be shown rather than silently lost.
 */
export async function consumeForWorkOrder(workOrderId: string, actorId?: string) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: { orderLine: { include: { order: true } } },
  });
  if (!wo) return { consumed: 0, short: [] as string[] };

  // Building the same work order twice must not consume twice.
  const already = await db.stockMovement.findFirst({
    where: { workOrderId, reason: "PRODUCTION" },
  });
  if (already) return { consumed: 0, short: [] };

  const bom = await db.bomLine.findMany({
    where: { productId: wo.productId },
    include: { stockItem: true },
  });
  if (bom.length === 0) return { consumed: 0, short: [] };

  // Materials come out of the factory. A showroom does not hold timber.
  const factory = await db.location.findFirst({ where: { type: "FACTORY" } });
  if (!factory) return { consumed: 0, short: [] };

  let consumed = 0;
  const short: string[] = [];
  for (const b of bom) {
    const need = Number(b.qty) * wo.qty;
    if (need <= 0) continue;
    const sums = await db.stockMovement.groupBy({
      by: ["direction"], _sum: { qty: true },
      where: { itemId: b.stockItemId, warehouseId: factory.id },
    });
    const onHand =
      Number(sums.find((g) => g.direction === "IN")?._sum.qty ?? 0)
      - Number(sums.find((g) => g.direction === "OUT")?._sum.qty ?? 0);
    // Take what is there rather than nothing: a shelf that is short by a metre
    // should not leave the whole build unrecorded.
    const take = Math.min(need, Math.max(0, onHand));
    if (take < need) short.push(b.stockItem.nameAr);
    if (take <= 0) continue;

    await db.stockMovement.create({
      data: {
        itemId: b.stockItemId, warehouseId: factory.id, direction: "OUT",
        qty: String(take), reason: "PRODUCTION", unitCost: b.stockItem.unitCost,
        occurredOn: new Date(), workOrderId, actorId: actorId ?? null,
        note: wo.code,
      },
    });
    consumed++;
  }
  return { consumed, short };
}
