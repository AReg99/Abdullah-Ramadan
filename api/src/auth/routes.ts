import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db.js";
import { env } from "../env.js";
import { sign, guard } from "./jwt.js";
import { record } from "../lib/events.js";

export default async function authRoutes(app: FastifyInstance) {
  /** Workers and drivers sign in by phone — they remember phone numbers, not passwords. */
  app.post("/auth/otp/request", async (req, reply) => {
    const { phone } = z.object({ phone: z.string().min(6) }).parse(req.body);
    const user = await db.user.findUnique({ where: { phone } });
    if (!user || !user.isActive) return reply.code(404).send({ error: "no_such_user" });
    const code = env.newOtp();
    await db.otpCode.create({
      data: { userId: user.id, code, expiresAt: new Date(Date.now() + 5 * 60_000) },
    });
    // Phase 4 delivers this by SMS. Until then it is disclosed only in
    // development; in production it goes to the server log and nowhere else,
    // because returning it would make the phone number the only credential.
    if (!env.discloseOtp) {
      req.log.info({ phone, code }, "OTP issued — SMS delivery is not implemented yet");
      return { sent: true };
    }
    return { sent: true, devCode: code };
  });

  app.post("/auth/otp/verify", async (req, reply) => {
    const { phone, code } = z.object({ phone: z.string(), code: z.string() }).parse(req.body);
    const user = await db.user.findUnique({ where: { phone }, include: { role: true } });
    if (!user) return reply.code(404).send({ error: "no_such_user" });
    const otp = await db.otpCode.findFirst({
      where: { userId: user.id, code, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) return reply.code(401).send({ error: "bad_code" });
    await db.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
    await record({ code: "USER_SIGNED_IN", entityType: "user", entityId: user.id, actorId: user.id });
    return { token: sign({ sub: user.id, role: user.role.key }), user: shape(user) };
  });

  /**
   * Email or phone, plus a password. Group leaders use their phone number here:
   * SMS delivery is Phase 4, and until it exists a password the owner sets is
   * how a leader signs in without the code ever leaving the server.
   */
  app.post("/auth/login", async (req, reply) => {
    const { email, phone, password } = z.object({
      email: z.string().optional(), phone: z.string().optional(), password: z.string(),
    }).parse(req.body);
    const identifier = (email ?? phone ?? "").trim();
    if (!identifier) return reply.code(400).send({ error: "email_or_phone_required" });

    const user = await db.user.findFirst({
      where: {
        OR: [{ email: identifier }, ...phoneForms(identifier).map((p) => ({ phone: p }))],
        canLogin: true,
      },
      include: { role: true },
    });
    if (!user?.passwordHash || !user.isActive) return reply.code(401).send({ error: "bad_credentials" });
    if (!bcrypt.compareSync(password, user.passwordHash)) return reply.code(401).send({ error: "bad_credentials" });
    await record({ code: "USER_SIGNED_IN", entityType: "user", entityId: user.id, actorId: user.id });
    return { token: sign({ sub: user.id, role: user.role.key }), user: shape(user) };
  });

  app.get("/me", { preHandler: guard() }, async (req) => shape((req as any).user));
}

const shape = (u: any) => ({
  id: u.id,
  nameAr: u.nameAr,
  nameEn: u.nameEn,
  phone: u.phone,
  locale: u.locale,
  role: u.role?.key ?? u.roleId,
  stationId: u.stationId ?? null,
});

/**
 * People type their own number the way they say it: 01012345678, or with spaces,
 * or 0020… — while it is stored as +201012345678. Matching only the exact string
 * would lock out most of the factory over a leading zero, so try every form the
 * same Egyptian number can be written in.
 */
function phoneForms(raw: string): string[] {
  const d = raw.replace(/[\s()\-.]/g, "");
  if (!/^[+0-9]+$/.test(d)) return [raw];
  const forms = new Set([raw, d]);
  const digits = d.replace(/^\+/, "").replace(/^00/, "");
  if (digits.startsWith("20")) forms.add("+" + digits).add("0" + digits.slice(2));
  else if (digits.startsWith("0")) forms.add("+20" + digits.slice(1)).add(digits);
  else forms.add("+20" + digits).add("0" + digits);
  return [...forms].filter(Boolean);
}
