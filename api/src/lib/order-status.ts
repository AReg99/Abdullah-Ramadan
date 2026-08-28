import { db } from "../db.js";

/**
 * An order's status is not something anyone sets — it is what its lines add up
 * to. Recomputing it from the lines after every transition keeps the pipeline
 * honest without a second place to forget to update.
 *
 * Cancelled lines are ignored: an order whose remaining lines are all delivered
 * is delivered, whatever was cancelled along the way.
 */
export async function syncOrderStatus(orderId: string) {
  const lines = await db.orderLine.findMany({ where: { orderId }, select: { status: true } });
  const live = lines.filter((l) => l.status !== "CANCELLED");

  // Nothing left standing: the order itself is cancelled. Returning early here
  // would leave a fully cancelled order still reading CONFIRMED.
  if (live.length === 0) {
    if (lines.length === 0) return null;
    await db.order.updateMany({
      where: { id: orderId, status: { not: "CANCELLED" } },
      data: { status: "CANCELLED" },
    });
    return "CANCELLED";
  }

  const every = (...s: string[]) => live.every((l) => s.includes(l.status));
  const some = (...s: string[]) => live.some((l) => s.includes(l.status));

  const status =
    every("DELIVERED") ? "DELIVERED"
    : every("READY", "DELIVERED") ? "READY"
    : some("IN_PRODUCTION", "FINISHED", "IN_TRANSIT", "READY", "DELIVERED") ? "IN_PRODUCTION"
    : "CONFIRMED";

  await db.order.updateMany({
    where: { id: orderId, status: { not: status as any } },
    data: { status: status as any },
  });
  return status;
}
