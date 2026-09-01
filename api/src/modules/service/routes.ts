import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { SERVICE, SERVICE_VISIT } from "../../auth/scopes.js";
import { nextNumber } from "../../lib/sequence.js";
import { allSettings } from "../../lib/settings.js";
import { isAllowed, readUpload, storeFile } from "../../lib/uploads.js";

/**
 * الضمان وما بعد البيع.
 *
 * The system forgot a piece the moment it was handed over. A customer ringing
 * six months later about a sagging wardrobe door reached a WhatsApp message and
 * somebody's memory: nothing said whether it was still under warranty, nothing
 * tracked the repair, and nothing learned which models keep coming back —
 * which is the only figure here that would change what the factory builds.
 *
 * `Product.warrantyMonths` has been in the schema since the first release and
 * nothing ever read it. `OrderLine.deliveredAt` has been written all along.
 * The warranty was computable and simply never computed.
 */

const n = (d: unknown) => Number(d ?? 0);
const MONTH_MS = 30.4375 * 86_400_000;

/**
 * When the warranty runs out.
 *
 * From the day the customer actually took the piece, not from the order — an
 * order placed in March and delivered in May is not eleven months of cover.
 * A piece that has not been delivered has no warranty running yet, which is a
 * different answer from "expired" and is said differently.
 */
function warrantyOf(line: any, fallbackMonths: number) {
  const months = line.product?.warrantyMonths ?? fallbackMonths;
  if (!line.deliveredAt) {
    return { delivered: false, months, until: null as Date | null,
             inWarranty: false, daysLeft: null as number | null };
  }
  const until = new Date(line.deliveredAt.getTime() + months * MONTH_MS);
  const daysLeft = Math.ceil((until.getTime() - Date.now()) / 86_400_000);
  return { delivered: true, months, until, inWarranty: daysLeft >= 0, daysLeft };
}

