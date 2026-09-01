import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { BOOKS, CATALOGUE, ROLE_KEYS, SELL, SETUP, STAFF_ADMIN,
         canGrant, grantableBy } from "../../auth/scopes.js";
import { record } from "../../lib/events.js";
import { applyVat, vatPolicy } from "../../lib/settings.js";
import { nextNumber } from "../../lib/sequence.js";
import { checkDiscount, claimApproval } from "../../lib/limits.js";
import { discard, isAllowed, readUpload, storeFile } from "../../lib/uploads.js";

/**
 * Setup and order entry — the half that turns a tracking spine into something a
 * factory can actually use. Without this, work can be followed but never
 * entered, and the system only ever contains whatever the seed put there.
 *
 * Phase 3 replaces order entry here with the showroom configurator. Until then
 * this is how a real order gets in.
 */
// Setup is the owner's alone. Grouping the factory manager in here let him read
// the whole staff list and the price list, and create an OWNER account — which
// is a way to grant himself everything else.

/** With a single showroom there is nothing to choose, so choose it for them. */
async function defaultShowroomId() {
  const rooms = await db.location.findMany({ where: { type: "SHOWROOM" }, select: { id: true } });
  return rooms.length === 1 ? rooms[0].id : null;
}

export default async function adminRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- stations
  app.get("/admin/stations", { preHandler: guard(STAFF_ADMIN) }, async () =>
    db.station.findMany({ orderBy: { code: "asc" }, include: { groups: true } }));

  app.post("/admin/stations", { preHandler: guard(SETUP) }, async (req) => {
    const b = z.object({
      code: z.string().min(1).max(8), nameAr: z.string().min(1), nameEn: z.string().min(1),
      dailyCapacityMinutes: z.number().int().positive().default(480),
    }).parse(req.body);
    const factory = await db.location.findFirst({ where: { type: "FACTORY" } });
    if (!factory) throw new Error("no factory location configured");
    return db.station.create({ data: { ...b, locationId: factory.id } });
  });

  /** What the signed-in person may hand out, so the form offers only that. */
  app.get("/admin/grantable-roles", { preHandler: guard(STAFF_ADMIN) }, async (req) =>
    grantableBy((req as any).user.role.key));

  // ---------------------------------------------------------------- locations
  // The accountant needs the store list too: a purchase invoice has to say
  // which one took the goods in.
  app.get("/admin/locations", { preHandler: guard([...new Set([...CATALOGUE, ...BOOKS])]) },
    async () => db.location.findMany({ orderBy: { type: "asc" } }));

  app.post("/admin/locations", { preHandler: guard(SETUP) }, async (req) => {
    const b = z.object({
      type: z.enum(["FACTORY", "SHOWROOM", "WAREHOUSE"]).default("SHOWROOM"),
      nameAr: z.string().min(1), nameEn: z.string().min(1).optional(),
      address: z.string().optional(),
    }).parse(req.body);
    return db.location.create({
      data: { ...b, nameEn: b.nameEn ?? b.nameAr, address: b.address ?? null },
    });
  });

  // ---------------------------------------------------------------- people
  app.get("/admin/people", { preHandler: guard(STAFF_ADMIN) }, async (req) => {
    const showPay = BOOKS.includes((req as any).user.role.key);
    const people = await db.user.findMany({
      orderBy: [{ isActive: "desc" }, { nameAr: "asc" }],
      include: { role: true, group: true, station: true, location: true },
    });
    return people.map((u) => ({
      id: u.id, nameAr: u.nameAr, nameEn: u.nameEn, phone: u.phone, email: u.email,
      role: u.role.key, canLogin: u.canLogin, isActive: u.isActive,
      hasPassword: Boolean(u.passwordHash),
      groupId: u.groupId, groupName: u.group?.nameAr ?? null,
      stationId: u.stationId, stationName: u.station?.nameAr ?? null,
      locationId: u.locationId, locationName: u.location?.nameAr ?? null,
      // A factory manager may add staff but has no business knowing what the
      // showroom manager is paid.
      ...(showPay ? {
        payType: u.payType,
        salary: u.salary === null ? null : Number(u.salary),
        dayRate: u.dayRate === null ? null : Number(u.dayRate),
      } : {}),
    }));
  });

  app.post("/admin/people", { preHandler: guard(STAFF_ADMIN) }, async (req, reply) => {
    const b = z.object({
      nameAr: z.string().min(1), nameEn: z.string().min(1).optional(),
      // From the one list, so a role added to the schema can actually be
      // hired into rather than rejected by a copy nobody remembered to edit.
      role: z.enum(ROLE_KEYS),
      phone: z.string().min(6).optional(),
      email: z.string().email().optional(),
      password: z.string().min(6).optional(),
      groupId: z.string().optional(),
      stationId: z.string().optional(),
      /** Which showroom this person works in. Null means every showroom. */
      locationId: z.string().optional(),
      /** Roster workers are tracked, not authenticated. */
      canLogin: z.boolean().default(true),
      /** Monthly wage. Omitted means "not on the payroll", which is not zero. */
      salary: z.number().nonnegative().nullable().optional(),
      /** What one day is worth, for anybody paid by the day. */
      dayRate: z.number().nonnegative().nullable().optional(),
      payType: z.enum(["MONTHLY", "DAILY"]).optional(),
    }).parse(req.body);

    if (b.canLogin && !b.phone && !b.email) {
      return reply.code(400).send({ error: "login_needs_phone_or_email" });
    }
    const actor = (req as any).user;
    if (!canGrant(actor.role.key, b.role)) {
      return reply.code(403).send({ error: "role_not_grantable", allowed: grantableBy(actor.role.key) });
    }

    // phone and email are unique. Without this the second person given a number
    // someone already has gets a 500 from the database, and the form shows a
    // dead end instead of "that number is already in use".
    for (const [field, value] of [["phone", b.phone], ["email", b.email]] as const) {
      if (!value) continue;
      if (await db.user.findFirst({ where: { [field]: value } })) {
        return reply.code(409).send({ error: `${field}_taken` });
      }
    }
    const role = await db.role.findUnique({ where: { key: b.role } });
    if (!role) return reply.code(400).send({ error: "unknown_role" });
    // A factory manager may hire, but setting wages is the owner's and the
    // accountant's; silently dropping it is safer than a confusing refusal.
    const payAllowed = BOOKS.includes(actor.role.key);

    return db.user.create({
      data: {
        nameAr: b.nameAr, nameEn: b.nameEn ?? b.nameAr,
        phone: b.phone ?? null, email: b.email ?? null,
        passwordHash: b.password ? bcrypt.hashSync(b.password, 10) : null,
        canLogin: b.canLogin, roleId: role.id,
        groupId: b.groupId ?? null, stationId: b.stationId ?? null,
        locationId: b.locationId ?? null,
        salary: payAllowed && b.salary != null ? String(b.salary) : null,
        dayRate: payAllowed && b.dayRate != null ? String(b.dayRate) : null,
        // Somebody given a day rate and no monthly salary is plainly on the
        // floor; saying so explicitly is only needed for the unusual case.
        payType: b.payType ?? (b.dayRate != null && b.salary == null ? "DAILY" : "MONTHLY"),
      },
    });
  });

  app.patch("/admin/people/:id", { preHandler: guard(STAFF_ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      nameAr: z.string().min(1).optional(),
      password: z.string().min(6).optional(),
      phone: z.string().min(6).nullable().optional(),
      email: z.string().email().nullable().optional(),
      groupId: z.string().nullable().optional(),
      stationId: z.string().nullable().optional(),
      locationId: z.string().nullable().optional(),
      salary: z.number().nonnegative().nullable().optional(),
      dayRate: z.number().nonnegative().nullable().optional(),
      payType: z.enum(["MONTHLY", "DAILY"]).optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body);
    const exists = await db.user.findUnique({ where: { id }, include: { role: true } });
    if (!exists) return reply.code(404).send({ error: "not_found" });

    const actor = (req as any).user;
    const self = actor.id === exists.id;
    if (!self && !canGrant(actor.role.key, exists.role.key)) {
      return reply.code(403).send({ error: "not_your_account_to_edit" });
    }

    // phone and email are unique. Colliding with someone else's would otherwise
    // surface as a 500 from the database rather than something a screen can say.
    for (const [field, value] of [["phone", b.phone], ["email", b.email]] as const) {
      if (!value) continue;
      const taken = await db.user.findFirst({ where: { [field]: value, id: { not: id } } });
      if (taken) return reply.code(409).send({ error: `${field}_taken` });
    }

    return db.user.update({
      where: { id },
      data: {
        ...(b.nameAr ? { nameAr: b.nameAr } : {}),
        ...(b.password ? { passwordHash: bcrypt.hashSync(b.password, 10) } : {}),
        ...(b.phone !== undefined ? { phone: b.phone } : {}),
        ...(b.email !== undefined ? { email: b.email } : {}),
        ...(b.groupId !== undefined ? { groupId: b.groupId } : {}),
        ...(b.stationId !== undefined ? { stationId: b.stationId } : {}),
        ...(b.locationId !== undefined ? { locationId: b.locationId } : {}),
        ...(b.salary !== undefined && BOOKS.includes(actor.role.key)
            ? { salary: b.salary === null ? null : String(b.salary) } : {}),
        ...(b.dayRate !== undefined && BOOKS.includes(actor.role.key)
            ? { dayRate: b.dayRate === null ? null : String(b.dayRate) } : {}),
        ...(b.payType !== undefined && BOOKS.includes(actor.role.key)
            ? { payType: b.payType } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
  });

  /**
   * Remove a person.
   *
   * Two different things wear the same word. Someone created by mistake five
   * minutes ago should simply vanish. Someone who has worked cannot: their name
   * is on stages, photos and events, and the point of an append-only record is
   * that finished work stays attributable to whoever did it. Deleting the row
   * would either fail on the foreign keys or quietly orphan months of history.
   *
   * So: no history, and they are gone. Any history, and they are retired —
   * cannot sign in, gone from every list and picker, and their phone and email
   * are released so a replacement can be given the same number. What they did
   * stays on the record under their name.
   */
  app.delete("/admin/people/:id", { preHandler: guard(STAFF_ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const actor = (req as any).user;

    const person = await db.user.findUnique({ where: { id }, include: { role: true } });
    if (!person) return reply.code(404).send({ error: "not_found" });
    if (person.id === actor.id) return reply.code(400).send({ error: "cannot_remove_yourself" });
    if (!canGrant(actor.role.key, person.role.key)) {
      return reply.code(403).send({ error: "not_your_account_to_remove" });
    }
    // Removing the last owner would lock everybody out of setup for good.
    if (person.role.key === "OWNER") {
      const owners = await db.user.count({ where: { isActive: true, role: { key: "OWNER" } } });
      if (owners <= 1) return reply.code(400).send({ error: "last_owner" });
    }

    const [stages, crewWork, photos, events, leads] = await Promise.all([
      db.workOrderStage.count({ where: { assignedToId: id } }),
      db.stageWorker.count({ where: { userId: id } }),
      db.stagePhoto.count({ where: { actorId: id } }),
      db.trackingEvent.count({ where: { actorId: id } }),
      db.group.count({ where: { leaderId: id } }),
    ]);
    const history = stages + crewWork + photos + events;

    // A crew must not be left pointing at someone who is gone.
    if (leads) await db.group.updateMany({ where: { leaderId: id }, data: { leaderId: null } });
    await db.otpCode.deleteMany({ where: { userId: id } });

    if (history === 0) {
      await db.user.delete({ where: { id } });
      return { removed: "deleted" as const };
    }

    await db.user.update({
      where: { id },
      data: { isActive: false, canLogin: false, phone: null, email: null, passwordHash: null,
              groupId: null, stationId: null, locationId: null },
    });
    return { removed: "retired" as const, keptFor: { stages, crewWork, photos, events } };
  });

  // ---------------------------------------------------------------- groups
  app.get("/admin/groups", { preHandler: guard(STAFF_ADMIN) }, async () => {
    const groups = await db.group.findMany({
      orderBy: { nameAr: "asc" },
      include: { station: true, leader: true, members: { where: { canLogin: false, isActive: true } } },
    });
    return groups.map((g) => ({
      id: g.id, nameAr: g.nameAr, nameEn: g.nameEn, isActive: g.isActive,
      stationId: g.stationId, stationAr: g.station.nameAr, stationEn: g.station.nameEn,
      leader: g.leader ? { id: g.leader.id, nameAr: g.leader.nameAr, phone: g.leader.phone } : null,
      memberCount: g.members.length,
      members: g.members.map((m) => ({ id: m.id, nameAr: m.nameAr })),
    }));
  });

  app.post("/admin/groups", { preHandler: guard(STAFF_ADMIN) }, async (req) => {
    const b = z.object({
      nameAr: z.string().min(1), nameEn: z.string().min(1).optional(),
      stationId: z.string(), leaderId: z.string().optional(),
    }).parse(req.body);
    const g = await db.group.create({
      data: { nameAr: b.nameAr, nameEn: b.nameEn ?? b.nameAr, stationId: b.stationId,
              leaderId: b.leaderId ?? null },
    });
    if (b.leaderId) await db.user.update({ where: { id: b.leaderId }, data: { groupId: g.id, stationId: b.stationId } });
    return g;
  });

  app.patch("/admin/groups/:id", { preHandler: guard(STAFF_ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({
      nameAr: z.string().min(1).optional(), stationId: z.string().optional(),
      leaderId: z.string().nullable().optional(), isActive: z.boolean().optional(),
    }).parse(req.body);
    const g = await db.group.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: "not_found" });
    const updated = await db.group.update({ where: { id }, data: b as any });
    if (b.leaderId) {
      await db.user.update({
        where: { id: b.leaderId },
        data: { groupId: id, stationId: b.stationId ?? g.stationId },
      });
    }
    return updated;
  });

  // ---------------------------------------------------------------- catalogue
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
    return db.product.update({
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
  });

  // ---------------------------------------------------------------- routings
  app.get("/admin/routings", { preHandler: guard(CATALOGUE) }, async () =>
    db.routing.findMany({
      orderBy: { nameAr: "asc" },
      include: { stages: { orderBy: { seq: "asc" }, include: { station: true } } },
    }));

  // ---------------------------------------------------------------- orders
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
