import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { discard, isAllowed, readUpload, storeFile } from "../../lib/uploads.js";
import { syncOrderStatus } from "../../lib/order-status.js";
import { record } from "../../lib/events.js";
import { SELL } from "../../auth/scopes.js";
import { MONEY, READ_ORDERS, SETUP, seesMoney } from "../../auth/scopes.js";
import { allSettings } from "../../lib/settings.js";

export default async function orderRoutes(app: FastifyInstance) {
  app.get("/orders", { preHandler: guard(READ_ORDERS) }, async (req) => {
    const user = (req as any).user;
    // The factory runs the order; it does not need to know what it sold for.
    const money = seesMoney(user.role.key);
    // Showroom staff see their own showroom's orders. Everyone else, and anyone
    // not tied to a showroom, sees all of them.
    const scoped = ["SHOWROOM_MANAGER", "SALES_REP"].includes(user.role.key) && user.locationId;
    const orders = await db.order.findMany({
      where: scoped ? { showroomId: user.locationId } : {},
      orderBy: { createdAt: "desc" },
      include: { customer: true, showroom: true,
                 lines: { include: { product: true } } },
    });
    return orders.map((o) => ({
      id: o.id, code: o.code, status: o.status, kind: o.kind,
      customer: o.customer.name, promisedDate: o.promisedDate,
      // A list has to be sortable and groupable by something other than the
      // order it happens to come back in.
      createdAt: o.createdAt,
      invoiceNo: o.invoiceNo,
      showroom: o.showroom ? { nameAr: o.showroom.nameAr, nameEn: o.showroom.nameEn } : null,
      ...(money ? { total: Number(o.total), paidTotal: Number(o.paidTotal) } : {}),
      lines: o.lines.map((l) => ({
        id: l.id, status: l.status, qty: l.qty,
        productAr: l.product.nameAr, productEn: l.product.nameEn,
      })),
    }));
  });

  /** The order timeline is a projection of the event stream, filtered by role. */
  app.get("/orders/:id", { preHandler: guard() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const order = await db.order.findUnique({
      where: { id },
      include: {
        customer: true,
        attachments: { orderBy: { uploadedAt: "asc" } },
        lines: { include: { product: true, workOrders: { include: { stages: { include: { routingStage: true, photos: true }, orderBy: { seq: "asc" } } } } } },
      },
    });
    if (!order) return reply.code(404).send({ error: "not_found" });

    const customerOnly = !READ_ORDERS.includes(user.role.key);
    const events = await db.trackingEvent.findMany({
      where: { orderId: id, ...(customerOnly ? { isCustomerVisible: true } : {}) },
      orderBy: { occurredAt: "desc" },
      include: { actor: true, station: true },
    });

    return {
      id: order.id, code: order.code, status: order.status,
      customer: { name: order.customer.name, phone: order.customer.phone },
      promisedDate: order.promisedDate,
      ...(seesMoney(user.role.key)
        ? { total: Number(order.total), paidTotal: Number(order.paidTotal) }
        : {}),
      lines: order.lines.map((l) => ({
        id: l.id, qty: l.qty, status: l.status,
        productAr: l.product.nameAr, productEn: l.product.nameEn,
        workOrders: l.workOrders.map((w) => ({
          code: w.code, status: w.status,
          stages: w.stages.map((s) => ({
            seq: s.seq, status: s.status,
            nameAr: s.routingStage.nameAr, nameEn: s.routingStage.nameEn,
            actualMinutes: s.actualMinutes, stdMinutes: s.routingStage.stdMinutes,
            photos: s.photos.map((p) => ({ kind: p.kind, path: p.path })),
          })),
        })),
      })),
      attachments: order.attachments.map((a) => ({
        id: a.id, kind: a.kind, filename: a.filename, path: a.path,
        mime: a.mime, bytes: a.bytes, note: a.note, uploadedAt: a.uploadedAt,
      })),
      events: events.map((e) => ({
        id: e.id, code: e.code, occurredAt: e.occurredAt, payload: e.payload,
        actor: e.actor ? { nameAr: e.actor.nameAr, nameEn: e.actor.nameEn } : null,
        station: e.station ? { nameAr: e.station.nameAr, nameEn: e.station.nameEn } : null,
      })),
    };
  });

  /**
   * A note on the order.
   *
   * The order already carried a complete history — every scan, every stage,
   * every payment — and no way for a person to add a sentence to it. So the
   * things that actually explain an order ("customer rang, wants it after the
   * Eid", "left a message twice") lived in a rep's head or a paper diary, and
   * the next person to pick the order up had no way to know them.
   *
   * It lands in the same event stream as everything else, so it appears in the
   * history in its right place among the machine's own events rather than in a
   * separate list nobody reads.
   */
  app.post("/orders/:id/notes", { preHandler: guard(READ_ORDERS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { note } = z.object({ note: z.string().trim().min(1).max(2000) })
      .parse(req.body ?? {});
    const order = await db.order.findUnique({ where: { id }, select: { id: true } });
    if (!order) return reply.code(404).send({ error: "not_found" });
    const e = await record({
      code: "NOTE", entityType: "order", entityId: id, orderId: id,
      actorId: (req as any).user.id, payload: { note },
      // The customer's tracking page is for where the piece is, not for what
      // the showroom said to each other about them.
      isCustomerVisible: false,
    });
    return { id: e.id, occurredAt: e.occurredAt, note };
  });

  /**
   * Where the order actually is, in words the showroom can read to a customer.
   *
   * The order page already carried every stage and every event, but that is the
   * factory's own record — station names, minutes against standard, raw event
   * codes. A sales rep with a customer on the phone needs one sentence, and
   * reading them the wrong one ("it is in sanding") is worse than saying
   * nothing.
   *
   * So the routing's own isCustomerVisible flag decides what gets named. The
   * hidden stages still count toward progress; they are simply not what the
   * customer is told.
   */
  app.get("/orders/:id/progress", { preHandler: guard(READ_ORDERS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;

    const order = await db.order.findUnique({
      where: { id },
      include: {
        customer: true,
        showroom: true,
        lines: {
          include: {
            product: true,
            workOrders: {
              include: {
                stages: { include: { routingStage: true }, orderBy: { seq: "asc" } },
              },
            },
          },
        },
      },
    });
    if (!order) return reply.code(404).send({ error: "not_found" });

    // Showroom staff see their own branch's orders and no others — the same
    // rule the orders list applies, which this route would otherwise sidestep.
    if (["SHOWROOM_MANAGER", "SALES_REP"].includes(user.role.key) &&
        user.locationId && order.showroomId !== user.locationId) {
      return reply.code(404).send({ error: "not_found" });
    }

    // The last visit that did not come off, per line. A piece a van stood
    // outside the door for is not simply "waiting at the showroom".
    const misses = await db.deliveryAttempt.findMany({
      where: { orderLineId: { in: order.lines.map((l) => l.id) }, delivered: false },
      orderBy: { occurredAt: "desc" },
    });
    const lastMiss = new Map<string, { at: Date; reason: string | null }>();
    for (const m of misses) {
      if (!lastMiss.has(m.orderLineId)) {
        lastMiss.set(m.orderLineId, { at: m.occurredAt, reason: m.failReason });
      }
    }

    const lastEvent = await db.trackingEvent.findFirst({
      where: { orderId: id },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });

    const now = Date.now();
    const lines = order.lines.map((l) => {
      const stages = l.workOrders.flatMap((w) => w.stages);
      const total = stages.length;
      const done = stages.filter((s) => s.status === "DONE").length;
      const running = stages.find((s) => s.status === "IN_PROGRESS")
                   ?? stages.find((s) => s.status === "PAUSED");

      // What to name to the customer: the stage being worked if they are meant
      // to hear about it, otherwise the last milestone that passed.
      const visibleDone = stages.filter((s) => s.status === "DONE" && s.routingStage.isCustomerVisible);
      const named = running?.routingStage.isCustomerVisible
        ? running.routingStage
        : visibleDone.length ? visibleDone[visibleDone.length - 1].routingStage : null;

      // Past the factory, the handover state is the whole story.
      const afterFactory = ["FINISHED", "IN_TRANSIT", "READY", "DELIVERED"].includes(l.status);
      const percent = l.status === "DELIVERED" ? 100
        : l.status === "READY" ? 95
        : l.status === "IN_TRANSIT" ? 88
        : l.status === "FINISHED" ? 80
        : total === 0 ? 0
        : Math.round((done / total) * 75);

      return {
        id: l.id,
        qty: l.qty,
        status: l.status,
        productAr: l.product.nameAr,
        productEn: l.product.nameEn,
        stagesTotal: total,
        stagesDone: done,
        percent,
        blocked: Boolean(running && running.status === "PAUSED"),
        /** Named only when the customer is meant to hear it. */
        milestoneAr: afterFactory ? null : named?.nameAr ?? null,
        milestoneEn: afterFactory ? null : named?.nameEn ?? null,
        promisedDate: l.promisedDate ?? order.promisedDate,
        receivedAt: l.receivedAt,
        deliveredAt: l.deliveredAt,
        // A piece somebody tried to deliver and could not is not simply
        // "ready". Telling the customer it is waiting for them, after a van
        // stood outside their door, is how a small problem becomes a row.
        missedAt: lastMiss.get(l.id)?.at ?? null,
        missedReason: lastMiss.get(l.id)?.reason ?? null,
      };
    });

    const promised = order.promisedDate;
    const settled = lines.every((l) => l.status === "DELIVERED");
    const late = Boolean(promised && !settled && promised.getTime() < now);

    return {
      id: order.id,
      code: order.code,
      status: order.status,
      customer: { name: order.customer.name, phone: order.customer.phone },
      showroomAr: order.showroom?.nameAr ?? null,
      showroomEn: order.showroom?.nameEn ?? null,
      promisedDate: promised,
      late,
      daysToPromise: promised ? Math.ceil((promised.getTime() - now) / 86_400_000) : null,
      lastUpdate: lastEvent?.occurredAt ?? null,
      lines,
      message: customerMessage(order.code, lines, promised, late),
    };
  });


  /**
   * Cancelling an order. The owner's alone — it stops work that people are
   * paid to do and money that has been promised.
   *
   * Nothing is deleted. Every line still on the books is marked cancelled, its
   * work orders with it, and any stage not yet finished is cancelled so it
   * drops out of the leaders' queues, the dispatch bench and the showroom
   * board. Stages already finished keep their record: the work happened, and
   * the hours are still owed to whoever did them.
   *
   * A piece already handed to the customer cannot be cancelled — that is a
   * return, which is a different transaction and not this one.
   */
  /**
   * Everything a printed invoice needs, in one answer.
   *
   * The layout lives in the browser, which is what gives a phone a PDF without
   * a rendering service: the page prints, and iOS and Android both offer "save
   * as PDF" from the share sheet. What the server owes it is the figures — and
   * they come from the order as it was written, tax rate included, so an
   * invoice reprinted next year is the invoice that was issued.
   */
  app.get("/orders/:id/invoice", { preHandler: guard(MONEY) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = await db.order.findUnique({
      where: { id },
      include: {
        customer: true, showroom: true,
        lines: { include: { product: true, warehouse: true } },
        payments: {
          where: { direction: "IN" },
          orderBy: { occurredOn: "asc" },
          include: { account: true },
        },
      },
    });
    if (!order) return reply.code(404).send({ error: "not_found" });

    const user = (req as any).user;
    // The showroom sees its own branch's invoices, as it does everywhere else.
    if (["SHOWROOM_MANAGER", "SALES_REP"].includes(user.role.key) &&
        user.locationId && order.showroomId !== user.locationId) {
      return reply.code(404).send({ error: "not_found" });
    }

    const s = await allSettings();
    const num = (d: unknown) => Number(d ?? 0);
    const paid = num(order.paidTotal);
    return {
      company: {
        nameAr: s["company.name"], nameEn: s["company.nameEn"],
        address: s["company.address"], phone: s["company.phone"],
        email: s["company.email"], vatNumber: s["vat.number"],
      },
      order: {
        id: order.id, code: order.code,
        // The number the customer and the tax authority quote. Falls back to
        // the order code for anything written before the series existed.
        invoiceNo: order.invoiceNo ?? order.code,
        date: order.createdAt,
        status: order.status, promisedDate: order.promisedDate,
        showroom: order.showroom?.nameAr ?? null,
        currency: order.currency,
      },
      customer: {
        name: order.customer.name, phone: order.customer.phone,
      },
      lines: order.lines.map((l) => ({
        nameAr: l.product.nameAr, nameEn: l.product.nameEn, sku: l.product.sku,
        // Which store it left. A stock count later cannot be reconstructed
        // without it, and the customer's copy is asked to say.
        warehouse: l.warehouse?.nameAr ?? order.showroom?.nameAr ?? null,
        qty: l.qty, unitPrice: num(l.unitPrice), discount: num(l.discount),
        lineTotal: num(l.unitPrice) * l.qty - num(l.discount),
        specNotes: l.specNotes,
      })),
      totals: {
        gross: order.lines.reduce((t, l) => t + num(l.unitPrice) * l.qty, 0),
        discount: num(order.discountTotal),
        subtotal: num(order.subtotal) || num(order.total),
        taxRate: num(order.taxRate),
        taxTotal: num(order.taxTotal),
        total: num(order.total),
        paid,
        outstanding: Math.max(0, num(order.total) - paid),
      },
      payments: order.payments.map((p) => ({
        voucherNo: p.voucherNo, date: p.occurredOn, amount: num(p.amount),
        discount: num(p.discount), method: p.method,
        account: p.account.nameAr, reference: p.reference,
      })),
    };
  });

  app.post("/orders/:id/cancel", { preHandler: guard(SETUP) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(req.body ?? {});
    const user = (req as any).user;

    const order = await db.order.findUnique({
      where: { id },
      include: { lines: { include: { product: true, workOrders: true } } },
    });
    if (!order) return reply.code(404).send({ error: "not_found" });
    if (order.status === "CANCELLED") return reply.code(409).send({ error: "already_cancelled" });

    const open = order.lines.filter((l) => !["DELIVERED", "CANCELLED"].includes(l.status));
    if (open.length === 0) {
      return reply.code(409).send({ error: "nothing_to_cancel" });
    }

    let stagesStopped = 0;
    for (const line of open) {
      const woIds = line.workOrders.map((w) => w.id);
      if (woIds.length) {
        const stopped = await db.workOrderStage.updateMany({
          where: { workOrderId: { in: woIds }, status: { not: "DONE" } },
          data: { status: "CANCELLED" },
        });
        stagesStopped += stopped.count;
        await db.workOrder.updateMany({
          where: { id: { in: woIds } },
          data: { status: "CANCELLED" },
        });
      }
      await db.orderLine.update({ where: { id: line.id }, data: { status: "CANCELLED" } });
    }

    await record({
      code: "ORDER_CANCELLED", entityType: "order", entityId: order.id,
      orderId: order.id, actorId: user.id, isCustomerVisible: true,
      payload: {
        reason,
        lines: open.map((l) => l.product.nameAr),
        stagesStopped,
        // Named so the record says what survived, not just what stopped.
        keptDelivered: order.lines.filter((l) => l.status === "DELIVERED").length,
      },
    });
    const status = await syncOrderStatus(order.id);

    return {
      cancelled: open.length,
      stagesStopped,
      keptDelivered: order.lines.filter((l) => l.status === "DELIVERED").length,
      orderStatus: status,
    };
  });


  /**
   * What arrived with the order: the photo of the piece to copy, the room
   * measurements, the signed quotation. Attached to the order rather than to a
   * stage, because it is true of the whole job and the factory needs it weeks
   * after the showroom took it.
   */
  app.post("/orders/:id/attachments", { preHandler: guard(SELL) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;
    const order = await db.order.findUnique({ where: { id } });
    if (!order) return reply.code(404).send({ error: "order_not_found" });

    const { buf, filename, mime, fields } = await readUpload(req);
    if (!buf?.byteLength) return reply.code(400).send({ error: "no_file" });
    if (!isAllowed(mime)) return reply.code(415).send({ error: "unsupported_type", mime });

    const { rel } = await storeFile(buf, mime, "orders");
    try {
      const att = await db.orderAttachment.create({
        data: {
          orderId: order.id,
          kind: mime.startsWith("image/") ? "IMAGE" : "DOCUMENT",
          filename: filename.slice(0, 200),
          path: rel, mime, bytes: buf.byteLength,
          note: fields.note?.slice(0, 500) || null,
          actorId: user.id,
        },
      });
      await record({
        code: "ORDER_ATTACHMENT_ADDED", entityType: "order_attachment", entityId: att.id,
        orderId: order.id, actorId: user.id,
        payload: { filename: att.filename, kind: att.kind },
      });
      return att;
    } catch (e) {
      // Don't leave an orphan on disk if the row could not be written.
      await discard(rel);
      throw e;
    }
  });

  app.delete("/orders/:id/attachments/:attId", { preHandler: guard(SELL) }, async (req, reply) => {
    const { id, attId } = req.params as { id: string; attId: string };
    const att = await db.orderAttachment.findUnique({ where: { id: attId } });
    if (!att || att.orderId !== id) return reply.code(404).send({ error: "not_found" });
    await db.orderAttachment.delete({ where: { id: attId } });
    await discard(att.path);
    return { removed: true };
  });
}

/**
 * The sentence the showroom reads out or sends. Built here rather than in the
 * screen so the wording is the same however it is reached, and so it can never
 * quote a stage the customer was not meant to hear about.
 */
type MsgLine = {
  productAr: string; productEn: string; status: string;
  milestoneAr: string | null; milestoneEn: string | null;
  missedAt?: Date | null;
};

function customerMessage(code: string, lines: MsgLine[], promised: Date | null, late: boolean) {
  // Once it is in the customer's house, promising them a date reads as a
  // mistake. The date line only belongs on an order still owed.
  const settled = lines.length > 0 && lines.every((l) => l.status === "DELIVERED");
  const show = promised && !settled;
  const dateAr = show ? promised!.toLocaleDateString("ar-EG", { day: "numeric", month: "long" }) : null;
  const dateEn = show ? promised!.toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : null;

  const say = (l: MsgLine, lang: "ar" | "en") => {
    const name = lang === "ar" ? l.productAr : l.productEn;
    const at = lang === "ar" ? l.milestoneAr : l.milestoneEn;
    if (lang === "ar") {
      switch (l.status) {
        case "DELIVERED":     return `${name}: اتسلّم`;
        case "READY":         return l.missedAt
          ? `${name}: حاولنا نوصّله ومعرفناش — هنتواصل معاك لميعاد تاني`
          : `${name}: جاهز في المعرض للاستلام`;
        case "IN_TRANSIT":    return `${name}: في الطريق للمعرض`;
        case "FINISHED":      return `${name}: خلص التصنيع`;
        case "IN_PRODUCTION": return at ? `${name}: في مرحلة ${at}` : `${name}: تحت التصنيع`;
        default:              return `${name}: في الجدول`;
      }
    }
    switch (l.status) {
      case "DELIVERED":     return `${name}: delivered`;
      case "READY":         return l.missedAt
        ? `${name}: we tried to deliver and could not — we will call to arrange another time`
        : `${name}: ready for collection at the showroom`;
      case "IN_TRANSIT":    return `${name}: on its way to the showroom`;
      case "FINISHED":      return `${name}: finished in the factory`;
      case "IN_PRODUCTION": return at ? `${name}: in ${at}` : `${name}: in production`;
      default:              return `${name}: scheduled`;
    }
  };

  const join = (head: string, body: string[], tail: string | null) =>
    [head, ...body, tail].filter(Boolean).join("\n");

  return {
    ar: join(`طلب ${code}`, lines.map((l) => `• ${say(l, "ar")}`),
      dateAr ? (late ? `الموعد كان ${dateAr} — بنعتذر عن التأخير وهنبلغك أول بأول.`
                     : `الموعد المتوقع: ${dateAr}.`) : null),
    en: join(`Order ${code}`, lines.map((l) => `• ${say(l, "en")}`),
      dateEn ? (late ? `The promised date was ${dateEn} — we are sorry for the delay and will keep you updated.`
                     : `Expected: ${dateEn}.`) : null),
  };
}
