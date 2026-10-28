import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import radarApi from "./api.js";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss(), radarApi()],
  build: { outDir: "dist", emptyOutDir: true },
  // Le navigateur s'ouvre tout seul, sauf dans Docker (pas de navigateur dans le conteneur).
  server: { port: 4319, open: !process.env.RADAR_COLLECTE_AUTO },
  preview: { port: 4319, open: !process.env.RADAR_COLLECTE_AUTO },
});