export default async function serviceRoutes(app: FastifyInstance) {
  /**
   * Is this piece still covered?
   *
   * Asked before a ticket exists: the showroom is on the phone to the customer
   * and needs the answer in that conversation, not after raising a record.
   */
  app.get("/service/warranty/:orderLineId", { preHandler: guard(SERVICE) },
    async (req, reply) => {
      const { orderLineId } = req.params as { orderLineId: string };
      const line = await db.orderLine.findUnique({
        where: { id: orderLineId },
        include: { product: true, order: { include: { customer: true } } },
      });
      if (!line) return reply.code(404).send({ error: "not_found" });
      const s = await allSettings();
      const w = warrantyOf(line, Number(s["warranty.months"]) || 24);
      return {
        orderLineId: line.id,
        order: { id: line.orderId, code: line.order.code },
        customer: { name: line.order.customer.name, phone: line.order.customer.phone },
        product: { nameAr: line.product.nameAr, nameEn: line.product.nameEn,
                   sku: line.product.sku },
        deliveredAt: line.deliveredAt,
        ...w,
      };
    });

  /** The same question from a label, which is what a technician has in hand. */
  app.get("/service/by-serial/:serial", { preHandler: guard(SERVICE_VISIT) },
    async (req, reply) => {
      const { serial } = req.params as { serial: string };
      const label = await db.unitLabel.findUnique({
        where: { serial },
        include: { workOrder: { include: { orderLine: {
          include: { product: true, order: { include: { customer: true } } } } } } },
      });
      if (!label) return reply.code(404).send({ error: "unknown_label" });
      const line = label.workOrder.orderLine;
      const s = await allSettings();
      return {
        serial, orderLineId: line.id,
        order: { id: line.orderId, code: line.order.code },
        customer: { name: line.order.customer.name, phone: line.order.customer.phone,
                    address: line.order.customer.address },
        product: { nameAr: line.product.nameAr, nameEn: line.product.nameEn,
                   sku: line.product.sku },
        deliveredAt: line.deliveredAt,
        ...warrantyOf(line, Number(s["warranty.months"]) || 24),
      };
    });

  /**
   * Who can be sent out.
   *
   * The showroom takes the call and names somebody, but the staff list is the
   * factory manager's — so they could assign a ticket with no way to see who
   * to assign it to. This is the narrow answer: the people who may record a
   * visit, and nothing else about them.
   */
  app.get("/service/technicians", { preHandler: guard(SERVICE) }, async () => {
    const rows = await db.user.findMany({
      where: { isActive: true, canLogin: true, role: { key: { in: SERVICE_VISIT as any } } },
      include: { role: true }, orderBy: { nameAr: "asc" },
    });
    return rows.map((u) => ({
      id: u.id, nameAr: u.nameAr, nameEn: u.nameEn, role: u.role.key,
    }));
  });

  // ─────────────────────────────────────────────────── the tickets

  /**
   * The list.
   *
   * A technician gets it too, narrowed to what they were actually sent to —
   * the person driving to the house needs the address and the fault, and a
   * screen only the office may open is a screen they work around. What they
   * do not get is the money: what a repair cost and what was charged is the
   * office's, and it is on the same record.
   */
  app.get("/service/tickets", { preHandler: guard(SERVICE_VISIT) }, async (req) => {
    const user = (req as any).user;
    const office = SERVICE.includes(user.role.key);
    const q = z.object({
      status: z.string().optional(), kind: z.string().optional(),
      mine: z.string().optional(),
    }).parse(req.query ?? {});
    const rows = await db.serviceTicket.findMany({
      where: {
        ...(q.status ? { status: q.status as any } : {}),
        ...(q.kind ? { kind: q.kind as any } : {}),
        ...(!office || q.mine === "1" ? { assignedToId: user.id } : {}),
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200, include: TICKET,
    });
    return rows.map((r) => view(r, office));
  });

  app.get("/service/tickets/:id", { preHandler: guard(SERVICE_VISIT) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = (req as any).user;
      const t = await db.serviceTicket.findUnique({ where: { id }, include: TICKET });
      if (!t) return reply.code(404).send({ error: "not_found" });
      const office = SERVICE.includes(user.role.key);
      if (!office && t.assignedToId !== user.id) {
        return reply.code(403).send({ error: "forbidden" });
      }
      return view(t, office);
    });

  /**
   * Taking the complaint.
   *
   * A piece that was never delivered cannot have an after-sales fault — it is
   * either still in the factory or still in the showroom, and both of those
   * are somebody else's screen. Refusing here keeps production problems out of
   * the after-sales figures, which is what makes those figures mean anything.
   */
  app.post("/service/tickets", { preHandler: guard(SERVICE) }, async (req, reply) => {
    const b = z.object({
      orderLineId: z.string(),
      serial: z.string().max(60).optional(),
      description: z.string().min(1).max(1000),
      defectTypeId: z.string().optional(),
      promisedDate: z.string().datetime().optional(),
      assignedToId: z.string().optional(),
    }).parse(req.body);

    const line = await db.orderLine.findUnique({
      where: { id: b.orderLineId }, include: { product: true },
    });
    if (!line) return reply.code(404).send({ error: "line_not_found" });
    if (!line.deliveredAt) return reply.code(409).send({ error: "not_delivered_yet" });

    if (b.defectTypeId
        && !(await db.defectType.findUnique({ where: { id: b.defectTypeId } }))) {
      return reply.code(404).send({ error: "defect_type_not_found" });
    }
    if (b.serial) {
      const label = await db.unitLabel.findUnique({ where: { serial: b.serial } });
      if (!label) return reply.code(404).send({ error: "unknown_label" });
    }

    const s = await allSettings();
    const w = warrantyOf(line, Number(s["warranty.months"]) || 24);
    const made = await db.serviceTicket.create({
      data: {
        number: await nextNumber("SRV"),
        orderLineId: line.id, serial: b.serial ?? null,
        description: b.description, defectTypeId: b.defectTypeId ?? null,
        // The answer as it stood today. Somebody will shorten the product's
        // warranty next year and this ticket must still read correctly.
        underWarranty: w.inWarranty, warrantyUntil: w.until,
        kind: w.inWarranty ? "WARRANTY" : "PAID",
        reportedById: (req as any).user.id,
        assignedToId: b.assignedToId ?? null,
        promisedDate: b.promisedDate ? new Date(b.promisedDate) : null,
        status: b.assignedToId ? "SCHEDULED" : "OPEN",
      },
      include: TICKET,
    });
    return view(made);
  });

  /**
   * Moving it along: who is going, when, and whether it is on us.
   *
   * The kind can be overridden — a fault a fortnight out of warranty that is
   * plainly ours gets done as GOODWILL, and naming that rather than filing it
   * as a warranty job is what keeps the warranty figures honest.
   */
  app.patch("/service/tickets/:id", { preHandler: guard(SERVICE) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      assignedToId: z.string().nullable().optional(),
      promisedDate: z.string().datetime().nullable().optional(),
      kind: z.enum(["WARRANTY", "PAID", "GOODWILL"]).optional(),
      status: z.enum(["OPEN", "SCHEDULED", "IN_REPAIR"]).optional(),
      defectTypeId: z.string().nullable().optional(),
      costAmount: z.number().nonnegative().optional(),
      chargeAmount: z.number().nonnegative().optional(),
    }).parse(req.body);

    const t = await db.serviceTicket.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not_found" });
    // Reopening is a new complaint, not an edit of the old one — otherwise a
    // ticket closed in March quietly becomes a ticket about something else.
    if (t.status === "DONE" || t.status === "REJECTED") {
      return reply.code(409).send({ error: "already_closed", status: t.status });
    }
    if (b.assignedToId
        && !(await db.user.findUnique({ where: { id: b.assignedToId } }))) {
      return reply.code(404).send({ error: "person_not_found" });
    }
    // A warranty job the customer is being charged for is one of the two
    // filled in by mistake, and the customer finds out at the door.
    const kind = b.kind ?? t.kind;
    const charge = b.chargeAmount ?? n(t.chargeAmount);
    if (kind !== "PAID" && charge > 0) {
      return reply.code(400).send({ error: "free_job_cannot_be_charged" });
    }

    const saved = await db.serviceTicket.update({
      where: { id },
      data: {
        ...(b.assignedToId !== undefined ? { assignedToId: b.assignedToId } : {}),
        ...(b.promisedDate !== undefined
          ? { promisedDate: b.promisedDate ? new Date(b.promisedDate) : null } : {}),
        ...(b.kind ? { kind: b.kind } : {}),
        ...(b.status ? { status: b.status } : {}),
        ...(b.defectTypeId !== undefined ? { defectTypeId: b.defectTypeId } : {}),
        ...(b.costAmount !== undefined ? { costAmount: String(b.costAmount) } : {}),
        ...(b.chargeAmount !== undefined ? { chargeAmount: String(b.chargeAmount) } : {}),
        // Naming somebody is scheduling it. Leaving it OPEN with an owner is
        // how a ticket sits for a week with everyone assuming it is in hand.
        ...(b.assignedToId && !b.status && t.status === "OPEN"
          ? { status: "SCHEDULED" as const } : {}),
      },
      include: TICKET,
    });
    return view(saved);
  });

  /**
   * A visit. Append-only, because they go more than once: the first trip finds
   * it needs a hinge, the second fits it. A single "what happened" field on the
   * ticket would lose the first trip entirely, and the first trip is the one
   * that cost a van and an afternoon.
   */
  app.post("/service/tickets/:id/visits", { preHandler: guard(SERVICE_VISIT) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = z.object({
        outcome: z.enum(["FIXED", "NEEDS_PARTS", "TAKEN_TO_FACTORY",
                         "CUSTOMER_ABSENT", "NOT_OUR_FAULT", "OTHER"]),
        note: z.string().max(1000).optional(),
        photoPath: z.string().max(300).optional(),
        occurredAt: z.string().datetime().optional(),
      }).parse(req.body);

      const t = await db.serviceTicket.findUnique({ where: { id } });
      if (!t) return reply.code(404).send({ error: "not_found" });
      if (t.status === "DONE" || t.status === "REJECTED") {
        return reply.code(409).send({ error: "already_closed", status: t.status });
      }

      await db.serviceVisit.create({
        data: {
          ticketId: id, technicianId: (req as any).user.id,
          outcome: b.outcome, note: b.note ?? null,
          photoPath: b.photoPath ?? null,
          occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
        },
      });

      // The visit moves the ticket, because a technician who has to remember
      // to also change a status is a technician whose tickets stay open.
      const next = b.outcome === "TAKEN_TO_FACTORY" ? "IN_REPAIR" as const
                 : t.status === "OPEN" ? "SCHEDULED" as const
                 : t.status;
      if (next !== t.status) {
        await db.serviceTicket.update({ where: { id }, data: { status: next } });
      }
      const fresh = await db.serviceTicket.findUnique({ where: { id }, include: TICKET });
      return view(fresh!);
    });

  /** The photograph a technician takes of what is wrong. */
  app.post("/service/photo", { preHandler: guard(SERVICE_VISIT) }, async (req, reply) => {
    const up = await readUpload(req);
    if (!up.buf) return reply.code(400).send({ error: "file_required" });
    if (!isAllowed(up.mime)) {
      return reply.code(415).send({ error: "unsupported_type", mime: up.mime });
    }
    return { path: (await storeFile(up.buf, up.mime, "service")).rel };
  });

  /**
   * Closing it.
   *
   * A resolution is required. A ticket closed with an empty one tells the next
   * person nothing, and the next person is usually the same customer ringing
   * again about the same door.
   */
  app.post("/service/tickets/:id/close", { preHandler: guard(SERVICE) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = z.object({
        resolution: z.string().min(1).max(1000),
        rejected: z.boolean().default(false),
        costAmount: z.number().nonnegative().optional(),
        chargeAmount: z.number().nonnegative().optional(),
        kind: z.enum(["WARRANTY", "PAID", "GOODWILL"]).optional(),
      }).parse(req.body);

      const t = await db.serviceTicket.findUnique({ where: { id } });
      if (!t) return reply.code(404).send({ error: "not_found" });
      if (t.status === "DONE" || t.status === "REJECTED") {
        return reply.code(409).send({ error: "already_closed", status: t.status });
      }
      const kind = b.kind ?? t.kind;
      const charge = b.chargeAmount ?? n(t.chargeAmount);
      if (kind !== "PAID" && charge > 0) {
        return reply.code(400).send({ error: "free_job_cannot_be_charged" });
      }

      const saved = await db.serviceTicket.update({
        where: { id },
        data: {
          status: b.rejected ? "REJECTED" : "DONE",
          resolution: b.resolution, closedAt: new Date(),
          ...(b.kind ? { kind: b.kind } : {}),
          ...(b.costAmount !== undefined ? { costAmount: String(b.costAmount) } : {}),
          ...(b.chargeAmount !== undefined ? { chargeAmount: String(b.chargeAmount) } : {}),
        },
        include: TICKET,
      });
      return view(saved);
    });

  /**
   * تقرير ما بعد البيع — which models come back, why, and what it costs.
   *
   * The point of recording any of this. A count of complaints changes nothing;
   * "this wardrobe came back four times this year and cost us eleven thousand"
   * is a decision about a hinge supplier.
   */
  app.get("/service/report", { preHandler: guard(SERVICE) }, async (req) => {
    const q = z.object({ from: z.string().optional(), to: z.string().optional() })
      .parse(req.query ?? {});
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 365 * 86_400_000);
    const to = q.to ? new Date(`${q.to}T23:59:59`) : new Date();

    const rows = await db.serviceTicket.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: TICKET, orderBy: { createdAt: "desc" },
    });

    const tally = (key: (t: any) => string | null) => {
      const m = new Map<string, { count: number; cost: number }>();
      for (const t of rows) {
        const k = key(t);
        if (!k) continue;
        const cur = m.get(k) ?? { count: 0, cost: 0 };
        m.set(k, { count: cur.count + 1, cost: cur.cost + n(t.costAmount) });
      }
      return [...m.entries()]
        .map(([name, v]) => ({ name, ...v, cost: Math.round(v.cost * 100) / 100 }))
        .sort((a, b) => b.count - a.count || b.cost - a.cost);
    };

    // How long a customer actually waited, which is the number they remember.
    const closed = rows.filter((t) => t.closedAt);
    const waitDays = closed.map((t) =>
      (t.closedAt!.getTime() - t.createdAt.getTime()) / 86_400_000);

    return {
      totals: {
        tickets: rows.length,
        open: rows.filter((t) => !["DONE", "REJECTED"].includes(t.status)).length,
        underWarranty: rows.filter((t) => t.kind === "WARRANTY").length,
        paid: rows.filter((t) => t.kind === "PAID").length,
        goodwill: rows.filter((t) => t.kind === "GOODWILL").length,
        rejected: rows.filter((t) => t.status === "REJECTED").length,
        cost: Math.round(rows.reduce((s, t) => s + n(t.costAmount), 0) * 100) / 100,
        charged: Math.round(rows.reduce((s, t) => s + n(t.chargeAmount), 0) * 100) / 100,
        // Two visits to one house is a van and an afternoon nobody was
        // counting, and it is the cheapest thing on this list to fix.
        repeatVisits: rows.filter((t) => t.visits.length > 1).length,
        avgDaysToClose: waitDays.length
          ? Math.round((waitDays.reduce((s, d) => s + d, 0) / waitDays.length) * 10) / 10
          : null,
      },
      byProduct: tally((t) => t.orderLine.product.nameAr),
      byDefect: tally((t) => t.defectType?.nameAr ?? null),
      rows: rows.map((t) => view(t)),
    };
  });
}

