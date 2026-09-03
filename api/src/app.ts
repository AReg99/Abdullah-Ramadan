import Fastify from "fastify";
import { ZodError } from "zod";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { env } from "./env.js";
import kernelRoutes from "./kernel/routes.js";
import { loadModules } from "./kernel/registry.js";

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

  /**
   * The apps, in dependency order, and only the ones this business installed.
   *
   * An uninstalled app registers nothing at all — no route to reach and no
   * screen to find — which is the difference between switching a feature off
   * and merely hiding it.
   */
  await app.register(kernelRoutes);
  await loadModules(app);

  return app;
}
