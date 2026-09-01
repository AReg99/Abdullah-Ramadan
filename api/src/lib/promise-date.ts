import { db } from "../db.js";
import { allSettings } from "./settings.js";

/**
 * When a piece can honestly be finished.
 *
 * A promise date was a rep's guess, or `baseLeadDays` — a fixed fourteen that
 * knows nothing about what is standing in the factory. So a customer was told
 * two weeks while cutting had eleven days of work in front of it, and the first
 * anybody heard about it was the order going red.
 *
 * Everything needed was already here and never put together: the routing says
 * which stations a piece passes through and how long it takes at each, every
 * station carries a daily capacity, and the open work orders say what is
 * already queued in front of it.
 *
 * The calculation is a forward pass through the routing. At each station the
 * piece waits for whatever is already queued there, and cannot start before it
 * has finished at the station before:
 *
 *   ready[i] = max(ready[i-1], queue[station i]) + this piece's own time
 *
 * That is finite-capacity scheduling at its simplest, and it is the honest
 * shape of the answer: the bottleneck decides the date, not the sum of the
 * standard times.
 */

export type PromiseSettings = { bufferDays: number; restDays: number[] };

export async function promiseSettings(): Promise<PromiseSettings> {
  const s = await allSettings();
  return {
    bufferDays: Number(s["promise.bufferDays"]) || 0,
    restDays: String(s["promise.restDays"] ?? "")
      .split(",").map((x) => Number(x.trim()))
      .filter((x) => Number.isInteger(x) && x >= 0 && x <= 6),
  };
}

/**
 * Working days forward from today, skipping the days the factory is shut.
 *
 * Counting calendar days would quietly promise a piece on a Friday, and a
 * customer told Friday who rings on Friday is a customer nobody can help.
 */
