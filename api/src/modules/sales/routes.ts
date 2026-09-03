import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { BOOKS, CATALOGUE, READ_LOCATIONS, ROLE_KEYS, SELL, SETUP, STAFF_ADMIN,
         canGrant, grantableBy } from "../../auth/scopes.js";
import { record } from "../../lib/events.js";
import { checkSpecs, writeSpecs } from "../spec/routes.js";
import { applyVat, vatPolicy } from "../../lib/settings.js";
import { nextNumber } from "../../lib/sequence.js";
import { checkDiscount, claimApproval } from "../../lib/limits.js";

/**
 * Taking an order. The moment the factory gets work: this creates the work
 * order, every stage from the routing, and a scannable label per unit, so the
 * piece exists in the system before anyone touches it.
 */
export default async function salesRoutes(app: FastifyInstance) {
/** With a single showroom there is nothing to choose, so choose it for them. */
async function defaultShowroomId() {
  const rooms = await db.location.findMany({ where: { type: "SHOWROOM" }, select: { id: true } });
  return rooms.length === 1 ? rooms[0].id : null;
}

  app.get("/admin/customers", { preHandler: guard(SELL) }, async () =>
    db.customer.findMany({ orderBy: { name: "asc" } }));

  /**
   * Creating an order is the moment the factory gets work. It writes the order,
   * its lines, a work order per line, every stage from the routing, and a unit
   * label per unit — so the piece is scannable the moment it exists.
   */
  app.post("/admin/orders", { preHandler: guard(SELL) }, async (req, reply) => {
    const b = z.object({
      customerId: z.string().optional(),
      customerName: z.string().min(1).optional(),
      customerPhone: z.string().min(6).optional(),
      promisedDate: z.string().optional(),
      routingId: z.string().optional(),
      showroomId: z.string().optional(),
      lines: z.array(z.object({
        productId: z.string(),
        qty: z.number().int().positive().default(1),
        unitPrice: z.number().nonnegative().optional(),
        /** Money off this line, in pounds — that is how it is argued. */
        discount: z.number().nonnegative().default(0),
        /** Which store the piece leaves. */
        warehouseId: z.string().optional(),
        specNotes: z.string().optional(),
        /**
         * What the piece is meant to be, keyed by the product's own field
         * codes. A required one left blank stops the order — see below.
         */
        specs: z.record(z.string().max(200)).optional(),
        lineKind: z.enum(["STANDARD", "CUSTOM"]).default("STANDARD"),
      })).min(1),
      /**
       * A permission slip for a discount above this person's ceiling, where
       * one was needed and granted.
       */
      approvalId: z.string().optional(),
      /**
       * The written price this order is honouring, where there was one. Linked
       * here rather than in a second call, so a client that dies between the
       * two cannot leave an order nobody can trace back to its quote.
       */
      quotationId: z.string().optional(),
    }).parse(req.body);

    if (!b.customerId && !b.customerName) {
      return reply.code(400).send({ error: "customer_required" });
    }
    const customer = b.customerId
      ? await db.customer.findUnique({ where: { id: b.customerId } })
      : await db.customer.create({
          data: { name: b.customerName!, phone: b.customerPhone ?? "" },
        });
    if (!customer) return reply.code(404).send({ error: "customer_not_found" });

    const routing = b.routingId
      ? await db.routing.findUnique({ where: { id: b.routingId }, include: { stages: { orderBy: { seq: "asc" } } } })
      : await db.routing.findFirst({ where: { isDefault: true }, include: { stages: { orderBy: { seq: "asc" } } } });
    if (!routing || routing.stages.length === 0) {
      return reply.code(400).send({ error: "no_routing_configured" });
    }

    const products = await db.product.findMany({ where: { id: { in: b.lines.map((l) => l.productId) } } });
    if (products.length !== new Set(b.lines.map((l) => l.productId)).size) {
      return reply.code(400).send({ error: "unknown_product" });
    }
    // A product still being set up — no price yet — must not reach an order.
    const off = products.find((p) => !p.isActive);
    if (off) return reply.code(400).send({ error: "product_not_active", sku: off.sku });
    const priceOf = (id: string) => Number(products.find((p) => p.id === id)!.basePrice);
    const costOf = (id: string) => Number(products.find((p) => p.id === id)!.cost);

    const seq = (await db.order.count()) + 1;
    const year = new Date().getFullYear();
    const promised = b.promisedDate ? new Date(b.promisedDate) : null;
    const gross = (l: { productId: string; qty: number; unitPrice?: number }) =>
      (l.unitPrice ?? priceOf(l.productId)) * l.qty;
    // A discount bigger than the line is a typo, and one that makes the order
    // negative is money the business would be handing out.
    const overdone = b.lines.find((l) => l.discount > gross(l) + 0.005);
    if (overdone) return reply.code(400).send({ error: "discount_exceeds_line" });
    const discountTotal = b.lines.reduce((s, l) => s + l.discount, 0);
    const lineTotal = b.lines.reduce((sum, l) => sum + gross(l) - l.discount, 0);

    /**
     * How much this person may take off on their own.
     *
     * Refusing the sale outright would leave a rep arguing with a customer
     * over a screen, so the answer names the ceiling and what was asked, and
     * the showroom raises a request the owner can answer from their phone.
     * Until a limit is set for the role, nothing here bites at all.
     */
    const grossTotal = b.lines.reduce((s, l) => s + gross(l), 0);
    const allowance = await checkDiscount((req as any).user.role.key, grossTotal, discountTotal);
    let approval: { id: string } | null = null;
    if (!allowance.ok) {
      if (!b.approvalId) {
        return reply.code(409).send({
          error: "discount_needs_approval",
          limitPct: allowance.limitPct,
          allowed: allowance.allowed,
          asked: allowance.asked,
          gross: Math.round(grossTotal * 100) / 100,
        });
      }
      const claim = await claimApproval({
        id: b.approvalId, kind: "ORDER_DISCOUNT",
        amount: discountTotal, actorId: (req as any).user.id,
      });
      if (!claim.ok) return reply.code(409).send(claim);
      approval = { id: claim.approval.id };
    }
    /**
     * The piece has to be fully described before anybody is asked to make it.
     *
     * This is the whole reason the spec is fields rather than a sentence: a
     * blank colour is visible here, at the counter, with the customer still
     * standing there — instead of at the bench a week later, where the only
     * two options are to stop the job or to guess.
     *
     * A product with no spec fields defined is unaffected, so this is a rule
     * that arrives one product at a time rather than on a flag day.
     */
    const blanks: { productId: string; nameAr: string; nameEn: string;
                    missing: { code: string; nameAr: string; nameEn: string }[];
                    offList: { code: string; nameAr: string; nameEn: string;
                               value: string }[] }[] = [];
    for (const l of b.lines) {
      const check = await checkSpecs(l.productId, l.specs ?? {});
      if (!check.ok) {
        const p = products.find((x) => x.id === l.productId);
        blanks.push({
          productId: l.productId,
          nameAr: p?.nameAr ?? "", nameEn: p?.nameEn ?? "",
          missing: check.missing, offList: check.offList,
        });
      }
    }
    if (blanks.length) {
      return reply.code(400).send({
        error: blanks.some((x) => x.missing.length) ? "spec_required" : "spec_not_an_option",
        detail: { lines: blanks },
      });
    }

    // Resolved once, here, so the order carries the rate it was written at.
    const tax = applyVat(lineTotal, await vatPolicy());
    const anyCustom = b.lines.some((l) => l.lineKind === "CUSTOM");

    const order = await db.order.create({
      data: {
        code: `AUR-${year}-${String(seq).padStart(4, "0")}`,
        kind: anyCustom ? (b.lines.every((l) => l.lineKind === "CUSTOM") ? "CUSTOM" : "MIXED") : "STANDARD",
        channel: "FACTORY", status: "CONFIRMED",
        customerId: customer.id, promisedDate: promised,
        // Where the customer collects. With one showroom configured, defaulting
        // to it means nobody has to pick, and the showroom board is never empty
        // because an order was filed against no branch.
        showroomId: b.showroomId ?? (await defaultShowroomId()),
        subtotal: String(tax.subtotal), discountTotal: String(discountTotal),
        taxTotal: String(tax.taxTotal),
        taxRate: String(tax.rate), total: String(tax.total),
        invoiceNo: await nextNumber("INV"),
        trackingToken: randomUUID(),
      },
    });

    if (b.quotationId) {
      const qu = await db.quotation.findUnique({ where: { id: b.quotationId } });
      // Not fatal: the order is real and the customer is standing there. The
      // link is a record, and refusing the sale over it would be absurd.
      if (qu && !qu.orderId) {
        await db.quotation.update({
          where: { id: qu.id }, data: { status: "ACCEPTED", orderId: order.id },
        });
        if (qu.leadId) {
          await db.lead.update({
            where: { id: qu.leadId },
            data: { status: "WON", wonOrderId: order.id, nextFollowUp: null },
          });
        }
      }
    }

    if (approval) {
      // Spent only now the order exists. Consuming it earlier would burn a
      // permission the showroom still needs if the write fails.
      await db.approval.update({
        where: { id: approval.id },
        data: { status: "USED", usedAt: new Date(), orderId: order.id },
      });
    }

    let woSeq = (await db.workOrder.count()) + 1;
    for (const l of b.lines) {
      const line = await db.orderLine.create({
        data: {
          orderId: order.id, productId: l.productId, qty: l.qty,
          unitPrice: String(l.unitPrice ?? priceOf(l.productId)),
          discount: String(l.discount),
          warehouseId: l.warehouseId ?? null,
          // Copied, not looked up later: this is what it cost to make today.
          unitCost: String(costOf(l.productId)),
          lineKind: l.lineKind, status: "QUEUED",
          promisedDate: promised, specNotes: l.specNotes ?? null,
        },
      });
      if (l.specs && Object.keys(l.specs).length) {
        await writeSpecs({
          orderLineId: line.id, productId: l.productId, answers: l.specs,
          actorId: (req as any).user.id, orderId: order.id, afterStart: false,
        });
      }
      const wo = await db.workOrder.create({
        data: {
          code: `WO-${String(1000 + woSeq++).padStart(4, "0")}`,
          orderLineId: line.id, productId: l.productId, qty: l.qty,
          routingId: routing.id, status: "SCHEDULED",
        },
      });
      await db.workOrderStage.createMany({
        data: routing.stages.map((st, i) => ({
          workOrderId: wo.id, routingStageId: st.id, seq: st.seq,
          // Only the first stage is workable; the rest open as each one finishes.
          status: i === 0 ? ("READY" as const) : ("PENDING" as const),
        })),
      });
      await db.unitLabel.createMany({
        data: Array.from({ length: l.qty }, (_, i) => ({
          workOrderId: wo.id, serial: `AURA-${wo.code}-${i + 1}`,
        })),
      });
      await record({
        code: "WO_SCHEDULED", entityType: "work_order", entityId: wo.id,
        orderId: order.id, actorId: (req as any).user.id, payload: { code: wo.code },
      });
    }

    await record({
      code: "ORDER_CONFIRMED", entityType: "order", entityId: order.id, orderId: order.id,
      actorId: (req as any).user.id, isCustomerVisible: true,
      payload: { code: order.code, total: tax.total },
    });
    return {
      id: order.id, code: order.code, invoiceNo: order.invoiceNo,
      subtotal: tax.subtotal, discountTotal, taxTotal: tax.taxTotal, total: tax.total,
    };
  });
}
