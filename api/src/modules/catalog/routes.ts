import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { BOOKS, CATALOGUE, READ_LOCATIONS, ROLE_KEYS, SELL, SETUP, STAFF_ADMIN,
         canGrant, grantableBy } from "../../auth/scopes.js";
import { discard, isAllowed, readUpload, storeFile } from "../../lib/uploads.js";

/**
 * The catalogue: what this business makes, what it charges, what it costs, and
 * what has to be decided about a piece before anybody can make it.
 */
export default async function catalogRoutes(app: FastifyInstance) {
  app.get("/admin/categories", { preHandler: guard(CATALOGUE) }, async () =>
    db.productCategory.findMany({ orderBy: { nameAr: "asc" } }));

  app.post("/admin/categories", { preHandler: guard(CATALOGUE) }, async (req) => {
    const b = z.object({ nameAr: z.string().min(1), nameEn: z.string().min(1).optional() }).parse(req.body);
    return db.productCategory.create({ data: { nameAr: b.nameAr, nameEn: b.nameEn ?? b.nameAr } });
  });

  app.get("/admin/products", { preHandler: guard(CATALOGUE) }, async (req) => {
    const showCost = BOOKS.includes((req as any).user.role.key);
    const rows = await db.product.findMany({
      orderBy: { nameAr: "asc" },
      include: { category: true, photos: { orderBy: [{ sortOrder: "asc" }, { uploadedAt: "asc" }] } },
    });
    return rows.map((p) => ({
      id: p.id, sku: p.sku, nameAr: p.nameAr, nameEn: p.nameEn, kind: p.kind,
      basePrice: Number(p.basePrice), baseLeadDays: p.baseLeadDays,
      warrantyMonths: p.warrantyMonths, isActive: p.isActive,
      // What it costs to make is not the showroom's business — a rep who
      // knows the margin is a rep who can be argued down to it.
      ...(showCost ? { cost: Number(p.cost) } : {}),
      description: p.description,
      categoryId: p.categoryId, categoryAr: p.category.nameAr,
      photos: p.photos.map((ph) => ({ id: ph.id, path: ph.path, filename: ph.filename })),
    }));
  });

  /**
   * Pictures of the piece. A catalogue without them is a price list: the
   * showroom cannot show a customer what they are buying, and the leader on the
   * bench cannot see what it is meant to end up looking like.
   */
  app.post("/admin/products/:id/photos", { preHandler: guard(CATALOGUE) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const product = await db.product.findUnique({ where: { id } });
    if (!product) return reply.code(404).send({ error: "product_not_found" });

    const { buf, filename, mime } = await readUpload(req);
    if (!buf?.byteLength) return reply.code(400).send({ error: "no_file" });
    // A product photo is a photo. A PDF datasheet belongs on the order.
    if (!isAllowed(mime) || !mime.startsWith("image/")) {
      return reply.code(415).send({ error: "images_only", mime });
    }

    const { rel } = await storeFile(buf, mime, "products");
    try {
      const last = await db.productPhoto.findFirst({
        where: { productId: id }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true },
      });
      return await db.productPhoto.create({
        data: {
          productId: id, filename: filename.slice(0, 200), path: rel, mime,
          bytes: buf.byteLength, sortOrder: (last?.sortOrder ?? -1) + 1,
          actorId: (req as any).user.id,
        },
      });
    } catch (e) {
      await discard(rel);
      throw e;
    }
  });

  /**
   * Remove a product.
   *
   * The same split as removing a person, for the same reason. One created by
   * mistake should vanish. One that has been ordered or built cannot: order
   * lines and work orders point at it, and deleting the row would either fail
   * on the foreign keys or orphan the history of pieces that were actually
   * made. Those are retired — switched off, gone from the order form, and still
   * readable on every order that included them.
   */
  app.delete("/admin/products/:id", { preHandler: guard(SETUP) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const product = await db.product.findUnique({
      where: { id }, include: { photos: true },
    });
    if (!product) return reply.code(404).send({ error: "not_found" });

    const [lines, workOrders] = await Promise.all([
      db.orderLine.count({ where: { productId: id } }),
      db.workOrder.count({ where: { productId: id } }),
    ]);

    if (lines + workOrders > 0) {
      await db.product.update({ where: { id }, data: { isActive: false } });
      return { removed: "retired" as const, keptFor: { lines, workOrders } };
    }

    // The photo rows go with the product, but the files on disk do not: nothing
    // else refers to them, so they would sit there for good.
    for (const photo of product.photos) await discard(photo.path);
    await db.productPhoto.deleteMany({ where: { productId: id } });
    await db.product.delete({ where: { id } });
    return { removed: "deleted" as const };
  });

  app.delete("/admin/products/:id/photos/:photoId", { preHandler: guard(CATALOGUE) }, async (req, reply) => {
    const { id, photoId } = req.params as { id: string; photoId: string };
    const photo = await db.productPhoto.findUnique({ where: { id: photoId } });
    if (!photo || photo.productId !== id) return reply.code(404).send({ error: "not_found" });
    await db.productPhoto.delete({ where: { id: photoId } });
    await discard(photo.path);
    return { removed: true };
  });

  app.post("/admin/products", { preHandler: guard(CATALOGUE) }, async (req, reply) => {
    const b = z.object({
      sku: z.string().min(1), nameAr: z.string().min(1), nameEn: z.string().min(1).optional(),
      categoryId: z.string(), basePrice: z.number().nonnegative(),
      cost: z.number().nonnegative().default(0),
      baseLeadDays: z.number().int().positive().default(14),
      warrantyMonths: z.number().int().min(0).max(240).optional(),
      kind: z.enum(["STANDARD", "CUSTOMIZABLE"]).default("STANDARD"),
      description: z.string().max(500).optional(),
    }).parse(req.body);
    if (await db.product.findUnique({ where: { sku: b.sku } })) {
      return reply.code(409).send({ error: "sku_taken" });
    }
    return db.product.create({
      data: { ...b, nameEn: b.nameEn ?? b.nameAr,
              basePrice: String(b.basePrice), cost: String(b.cost) },
    });
  });

  /**
   * Correcting a product after the fact. The catalogue was write-once: a price
   * typed wrong stayed wrong, and a model loaded from the printed catalogue —
   * which carries no prices — could never be finished.
   */
  app.patch("/admin/products/:id", { preHandler: guard(CATALOGUE) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      sku: z.string().min(1).optional(),
      nameAr: z.string().min(1).optional(),
      nameEn: z.string().min(1).optional(),
      categoryId: z.string().optional(),
      basePrice: z.number().nonnegative().optional(),
      cost: z.number().nonnegative().optional(),
      baseLeadDays: z.number().int().positive().optional(),
      /// How long this model is covered for, from the day it is delivered.
      warrantyMonths: z.number().int().min(0).max(240).optional(),
      kind: z.enum(["STANDARD", "CUSTOMIZABLE"]).optional(),
      description: z.string().max(500).nullable().optional(),
      isActive: z.boolean().optional(),
      /** Why the price moved. The counter reads it. */
      reason: z.string().max(300).optional(),
    }).parse(req.body);

    const exists = await db.product.findUnique({ where: { id } });
    if (!exists) return reply.code(404).send({ error: "not_found" });
    if (b.sku && await db.product.findFirst({ where: { sku: b.sku, id: { not: id } } })) {
      return reply.code(409).send({ error: "sku_taken" });
    }
    // Nothing sells at nothing. Switching a product on is the moment someone
    // could put it on an order, so the price has to be real by then.
    const price = b.basePrice ?? Number(exists.basePrice);
    if ((b.isActive ?? exists.isActive) && price <= 0) {
      return reply.code(400).send({ error: "price_required_to_activate" });
    }
    const saved = await db.product.update({
      where: { id },
      data: {
        ...(b.sku ? { sku: b.sku } : {}),
        ...(b.nameAr ? { nameAr: b.nameAr } : {}),
        ...(b.nameEn ? { nameEn: b.nameEn } : {}),
        ...(b.categoryId ? { categoryId: b.categoryId } : {}),
        ...(b.basePrice !== undefined ? { basePrice: String(b.basePrice) } : {}),
        ...(b.cost !== undefined ? { cost: String(b.cost) } : {}),
        ...(b.baseLeadDays !== undefined ? { baseLeadDays: b.baseLeadDays } : {}),
        ...(b.warrantyMonths !== undefined ? { warrantyMonths: b.warrantyMonths } : {}),
        ...(b.kind ? { kind: b.kind } : {}),
        ...(b.description !== undefined ? { description: b.description } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });

    /**
     * A price or a cost moving is written down here, in the one route every
     * screen goes through — not by whoever remembers to. Prices were a column
     * somebody overwrote: nothing said what a wardrobe used to cost, when it
     * changed or what for, and the showroom found out from a customer.
     */
    const moved = Number(saved.basePrice) !== Number(exists.basePrice)
               || Number(saved.cost) !== Number(exists.cost);
    if (moved) {
      await db.priceChange.create({
        data: {
          productId: id,
          oldPrice: exists.basePrice, newPrice: saved.basePrice,
          oldCost: exists.cost, newCost: saved.cost,
          reason: b.reason ?? null, actorId: (req as any).user.id,
        },
      });
    }
    return saved;
  });

  // ---------------------------------------------------------------- routings
  app.get("/admin/routings", { preHandler: guard(CATALOGUE) }, async () =>
    db.routing.findMany({
      orderBy: { nameAr: "asc" },
      include: { stages: { orderBy: { seq: "asc" }, include: { station: true } } },
    }));

  // ---------------------------------------------------------------- orders
}