export function addWorkingDays(from: Date, days: number, restDays: number[]) {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  let left = Math.ceil(days);
  // A factory that never works has no date to give.
  if (restDays.length >= 7) return null;
  let guard = 0;
  while (left > 0 && guard++ < 4000) {
    d.setDate(d.getDate() + 1);
    if (!restDays.includes(d.getDay())) left--;
  }
  // Never land the answer on a day nobody is in.
  while (restDays.includes(d.getDay()) && guard++ < 4000) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * What is queued at every station, in minutes of standard work.
 *
 * Read once and handed to every line being quoted, because a five-line order
 * asked for it five times would be five identical passes over the same open
 * work orders.
 */
export async function stationQueues() {
  const [stations, stages] = await Promise.all([
    db.station.findMany({ where: { isActive: true } }),
    db.workOrderStage.findMany({
      where: {
        status: { in: ["PENDING", "READY", "IN_PROGRESS", "PAUSED"] },
        workOrder: { status: { notIn: ["DONE", "CANCELLED"] } },
      },
      include: {
        routingStage: { select: { stationId: true, stdMinutes: true } },
        workOrder: {
          select: {
            id: true, code: true, qty: true, priority: true,
            orderLine: { select: { promisedDate: true,
                                   order: { select: { promisedDate: true } } } },
          },
        },
      },
    }),
  ]);

  const q = new Map<string, number>();
  // The same queue, but each entry keeping its place in it. A piece already in
  // the factory waits for the work **ahead** of it, not for everything —
  // counting an order taken this afternoon as standing in front of one taken
  // last week would flag half the factory as late for no reason, and a warning
  // screen that cries wolf is one nobody opens twice.
  const ordered = new Map<string, { rank: string; woId: string; minutes: number }[]>();
  for (const st of stations) { q.set(st.id, 0); ordered.set(st.id, []); }

  for (const s of stages) {
    const id = s.routingStage.stationId;
    if (!q.has(id)) continue;
    const minutes = s.routingStage.stdMinutes * s.workOrder.qty;
    q.set(id, (q.get(id) ?? 0) + minutes);
    ordered.get(id)!.push({ rank: rankOf(s.workOrder), woId: s.workOrder.id, minutes });
  }
  for (const list of ordered.values()) list.sort((a, b) => a.rank.localeCompare(b.rank));

  return {
    queued: q,
    ordered,
    capacity: new Map(stations.map((st) => [st.id, st.dailyCapacityMinutes])),
    names: new Map(stations.map((st) => [st.id, st.nameAr])),
  };
}

/**
 * Where a work order sits in the queue, as one sortable string.
 *
 * The same order the floor works to and the planning board shows: priority
 * first, then the promise date, then the code. A date worked out against a
 * different order from the one the floor follows is a date that will not
 * happen.
 */
function rankOf(w: {
  code: string; priority: number;
  orderLine: { promisedDate: Date | null; order: { promisedDate: Date | null } };
}) {
  const due = w.orderLine.promisedDate ?? w.orderLine.order.promisedDate;
  const pri = String(999 - w.priority).padStart(4, "0");
  const when = due ? String(due.getTime()).padStart(16, "0") : "9".repeat(16);
  return `${pri}|${when}|${w.code}`;
}

export type Queues = Awaited<ReturnType<typeof stationQueues>>;

/**
 * The forward pass for one line: a quantity of one product through one routing.
 *
 * `extra` carries what earlier lines of the same order have already added to
 * each station, so quoting three wardrobes does not quote each of them as if
 * it were alone in the factory.
 */
export function workingDaysFor(
  routing: { stages: { stationId: string; stdMinutes: number; nameAr: string }[] },
  qty: number,
  q: Queues,
  extra?: Map<string, number>,
) {
  let ready = 0;
  const steps: { stage: string; station: string | null; waitDays: number;
                 ownDays: number; readyDay: number }[] = [];

  for (const st of routing.stages) {
    const cap = q.capacity.get(st.stationId) ?? 0;
    // A station with no capacity cannot be scheduled through, and guessing a
    // number here would produce a date nobody could defend.
    if (cap <= 0) return { days: null, steps };
    const queued = (q.queued.get(st.stationId) ?? 0) + (extra?.get(st.stationId) ?? 0);
    const waitDays = queued / cap;
    const ownDays = (st.stdMinutes * qty) / cap;
    // Whichever is later: this station clearing its queue, or the piece
    // arriving from the station before it.
    ready = Math.max(ready, waitDays) + ownDays;
    steps.push({
      stage: st.nameAr, station: q.names.get(st.stationId) ?? null,
      waitDays: Math.round(waitDays * 10) / 10,
      ownDays: Math.round(ownDays * 10) / 10,
      readyDay: Math.round(ready * 10) / 10,
    });
  }
  return { days: ready, steps };
}

/** What this line adds to each station, for the next line of the same order. */
export function addToQueues(
  routing: { stages: { stationId: string; stdMinutes: number }[] },
  qty: number,
  into: Map<string, number>,
) {
  for (const st of routing.stages) {
    into.set(st.stationId, (into.get(st.stationId) ?? 0) + st.stdMinutes * qty);
  }
  return into;
}

/** The routing a piece will actually follow. One default for now. */
export async function defaultRouting() {
  const r = await db.routing.findFirst({
    where: { isDefault: true },
    include: { stages: { orderBy: { seq: "asc" }, include: { station: true } } },
  });
  if (!r) return null;
  return {
    id: r.id, nameAr: r.nameAr,
    stages: r.stages.map((s) => ({
      stationId: s.stationId, stdMinutes: s.stdMinutes, nameAr: s.nameAr,
    })),
  };
}

/**
 * Is a date already promised still achievable?
 *
 * Deliberately measured from what is *left* to do rather than from the whole
 * routing: a piece three stages in has three stages of work behind it, and
 * judging it against a fresh order's lead time would call every order in the
 * factory late.
 */
export function daysLeftFor(
  stages: { status: string; routingStage: { stationId: string; stdMinutes: number } }[],
  wo: { id: string; qty: number; code: string; priority: number;
        orderLine: { promisedDate: Date | null; order: { promisedDate: Date | null } } },
  q: Queues,
) {
  const rank = rankOf(wo);
  /** Only the work standing in front of this piece at that station. */
  const ahead = (stationId: string) =>
    (q.ordered.get(stationId) ?? [])
      .filter((x) => x.woId !== wo.id && x.rank < rank)
      .reduce((s, x) => s + x.minutes, 0);

  let ready = 0;
  let any = false;
  for (const s of stages) {
    if (s.status === "DONE" || s.status === "CANCELLED") continue;
    const cap = q.capacity.get(s.routingStage.stationId) ?? 0;
    if (cap <= 0) return null;
    any = true;
    ready = Math.max(ready, ahead(s.routingStage.stationId) / cap)
          + (s.routingStage.stdMinutes * wo.qty) / cap;
  }
  return any ? ready : 0;
}
