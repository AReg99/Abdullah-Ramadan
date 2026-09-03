import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { BOOKS, CATALOGUE, READ_LOCATIONS, ROLE_KEYS, SELL, SETUP, STAFF_ADMIN,
         canGrant, grantableBy } from "../../auth/scopes.js";
import { record } from "../../lib/events.js";

/**
 * The kernel's own screens: who works here, where they work, and the crews they
 * work in. Everything else builds on these — a product needs a category, an
 * order needs a customer, a work order needs a station — so this module is
 * required and cannot be switched off.
 */
export default async function coreRoutes(app: FastifyInstance) {
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
  app.get("/admin/locations", { preHandler: guard(READ_LOCATIONS) },
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
}
