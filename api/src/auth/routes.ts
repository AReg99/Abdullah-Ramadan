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
    const code = env.devOtp;
    await db.otpCode.create({
      data: { userId: user.id, code, expiresAt: new Date(Date.now() + 5 * 60_000) },
    });
    // Phase 4 sends this over SMS. In development it is returned so the flow is testable.
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

  /** Office and showroom staff use email and password. */
  app.post("/auth/login", async (req, reply) => {
    const { email, password } = z.object({ email: z.string(), password: z.string() }).parse(req.body);
    const user = await db.user.findUnique({ where: { email }, include: { role: true } });
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
