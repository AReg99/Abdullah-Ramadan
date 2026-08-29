import Fastify from "fastify";
import { ZodError } from "zod";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { env } from "./env.js";
import authRoutes from "./auth/routes.js";
import workRoutes from "./modules/work/routes.js";
import photoRoutes from "./modules/photos/routes.js";
import dashboardRoutes from "./modules/dashboard/routes.js";
import flowRoutes from "./modules/flow/routes.js";
import moneyRoutes from "./modules/money/routes.js";
import orderRoutes from "./modules/orders/routes.js";
import labelRoutes from "./modules/labels/routes.js";
import adminRoutes from "./modules/admin/routes.js";
import settingsRoutes from "./modules/settings/routes.js";
import stockRoutes from "./modules/stock/routes.js";
import qualityRoutes from "./modules/quality/routes.js";
import deliveryRoutes from "./modules/delivery/routes.js";

export async function build() {
  const app = Fastify({ logger: { level: "warn" } });

  // A request that says application/json and sends nothing means "no
  // arguments" — a DELETE, or a POST whose whole payload is optional. Fastify
  // rejects it outright, which reaches the screen as a baffling 400 on a button
  // that correctly sent no body at all.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const raw = typeof body === "string" ? body.trim() : "";
    if (!raw) return done(null, {});
    try { done(null, JSON.parse(raw)); }
    catch (e) { (e as any).statusCode = 400; done(e as Error, undefined); }
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

  mkdirSync(env.uploadDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: path.resolve(env.uploadDir),
    prefix: "/uploads/",
  });

  /**
   * A malformed request is the client's fault, not the server's. Without this,
   * every schema violation surfaced as a 500, which hides real faults in the
   * noise and tells the caller nothing about what to correct.
   */
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if ((err as any).statusCode && (err as any).statusCode < 500) {
      return reply.code((err as any).statusCode).send({ error: (err as Error).message });
    }
    app.log.error(err as Error);
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/health", async () => ({ ok: true }));

  // Modular monolith: each module owns its tables and is reached only through
  // its routes and services. The seams are here if one ever needs extracting.
  await app.register(authRoutes);
  await app.register(workRoutes);
  await app.register(photoRoutes);
  await app.register(dashboardRoutes);
  await app.register(orderRoutes);
  await app.register(flowRoutes);
  await app.register(moneyRoutes);
  await app.register(labelRoutes);
  await app.register(adminRoutes);
  await app.register(settingsRoutes);
  await app.register(stockRoutes);
  await app.register(qualityRoutes);
  await app.register(deliveryRoutes);

  return app;
}
