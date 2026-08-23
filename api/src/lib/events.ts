import { db } from "../db.js";

export type EventInput = {
  code: string;
  entityType: string;
  entityId: string;
  orderId?: string | null;
  actorId?: string | null;
  stationId?: string | null;
  locationId?: string | null;
  payload?: Record<string, unknown>;
  /** Device clock. An offline scan at 09:12 that syncs at 11:40 still counts at 09:12. */
  occurredAt?: Date;
  isCustomerVisible?: boolean;
  clientEventId?: string | null;
};

/**
 * The only way anything is written to the event stream. Append-only:
 * a mistake is corrected by a new compensating event, never an update.
 * Idempotent on clientEventId so a retried offline sync is a no-op.
 */
export async function record(e: EventInput) {
  if (e.clientEventId) {
    const seen = await db.trackingEvent.findUnique({ where: { clientEventId: e.clientEventId } });
    if (seen) return seen;
  }
  return db.trackingEvent.create({
    data: {
      code: e.code,
      entityType: e.entityType,
      entityId: e.entityId,
      orderId: e.orderId ?? null,
      actorId: e.actorId ?? null,
      stationId: e.stationId ?? null,
      locationId: e.locationId ?? null,
      payload: (e.payload ?? {}) as object,
      occurredAt: e.occurredAt ?? new Date(),
      isCustomerVisible: e.isCustomerVisible ?? false,
      clientEventId: e.clientEventId ?? null,
    },
  });
}
