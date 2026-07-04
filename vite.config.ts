/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Tauri: don't clear the terminal, use strict port, and ignore src-tauri
  clearScreen: false,
  server: {
    port: 8080,
    host: host || "::",
    strictPort: true,
    hmr: host ? { protocol: "ws", host, port: 8080 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // Expose TAURI_ENV_* vars to the frontend in addition to VITE_*
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // Tauri supports es2021 and chrome105 on Windows, safari13 on macOS/Linux
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/__tests__/**/*.test.tsx"],
  },
});
