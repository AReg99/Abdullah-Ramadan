import type { FastifyInstance } from "fastify";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { PRODUCTION, seesMoney } from "../../auth/scopes.js";

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/**
 * Every figure here is an aggregation over the event stream and the stage
 * records it produced — never a separately maintained counter that can drift.
 */
export default async function dashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard/today", { preHandler: guard(PRODUCTION) }, async (req) => {
    const since = startOfToday();
    const money = seesMoney((req as any).user.role.key);

    const [ordersToday, finishedToday, blocked, openLines, events] = await Promise.all([
      db.order.findMany({ where: { createdAt: { gte: since } }, select: { total: true } }),
      db.workOrderStage.count({ where: { status: "DONE", finishedAt: { gte: since } } }),
      db.workOrderStage.findMany({
        where: { status: "PAUSED" },
        include: { routingStage: { include: { station: true } }, workOrder: { include: { orderLine: { include: { order: true } } } } },
      }),
      db.orderLine.findMany({
        where: { status: { in: ["QUEUED", "IN_PRODUCTION"] } },
        include: { order: true },
      }),
      db.trackingEvent.findMany({
        where: { occurredAt: { gte: since } },
        orderBy: { occurredAt: "desc" },
        take: 30,
        include: { actor: true, station: true },
      }),
    ]);

    const now = Date.now();
    const late = openLines.filter((l) => l.promisedDate && l.promisedDate.getTime() < now);
    const atRisk = openLines.filter(
      (l) => l.promisedDate && l.promisedDate.getTime() >= now &&
             l.promisedDate.getTime() - now < 3 * 86400_000
    );

    return {
      ordersToday: {
        count: ordersToday.length,
        // Production sees how many came in, not what they were worth.
        ...(money ? { value: ordersToday.reduce((s, o) => s + Number(o.total), 0) } : {}),
      },
      unitsFinished: finishedToday,
      openLines: openLines.length,
      late: late.length,
      atRisk: atRisk.length,
      blocked: blocked.map((b) => ({
        stageId: b.id,
        reason: b.blockedReason,
        note: b.blockedNote,
        station: b.routingStage.station.nameEn,
        stationAr: b.routingStage.station.nameAr,
        orderCode: b.workOrder.orderLine.order.code,
        minutes: b.pausedAt ? Math.round((now - b.pausedAt.getTime()) / 60000) : 0,
      })),
      events: events.map((e) => ({
        id: e.id, code: e.code, occurredAt: e.occurredAt,
        actor: e.actor ? { nameAr: e.actor.nameAr, nameEn: e.actor.nameEn } : null,
        station: e.station ? { nameAr: e.station.nameAr, nameEn: e.station.nameEn } : null,
        payload: e.payload,
      })),
    };
  });

  /** The live floor: one card per station, what is on the bench right now. */
  app.get("/dashboard/floor", { preHandler: guard(PRODUCTION) }, async () => {
    const stations = await db.station.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
    const stages = await db.workOrderStage.findMany({
      where: { status: { in: ["READY", "IN_PROGRESS", "PAUSED"] } },
      include: {
        routingStage: true, assignedTo: true,
        workOrder: { include: { product: true, orderLine: { include: { order: true } } } },
      },
    });
    return stations.map((st) => {
      const mine = stages.filter((s) => s.routingStage.stationId === st.id);
      return {
        id: st.id, code: st.code, nameAr: st.nameAr, nameEn: st.nameEn,
        waiting: mine.filter((s) => s.status === "READY").length,
        active: mine.filter((s) => s.status === "IN_PROGRESS").map((s) => ({
          stageId: s.id, orderCode: s.workOrder.orderLine.order.code,
          productAr: s.workOrder.product.nameAr, productEn: s.workOrder.product.nameEn,
          worker: s.assignedTo ? { nameAr: s.assignedTo.nameAr, nameEn: s.assignedTo.nameEn } : null,
          minutes: s.startedAt ? Math.round((Date.now() - s.startedAt.getTime()) / 60000) : 0,
          stdMinutes: s.routingStage.stdMinutes,
        })),
        blocked: mine.filter((s) => s.status === "PAUSED").map((s) => ({
          stageId: s.id, orderCode: s.workOrder.orderLine.order.code, reason: s.blockedReason,
          minutes: s.pausedAt ? Math.round((Date.now() - s.pausedAt.getTime()) / 60000) : 0,
        })),
      };
    });
  });
}
