import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { PLANNING } from "../../auth/scopes.js";
import { record } from "../../lib/events.js";
import { SELL } from "../../auth/scopes.js";
import {
  addToQueues, addWorkingDays, daysLeftFor, defaultRouting,
  promiseSettings, stationQueues, workingDaysFor,
} from "../../lib/promise-date.js";

/**
 * التخطيط — the production manager's job.
 *
 * The schema has carried `WorkOrder.priority`, `Station.dailyCapacityMinutes`
 * and `RoutingStage.stdMinutes` since the first release, and the floor has been
 * sorting its work list by priority all along. Nothing ever **set** a priority,
 * so every work order sat at zero and the ordering meant nothing; and nothing
 * ever compared the queue against the capacity, so the one number a production
 * manager lives by — where the pile-up is — could not be read anywhere.
 *
 * Two questions, which is the whole module:
 *
 *   1. What should the floor do next, and in what order?
 *   2. Which station is the factory waiting on?
 */

/**
 * Three levels, not a free number.
 *
 * Free numbers become 1, 5, 10 and 100 within a fortnight, and then nobody on
 * the floor knows what a 7 means. Three is what a floor can actually act on;
 * within a level the promise date decides, which is the honest tie-break.
 */
export const PRIORITIES = { NORMAL: 0, URGENT: 10, CRITICAL: 20 } as const;
const labelOf = (p: number) =>
  p >= PRIORITIES.CRITICAL ? "CRITICAL" : p >= PRIORITIES.URGENT ? "URGENT" : "NORMAL";

const DAY = 86_400_000;
/** Inside this many days of the promise, a piece not yet finished is at risk. */
const RISK_DAYS = 3;

