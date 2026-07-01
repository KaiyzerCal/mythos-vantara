/**
 * MCP Client — Model Context Protocol implementation for MAVIS.
 * Mirrors Antigravity's Client-Host-Server architecture:
 *   Host  = MAVIS (this app)
 *   Client = this module (MCPClient per server)
 *   Server = external MCP server (HTTP or stdio-proxy transport)
 *
 * On connect: runs initialize → tools/list → resources/list and syncs
 * discovered tools into MAVIS's toolRegistry so agents can use them
 * transparently alongside built-in tools.
 *
 * Config mirrors mcp_config.json format used by Antigravity/Cursor/Claude Desktop:
 *   { "mcpServers": { "myServer": { "url": "https://..." } } }
 *   { "mcpServers": { "local": { "command": "node", "args": ["./server.js"] } } }
 */

import { supabase as _sb } from "@/integrations/supabase/client";
const supabase: any = _sb;
import { toolRegistry, type ToolDefinition } from "@/mavis/toolRegistry";

// ── MCP Protocol Types (JSON-RPC 2.0) ────────────────────────────────────────

interface MCPJsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id: number;
}

interface MCPJsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPServerInfo {
  name: string;
  version: string;
  capabilities?: {
    tools?: Record<string, unknown>;
    resources?: Record<string, unknown>;
    prompts?: Record<string, unknown>;
  };
}

// ── Server Config (mirrors mcp_config.json) ───────────────────────────────────

export type MCPTransport = "http" | "sse" | "stdio-proxy";

export interface MCPServerConfig {
  id?: string;
  name: string;
  description?: string;
  transport: MCPTransport;
  // HTTP / SSE transport
  url?: string;
  authToken?: string;
  // stdio-proxy transport (routed via LocalMesh proxy endpoint)
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

// ── Single MCP client (one per server) ───────────────────────────────────────

export class MCPClient {
  private _requestId = 1;
  private _initialized = false;
  public serverInfo: MCPServerInfo | null = null;
  public tools: MCPTool[] = [];
  public resources: MCPResource[] = [];

  constructor(public readonly config: MCPServerConfig) {}

  private nextId(): number { return this._requestId++; }

  /** Send a JSON-RPC 2.0 request to the MCP server */
  private async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const req: MCPJsonRpcRequest = { jsonrpc: "2.0", method, params, id: this.nextId() };

    if (this.config.transport === "http" || this.config.transport === "sse") {
      const url = this.config.url;
      if (!url) throw new Error(`MCP server "${this.config.name}" has no url configured`);

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.config.authToken) headers["Authorization"] = `Bearer ${this.config.authToken}`;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(req),
      });

      if (!res.ok) throw new Error(`MCP HTTP error ${res.status}: ${await res.text().catch(() => "")}`);
      const rpc = await res.json() as MCPJsonRpcResponse;
      if (rpc.error) throw new Error(`MCP error ${rpc.error.code}: ${rpc.error.message}`);
      return rpc.result as T;
    }

    if (this.config.transport === "stdio-proxy") {
      // Route stdio servers through the LocalMesh proxy endpoint.
      // The local Ollama companion service (or a dedicated MAVIS helper) must expose
      // a /mcp-proxy route that spawns and communicates with the stdio process.
      const { getLocalMeshConfig } = await import("@/mavis/localMesh");
      const cfg = getLocalMeshConfig();
      const proxyBase = cfg.tunnelEnabled && cfg.tunnelUrl ? cfg.tunnelUrl : cfg.endpoint;
      const proxyUrl = `${proxyBase}/mcp-proxy`;

      const res = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: this.config.command,
          args: this.config.args ?? [],
          env: this.config.env ?? {},
          rpcRequest: req,
        }),
      });

      if (!res.ok) throw new Error(`MCP stdio-proxy error ${res.status}`);
      const rpc = await res.json() as MCPJsonRpcResponse;
      if (rpc.error) throw new Error(`MCP proxy error ${rpc.error.code}: ${rpc.error.message}`);
      return rpc.result as T;
    }

    throw new Error(`Unsupported MCP transport: ${this.config.transport}`);
  }

  /** MCP handshake — must be called before any other method */
  async initialize(): Promise<MCPServerInfo> {
    const result = await this.send<{ serverInfo: MCPServerInfo; capabilities: Record<string, unknown> }>(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        clientInfo: { name: "MAVIS", version: "1.0.0" },
        capabilities: { tools: {}, resources: {}, prompts: {} },
      }
    );
    this.serverInfo = result.serverInfo;
    this._initialized = true;

    // Acknowledge initialization
    await this.send("notifications/initialized", {}).catch(() => {/* optional */});
    return result.serverInfo;
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this._initialized) await this.initialize();
    const result = await this.send<{ tools: MCPTool[] }>("tools/list");
    this.tools = result.tools ?? [];
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this._initialized) await this.initialize();
    return this.send("tools/call", { name, arguments: args });
  }

  async listResources(): Promise<MCPResource[]> {
    if (!this._initialized) await this.initialize();
    const result = await this.send<{ resources: MCPResource[] }>("resources/list").catch(() => ({ resources: [] }));
    this.resources = result.resources ?? [];
    return this.resources;
  }

  async readResource(uri: string): Promise<string> {
    if (!this._initialized) await this.initialize();
    const result = await this.send<{ contents: Array<{ text?: string; blob?: string }> }>(
      "resources/read", { uri }
    );
    return result.contents?.map(c => c.text ?? "").join("\n") ?? "";
  }

  async ping(): Promise<boolean> {
    try {
      await this.send("ping");
      return true;
    } catch { return false; }
  }
}

// ── MCP Registry — manages all connected servers ──────────────────────────────

class MCPRegistry {
  private clients = new Map<string, MCPClient>(); // key: server name

