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
