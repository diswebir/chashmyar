import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "0.0.0.0",
    // allow proxied preview hosts (dev-only convenience)
    allowedHosts: true,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  preview: {
    port: 4173,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "chrome105",
    // Use Vite's default minifier: Vite 6 uses esbuild, while Vite 8 uses Oxc.
    // Forcing esbuild breaks a grouped Vite 8 / plugin-react 6 upgrade.
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
