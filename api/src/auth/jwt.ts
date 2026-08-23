import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env.js";
import { db } from "../db.js";

export type Claims = { sub: string; role: string };

export const sign = (c: Claims) => jwt.sign(c, env.jwtSecret, { expiresIn: "30d" });

export async function currentUser(req: FastifyRequest) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  try {
    const c = jwt.verify(h.slice(7), env.jwtSecret) as Claims;
    return db.user.findUnique({ where: { id: c.sub }, include: { role: true, station: true } });
  } catch {
    return null;
  }
}

/** Roles are checked on the server. The client's claim about its role is never trusted. */
export function guard(roles?: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await currentUser(req);
    if (!user || !user.isActive) return reply.code(401).send({ error: "unauthorised" });
    if (roles && !roles.includes(user.role.key)) return reply.code(403).send({ error: "forbidden" });
    (req as any).user = user;
  };
}
