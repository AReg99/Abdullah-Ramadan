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

export default defineConfig({
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
      "/uploads": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
