import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { STOCK, STOCK_ADMIN } from "../../auth/scopes.js";

/**
 * The store.
 *
 * A quantity on a shelf is never stored as a number somebody edits. It is
 * re-derived by summing movements, exactly as the cash balance is — which is
 * what lets anyone ask "why is it four?" and get an answer instead of a shrug.
 *
 * Every movement carries a reason, because a shelf that dropped by four tells
 * you nothing until you know whether they were sold, damaged, or miscounted.
 */

const qty = () => z.number().finite().positive().max(1e9);
const n = (d: unknown) => Number(d ?? 0);

/** What is on hand, per item per store, from the movements alone. */
async function balances(where: { itemId?: string; warehouseId?: string } = {}) {
  const rows = await db.stockMovement.groupBy({
    by: ["itemId", "warehouseId", "direction"],
    _sum: { qty: true },
    where,
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.itemId}|${r.warehouseId}`;
    const signed = r.direction === "IN" ? n(r._sum.qty) : -n(r._sum.qty);
    map.set(key, (map.get(key) ?? 0) + signed);
  }
  return map;
}

export default async function stockRoutes(app: FastifyInstance) {
  // ─────────────────────────────────────────────────────── what is tracked
  app.get("/stock/items", { preHandler: guard(STOCK) }, async (req) => {
    const q = z.object({ all: z.string().optional() }).parse(req.query ?? {});
    const items = await db.stockItem.findMany({
      where: q.all === "1" ? {} : { isActive: true },
      orderBy: { nameAr: "asc" },
      include: { product: { select: { sku: true, nameAr: true } } },
    });
    const bal = await balances();
    const stores = await db.location.findMany({ where: { type: { not: "FACTORY" } } });
    const all = await db.location.findMany();

    return items.map((i) => {
      const per = all
        .map((w) => ({ warehouseId: w.id, nameAr: w.nameAr, nameEn: w.nameEn,
                       qty: bal.get(`${i.id}|${w.id}`) ?? 0 }))
        .filter((x) => x.qty !== 0);
      const onHand = per.reduce((s, x) => s + x.qty, 0);
      return {
        id: i.id, sku: i.sku, nameAr: i.nameAr, nameEn: i.nameEn, kind: i.kind,
        unit: i.unit, reorderLevel: n(i.reorderLevel), unitCost: n(i.unitCost),
        productId: i.productId, productSku: i.product?.sku ?? null,
        isActive: i.isActive,
        onHand,
        value: Math.round(onHand * n(i.unitCost) * 100) / 100,
        // Only worth flagging when a level was actually set.
        low: n(i.reorderLevel) > 0 && onHand <= n(i.reorderLevel),
        byWarehouse: per,
        _stores: stores.length,
      };
    });
  });

  app.post("/stock/items", { preHandler: guard(STOCK_ADMIN) }, async (req, reply) => {
    const b = z.object({
      sku: z.string().min(1).max(40),
      nameAr: z.string().min(1), nameEn: z.string().min(1).optional(),
      kind: z.enum(["PRODUCT", "MATERIAL"]).default("MATERIAL"),
      unit: z.string().min(1).max(20).default("قطعة"),
      reorderLevel: z.number().nonnegative().default(0),
      unitCost: z.number().nonnegative().default(0),
      productId: z.string().optional(),
    }).parse(req.body);

    if (await db.stockItem.findUnique({ where: { sku: b.sku } })) {
      return reply.code(409).send({ error: "sku_taken" });
    }
    if (b.productId) {
      if (!(await db.product.findUnique({ where: { id: b.productId } }))) {
        return reply.code(404).send({ error: "unknown_product" });
      }
      // One stock item per product, or selling one would not know which shelf
      // to take it off.
      if (await db.stockItem.findUnique({ where: { productId: b.productId } })) {
        return reply.code(409).send({ error: "product_already_stocked" });
      }
    }
    return db.stockItem.create({
      data: {
        ...b, nameEn: b.nameEn ?? b.nameAr,
        reorderLevel: String(b.reorderLevel), unitCost: String(b.unitCost),
        productId: b.productId ?? null,
      },
    });
  });

  app.patch("/stock/items/:id", { preHandler: guard(STOCK_ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      nameAr: z.string().min(1).optional(),
      unit: z.string().min(1).max(20).optional(),
      reorderLevel: z.number().nonnegative().optional(),
      unitCost: z.number().nonnegative().optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body ?? {});
    if (!(await db.stockItem.findUnique({ where: { id } }))) {
      return reply.code(404).send({ error: "not_found" });
    }
    return db.stockItem.update({
      where: { id },
      data: {
        ...(b.nameAr ? { nameAr: b.nameAr } : {}),
        ...(b.unit ? { unit: b.unit } : {}),
        ...(b.reorderLevel !== undefined ? { reorderLevel: String(b.reorderLevel) } : {}),
        ...(b.unitCost !== undefined ? { unitCost: String(b.unitCost) } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
  });

  /**
   * Delete an item nothing has ever happened to; retire one that has moved.
   *
   * The same split as everywhere else in this system: a thing with history
   * cannot vanish, because the history would stop making sense.
   */
  app.delete("/stock/items/:id", { preHandler: guard(STOCK_ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await db.stockItem.findUnique({ where: { id } }))) {
      return reply.code(404).send({ error: "not_found" });
    }
    const moved = await db.stockMovement.count({ where: { itemId: id } });
    if (moved > 0) {
      await db.stockItem.update({ where: { id }, data: { isActive: false } });
      return { removed: "retired", movements: moved };
    }
    await db.stockItem.delete({ where: { id } });
    return { removed: "deleted" };
  });

  // ──────────────────────────────────────────────────────────── movements
  app.get("/stock/movements", { preHandler: guard(STOCK) }, async (req) => {
    const q = z.object({
      itemId: z.string().optional(),
      warehouseId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(500).default(100),
    }).parse(req.query ?? {});
    const rows = await db.stockMovement.findMany({
      where: {
        ...(q.itemId ? { itemId: q.itemId } : {}),
        ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
      take: q.limit,
      include: { item: true, warehouse: true, actor: true },
    });
    return rows.map((m) => ({
      id: m.id, date: m.occurredOn,
      item: m.item.nameAr, sku: m.item.sku, unit: m.item.unit,
      warehouse: m.warehouse.nameAr,
      direction: m.direction, qty: n(m.qty), reason: m.reason,
      note: m.note, by: m.actor?.nameAr ?? null,
      reversal: Boolean(m.reversesId),
    }));
  });

  /** Goods in or out by hand: a delivery received, a piece written off. */
  app.post("/stock/move", { preHandler: guard(STOCK) }, async (req, reply) => {
    const b = z.object({
      itemId: z.string(),
      warehouseId: z.string(),
      direction: z.enum(["IN", "OUT"]),
      qty: qty(),
      reason: z.enum(["OPENING", "PURCHASE", "PRODUCTION", "SALE", "RETURN",
                      "ADJUSTMENT", "DAMAGE"]).default("ADJUSTMENT"),
      occurredOn: z.string().datetime().optional(),
      note: z.string().max(300).optional(),
    }).parse(req.body);

    const item = await db.stockItem.findUnique({ where: { id: b.itemId } });
    if (!item) return reply.code(404).send({ error: "item_not_found" });
    if (!(await db.location.findUnique({ where: { id: b.warehouseId } }))) {
      return reply.code(404).send({ error: "warehouse_not_found" });
    }
    // Taking out more than is there is nearly always a typo or the wrong store.
    // Unlike money, a shelf really cannot hold less than nothing, and letting it
    // makes every later count argue with the system instead of the shelf.
    if (b.direction === "OUT") {
      const bal = (await balances({ itemId: b.itemId, warehouseId: b.warehouseId }))
        .get(`${b.itemId}|${b.warehouseId}`) ?? 0;
      if (b.qty > bal + 0.0005) {
        return reply.code(400).send({ error: "not_enough_stock", onHand: bal });
      }
    }
    return db.stockMovement.create({
      data: {
        itemId: b.itemId, warehouseId: b.warehouseId, direction: b.direction,
        qty: String(b.qty), reason: b.reason, unitCost: item.unitCost,
        occurredOn: b.occurredOn ? new Date(b.occurredOn) : new Date(),
        note: b.note ?? null, actorId: (req as any).user.id,
      },
    });
  });

  /**
   * Moving goods between two of your own stores.
   *
   * Two movements sharing one id, for the same reason a cash transfer is two
   * entries: recorded as an unrelated issue and receipt it looks like a sale
   * from one store and a purchase into the other, and both reports lie.
   */
  app.post("/stock/transfer", { preHandler: guard(STOCK) }, async (req, reply) => {
    const b = z.object({
      itemId: z.string(),
      fromWarehouseId: z.string(),
      toWarehouseId: z.string(),
      qty: qty(),
      occurredOn: z.string().datetime().optional(),
      note: z.string().max(300).optional(),
    }).parse(req.body);
    if (b.fromWarehouseId === b.toWarehouseId) {
      return reply.code(400).send({ error: "same_warehouse" });
    }
    const item = await db.stockItem.findUnique({ where: { id: b.itemId } });
    if (!item) return reply.code(404).send({ error: "item_not_found" });
    const [from, to] = await Promise.all([
      db.location.findUnique({ where: { id: b.fromWarehouseId } }),
      db.location.findUnique({ where: { id: b.toWarehouseId } }),
    ]);
    if (!from || !to) return reply.code(404).send({ error: "warehouse_not_found" });

    const bal = (await balances({ itemId: b.itemId, warehouseId: b.fromWarehouseId }))
      .get(`${b.itemId}|${b.fromWarehouseId}`) ?? 0;
    if (b.qty > bal + 0.0005) {
      return reply.code(400).send({ error: "not_enough_stock", onHand: bal });
    }

    const transferId = randomUUID();
    const common = {
      itemId: b.itemId, qty: String(b.qty), reason: "TRANSFER" as const,
      unitCost: item.unitCost, transferId,
      occurredOn: b.occurredOn ? new Date(b.occurredOn) : new Date(),
      note: b.note ?? null, actorId: (req as any).user.id,
    };
    const [out, inn] = await db.$transaction([
      db.stockMovement.create({ data: { ...common, warehouseId: from.id, direction: "OUT" } }),
      db.stockMovement.create({ data: { ...common, warehouseId: to.id, direction: "IN" } }),
    ]);
    return { transferId, out, in: inn };
  });

  /** Undo a movement by writing its opposite; both stay on the record. */
  app.post("/stock/movements/:id/reverse", { preHandler: guard(STOCK_ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(req.body ?? {});
    const original = await db.stockMovement.findUnique({
      where: { id }, include: { reversedBy: true },
    });
    if (!original) return reply.code(404).send({ error: "not_found" });
    if (original.reversedBy) return reply.code(409).send({ error: "already_reversed" });
    if (original.reversesId) return reply.code(409).send({ error: "cannot_reverse_a_reversal" });

    return db.stockMovement.create({
      data: {
        itemId: original.itemId, warehouseId: original.warehouseId,
        direction: original.direction === "IN" ? "OUT" : "IN",
        qty: original.qty, reason: original.reason, unitCost: original.unitCost,
        occurredOn: new Date(), note: reason, reversesId: original.id,
        actorId: (req as any).user.id,
      },
    });
  });

  // ────────────────────────────────────────────────────────── الجرد
  /**
   * A count sheet for one store: every active item, what the books say, and
   * room for what is actually on the shelf.
   */
  app.post("/stock/stocktakes", { preHandler: guard(STOCK) }, async (req, reply) => {
    const b = z.object({
      warehouseId: z.string(), note: z.string().max(300).optional(),
    }).parse(req.body);
    if (!(await db.location.findUnique({ where: { id: b.warehouseId } }))) {
      return reply.code(404).send({ error: "warehouse_not_found" });
    }
    // An open count for the same store means two people counting the same
    // shelves and posting contradictory adjustments.
    const open = await db.stocktake.findFirst({
      where: { warehouseId: b.warehouseId, postedAt: null },
    });
    if (open) return reply.code(409).send({ error: "stocktake_already_open", id: open.id });

    const items = await db.stockItem.findMany({ where: { isActive: true } });
    const bal = await balances({ warehouseId: b.warehouseId });
    const take = await db.stocktake.create({
      data: {
        warehouseId: b.warehouseId, note: b.note ?? null,
        actorId: (req as any).user.id,
        lines: {
          create: items.map((i) => {
            const expected = bal.get(`${i.id}|${b.warehouseId}`) ?? 0;
            return {
              itemId: i.id, expected: String(expected),
              // Starts at what the books say, so a shelf that is right needs
              // no typing at all — only the differences get touched.
              counted: String(expected),
            };
          }),
        },
      },
    });
    return { id: take.id, lines: items.length };
  });

  app.get("/stock/stocktakes/:id", { preHandler: guard(STOCK) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const take = await db.stocktake.findUnique({
      where: { id },
      include: { warehouse: true, actor: true, lines: { include: { item: true } } },
    });
    if (!take) return reply.code(404).send({ error: "not_found" });
    const lines = take.lines
      .map((l) => ({
        itemId: l.itemId, sku: l.item.sku, nameAr: l.item.nameAr, unit: l.item.unit,
        expected: n(l.expected), counted: n(l.counted),
        variance: n(l.counted) - n(l.expected),
        value: Math.round((n(l.counted) - n(l.expected)) * n(l.item.unitCost) * 100) / 100,
        note: l.note,
      }))
      .sort((a, b2) => a.nameAr.localeCompare(b2.nameAr, "ar"));
    return {
      id: take.id, warehouse: take.warehouse.nameAr, warehouseId: take.warehouseId,
      startedAt: take.startedAt, postedAt: take.postedAt, note: take.note,
      by: take.actor?.nameAr ?? null,
      totals: {
        counted: lines.length,
        differences: lines.filter((l) => Math.abs(l.variance) > 0.0005).length,
        value: Math.round(lines.reduce((s, l) => s + l.value, 0) * 100) / 100,
      },
      lines,
    };
  });

  app.get("/stock/stocktakes", { preHandler: guard(STOCK) }, async () => {
    const rows = await db.stocktake.findMany({
      orderBy: { startedAt: "desc" }, take: 30,
      include: { warehouse: true, _count: { select: { lines: true } } },
    });
    return rows.map((t) => ({
      id: t.id, warehouse: t.warehouse.nameAr, startedAt: t.startedAt,
      postedAt: t.postedAt, lines: t._count.lines,
    }));
  });

  app.put("/stock/stocktakes/:id", { preHandler: guard(STOCK) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      counts: z.array(z.object({
        itemId: z.string(),
        counted: z.number().nonnegative(),
        note: z.string().max(200).optional(),
      })).min(1),
    }).parse(req.body);

    const take = await db.stocktake.findUnique({ where: { id } });
    if (!take) return reply.code(404).send({ error: "not_found" });
    if (take.postedAt) return reply.code(409).send({ error: "stocktake_already_posted" });

    for (const c of b.counts) {
      await db.stocktakeLine.updateMany({
        where: { stocktakeId: id, itemId: c.itemId },
        data: { counted: String(c.counted), note: c.note ?? null },
      });
    }
    return { saved: b.counts.length };
  });

  /**
   * Post the count: every difference becomes a movement with reason STOCKTAKE.
   *
   * The balance is never written directly. A shelf that came up four short has
   * a movement saying so, with a date and a name on it, which is the only way
   * the shortage can be asked about later.
   */
  app.post("/stock/stocktakes/:id/post", { preHandler: guard(STOCK_ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const take = await db.stocktake.findUnique({
      where: { id }, include: { lines: { include: { item: true } } },
    });
    if (!take) return reply.code(404).send({ error: "not_found" });
    if (take.postedAt) return reply.code(409).send({ error: "stocktake_already_posted" });

    let posted = 0;
    for (const l of take.lines) {
      const diff = n(l.counted) - n(l.expected);
      if (Math.abs(diff) < 0.0005) continue;
      await db.stockMovement.create({
        data: {
          itemId: l.itemId, warehouseId: take.warehouseId,
          direction: diff > 0 ? "IN" : "OUT", qty: String(Math.abs(diff)),
          reason: "STOCKTAKE", unitCost: l.item.unitCost, occurredOn: new Date(),
          stocktakeId: take.id, note: l.note ?? null, actorId: (req as any).user.id,
        },
      });
      posted++;
    }
    await db.stocktake.update({ where: { id }, data: { postedAt: new Date() } });
    return { posted, lines: take.lines.length };
  });

  // ───────────────────────────────────────────────────────────── reports
  /** What is on the shelves, what it is worth, and what is running out. */
  app.get("/stock/report", { preHandler: guard(STOCK) }, async (req) => {
    const q = z.object({ warehouseId: z.string().optional() }).parse(req.query ?? {});
    const items = await db.stockItem.findMany({
      where: { isActive: true }, orderBy: { nameAr: "asc" },
    });
    const bal = await balances(q.warehouseId ? { warehouseId: q.warehouseId } : {});
    const stores = await db.location.findMany();

    const rows = items.map((i) => {
      const onHand = stores.reduce((s, w) => s + (bal.get(`${i.id}|${w.id}`) ?? 0), 0);
      return {
        id: i.id, sku: i.sku, name: i.nameAr, unit: i.unit, kind: i.kind,
        onHand, unitCost: n(i.unitCost),
        value: Math.round(onHand * n(i.unitCost) * 100) / 100,
        reorderLevel: n(i.reorderLevel),
        low: n(i.reorderLevel) > 0 && onHand <= n(i.reorderLevel),
      };
    });
    return {
      totals: {
        items: rows.length,
        value: Math.round(rows.reduce((s, r) => s + r.value, 0) * 100) / 100,
        low: rows.filter((r) => r.low).length,
        outOfStock: rows.filter((r) => r.onHand <= 0).length,
      },
      rows,
    };
  });
}
