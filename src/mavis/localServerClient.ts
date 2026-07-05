// ── VANTARA Local Server Client ───────────────────────────────────────────────
// Connects to the local Node.js server (server/vantara-local.mjs) when it's
// running alongside the app. Falls back gracefully to Supabase edge functions
// when the local server is unavailable (e.g. cloud/web deployments).

const LOCAL_URL = import.meta.env.VITE_LOCAL_SERVER_URL ?? "http://127.0.0.1:8789";
const TOKEN = import.meta.env.VITE_LOCAL_SERVER_TOKEN ?? "";

// Cached availability — checked once, then remembered for the session.
// Reset to null if you need a fresh check (e.g. after restarting the server).
let _available: boolean | null = null;

export async function isLocalServerAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600);
    const r = await fetch(`${LOCAL_URL}/status`, { signal: controller.signal });
    clearTimeout(timer);
    _available = r.ok;
  } catch {
    _available = false;
  }
  return _available;
}

/** Reset the cached availability (call if you restart the local server mid-session). */
export function resetLocalServerCache(): void {
  _available = null;
}

interface ToolResult {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

async function callTool(tool: string, payload: unknown): Promise<ToolResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  const r = await fetch(`${LOCAL_URL}/tools`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tool, payload }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => r.statusText);
    throw new Error(`Local server error ${r.status}: ${text}`);
  }
  return r.json();
}

// ── Tool wrappers ─────────────────────────────────────────────────────────────

/** Free DuckDuckGo web search — no API key required. */
export async function localWebSearch(query: string, limit = 6) {
  return callTool("websearch", { query, limit });
}

/** Execute Node.js, Python, or Bash code in a sandboxed subprocess. */
export async function localExecCode(code: string, language: "node" | "python" | "bash" = "node") {
  return callTool("exec", { code, language });
}

/** Run a read-only git command against the project repo. */
export async function localGitStatus(command = "status") {
  return callTool("git", { command });
}

/** Fetch and extract text from any URL using Playwright (headless Chromium). */
export async function localBrowserFetch(url: string, action: "extract" | "title" | "screenshot" = "extract") {
  return callTool("browser", { url, action });
}

/** Chat with a local Ollama model (free, no cloud API needed). */
export async function ollamaChat(prompt: string, model = "deepseek-coder:6.7b", system = "") {
  return callTool("ollama", { prompt, model, system });
}

/**
 * Self-improve a source file using an LLM.
 * Returns the improved code — does NOT write it back automatically.
 * Review the result and apply it manually or via a commit.
 */
export async function selfImproveFile(file: string, goal: string, useOllama = false) {
  return callTool("selfimprove", { file, goal, use_ollama: useOllama });
}

/** Get the local server's capability status object. */
export async function getLocalServerStatus() {
  const headers: Record<string, string> = {};
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  const r = await fetch(`${LOCAL_URL}/status`, { headers, signal: AbortSignal.timeout(2000) });
  return r.json();
}