const TICKET = {
  defectType: true, reportedBy: true, assignedTo: true,
  visits: { include: { technician: true }, orderBy: { occurredAt: "asc" as const } },
  orderLine: {
    include: { product: true, order: { include: { customer: true } } },
  },
};

function view(t: any, money = true) {
  return {
    id: t.id, number: t.number, status: t.status, kind: t.kind,
    description: t.description,
    defect: t.defectType ? { id: t.defectType.id, nameAr: t.defectType.nameAr,
                             nameEn: t.defectType.nameEn } : null,
    underWarranty: t.underWarranty, warrantyUntil: t.warrantyUntil,
    serial: t.serial,
    order: { id: t.orderLine.order.id, code: t.orderLine.order.code },
    orderLineId: t.orderLineId,
    customer: {
      name: t.orderLine.order.customer.name,
      phone: t.orderLine.order.customer.phone,
      address: t.orderLine.order.customer.address,
    },
    product: { nameAr: t.orderLine.product.nameAr, nameEn: t.orderLine.product.nameEn,
               sku: t.orderLine.product.sku },
    deliveredAt: t.orderLine.deliveredAt,
    reportedBy: t.reportedBy?.nameAr ?? null,
    assignedTo: t.assignedTo?.nameAr ?? null,
    assignedToId: t.assignedToId,
    promisedDate: t.promisedDate,
    resolution: t.resolution, closedAt: t.closedAt,
    // Not fetched-and-blanked but simply absent for anyone who may not see it.
    ...(money ? { costAmount: n(t.costAmount), chargeAmount: n(t.chargeAmount) } : {}),
    createdAt: t.createdAt,
    visits: (t.visits ?? []).map((v: any) => ({
      id: v.id, outcome: v.outcome, note: v.note, photoPath: v.photoPath,
      by: v.technician?.nameAr ?? null, occurredAt: v.occurredAt,
    })),
  };
}
