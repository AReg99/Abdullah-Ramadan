import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { day, money, n, period } from "../../lib/books.js";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { ATTENDANCE, BOOKS, COLLECT } from "../../auth/scopes.js";
import { atMidday, dayValue, resolvePeriod, weekKeyOf } from "../../lib/period.js";
import { record } from "../../lib/events.js";
import { nextNumber } from "../../lib/sequence.js";

/**
 * Attendance and wages.
 *
 * Separate from the books because a workshop can perfectly well keep its cash
 * in this system and pay its people out of a notebook — and because the floor
 * is paid weekly against days it turned up while the office is paid monthly,
 * which is a different calendar from everything in accounting.
 */
/**
 * What everybody is owed for a period, before it is posted.
 *
 * One function, used by both the screen and the posting, because the moment
 * there are two the figure a person was shown and the figure that left the
 * drawer start to disagree.
 *
 * Monthly people are paid their salary. Daily people are paid for the days
 * they were actually in — which is why attendance is not a report but the
 * thing the wage is computed from.
 */
async function payslipsFor(p: { kind: string; start: Date; end: Date; days: Date[] }, period: string) {
  const staff = await db.user.findMany({
    where: {
      isActive: true,
      // A weekly run pays the floor; a monthly run pays the office. Paying
      // everyone in both would pay the office twice.
      ...(p.kind === "WEEKLY"
        ? { payType: "DAILY" as const, dayRate: { not: null } }
        : { payType: "MONTHLY" as const, salary: { not: null } }),
    },
    include: { role: true },
    orderBy: { nameAr: "asc" },
  });
  const adj = await db.payrollAdjustment.findMany({ where: { period } });
  const attendance = p.kind === "WEEKLY"
    ? await db.attendance.findMany({ where: { day: { gte: p.start, lte: p.end } } })
    : [];

  return staff.map((u) => {
    const a = adj.find((x) => x.userId === u.id);
    const daily = u.payType === "DAILY";
    // Nobody has ticked the register yet means everybody was in, which is the
    // normal case: attendance is taken by marking the absences.
    const days = daily
      ? p.days.reduce((s, d) => {
          const row = attendance.find((r) => r.userId === u.id && r.day.getTime() === d.getTime());
          return s + dayValue(row?.status ?? "PRESENT");
        }, 0)
      : 0;
    const rate = Number(u.dayRate ?? 0);
    const base = daily ? Math.round(days * rate * 100) / 100 : Number(u.salary ?? 0);
    const add = Number(a?.overtime ?? 0) + Number(a?.bonus ?? 0);
    const off = Number(a?.advance ?? 0) + Number(a?.deduction ?? 0) + Number(a?.insurance ?? 0);
    return {
      userId: u.id, nameAr: u.nameAr, nameEn: u.nameEn, role: u.role.key,
      payType: u.payType,
      baseSalary: base, dayRate: daily ? rate : 0, daysWorked: days,
      overtime: Number(a?.overtime ?? 0), bonus: Number(a?.bonus ?? 0),
      advance: Number(a?.advance ?? 0), deduction: Number(a?.deduction ?? 0),
      insurance: Number(a?.insurance ?? 0),
      // Never below zero: an advance bigger than the wage is carried into the
      // next period, not clawed back out of the drawer.
      amount: Math.max(0, Math.round((base + add - off) * 100) / 100),
    };
  });
}

