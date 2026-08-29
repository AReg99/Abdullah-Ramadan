import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { SETUP, READ_ORDERS } from "../../auth/scopes.js";
import { allSettings, DEFAULTS, type SettingKey } from "../../lib/settings.js";

export default async function settingsRoutes(app: FastifyInstance) {
  /**
   * Anyone who can see an order needs the letterhead and the tax rate to make
   * sense of its total, so reading is wide. Changing it is the owner's alone —
   * a tax rate is not a preference.
   */
  app.get("/settings", { preHandler: guard(READ_ORDERS) }, async () => allSettings());

  app.put("/settings", { preHandler: guard(SETUP) }, async (req, reply) => {
    const b = z.record(z.string().max(200)).parse(req.body ?? {});
    const unknown = Object.keys(b).filter((k) => !(k in DEFAULTS));
    if (unknown.length) return reply.code(400).send({ error: "unknown_setting", keys: unknown });

    // A rate outside this range is a typo, and a typo here reprices everything.
    if (b["vat.rate"] !== undefined) {
      const rate = Number(b["vat.rate"]);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return reply.code(400).send({ error: "bad_vat_rate" });
      }
    }
    for (const [key, value] of Object.entries(b)) {
      await db.setting.upsert({
        where: { key }, update: { value }, create: { key: key as SettingKey, value },
      });
    }
    return allSettings();
  });
}
