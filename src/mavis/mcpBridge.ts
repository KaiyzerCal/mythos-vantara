/**
 * MCP Bridge — LocalMesh gateway for Model Context Protocol servers.
 *
 * Architecture:
 *   MAVIS runtime (browser / edge function)
 *     → mcpBridge.call(server, method, params)
 *     → checks LOCAL_MCP_PORTS for a running HTTP MCP server
 *     → falls back to MAVIS cloud capabilities when local is unavailable
 *
 * Supported transports:
 *   - HTTP/SSE: Stagehand MCP (default port 3111), MetaMCP (port 3000)
 *   - REST pass-through: n8n API (port 5678), Neo4j Aura (cloud)
 *
 * All calls are non-blocking — a server being offline degrades gracefully
 * to the fallback path rather than throwing.
 */

export interface McpServer {
  name: string;
  port: number;
  baseUrl?: string;   // override for cloud-hosted servers
  healthPath?: string;
}

export interface McpToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: "text" | "image"; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

// ── Known MCP servers ─────────────────────────────────────────────────────────

export const MCP_SERVERS: Record<string, McpServer> = {
  stagehand:  { name: "stagehand",  port: 3111, healthPath: "/health" },
  metamcp:    { name: "metamcp",    port: 3000, healthPath: "/api/health" },
  n8n:        { name: "n8n",        port: 5678, healthPath: "/healthz" },
  sequential: { name: "sequential", port: 3010 },
  outstand:   { name: "outstand",   port: 9000, baseUrl: "https://mcp.outstand.com",   healthPath: "/health" },
  screenpipe: { name: "screenpipe", port: 3030, healthPath: "/health" },
};

// ── Health cache (avoid hammering closed ports) ───────────────────────────────

const _healthCache = new Map<string, { alive: boolean; ts: number }>();
const HEALTH_TTL_MS = 15_000;

export async function isMcpServerAlive(server: McpServer): Promise<boolean> {
  const key = server.name;
  const cached = _healthCache.get(key);
  if (cached && Date.now() - cached.ts < HEALTH_TTL_MS) return cached.alive;

  try {
    const base = server.baseUrl ?? `http://localhost:${server.port}`;
    const path = server.healthPath ?? "/";
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(1500) });
    const alive = res.ok;
    _healthCache.set(key, { alive, ts: Date.now() });
    return alive;
  } catch {
    _healthCache.set(key, { alive: false, ts: Date.now() });
    return false;
  }
}

// ── MCP JSON-RPC call ─────────────────────────────────────────────────────────

export async function callMcpTool(
  server: McpServer,
  tool: McpToolCall,
  timeoutMs = 30_000,
): Promise<McpToolResult> {
  const base = server.baseUrl ?? `http://localhost:${server.port}`;

  const res = await fetch(`${base}/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name: tool.name, arguments: tool.arguments },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`MCP ${server.name} returned HTTP ${res.status}`);

  const json = await res.json() as { result?: McpToolResult; error?: { message: string } };
  if (json.error) throw new Error(`MCP tool error: ${json.error.message}`);
  return json.result!;
}

// ── List available tools on a server ─────────────────────────────────────────

export async function listMcpTools(server: McpServer): Promise<string[]> {
  try {
    const base = server.baseUrl ?? `http://localhost:${server.port}`;
    const res = await fetch(`${base}/tools/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "list", method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(3000),
    });
    const json = await res.json() as { result?: { tools: Array<{ name: string }> } };
    return json.result?.tools.map(t => t.name) ?? [];
  } catch {
    return [];
  }
}

// ── Convenience: extract text from MCP result ────────────────────────────────

export function mcpResultText(result: McpToolResult): string {
  return result.content
    .filter(c => c.type === "text")
    .map(c => c.text ?? "")
    .join("\n")
    .trim();
}

// ── Social content convenience ────────────────────────────────────────────────

/**
 * Route a social content request through Outstand MCP or fall back to direct API.
 * Returns an empty string when the MCP server is unavailable — callers should
 * use MAVIS AI generation as their fallback in that case.
 */
export async function createSocialContent(
  platform: string,
  topic: string,
  brandVoice?: string,
): Promise<string> {
  const server = MCP_SERVERS.outstand;
  const alive = await isMcpServerAlive(server);

  if (alive) {
    try {
      const result = await callMcpTool(server, {
        name: "create_content",
        arguments: { platform, topic, brand_voice: brandVoice ?? "professional" },
      });
      return mcpResultText(result);
    } catch { /* fall through */ }
  }

  // Return empty string — caller will use MAVIS AI generation as fallback
  return "";
}