export default async function hrRoutes(app: FastifyInstance) {
  // ──────────────────────────────────────────────────────── payroll (المرتبات)

  /**
   * Who is on the payroll for a period, what they are owed, and why.
   *
   * A period is "2026-08" for a month or "2026-W35" for a week. The floor is
   * paid weekly against the days they turned up; the office is paid monthly.
   * Both are worked out here, so nobody has to keep two sets of figures.
   */
  app.get("/money/payroll/:period", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const { period } = req.params as { period: string };
    const p = resolvePeriod(period);
    if (!p.ok) return reply.code(400).send({ error: "bad_period" });

    const run = await db.payrollRun.findUnique({
      where: { period },
      include: { lines: { include: { user: true } }, account: true },
    });
    // Once posted, the run is the record — not today's rates, which may have
    // changed since. An old week must read back as it was paid.
    if (run) {
      return {
        period, kind: run.kind, posted: true, postedAt: run.postedAt,
        start: run.periodStart ?? p.start, end: run.periodEnd ?? p.end,
        account: { id: run.account.id, nameAr: run.account.nameAr, nameEn: run.account.nameEn },
        total: run.lines.reduce((s2, l) => s2 + n(l.amount), 0),
        lines: run.lines.map((l) => ({
          userId: l.userId, nameAr: l.user.nameAr, nameEn: l.user.nameEn,
          payType: l.user.payType,
          baseSalary: n(l.baseSalary), dayRate: n(l.dayRate), daysWorked: n(l.daysWorked),
          overtime: n(l.overtime), bonus: n(l.bonus),
          advance: n(l.advance), deduction: n(l.deduction), insurance: n(l.insurance),
          amount: n(l.amount),
        })),
      };
    }

    const lines = await payslipsFor(p, period);
    return {
      period, kind: p.kind, posted: false, start: p.start, end: p.end,
      total: lines.reduce((s2, l) => s2 + l.amount, 0),
      lines,
    };
  });

  /**
   * What changes about one person's pay this period: overtime, a bonus, an
   * advance already handed over, a deduction, insurance withheld.
   *
   * Kept apart from the wage itself, because the next period starts clean — an
   * advance taken in one week must not quietly repeat in the next.
   */
  app.put("/money/payroll/:period/:userId", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const { period, userId } = req.params as { period: string; userId: string };
    if (!resolvePeriod(period).ok) return reply.code(400).send({ error: "bad_period" });
    if (await db.payrollRun.findUnique({ where: { period } })) {
      return reply.code(409).send({ error: "period_already_paid" });
    }
    if (!(await db.user.findUnique({ where: { id: userId } }))) {
      return reply.code(404).send({ error: "not_found" });
    }
    const b = z.object({
      overtime: z.number().nonnegative().default(0),
      bonus: z.number().nonnegative().default(0),
      advance: z.number().nonnegative().default(0),
      deduction: z.number().nonnegative().default(0),
      insurance: z.number().nonnegative().default(0),
      note: z.string().max(300).optional(),
    }).parse(req.body ?? {});
    const data = {
      overtime: String(b.overtime), bonus: String(b.bonus), advance: String(b.advance),
      deduction: String(b.deduction), insurance: String(b.insurance), note: b.note ?? null,
    };
    return db.payrollAdjustment.upsert({
      where: { period_userId: { period, userId } },
      update: data,
      create: { period, userId, ...data },
    });
  });

  /**
   * Pay the period. One entry per person so a single payslip can be reversed
   * without unpicking the rest, and unique on the period so a week cannot be
   * paid twice — which is the mistake this whole record exists to prevent.
   */
  app.post("/money/payroll/:period", { preHandler: guard(BOOKS) }, async (req, reply) => {
    const { period } = req.params as { period: string };
    const p = resolvePeriod(period);
    if (!p.ok) return reply.code(400).send({ error: "bad_period" });

    const b = z.object({
      accountId: z.string(),
      note: z.string().max(300).optional(),
      /** Leave somebody out this period without touching their wage. */
      skip: z.array(z.string()).default([]),
    }).parse(req.body);

    if (await db.payrollRun.findUnique({ where: { period } })) {
      return reply.code(409).send({ error: "period_already_paid" });
    }
    if (!(await db.cashAccount.findUnique({ where: { id: b.accountId } }))) {
      return reply.code(404).send({ error: "account_not_found" });
    }

    // The same function the screen used, so the two cannot disagree about what
    // anybody is owed.
    const slips = (await payslipsFor(p, period)).filter(
      (l) => !b.skip.includes(l.userId) && l.amount > 0);
    if (slips.length === 0) return reply.code(400).send({ error: "nobody_on_payroll" });

    const run = await db.payrollRun.create({
      data: {
        period, kind: p.kind, periodStart: p.start, periodEnd: p.end,
        accountId: b.accountId, actorId: (req as any).user.id, note: b.note ?? null,
      },
    });

    let total = 0;
    for (const l of slips) {
      const entry = await db.cashEntry.create({
        data: {
          accountId: b.accountId, direction: "OUT", amount: String(l.amount),
          voucherNo: await nextNumber("PV"),
          // Wages belong to the period worked, not the day the money moved.
          method: "CASH", occurredOn: p.end, category: "SALARIES",
          note: `${period} · ${l.nameAr}`, actorId: (req as any).user.id,
        },
      });
      await db.payrollLine.create({
        data: {
          runId: run.id, userId: l.userId, entryId: entry.id,
          baseSalary: String(l.baseSalary), dayRate: String(l.dayRate),
          daysWorked: String(l.daysWorked),
          overtime: String(l.overtime), bonus: String(l.bonus),
          advance: String(l.advance), deduction: String(l.deduction),
          insurance: String(l.insurance), amount: String(l.amount),
        },
      });
      total += l.amount;
    }
    return { period, kind: p.kind, paid: slips.length, total };
  });

  // ───────────────────────────────────────────────────── attendance (الحضور)

  /**
   * The day sheet: everyone paid by the day, and whether they were in.
   *
   * Anybody with no row yet comes back as PRESENT, because that is the normal
   * case and ticking only the absences is how attendance is actually taken.
   */
  app.get("/money/attendance/:day", { preHandler: guard(ATTENDANCE) }, async (req, reply) => {
    const { day } = req.params as { day: string };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return reply.code(400).send({ error: "bad_day" });
    const when = atMidday(new Date(`${day}T12:00:00Z`));

    const staff = await db.user.findMany({
      where: { isActive: true, payType: "DAILY" },
      include: { role: true }, orderBy: { nameAr: "asc" },
    });
    const rows = await db.attendance.findMany({ where: { day: when } });
    return {
      day, weekKey: weekKeyOf(when),
      lines: staff.map((u) => {
        const a = rows.find((r) => r.userId === u.id);
        return {
          userId: u.id, nameAr: u.nameAr, nameEn: u.nameEn, role: u.role.key,
          dayRate: n(u.dayRate),
          status: a?.status ?? "PRESENT",
          overtimeHours: n(a?.overtimeHours),
          note: a?.note ?? null,
          recorded: Boolean(a),
        };
      }),
    };
  });

  /** Take the register for one day. */
  app.put("/money/attendance/:day", { preHandler: guard(ATTENDANCE) }, async (req, reply) => {
    const { day } = req.params as { day: string };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return reply.code(400).send({ error: "bad_day" });
    const when = atMidday(new Date(`${day}T12:00:00Z`));
    // A future day cannot be attended. Marking one is always a mistyped date,
    // and it would quietly inflate a wage.
    if (when.getTime() > Date.now() + 86_400_000) {
      return reply.code(400).send({ error: "day_in_the_future" });
    }
    const paid = await db.payrollRun.findUnique({ where: { period: weekKeyOf(when) } });
    if (paid) return reply.code(409).send({ error: "period_already_paid" });

    const b = z.object({
      lines: z.array(z.object({
        userId: z.string(),
        status: z.enum(["PRESENT", "HALF", "LEAVE", "ABSENT"]),
        overtimeHours: z.number().nonnegative().max(24).default(0),
        note: z.string().max(200).optional(),
      })).min(1),
    }).parse(req.body);

    for (const l of b.lines) {
      const data = {
        status: l.status, overtimeHours: String(l.overtimeHours),
        note: l.note ?? null, actorId: (req as any).user.id,
      };
      await db.attendance.upsert({
        where: { userId_day: { userId: l.userId, day: when } },
        update: data,
        create: { userId: l.userId, day: when, ...data },
      });
    }
    return { day, saved: b.lines.length };
  });

  /** The week at a glance: a row per person, a column per day. */
  app.get("/money/attendance/week/:period", { preHandler: guard(ATTENDANCE) }, async (req, reply) => {
    const { period } = req.params as { period: string };
    const p = resolvePeriod(period);
    if (!p.ok || p.kind !== "WEEKLY") return reply.code(400).send({ error: "bad_period" });

    const staff = await db.user.findMany({
      where: { isActive: true, payType: "DAILY" }, orderBy: { nameAr: "asc" },
    });
    const rows = await db.attendance.findMany({
      where: { day: { gte: p.start, lte: p.end } },
    });
    return {
      period, start: p.start, end: p.end,
      days: p.days.map((d) => d.toISOString().slice(0, 10)),
      lines: staff.map((u) => {
        const mine = p.days.map((d) => {
          const a = rows.find((r) => r.userId === u.id && r.day.getTime() === d.getTime());
          return { day: d.toISOString().slice(0, 10), status: a?.status ?? "PRESENT",
                   overtimeHours: n(a?.overtimeHours) };
        });
        const days = mine.reduce((s2, x) => s2 + dayValue(x.status), 0);
        return {
          userId: u.id, nameAr: u.nameAr, nameEn: u.nameEn, dayRate: n(u.dayRate),
          days, earned: Math.round(days * n(u.dayRate) * 100) / 100,
          cells: mine,
        };
      }),
    };
  });

}
