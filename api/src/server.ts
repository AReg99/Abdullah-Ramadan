import { build } from "./app.js";
import { env } from "./env.js";

const app = await build();
await app.listen({ port: env.port, host: "0.0.0.0" });
console.log(`aura api on http://localhost:${env.port}`);