  /** Connect to a server, discover its tools, register them into toolRegistry */
  async connect(config: MCPServerConfig, userId: string): Promise<{ toolsAdded: number; resources: number }> {
    const client = new MCPClient(config);

    try {
      await client.initialize();
    } catch (err) {
      throw new Error(`Failed to initialize MCP server "${config.name}": ${(err as Error).message}`);
    }

    const [tools, resources] = await Promise.all([
      client.listTools().catch(() => []),
      client.listResources().catch(() => []),
    ]);

    this.clients.set(config.name, client);

    // Register each discovered tool into MAVIS's toolRegistry
    for (const tool of tools) {
      const toolDef: ToolDefinition = {
        name: `mcp::${config.name}::${tool.name}`,
        description: `[MCP:${config.name}] ${tool.description ?? tool.name}`,
        category: "api",
        parameters: (tool.inputSchema as ToolDefinition["parameters"]) ?? { type: "object", properties: {} },
        execute: async (params) => {
          try {
            const result = await client.callTool(tool.name, params);
            return {
              success: true,
              output: typeof result === "string" ? result : JSON.stringify(result).slice(0, 2000),
              data: result,
            };
          } catch (err) {
            return { success: false, output: "", error: (err as Error).message };
          }
        },
      };
      toolRegistry.register(toolDef);
    }

    // Persist to DB
    if (config.id) {
      await supabase.from("mavis_mcp_servers").update({
        health_status: "healthy",
        last_health_at: new Date().toISOString(),
        tools_manifest: tools,
        resources_manifest: resources,
        server_info: client.serverInfo ?? {},
        tools_count: tools.length,
        updated_at: new Date().toISOString(),
      }).eq("id", config.id).eq("user_id", userId).catch(() => {/* non-fatal */});
    }

    return { toolsAdded: tools.length, resources: resources.length };
  }

  /** Disconnect and remove a server's tools from the registry */
  disconnect(serverName: string): void {
    const client = this.clients.get(serverName);
    if (!client) return;

    for (const tool of client.tools) {
      toolRegistry.unregister(`mcp::${serverName}::${tool.name}`);
    }
    this.clients.delete(serverName);
  }

  /** Load all enabled servers for a user from DB and connect them */
  async connectAll(userId: string): Promise<{ connected: number; failed: string[] }> {
    const { data: servers } = await supabase
      .from("mavis_mcp_servers")
      .select("*")
      .eq("user_id", userId)
      .eq("enabled", true);

    if (!servers?.length) return { connected: 0, failed: [] };

    let connected = 0;
    const failed: string[] = [];

    for (const row of servers) {
      const config: MCPServerConfig = {
        id: row.id as string,
        name: row.name as string,
        description: row.description as string | undefined,
        transport: row.transport as MCPTransport,
        url: row.endpoint_url as string | undefined,
        authToken: row.auth_token as string | undefined,
        command: row.command as string | undefined,
        args: (row.args as string[]) ?? [],
        env: (row.env as Record<string, string>) ?? {},
      };

      try {
        await this.connect(config, userId);
        connected++;
      } catch (err) {
        failed.push(`${config.name}: ${(err as Error).message}`);
        await supabase.from("mavis_mcp_servers").update({
          health_status: "offline",
          last_health_at: new Date().toISOString(),
        }).eq("id", config.id!).catch(() => {/* non-fatal */});
      }
    }

    return { connected, failed };
  }

  /** Health-check all connected servers */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    await Promise.all(
      [...this.clients.entries()].map(async ([name, client]) => {
        results.set(name, await client.ping());
      })
    );
    return results;
  }

  /** Save a new server config to DB */
  async saveServer(config: MCPServerConfig, userId: string): Promise<string> {
    const { data, error } = await supabase
      .from("mavis_mcp_servers")
      .upsert({
        user_id: userId,
        name: config.name,
        description: config.description ?? null,
        transport: config.transport,
        endpoint_url: config.url ?? null,
        auth_token: config.authToken ?? null,
        command: config.command ?? null,
        args: config.args ?? [],
        env: config.env ?? {},
        enabled: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,name" })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to save MCP server: ${error.message}`);
    return data.id;
  }

  getClient(serverName: string): MCPClient | undefined {
    return this.clients.get(serverName);
  }

  listConnected(): string[] {
    return [...this.clients.keys()];
  }

  /** Call a tool on a specific server by full qualified name (mcp::server::tool) */
  async callQualifiedTool(qualifiedName: string, params: Record<string, unknown>): Promise<unknown> {
    const parts = qualifiedName.split("::");
    if (parts.length < 3 || parts[0] !== "mcp") {
      throw new Error(`Invalid qualified MCP tool name: ${qualifiedName}`);
    }
    const serverName = parts[1];
    const toolName = parts.slice(2).join("::");
    const client = this.clients.get(serverName);
    if (!client) throw new Error(`MCP server not connected: ${serverName}`);
    return client.callTool(toolName, params);
  }
}

export const mcpRegistry = new MCPRegistry();

// ── Convenience: parse mcp_config.json format ─────────────────────────────────

export function parseMCPConfigJson(json: string): MCPServerConfig[] {
  try {
    const parsed = JSON.parse(json);
    const servers = parsed.mcpServers ?? parsed.servers ?? {};
    return Object.entries(servers).map(([name, cfg]) => {
      const c = cfg as Record<string, unknown>;
      return {
        name,
        transport: c.url ? "http" : "stdio-proxy",
        url: c.url as string | undefined,
        authToken: c.authToken as string | undefined,
        command: c.command as string | undefined,
        args: (c.args as string[]) ?? [],
        env: (c.env as Record<string, string>) ?? {},
      } satisfies MCPServerConfig;
    });
  } catch { return []; }
}