export default async function planningRoutes(app: FastifyInstance) {
  /**
   * لوحة التخطيط — every piece still to be made, in the order the floor sees it.
   *
   * Sorted exactly as `/work/today` sorts: priority first, then the promise
   * date. A planning board that disagrees with the work list is worse than no
   * board, because the manager reorders something and the floor does not move.
   */
  app.get("/planning/board", { preHandler: guard(PLANNING) }, async () => {
    const rows = await db.workOrder.findMany({
      where: { status: { notIn: ["DONE", "CANCELLED"] } },
      include: {
        product: true,
        orderLine: { include: { order: { include: { customer: true } } } },
        stages: {
          orderBy: { seq: "asc" },
          include: { routingStage: { include: { station: true } } },
        },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 300,
    });

    const now = Date.now();
    const view = rows.map((w) => {
      const live = w.stages.filter((s) => s.status !== "CANCELLED");
      const done = live.filter((s) => s.status === "DONE");
      const at = live.find((s) => s.status === "IN_PROGRESS")
              ?? live.find((s) => s.status === "PAUSED")
              ?? live.find((s) => s.status === "READY");
      // What is left to do, in the routing's own standard minutes — the only
      // measure of "how much work" the system actually holds.
      const remaining = live
        .filter((s) => s.status !== "DONE")
        .reduce((sum, s) => sum + s.routingStage.stdMinutes * w.qty, 0);
      const promised = w.orderLine.promisedDate ?? w.orderLine.order.promisedDate;
      const daysLeft = promised
        ? Math.floor((promised.getTime() - now) / DAY) : null;
      const paused = live.find((s) => s.status === "PAUSED");

      return {
        id: w.id, code: w.code, qty: w.qty,
        priority: w.priority, level: labelOf(w.priority),
        order: { id: w.orderLine.order.id, code: w.orderLine.order.code },
        customer: w.orderLine.order.customer.name,
        product: { nameAr: w.product.nameAr, nameEn: w.product.nameEn, sku: w.product.sku },
        promisedDate: promised, daysLeft,
        late: daysLeft != null && daysLeft < 0,
        atRisk: daysLeft != null && daysLeft >= 0 && daysLeft <= RISK_DAYS,
        started: done.length > 0,
        done: done.length, of: live.length,
        remainingMinutes: remaining,
        at: at ? {
          stage: at.routingStage.nameAr,
          station: at.routingStage.station.nameAr,
          stationId: at.routingStage.stationId,
          status: at.status,
        } : null,
        // A piece nobody can work on is the first thing a production manager
        // wants, and it is invisible on a list sorted by urgency alone.
        blocked: paused ? {
          reason: paused.blockedReason, note: paused.blockedNote,
          sinceMinutes: paused.pausedAt
            ? Math.round((now - paused.pausedAt.getTime()) / 60_000) : 0,
        } : null,
      };
    });

    return {
      totals: {
        open: view.length,
        late: view.filter((v) => v.late).length,
        atRisk: view.filter((v) => v.atRisk).length,
        notStarted: view.filter((v) => !v.started).length,
        blocked: view.filter((v) => v.blocked).length,
        urgent: view.filter((v) => v.priority >= PRIORITIES.URGENT).length,
        remainingHours: Math.round(view.reduce((s, v) => s + v.remainingMinutes, 0) / 60),
      },
      // Late first within each level: a board sorted only by the manager's own
      // flags hides the piece that quietly went past its date at normal
      // priority.
      rows: view.sort((a, b) =>
        b.priority - a.priority
        || (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9)
        || a.code.localeCompare(b.code)),
    };
  });

  /**
   * Bumping a piece up the queue.
   *
   * This is the one write the whole module exists for. The floor's work list
   * already sorts by it, so the change is visible at every station the moment
   * it is made — no re-planning run, nothing to publish.
   */
  app.post("/planning/work-orders/:id/priority", { preHandler: guard(PLANNING) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = z.object({
        level: z.enum(["NORMAL", "URGENT", "CRITICAL"]),
        /** Why it jumped the queue. Somebody else's piece just moved down. */
        note: z.string().max(300).optional(),
      }).parse(req.body);

      const w = await db.workOrder.findUnique({
        where: { id },
        include: { orderLine: { include: { order: true } } },
      });
      if (!w) return reply.code(404).send({ error: "not_found" });
      if (w.status === "DONE" || w.status === "CANCELLED") {
        return reply.code(409).send({ error: "already_finished", status: w.status });
      }

      const priority = PRIORITIES[b.level];
      if (priority === w.priority) return { id: w.id, priority, level: b.level };

      const saved = await db.workOrder.update({ where: { id }, data: { priority } });
      // On the record, because raising one piece lowers every other piece and
      // the floor is entitled to know who did it.
      await record({
        code: "WO_PRIORITY_SET",
        entityType: "WorkOrder", entityId: w.id,
        actorId: (req as any).user.id,
        orderId: w.orderLine.orderId,
        payload: { code: w.code, from: labelOf(w.priority), to: b.level,
                   note: b.note ?? null },
      });
      return { id: saved.id, priority: saved.priority, level: b.level };
    });

  /**
   * تحميل المحطات — where the factory is waiting.
   *
   * For each station: the standard minutes still queued in front of it against
   * what it can do in a day. The ratio is the answer a production manager
   * actually needs — "cutting has eleven days of work and finishing has one"
   * is a decision about where to put people, and no screen could say it.
   */
  app.get("/planning/load", { preHandler: guard(PLANNING) }, async () => {
    const [stations, stages] = await Promise.all([
      db.station.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
      db.workOrderStage.findMany({
        where: {
          status: { in: ["PENDING", "READY", "IN_PROGRESS", "PAUSED"] },
          workOrder: { status: { notIn: ["DONE", "CANCELLED"] } },
        },
        include: {
          routingStage: true,
          workOrder: { select: { qty: true, priority: true,
                                 orderLine: { select: { promisedDate: true,
                                              order: { select: { promisedDate: true } } } } } },
        },
      }),
    ]);

    // How many people can actually stand at each station. A station with
    // eight days of queue and four people is not the same problem as one with
    // eight days and nobody.
    const [users, groups] = await Promise.all([
      db.user.groupBy({ by: ["stationId"], where: { isActive: true }, _count: true }),
      db.group.findMany({ where: { isActive: true }, include: { _count: { select: { members: true } } } }),
    ]);

    const now = Date.now();
    const rows = stations.map((st) => {
      const mine = stages.filter((s) => s.routingStage.stationId === st.id);
      const minutes = (list: typeof mine) =>
        list.reduce((sum, s) => sum + s.routingStage.stdMinutes * s.workOrder.qty, 0);
      const queued = minutes(mine);
      const lateMinutes = minutes(mine.filter((s) => {
        const d = s.workOrder.orderLine.promisedDate ?? s.workOrder.orderLine.order.promisedDate;
        return d != null && d.getTime() < now;
      }));
      const people = (users.find((u) => u.stationId === st.id)?._count ?? 0)
        + groups.filter((g) => g.stationId === st.id)
                .reduce((s, g) => s + g._count.members, 0);

      return {
        id: st.id, code: st.code, nameAr: st.nameAr, nameEn: st.nameEn,
        dailyCapacityMinutes: st.dailyCapacityMinutes,
        queuedMinutes: queued,
        queuedHours: Math.round(queued / 6) / 10,
        inProgress: mine.filter((s) => s.status === "IN_PROGRESS").length,
        blocked: mine.filter((s) => s.status === "PAUSED").length,
        pieces: mine.length,
        lateMinutes,
        people,
        // How long this station would take to clear what is in front of it if
        // nothing else arrived. Capacity is per station, not per head — a
        // second bench does not double a single machine.
        daysOfQueue: st.dailyCapacityMinutes > 0
          ? Math.round((queued / st.dailyCapacityMinutes) * 10) / 10 : null,
      };
    });

    const worst = rows.filter((r) => r.daysOfQueue != null)
                      .sort((a, b) => (b.daysOfQueue ?? 0) - (a.daysOfQueue ?? 0))[0];
    return {
      totals: {
        queuedHours: Math.round(rows.reduce((s, r) => s + r.queuedMinutes, 0) / 60),
        capacityHoursPerDay: Math.round(rows.reduce((s, r) => s + r.dailyCapacityMinutes, 0) / 60),
        stations: rows.length,
      },
      // Naming it is the point. A list of numbers leaves the reader to find
      // the bottleneck; the bottleneck is the reason they opened the screen.
      bottleneck: worst && (worst.daysOfQueue ?? 0) > 0 ? worst.id : null,
      rows,
    };
  });

  /**
   * أقرب موعد تسليم — the date the factory can actually stand behind.
   *
   * Asked while the customer is at the counter, before anything is written.
   * A promise date used to be a guess, or a fixed fourteen days that knew
   * nothing about the eleven days of work standing in front of cutting.
   *
   * The showroom asks this, not the factory: it is the counter that makes the
   * promise, and a date only the factory can see is a date nobody quotes.
   */
  app.post("/planning/promise", { preHandler: guard([...new Set([...PLANNING, ...SELL])]) },
    async (req, reply) => {
      const b = z.object({
        lines: z.array(z.object({
          productId: z.string().optional(),
          qty: z.number().int().positive().default(1),
        })).min(1),
      }).parse(req.body);

      const [routing, q, cfg] = await Promise.all([
        defaultRouting(), stationQueues(), promiseSettings(),
      ]);
      if (!routing || routing.stages.length === 0) {
        return reply.code(400).send({ error: "no_routing_configured" });
      }

      // Each line is quoted against the queue the lines before it just added:
      // three wardrobes are not three separate pieces alone in the factory.
      const extra = new Map<string, number>();
      const lines = b.lines.map((l) => {
        const r = workingDaysFor(routing, l.qty, q, extra);
        addToQueues(routing, l.qty, extra);
        return { qty: l.qty, workingDays: r.days, steps: r.steps };
      });

      const worst = lines.reduce<number | null>(
        (m, l) => (l.workingDays == null || m == null ? null : Math.max(m, l.workingDays)), 0);
      if (worst == null) {
        // A station with no capacity cannot be scheduled through, and a made-up
        // number here is a date nobody could defend.
        return { date: null, workingDays: null, bufferDays: cfg.bufferDays,
                 reason: "no_capacity", lines };
      }
      const withBuffer = worst + cfg.bufferDays;
      return {
        date: addWorkingDays(new Date(), withBuffer, cfg.restDays),
        workingDays: Math.ceil(worst),
        bufferDays: cfg.bufferDays,
        totalWorkingDays: Math.ceil(withBuffer),
        restDays: cfg.restDays,
        // The station the date is really waiting on. Everything else is noise
        // to whoever is about to argue about a week either way.
        bottleneck: (() => {
          const st = lines[0].steps;
          const worstStep = st.reduce((a, x) => (x.waitDays > (a?.waitDays ?? -1) ? x : a),
                                      st[0] ?? null);
          return worstStep && worstStep.waitDays > 0.5 ? worstStep.station : null;
        })(),
        lines,
      };
    });

  /**
   * الوعود المهددة — dates already given that the factory can no longer meet.
   *
   * The early warning the business never had. "Late" arrived as a fact on the
   * day it happened; this says it a fortnight earlier, while there is still a
   * phone call that helps.
   *
   * Measured from the work **left** on each piece, not from a fresh order's
   * lead time — a piece three stages in has three stages behind it, and
   * judging it as though it were new would call the whole factory late.
   */
  app.get("/planning/promises", { preHandler: guard(PLANNING) }, async () => {
    const [q, cfg, lines] = await Promise.all([
      stationQueues(), promiseSettings(),
      db.orderLine.findMany({
        where: { status: { notIn: ["DELIVERED", "CANCELLED"] } },
        include: {
          product: true,
          order: { include: { customer: true } },
          workOrders: {
            where: { status: { notIn: ["CANCELLED"] } },
            include: { stages: { include: { routingStage: true } } },
          },
        },
        take: 300,
      }),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = lines.map((l) => {
      const wo = l.workOrders[0];
      const left = wo
        ? daysLeftFor(wo.stages as any,
                      { id: wo.id, qty: wo.qty, code: wo.code, priority: wo.priority,
                        orderLine: { promisedDate: l.promisedDate,
                                     order: { promisedDate: l.order.promisedDate } } },
                      q)
        : null;
      const canDo = left == null ? null
        : addWorkingDays(today, left + cfg.bufferDays, cfg.restDays);
      const promised = l.promisedDate ?? l.order.promisedDate;
      const slipDays = promised && canDo
        ? Math.ceil((canDo.getTime() - promised.getTime()) / 86_400_000) : null;

      return {
        id: l.id, orderId: l.orderId, orderCode: l.order.code,
        customer: l.order.customer.name,
        customerPhone: l.order.customer.phone,
        product: { nameAr: l.product.nameAr, nameEn: l.product.nameEn },
        qty: l.qty, status: l.status,
        promisedDate: promised,
        // Nothing was promised, so nothing can slip — but somebody should say
        // a date, and that is its own thing to see.
        noPromise: promised == null,
        canDoBy: canDo,
        workingDaysLeft: left == null ? null : Math.ceil(left),
        slipDays,
        atRisk: slipDays != null && slipDays > 0,
      };
    });

    const at = rows.filter((r) => r.atRisk);
    return {
      totals: {
        open: rows.length,
        atRisk: at.length,
        noPromise: rows.filter((r) => r.noPromise).length,
        alreadyLate: rows.filter((r) => r.promisedDate
          && r.promisedDate.getTime() < today.getTime()).length,
        worstSlipDays: at.length ? Math.max(...at.map((r) => r.slipDays ?? 0)) : 0,
      },
      // Worst slip first: the one to ring about today.
      rows: rows.sort((a, b) =>
        (b.slipDays ?? -9e9) - (a.slipDays ?? -9e9)
        || (a.promisedDate?.getTime() ?? 9e15) - (b.promisedDate?.getTime() ?? 9e15)),
    };
  });

  /**
   * What a station can do in a day.
   *
   * Editable here rather than only in setup, because the load figures are
   * worthless against a capacity nobody has ever corrected, and the person who
   * reads them is the person who knows.
   */
  app.put("/planning/stations/:id/capacity", { preHandler: guard(PLANNING) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = z.object({
        dailyCapacityMinutes: z.number().int().positive().max(24 * 60),
      }).parse(req.body);
      if (!(await db.station.findUnique({ where: { id } }))) {
        return reply.code(404).send({ error: "not_found" });
      }
      const saved = await db.station.update({ where: { id }, data: b });
      return { id: saved.id, dailyCapacityMinutes: saved.dailyCapacityMinutes };
    });
}
