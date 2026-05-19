/**
 * MAVIS Local Mesh — API abstraction layer for local LLM inference.
 *
 * Architectural pattern adapted from OpenJarvis:
 *   - Ollama HTTP API as the primary local provider (POST /api/chat)
 *   - llama-cpp-python compatible request format
 *   - Graceful fallback to cloud when local is unavailable
 *   - Configurable endpoint to support tunneled access (Tailscale / ngrok)
 *
 * Current devices: routes to cloud. When OpenClaw/OpenJarvis arrives,
 * set the endpoint in settings and the mesh activates automatically.
 */

export type LocalMeshStatus = "checking" | "online" | "offline" | "disabled";
export type LocalMeshProvider = "ollama" | "llama-cpp" | "custom";

export interface LocalMeshConfig {
  enabled: boolean;
  endpoint: string;           // e.g. "http://localhost:11434" or Tailscale URL
  model: string;              // e.g. "llama3.2:3b", "mistral:7b", "phi4-mini"
  provider: LocalMeshProvider;
  contextWindowTokens: number;
  preferLocalForModes: string[]; // e.g. ["CHAT", "PRIME"] — avoid for ARCH
  tunnelEnabled: boolean;
  tunnelUrl: string;          // ngrok / Tailscale address for remote-to-local
}

export interface LocalMeshMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LocalMeshResponse {
  content: string;
  provider: "local" | "cloud";
  model: string;
  durationMs: number;
  tokensUsed?: number;
}

// ── Config storage key ────────────────────────────────────────
const CONFIG_KEY = "mavis-local-mesh-config";

const DEFAULT_CONFIG: LocalMeshConfig = {
  enabled: false,
  endpoint: "http://localhost:11434",
  model: "llama3.2:3b",
  provider: "ollama",
  contextWindowTokens: 4096,
  preferLocalForModes: ["CHAT", "PRIME"],
  tunnelEnabled: false,
  tunnelUrl: "",
};

// ── Config persistence ────────────────────────────────────────
export function getLocalMeshConfig(): LocalMeshConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_CONFIG;
}

export function saveLocalMeshConfig(config: Partial<LocalMeshConfig>): void {
  const current = getLocalMeshConfig();
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...current, ...config }));
  // Invalidate cached status so next health check re-runs
  _cachedStatus = null;
  _statusTs = 0;
}

// ── Health check (cached 30s) ─────────────────────────────────
let _cachedStatus: LocalMeshStatus | null = null;
let _statusTs = 0;
const STATUS_TTL_MS = 30_000;

export async function checkLocalMeshHealth(force = false): Promise<LocalMeshStatus> {
  const cfg = getLocalMeshConfig();
  if (!cfg.enabled) return "disabled";

  if (!force && _cachedStatus && Date.now() - _statusTs < STATUS_TTL_MS) {
    return _cachedStatus;
  }

  const endpoint = cfg.tunnelEnabled && cfg.tunnelUrl ? cfg.tunnelUrl : cfg.endpoint;

  try {
    // Ollama health: GET /api/tags returns list of local models
    const res = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    _cachedStatus = res.ok ? "online" : "offline";
  } catch {
    _cachedStatus = "offline";
  }

  _statusTs = Date.now();
  return _cachedStatus;
}

// ── Streaming inference (Ollama /api/chat SSE format) ─────────
/**
 * Streams tokens from local Ollama. On every token, calls onToken.
 * If local is unavailable, returns null so caller can fall back to cloud.
 *
 * Ollama streaming response format (per OpenJarvis plugin pattern):
 *   { "model": "...", "message": {"role":"assistant","content":"token"}, "done": false }
 */
export async function streamLocalMesh(
  messages: LocalMeshMessage[],
  onToken: (token: string, accumulated: string) => void,
  signal?: AbortSignal,
): Promise<LocalMeshResponse | null> {
  const cfg = getLocalMeshConfig();
  if (!cfg.enabled) return null;

  const health = await checkLocalMeshHealth();
  if (health !== "online") return null;

  const endpoint = cfg.tunnelEnabled && cfg.tunnelUrl ? cfg.tunnelUrl : cfg.endpoint;
  const t0 = Date.now();

  try {
    const res = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: true,
        options: {
          num_ctx: cfg.contextWindowTokens,
          temperature: 0.7,
          top_p: 0.9,
        },
      }),
    });

    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let accumulated = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = dec.decode(value, { stream: true }).split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          const token = j?.message?.content ?? "";
          if (token) {
            accumulated += token;
            onToken(token, accumulated);
          }
          if (j?.done) break;
        } catch {}
      }
    }

    return {
      content: accumulated,
      provider: "local",
      model: cfg.model,
      durationMs: Date.now() - t0,
    };
  } catch {
    _cachedStatus = "offline";
    return null;
  }
}

/**
 * Non-streaming local inference — returns full response string or null on failure.
 */
export async function callLocalMesh(
  messages: LocalMeshMessage[],
  signal?: AbortSignal,
): Promise<LocalMeshResponse | null> {
  const cfg = getLocalMeshConfig();
  if (!cfg.enabled) return null;

  const health = await checkLocalMeshHealth();
  if (health !== "online") return null;

  const endpoint = cfg.tunnelEnabled && cfg.tunnelUrl ? cfg.tunnelUrl : cfg.endpoint;
  const t0 = Date.now();

  try {
    const res = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
        options: { num_ctx: cfg.contextWindowTokens, temperature: 0.7 },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const content = j?.message?.content ?? "";
    return { content, provider: "local", model: cfg.model, durationMs: Date.now() - t0 };
  } catch {
    _cachedStatus = "offline";
    return null;
  }
}

/**
 * List models available on the local Ollama instance.
 */
export async function listLocalModels(): Promise<string[]> {
  const cfg = getLocalMeshConfig();
  const endpoint = cfg.tunnelEnabled && cfg.tunnelUrl ? cfg.tunnelUrl : cfg.endpoint;
  try {
    const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const j = await res.json();
    return (j?.models ?? []).map((m: any) => m.name as string);
  } catch {
    return [];
  }
}

/**
 * Check whether local mode should be preferred for a given MAVIS mode string.
 * ARCH/CODEX modes always use cloud (require Claude's full reasoning depth).
 */
export function shouldUseLocal(mavisMode: string): boolean {
  const cfg = getLocalMeshConfig();
  if (!cfg.enabled) return false;
  const ALWAYS_CLOUD = ["ARCH", "CODEX", "SOVEREIGN", "RESEARCH"];
  if (ALWAYS_CLOUD.includes(mavisMode.toUpperCase())) return false;
  return cfg.preferLocalForModes.includes(mavisMode.toUpperCase());
}
