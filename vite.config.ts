/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

const host = process.env.TAURI_DEV_HOST;

// Public VAPID key for browser web-push (safe to ship in the client bundle).
const VAPID_PUBLIC_KEY_FALLBACK =
  "BKJoaYQU4sVIOoyWx2eGIXV3vTHi9mTIZqO_CMo1HZHAx8owU7rVoIaAiG9pcugXNWRNoqZBL5_-q6Y9ZSj8VzU";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
  plugins: [react(), mcpPlugin()],
  define: {
    "import.meta.env.VITE_VAPID_PUBLIC_KEY": JSON.stringify(
      env.VITE_VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY_FALLBACK,
    ),
  },

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
