import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

/**
 * HTTPS is not optional for phone testing: Safari and Chrome only expose the
 * camera and register a service worker on a secure origin, and a LAN IP is not
 * one. `npm run dev:https` serves a self-signed cert — the phone shows a warning
 * once, you accept it, and both work.
 */
const https = process.env.HTTPS === "1";

/**
 * When the dev server sits behind a tunnel, requests arrive with the tunnel's
 * hostname. Vite rejects unknown hosts by default, so tunnel mode opts out —
 * and runs plain HTTP, because the tunnel terminates TLS with a real
 * certificate, which is exactly what the phone needs.
 */
const tunnel = process.env.TUNNEL === "1";

export default defineConfig({
  plugins: [react(), ...(https && !tunnel ? [basicSsl()] : [])],
  server: {
    host: "0.0.0.0",
    port: 5173,
    ...(tunnel ? { allowedHosts: true as const } : {}),
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
      "/uploads": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
