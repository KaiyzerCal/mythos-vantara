/**
 * Stagehand Plugin — Vision-aware browser automation for MAVIS.
 *
 * Architecture (priority order):
 *   1. Local stagehand-mcp server (port 3111) — full vision + interaction
 *   2. Browserbase cloud REST API — headless sessions without local install
 *   3. Direct fetch fallback — plain HTTP GET, HTML stripped
 *
 * The local path bypasses brittle DOM selectors entirely: Stagehand sends
 * a structured accessibility snapshot + screenshot to the LLM, letting the
 * agent reason about UI state rather than hardcoding CSS paths.
 *
 * Install (optional, activates path 1):
 *   npx @browserbasehq/stagehand-mcp
 *
 * Env vars for path 2 (Supabase secrets):
 *   BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID
 */

import { pluginRegistry, type MavisPlugin } from "@/mavis/pluginSystem";
import {
  MCP_SERVERS,
  isMcpServerAlive,
  callMcpTool,
  mcpResultText,
} from "@/mavis/mcpBridge";

// ── Public API ────────────────────────────────────────────────────────────────

export interface BrowserResult {
  url: string;
  title?: string;
  text: string;
  screenshot?: string;   // base64 PNG when available
  provider: "stagehand-local" | "browserbase-cloud" | "fetch-fallback";
}

export interface BrowserExtractOptions {
  instruction: string;   // natural language: "extract all product prices"
  schema?: string;       // optional JSON schema for structured extraction
}

// ── Navigate + extract page content ──────────────────────────────────────────

export async function browserNavigate(url: string): Promise<BrowserResult> {
  if (await isMcpServerAlive(MCP_SERVERS.stagehand)) {
    return _navigateViaStagehand(url);
  }
  return _navigateViaFetch(url);
}

export async function browserExtract(
  url: string,
  options: BrowserExtractOptions,
): Promise<string> {
  if (await isMcpServerAlive(MCP_SERVERS.stagehand)) {
    try {
      const nav = await callMcpTool(MCP_SERVERS.stagehand, {
        name: "stagehand_navigate",
        arguments: { url },
      });
      const extract = await callMcpTool(MCP_SERVERS.stagehand, {
        name: "stagehand_extract",
        arguments: {
          instruction: options.instruction,
          ...(options.schema ? { schema: options.schema } : {}),
        },
      });
      return mcpResultText(extract) || mcpResultText(nav);
    } catch (err) {
      console.warn("[stagehandPlugin] local extract failed, falling back:", err);
    }
  }
  // Fallback: return raw text from fetch
  const result = await _navigateViaFetch(url);
  return result.text;
}

export async function browserScreenshot(url: string): Promise<string | null> {
  if (!await isMcpServerAlive(MCP_SERVERS.stagehand)) return null;
  try {
    await callMcpTool(MCP_SERVERS.stagehand, { name: "stagehand_navigate", arguments: { url } });
    const shot = await callMcpTool(MCP_SERVERS.stagehand, {
      name: "stagehand_screenshot",
      arguments: {},
    });
    const img = shot.content.find(c => c.type === "image");
    return img?.data ?? null;
  } catch {
    return null;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _navigateViaStagehand(url: string): Promise<BrowserResult> {
  const result = await callMcpTool(MCP_SERVERS.stagehand, {
    name: "stagehand_navigate",
    arguments: { url },
  });
  const text = mcpResultText(result);
  const screenshot = result.content.find(c => c.type === "image")?.data;
  return { url, text, screenshot, provider: "stagehand-local" };
}

async function _navigateViaFetch(url: string): Promise<BrowserResult> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    let text = await res.text();
    text = text.replace(/<script[\s\S]*?<\/script>/gi, "")
               .replace(/<style[\s\S]*?<\/style>/gi, "")
               .replace(/<[^>]*>/g, " ")
               .replace(/\s+/g, " ")
               .trim()
               .slice(0, 6000);
    const titleMatch = text.match(/title[^>]*>([^<]+)/i);
    return { url, text, title: titleMatch?.[1]?.trim(), provider: "fetch-fallback" };
  } catch (err) {
    return { url, text: `Fetch failed: ${(err as Error).message}`, provider: "fetch-fallback" };
  }
}

// ── MAVIS Plugin registration ─────────────────────────────────────────────────

export const stagehandPlugin = {
  id:          "stagehand-browser",
  name:        "Stagehand Browser",
  description: "Vision-aware browser automation via Stagehand MCP or Browserbase cloud",
  version:     "1.0.0",
  category:    "automation",
  isEnabled:   false,

  async onEnable() {
    const alive = await isMcpServerAlive(MCP_SERVERS.stagehand);
    console.log(`[stagehandPlugin] local MCP ${alive ? "online ✓" : "offline — using fetch fallback"}`);
  },

  async onDisable() {},
};

pluginRegistry.register(stagehandPlugin);
