import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { COSTING, COSTING_READ, PRICE_NOTICES } from "../../auth/scopes.js";
import { allSettings } from "../../lib/settings.js";

/**
 * محاسبة التكاليف.
 *
 * `Product.cost` was a number somebody typed once. Nothing computed it from
 * what the piece is actually made of, so when timber went up twenty per cent
 * nothing said the margin on a wardrobe had collapsed — the figure only
 * surfaced months later in a profit report, as a number nobody could explain.
 *
 * Everything needed to work it out was already here and never multiplied
 * together: the bill of materials says what a piece takes, each stock item
 * carries what that material costs today, and the routing carries the standard
 * minutes at every station.
 *
 *   cost = materials + (standard hours × the labour rate) + overhead
 *
 * The computed figure is shown **against** the stored one rather than replacing
 * it. A cost that silently rewrites itself is a cost nobody can quote against;
 * the gap between the two is the finding, and moving the stored figure is a
 * decision somebody makes.
 */

const n = (d: unknown) => Number(d ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

type Rates = { labourRate: number; overheadPct: number; minMarginPct: number };

async function rates(): Promise<Rates> {
  const s = await allSettings();
  return {
    labourRate: Number(s["costing.labourRate"]) || 0,
    overheadPct: Number(s["costing.overheadPct"]) || 0,
    minMarginPct: Number(s["costing.minMarginPct"]) || 0,
  };
}

/** The standard minutes a routing spends on one piece, at every station. */
function routingMinutes(routing: any) {
  return (routing?.stages ?? []).reduce((s: number, st: any) => s + st.stdMinutes, 0);
}

export default async function costingRoutes(app: FastifyInstance) {
  /**
   * قائمة الأسعار — every model, what it costs, what it sells for, and the
   * margin between them.
   *
   * Sorted worst margin first. A price list in alphabetical order is a price
   * list nobody reads to the bottom, and the bottom is where the losses are.
   */
  app.get("/costing/price-list", { preHandler: guard(COSTING_READ) }, async () => {
    const [products, routing, rate] = await Promise.all([
      db.product.findMany({
        include: { category: true, bom: { include: { stockItem: true } } },
        orderBy: { nameAr: "asc" },
      }),
      // One default routing for the whole catalogue today. When products carry
      // their own, this reads theirs instead.
      db.routing.findFirst({ where: { isDefault: true }, include: { stages: true } }),
      rates(),
    ]);

    const minutes = routingMinutes(routing);
    const labour = r2((minutes / 60) * rate.labourRate);

    const rows = products.map((p) => {
      const materials = r2(p.bom.reduce(
        (s, l) => s + n(l.qty) * n(l.stockItem.unitCost), 0));
      const overhead = r2((materials + labour) * (rate.overheadPct / 100));
      const computed = r2(materials + labour + overhead);
      const stored = n(p.cost);
      const price = n(p.basePrice);
      // Margin on the selling price, which is how a showroom argues about it —
      // not mark-up on cost, which is a different number and always larger.
      const margin = price > 0 ? r2(((price - computed) / price) * 100) : null;

      return {
        id: p.id, sku: p.sku, nameAr: p.nameAr, nameEn: p.nameEn,
        category: p.category.nameAr, isActive: p.isActive,
        price, storedCost: stored,
        computed: { materials, labour, overhead, total: computed, minutes },
        // What the stored figure is out by. The whole point of the screen.
        drift: r2(computed - stored),
        margin,
        belowFloor: margin != null && margin < rate.minMarginPct,
        belowCost: price > 0 && price < computed,
        // A model with no recipe cannot be costed, and saying so is better
        // than showing a confident zero.
        hasBom: p.bom.length > 0,
      };
    });

    const priced = rows.filter((x) => x.margin != null && x.hasBom);
    return {
      rates: rate,
      totals: {
        products: rows.length,
        noBom: rows.filter((x) => !x.hasBom).length,
        belowFloor: priced.filter((x) => x.belowFloor).length,
        belowCost: priced.filter((x) => x.belowCost).length,
        driftedUp: rows.filter((x) => x.hasBom && x.drift > 1).length,
        avgMargin: priced.length
          ? r2(priced.reduce((s, x) => s + (x.margin ?? 0), 0) / priced.length) : null,
      },
      // Worst first: the bottom of an alphabetical list is where the losses
      // sit and nobody scrolls that far.
      rows: rows.sort((a, b) => {
        if (a.hasBom !== b.hasBom) return a.hasBom ? -1 : 1;
        return (a.margin ?? 9e9) - (b.margin ?? 9e9);
      }),
    };
  });

  /**
   * One model, broken down to the material.
   *
   * "This wardrobe costs 4,300" is not actionable. "It costs 4,300 and 2,900 of
   * that is timber" is a conversation with a supplier.
   */
  app.get("/costing/products/:id", { preHandler: guard(COSTING_READ) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [p, routing, rate] = await Promise.all([
        db.product.findUnique({
          where: { id },
          include: {
            category: true,
            bom: { include: { stockItem: true } },
            priceChanges: {
              include: { actor: true }, orderBy: { createdAt: "desc" }, take: 20,
            },
          },
        }),
        db.routing.findFirst({ where: { isDefault: true },
                               include: { stages: { include: { station: true },
                                                    orderBy: { seq: "asc" } } } }),
        rates(),
      ]);
      if (!p) return reply.code(404).send({ error: "not_found" });

      const materials = p.bom.map((l) => ({
        stockItemId: l.stockItemId,
        name: l.stockItem.nameAr, sku: l.stockItem.sku, unit: l.stockItem.unit,
        qty: n(l.qty), unitCost: n(l.stockItem.unitCost),
        total: r2(n(l.qty) * n(l.stockItem.unitCost)),
      })).sort((a, b) => b.total - a.total);

      const materialTotal = r2(materials.reduce((s, m) => s + m.total, 0));
      const stages = (routing?.stages ?? []).map((st: any) => ({
        name: st.nameAr, station: st.station?.nameAr ?? null,
        minutes: st.stdMinutes,
        cost: r2((st.stdMinutes / 60) * rate.labourRate),
      }));
      const minutes = routingMinutes(routing);
      const labour = r2((minutes / 60) * rate.labourRate);
      const overhead = r2((materialTotal + labour) * (rate.overheadPct / 100));
      const computed = r2(materialTotal + labour + overhead);
      const price = n(p.basePrice);

      return {
        product: { id: p.id, sku: p.sku, nameAr: p.nameAr, nameEn: p.nameEn,
                   category: p.category.nameAr, isActive: p.isActive,
                   price, storedCost: n(p.cost) },
        rates: rate,
        materials, stages,
        computed: { materials: materialTotal, labour, overhead, total: computed, minutes },
        drift: r2(computed - n(p.cost)),
        margin: price > 0 ? r2(((price - computed) / price) * 100) : null,
        // What the price would have to be to clear the floor. The number the
        // cost accountant is actually reaching for.
        suggestedPrice: rate.minMarginPct < 100
          ? r2(computed / (1 - rate.minMarginPct / 100)) : null,
        history: p.priceChanges.map((c) => ({
          id: c.id,
          oldPrice: n(c.oldPrice), newPrice: n(c.newPrice),
          oldCost: n(c.oldCost), newCost: n(c.newCost),
          reason: c.reason, by: c.actor?.nameAr ?? null,
          seenAt: c.seenAt, at: c.createdAt,
        })),
      };
    });

  /**
   * Taking the computed figure as the stored one.
   *
   * One button rather than retyping, because a cost accountant who has to copy
   * a number by hand is one who does it for the three models they remember.
   */
  app.post("/costing/products/:id/adopt", { preHandler: guard(COSTING) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = z.object({
        reason: z.string().max(300).optional(),
        /** Move the price with it, to hold the margin where it is. */
        holdMargin: z.boolean().default(false),
      }).parse(req.body ?? {});

      const [p, routing, rate] = await Promise.all([
        db.product.findUnique({ where: { id }, include: { bom: { include: { stockItem: true } } } }),
        db.routing.findFirst({ where: { isDefault: true }, include: { stages: true } }),
        rates(),
      ]);
      if (!p) return reply.code(404).send({ error: "not_found" });
      if (p.bom.length === 0) return reply.code(409).send({ error: "no_bom" });

      const materials = r2(p.bom.reduce((s, l) => s + n(l.qty) * n(l.stockItem.unitCost), 0));
      const labour = r2((routingMinutes(routing) / 60) * rate.labourRate);
      const computed = r2(materials + labour + r2((materials + labour) * (rate.overheadPct / 100)));

      const oldPrice = n(p.basePrice);
      const oldCost = n(p.cost);
      // Holding the margin means the price moves by the same proportion the
      // cost did, which is what a business means when it says "pass it on".
      const newPrice = b.holdMargin && oldCost > 0 && oldPrice > 0
        ? r2(oldPrice * (computed / oldCost))
        : oldPrice;

      const saved = await db.product.update({
        where: { id },
        data: { cost: String(computed), ...(newPrice !== oldPrice ? { basePrice: String(newPrice) } : {}) },
      });
      await db.priceChange.create({
        data: {
          productId: id,
          oldPrice: String(oldPrice), newPrice: String(newPrice),
          oldCost: String(oldCost), newCost: String(computed),
          reason: b.reason ?? null, actorId: (req as any).user.id,
        },
      });
      return { id: saved.id, cost: n(saved.cost), basePrice: n(saved.basePrice) };
    });

  // ────────────────────────────────────────────── talking to the counter

  /**
   * What moved, and whether the counter has seen it.
   *
   * The showroom used to find out a price had changed when a customer argued
   * about it. Every change is written by the product route itself rather than
   * by whoever remembers, so this list cannot be incomplete.
   */
  app.get("/costing/changes", { preHandler: guard(PRICE_NOTICES) }, async (req) => {
    const q = z.object({ unseen: z.string().optional() }).parse(req.query ?? {});
    const rows = await db.priceChange.findMany({
      where: q.unseen === "1" ? { seenAt: null } : {},
      include: { product: true, actor: true, seenBy: true },
      orderBy: { createdAt: "desc" }, take: 100,
    });
    return rows.map((c) => ({
      id: c.id,
      product: { id: c.productId, nameAr: c.product.nameAr,
                 nameEn: c.product.nameEn, sku: c.product.sku },
      oldPrice: n(c.oldPrice), newPrice: n(c.newPrice),
      priceMoved: r2(n(c.newPrice) - n(c.oldPrice)),
      oldCost: n(c.oldCost), newCost: n(c.newCost),
      reason: c.reason, by: c.actor?.nameAr ?? null,
      seenAt: c.seenAt, seenBy: c.seenBy?.nameAr ?? null,
      at: c.createdAt,
    }));
  });

  /** How many the counter has not read, for the badge on their nav. */
  app.get("/costing/changes/unseen", { preHandler: guard(PRICE_NOTICES) }, async () => ({
    count: await db.priceChange.count({ where: { seenAt: null } }),
  }));

  /**
   * The counter has read them.
   *
   * Marked in a batch rather than one at a time: a rep opening the list has
   * read the list, and making them tap each row is how the badge stays lit for
   * ever until nobody looks at it.
   */
  app.post("/costing/changes/seen", { preHandler: guard(PRICE_NOTICES) }, async (req) => {
    const b = z.object({ ids: z.array(z.string()).optional() }).parse(req.body ?? {});
    const done = await db.priceChange.updateMany({
      where: { seenAt: null, ...(b.ids?.length ? { id: { in: b.ids } } : {}) },
      data: { seenAt: new Date(), seenById: (req as any).user.id },
    });
    return { marked: done.count };
  });

  // ────────────────────────────────────────────── what actually happened

  /**
   * الربح الفعلي — margin on what was really sold, not on the price list.
   *
   * The list says what a model should make. This says what it did: every order
   * line carries the price it went out at and the cost it was made at on the
   * day, so a discount given at the counter shows up here and nowhere else.
   */
  app.get("/costing/margin", { preHandler: guard(COSTING_READ) }, async (req) => {
    const q = z.object({ from: z.string().optional(), to: z.string().optional() })
      .parse(req.query ?? {});
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 90 * 86_400_000);
    const to = q.to ? new Date(`${q.to}T23:59:59`) : new Date();

    const lines = await db.orderLine.findMany({
      where: {
        order: { createdAt: { gte: from, lte: to }, status: { not: "CANCELLED" } },
        status: { not: "CANCELLED" },
      },
      include: { product: true },
    });

    const m = new Map<string, { name: string; sku: string; qty: number;
                                revenue: number; cost: number }>();
    for (const l of lines) {
      const cur = m.get(l.productId)
        ?? { name: l.product.nameAr, sku: l.product.sku, qty: 0, revenue: 0, cost: 0 };
      m.set(l.productId, {
        ...cur,
        qty: cur.qty + l.qty,
        revenue: cur.revenue + (n(l.unitPrice) * l.qty - n(l.discount)),
        cost: cur.cost + n(l.unitCost) * l.qty,
      });
    }

    const rows = [...m.entries()].map(([id, v]) => ({
      id, ...v,
      revenue: r2(v.revenue), cost: r2(v.cost),
      profit: r2(v.revenue - v.cost),
      margin: v.revenue > 0 ? r2(((v.revenue - v.cost) / v.revenue) * 100) : null,
    })).sort((a, b) => a.profit - b.profit);

    const revenue = r2(rows.reduce((s, x) => s + x.revenue, 0));
    const cost = r2(rows.reduce((s, x) => s + x.cost, 0));
    return {
      totals: {
        lines: lines.length, revenue, cost, profit: r2(revenue - cost),
        margin: revenue > 0 ? r2(((revenue - cost) / revenue) * 100) : null,
        // Sold at a loss. The one row on this screen that is an emergency.
        losingModels: rows.filter((x) => x.profit < 0).length,
      },
      // Worst first, again: the models losing money are the reason to look.
      rows,
    };
  });

  /** The three figures the whole calculation rests on. */
  app.put("/costing/rates", { preHandler: guard(COSTING) }, async (req) => {
    const b = z.object({
      labourRate: z.number().nonnegative().max(10_000).optional(),
      overheadPct: z.number().min(0).max(500).optional(),
      minMarginPct: z.number().min(0).max(99).optional(),
    }).parse(req.body);
    const write = async (key: string, v?: number) => {
      if (v === undefined) return;
      await db.setting.upsert({
        where: { key }, create: { key, value: String(v) }, update: { value: String(v) },
      });
    };
    await write("costing.labourRate", b.labourRate);
    await write("costing.overheadPct", b.overheadPct);
    await write("costing.minMarginPct", b.minMarginPct);
    return rates();
  });
}
