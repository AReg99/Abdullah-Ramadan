import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { guard } from "../auth/jwt.js";
import { SETUP } from "../auth/scopes.js";
import { MODULES } from "./modules.js";
import { installedSet, resolve } from "./registry.js";
import { record } from "../lib/events.js";

/**
 * The Apps screen, and the menu the web app builds itself from.
 *
 * `/modules/menu` is the important one: it returns the screens this person may
 * open, from the installed apps only, each already filtered by the same scope
 * its routes are guarded with. The web app used to keep that list by hand, one
 * array per role, and it drifted from the server six times.
 */
export default async function kernelRoutes(app: FastifyInstance) {
  app.get("/modules", { preHandler: guard(SETUP) }, async () => {
    const installed = await installedSet();
    const { order, stranded } = resolve(installed);
    const loaded = new Set(order.map((m) => m.key));
    return MODULES.map((m) => ({
      key: m.key,
      nameAr: m.nameAr, nameEn: m.nameEn,
      summaryAr: m.summaryAr, summaryEn: m.summaryEn,
      depends: m.depends,
      required: Boolean(m.required),
      installed: m.required || installed.has(m.key),
      /** Switched on but not loaded, because something underneath it is off. */
      stranded: stranded.includes(m.key),
      loaded: loaded.has(m.key),
      /** Which installed apps would break if this one were switched off. */
      neededBy: MODULES.filter((o) => o.depends.includes(m.key)
                                      && (o.required || installed.has(o.key)))
                       .map((o) => o.key),
      screens: (m.menu ?? []).length,
    }));
  });

  /**
   * The menu for whoever is asking.
   *
   * Filtered twice, and both filters matter: by what this business installed,
   * and by what this person's role may open. Sorted by the order each module
   * declared, so the first four are somebody's daily tabs wherever they came
   * from.
   */
  app.get("/modules/menu", { preHandler: guard() }, async (req) => {
    const role = (req as any).user.role.key as string;
    const installed = await installedSet();
    const { order } = resolve(installed);
    const entries = order.flatMap((m) =>
      (m.menu ?? [])
        .filter((e) => e.scope.includes(role))
        .map((e) => ({
          module: m.key,
          path: e.path,
          icon: e.icon,
          labelKey: e.labelFor && e.labelFor.roles.includes(role)
            ? e.labelFor.labelKey : e.labelKey,
          area: e.area,
          order: e.order,
        })));
    entries.sort((a, b) => a.order - b.order || a.path.localeCompare(b.path));
    return entries;
  });

  /**
   * Switch an app on or off.
   *
   * Refused for a required app, and refused for one another installed app is
   * built on — switching off the catalogue under sales would leave a business
   * with an order screen that cannot name a product, which is worse than either
   * state on its own.
   */
  app.post("/modules/:key", { preHandler: guard(SETUP) }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const { installed } = z.object({ installed: z.boolean() }).parse(req.body ?? {});
    const m = MODULES.find((x) => x.key === key);
    if (!m) return reply.code(404).send({ error: "not_found" });
    if (m.required && !installed) {
      return reply.code(409).send({ error: "module_required" });
    }
    if (!installed) {
      const on = await installedSet();
      const blockers = MODULES.filter((o) => o.depends.includes(key)
                                             && (o.required || on.has(o.key)))
                              .map((o) => o.key);
      if (blockers.length) {
        return reply.code(409).send({ error: "module_needed_by", detail: { blockers } });
      }
    }
    await db.module.upsert({
      where: { key },
      create: { key, installed, installedAt: installed ? new Date() : null },
      update: { installed, installedAt: installed ? new Date() : null },
    });
    await record({
      code: installed ? "MODULE_INSTALLED" : "MODULE_UNINSTALLED",
      entityType: "module", entityId: key, actorId: (req as any).user.id,
      payload: { key },
    });
    // The routes are registered at boot, so this takes effect on the next
    // restart. Saying so is better than a screen that looks like it worked and
    // did not.
    return { key, installed, restartRequired: true };
  });
}
