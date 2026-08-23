import Fastify from "fastify";
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
import orderRoutes from "./modules/orders/routes.js";

export async function build() {
  const app = Fastify({ logger: { level: "warn" } });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

  mkdirSync(env.uploadDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: path.resolve(env.uploadDir),
    prefix: "/uploads/",
  });

  app.get("/health", async () => ({ ok: true }));

  // Modular monolith: each module owns its tables and is reached only through
  // its routes and services. The seams are here if one ever needs extracting.
  await app.register(authRoutes);
  await app.register(workRoutes);
  await app.register(photoRoutes);
  await app.register(dashboardRoutes);
  await app.register(orderRoutes);

  return app;
}
