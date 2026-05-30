/**
 * Dynamic Tool Registry — OpenClaw function-calling orchestration pattern.
 * Tools declare JSON Schema parameters. The LLM outputs tool calls in
 * OpenAI-compatible format; this registry validates, executes, and feeds
 * results back into the conversation for the next inference step.
 *
 * Architecture:
 *   ToolRegistry (in-memory + DB sync)
 *     → FunctionCallParser (extracts tool calls from LLM output)
 *     → ToolExecutor (validates params, runs handler, enforces timeout)
 *     → FeedbackLoop (injects results as "tool" role messages)
 */

import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { browserNavigate, browserExtract } from "@/mavis/plugins/stagehandPlugin";
import { buildWorkflow, triggerWorkflow, listWorkflows } from "@/mavis/plugins/n8nPlugin";
import { think, formatThoughtChain } from "@/mavis/sequentialThought";

// ── JSON Schema subset for tool parameters ────────────────────────────────────

export interface JSONSchemaProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface ToolParameters {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

// ── Tool definition ───────────────────────────────────────────────────────────

export type ToolCategory = "api" | "system" | "data" | "analysis" | "communication" | "trading" | "knowledge";

export interface ToolResult {
  success: boolean;
  output: string;
  data?: unknown;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: ToolParameters;
  requiresApproval?: boolean;
  timeoutMs?: number;
  execute: (params: Record<string, unknown>, userId: string) => Promise<ToolResult>;
}

// OpenAI-compatible tool call format output by LLMs
export interface LLMToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ParsedToolCall {
  id: string;
  name: string;
  params: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  result: ToolResult;
}

// ── Tool Registry ─────────────────────────────────────────────────────────────

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  getByCategory(category: ToolCategory): ToolDefinition[] {
    return [...this.tools.values()].filter(t => t.category === category);
  }

  /** Format as OpenAI-style tools array for the LLM request payload */
  toOpenAIFormat(filter?: (t: ToolDefinition) => boolean): object[] {
    return [...this.tools.values()]
      .filter(filter ?? (() => true))
      .map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
  }

  /** Sync registered tool names to DB for persistence + cross-session visibility */
  async syncToDb(userId: string): Promise<void> {
    const rows = [...this.tools.values()].map(t => ({
      user_id: userId,
      name: t.name,
      description: t.description,
      category: t.category,
      parameters: t.parameters,
      requires_approval: t.requiresApproval ?? false,
      timeout_ms: t.timeoutMs ?? 30_000,
      updated_at: new Date().toISOString(),
    }));

    for (const row of rows) {
      await supabase
        .from("mavis_tool_registry")
        .upsert(row, { onConflict: "user_id,name" })
        .catch(() => {/* non-fatal */});
    }
  }

  async incrementUsage(name: string): Promise<void> {
    await supabase.rpc("increment_tool_usage", { p_tool_name: name })
      .catch(() => {
        // Fallback: just update last_used_at if RPC doesn't exist
        supabase.from("mavis_tool_registry")
          .update({ last_used_at: new Date().toISOString() })
          .eq("name", name)
          .catch(() => {});
      });
  }
}

export const toolRegistry = new ToolRegistry();

// ── Function call parser ──────────────────────────────────────────────────────

/** Parse tool calls from LLM output. Handles both structured JSON and markdown
 *  code blocks that local models (Ollama) often produce. */
export function parseFunctionCalls(llmOutput: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];

  // Pattern 1: OpenAI-style structured JSON array in ```json blocks
  const jsonBlockMatch = llmOutput.match(/```json\s*([\s\S]*?)```/i);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item.function?.name) {
          calls.push({
            id: item.id ?? crypto.randomUUID(),
            name: item.function.name,
            params: typeof item.function.arguments === "string"
              ? JSON.parse(item.function.arguments)
              : item.function.arguments ?? {},
          });
        }
      }
      if (calls.length > 0) return calls;
    } catch {/* fall through to next pattern */}
  }

  // Pattern 2: XML-like <tool_call> tags (common in local models)
  const toolCallMatches = llmOutput.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi);
  for (const match of toolCallMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.name) {
        calls.push({
          id: crypto.randomUUID(),
          name: parsed.name,
          params: parsed.arguments ?? parsed.parameters ?? {},
        });
      }
    } catch {/* skip malformed */}
  }
  if (calls.length > 0) return calls;

  // Pattern 3: FUNCTION_CALL: name({"param": "value"}) inline format
  const inlineMatches = llmOutput.matchAll(/FUNCTION_CALL:\s*(\w+)\s*\((\{[\s\S]*?\})\)/gi);
  for (const match of inlineMatches) {
    try {
      calls.push({
        id: crypto.randomUUID(),
        name: match[1],
        params: JSON.parse(match[2]),
      });
    } catch {/* skip */}
  }

  return calls;
}

// ── Tool executor ─────────────────────────────────────────────────────────────

export async function executeTool(
  call: ParsedToolCall,
  userId: string,
  options?: { skipApprovalCheck?: boolean }
): Promise<ToolCallResult> {
  const tool = toolRegistry.get(call.name);

  if (!tool) {
    return {
      toolCallId: call.id,
      name: call.name,
      result: { success: false, output: "", error: `Unknown tool: ${call.name}` },
    };
  }

  if (tool.requiresApproval && !options?.skipApprovalCheck) {
    return {
      toolCallId: call.id,
      name: call.name,
      result: {
        success: false,
        output: `Tool "${call.name}" requires operator approval before execution.`,
        error: "approval_required",
      },
    };
  }

  // Validate required params
  const requiredParams = tool.parameters.required ?? [];
  const missingParams = requiredParams.filter(k => !(k in call.params));
  if (missingParams.length > 0) {
    return {
      toolCallId: call.id,
      name: call.name,
      result: { success: false, output: "", error: `Missing required params: ${missingParams.join(", ")}` },
    };
  }

  // Execute with timeout
  const timeoutMs = tool.timeoutMs ?? 30_000;
  const timeoutPromise = new Promise<ToolResult>((_, reject) =>
    setTimeout(() => reject(new Error("Tool execution timed out")), timeoutMs)
  );

  const t0 = Date.now();
  try {
    const result = await Promise.race([tool.execute(call.params, userId), timeoutPromise]);
    supabase.from("mavis_tool_executions").insert({
      user_id: userId,
      tool_name: call.name,
      params: call.params,
      result: { output: result.output.slice(0, 2000) },
      success: result.success,
      error_msg: result.error ?? null,
      duration_ms: Date.now() - t0,
      provider: (result.data as any)?.provider ?? "native",
    }).catch(() => {});
    return { toolCallId: call.id, name: call.name, result };
  } catch (err) {
    const errMsg = (err as Error).message;
    supabase.from("mavis_tool_executions").insert({
      user_id: userId,
      tool_name: call.name,
      params: call.params,
      result: null,
      success: false,
      error_msg: errMsg,
      duration_ms: Date.now() - t0,
      provider: "native",
    }).catch(() => {});
    return {
      toolCallId: call.id,
      name: call.name,
      result: { success: false, output: "", error: errMsg },
    };
  }
}

// ── Feedback loop ─────────────────────────────────────────────────────────────

/** Inject tool results as "tool" role messages for the next LLM call.
 *  Returns the updated messages array with tool results appended. */
export function buildToolFeedback(
  messages: Array<{ role: string; content: string; tool_call_id?: string; name?: string }>,
  results: ToolCallResult[]
): Array<{ role: string; content: string; tool_call_id?: string; name?: string }> {
  return [
    ...messages,
    ...results.map(r => ({
      role: "tool" as const,
      tool_call_id: r.toolCallId,
      name: r.name,
      content: r.result.success
        ? `Result: ${r.result.output}${r.result.data ? `\nData: ${JSON.stringify(r.result.data).slice(0, 500)}` : ""}`
        : `Error: ${r.result.error ?? r.result.output}`,
    })),
  ];
}

/** Run a full tool-use loop: parse → execute → inject feedback → repeat until
 *  no more tool calls or max iterations reached. */
export async function runToolLoop(
  llmOutput: string,
  messages: Array<{ role: string; content: string }>,
  userId: string,
  callLLM: (msgs: Array<{ role: string; content: string }>) => Promise<string>,
  options?: { maxIterations?: number; onToolCall?: (call: ParsedToolCall) => void }
): Promise<{ finalOutput: string; toolsUsed: string[]; iterations: number }> {
  const maxIterations = options?.maxIterations ?? 5;
  const toolsUsed: string[] = [];
  let currentOutput = llmOutput;
  let currentMessages = messages;
  let iterations = 0;

  while (iterations < maxIterations) {
    const calls = parseFunctionCalls(currentOutput);
    if (calls.length === 0) break;

    iterations++;
    const results: ToolCallResult[] = [];

    for (const call of calls) {
      options?.onToolCall?.(call);
      toolsUsed.push(call.name);
      results.push(await executeTool(call, userId));
    }

    currentMessages = buildToolFeedback(
      [...currentMessages, { role: "assistant", content: currentOutput }],
      results
    );

    currentOutput = await callLLM(currentMessages);
  }

  return { finalOutput: currentOutput, toolsUsed, iterations };
}

// ── Built-in tools ────────────────────────────────────────────────────────────

// Registered at module load; specialized plugins add their own tools.

toolRegistry.register({
  name: "search_knowledge",
  description: "Search the MAVIS knowledge base (notes, vault, journal) by keyword or topic",
  category: "knowledge",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      sources: {
        type: "array",
        description: "Sources to search: notes, journal, vault, memories",
        items: { type: "string", enum: ["notes", "journal", "vault", "memories"] },
      },
      limit: { type: "number", description: "Max results per source (default 5)" },
    },
    required: ["query"],
  },
  async execute(params, userId) {
    const query = params.query as string;
    const sources = (params.sources as string[]) ?? ["notes", "vault"];
    const limit = (params.limit as number) ?? 5;
    const sections: string[] = [];

    if (sources.includes("notes")) {
      const { data } = await supabase
        .from("mavis_notes")
        .select("title, content")
        .eq("user_id", userId)
        .textSearch("content", query.replace(/\s+/g, " & "), { type: "plain" })
        .limit(limit);
      if (data?.length) {
        sections.push(`Notes:\n${data.map(n => `  [${n.title}] ${String(n.content).slice(0, 200)}`).join("\n")}`);
      }
    }

    if (sources.includes("journal")) {
      const { data } = await supabase
        .from("mavis_journal")
        .select("title, content, created_at")
        .eq("user_id", userId)
        .ilike("content", `%${query}%`)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (data?.length) {
        sections.push(`Journal:\n${data.map(j => `  [${j.title}] ${String(j.content).slice(0, 200)}`).join("\n")}`);
      }
    }

    const output = sections.join("\n\n") || `No results found for: ${query}`;
    return { success: true, output };
  },
});

toolRegistry.register({
  name: "get_system_status",
  description: "Get current MAVIS system status: mesh health, active agents, pending tasks",
  category: "system",
  parameters: { type: "object", properties: {} },
  async execute(_params, userId) {
    const [{ count: pendingTasks }, { count: activeSessions }] = await Promise.all([
      supabase.from("mavis_tasks").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("status", "pending"),
      supabase.from("mavis_agent_sessions").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("status", "active"),
    ]);

    const online = navigator.onLine;
    const output = `System: ${online ? "ONLINE" : "OFFLINE"} | Pending tasks: ${pendingTasks ?? 0} | Active agent sessions: ${activeSessions ?? 0}`;
    return { success: true, output, data: { online, pendingTasks, activeSessions } };
  },
});

toolRegistry.register({
  name: "create_task",
  description: "Create a new quest (tasks are stored as quests — there is no separate tasks table)",
  category: "data",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Quest/task title" },
      description: { type: "string", description: "Description" },
      type: { type: "string", description: "daily | side | main | epic (default: daily)" },
      xp_reward: { type: "number", description: "XP reward (default: 25)" },
      deadline: { type: "string", description: "Deadline ISO timestamp (optional)" },
    },
    required: ["title"],
  },
  async execute(params, userId) {
    const { data, error } = await supabase
      .from("quests")
      .insert({
        user_id: userId,
        title: params.title,
        description: params.description ?? "",
        type: params.type ?? "daily",
        status: "active",
        xp_reward: params.xp_reward ?? 25,
        deadline: params.deadline ?? null,
      })
      .select("id")
      .single();

    if (error) return { success: false, output: `Failed to create quest: ${error.message}`, error: error.message };
    return { success: true, output: `Quest created: "${params.title}" (ID: ${data.id})`, data };
  },
});


toolRegistry.register({
  name: "fetch_url",
  description: "Fetch content from a URL (GET request, returns text)",
  category: "api",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch" },
      extract_text: { type: "boolean", description: "Strip HTML tags from response (default true)" },
    },
    required: ["url"],
  },
  timeoutMs: 15_000,
  requiresApproval: false,
  async execute(params) {
    try {
      const res = await fetch(params.url as string);
      if (!res.ok) return { success: false, output: `HTTP ${res.status}`, error: `HTTP ${res.status}` };
      let text = await res.text();
      if (params.extract_text !== false) {
        text = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
      return { success: true, output: text.slice(0, 3000) };
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }
  },
});

// ── MCP-backed tools ──────────────────────────────────────────────────────────

toolRegistry.register({
  name: "browser_navigate",
  description: "Navigate to a URL using Stagehand vision-aware browser. Returns page text and detects dynamic SPA content. Falls back to direct fetch when Stagehand isn't running locally.",
  category: "api",
  parameters: {
    type: "object",
    properties: {
      url:     { type: "string",  description: "Full URL to navigate to" },
      extract: { type: "string",  description: "Optional: natural language instruction for what to extract (e.g. 'all product prices')" },
    },
    required: ["url"],
  },
  timeoutMs: 45_000,
  async execute(params) {
    try {
      if (params.extract) {
        const text = await browserExtract(params.url as string, { instruction: params.extract as string });
        return { success: true, output: text.slice(0, 4000) };
      }
      const result = await browserNavigate(params.url as string);
      return {
        success: true,
        output:  result.text.slice(0, 4000),
        data:    { provider: result.provider, title: result.title },
      };
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }
  },
});

toolRegistry.register({
  name: "build_n8n_workflow",
  description: "Build a complete n8n automation workflow from a natural language description. Returns the workflow JSON ready to save or execute. Requires n8n MCP server running locally.",
  category: "system",
  parameters: {
    type: "object",
    properties: {
      description: { type: "string",  description: "Natural language description of the automation (e.g. 'Send a Slack message when a new Supabase row is inserted')" },
      save:        { type: "boolean", description: "If true, save the workflow to n8n immediately (requires N8N_API_KEY)" },
    },
    required: ["description"],
  },
  timeoutMs: 60_000,
  requiresApproval: true,
  async execute(params) {
    try {
      const blueprint = await buildWorkflow(params.description as string);
      if (!blueprint) return { success: false, output: "n8n MCP server not available. Start it with: npx @czlonkowski/n8n-mcp" };
      if (params.save) {
        const id = await triggerWorkflow(blueprint as never);
        if (id) return { success: true, output: `Workflow saved to n8n. ID: ${id}`, data: blueprint };
      }
      return { success: true, output: `Workflow blueprint created: "${blueprint.name}"\n${blueprint.description}`, data: blueprint };
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }
  },
});

toolRegistry.register({
  name: "list_n8n_workflows",
  description: "List all automation workflows in the connected n8n instance.",
  category: "system",
  parameters: { type: "object", properties: {} },
  async execute() {
    try {
      const workflows = await listWorkflows();
      if (!workflows.length) return { success: true, output: "No workflows found or n8n not configured." };
      const lines = workflows.map(w => `• [${w.id}] ${w.name} — ${w.active ? "active" : "inactive"}`);
      return { success: true, output: lines.join("\n"), data: workflows };
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }
  },
});

toolRegistry.register({
  name: "think_sequential",
  description: "Apply tree-of-thought reasoning before taking a complex action. Use this before any irreversible mutation, multi-step plan, or ambiguous decision to reduce greedy-decoding errors.",
  category: "analysis",
  parameters: {
    type: "object",
    properties: {
      goal:    { type: "string", description: "What you need to reason through" },
      context: { type: "string", description: "Relevant facts and constraints to consider" },
      mode:    { type: "string", enum: ["chain", "tree", "revision"], description: "chain=linear, tree=branching, revision=allows backtracking" },
      steps:   { type: "number", description: "Max thought steps (default 5)" },
    },
    required: ["goal", "context"],
  },
  timeoutMs: 120_000,
  async execute(params) {
    try {
      const chain = await think(
        params.goal as string,
        params.context as string,
        { mode: (params.mode as never) ?? "chain", maxSteps: (params.steps as number) ?? 5 },
      );
      return { success: true, output: formatThoughtChain(chain), data: chain };
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }
  },
});

toolRegistry.register({
  name: "graph_traverse",
  description: "Traverse the MAVIS knowledge graph from a starting note outward by wikilinks. Returns a subgraph of connected notes up to the specified depth. Use for context discovery before writing or referencing notes.",
  category: "knowledge",
  parameters: {
    type: "object",
    properties: {
      start_title: { type: "string",  description: "Title of the starting note" },
      depth:       { type: "number",  description: "How many link hops to follow (1–4, default 2)" },
      user_id:     { type: "string",  description: "User ID (injected automatically)" },
    },
    required: ["start_title"],
  },
  async execute(params, userId) {
    try {
      const depth = Math.min(Math.max(1, (params.depth as number) ?? 2), 4);
      const uid   = (params.user_id as string) || userId;

      // Seed: find the starting note
      const { data: seed } = await supabase
        .from("mavis_notes")
        .select("id, title, content, tags")
        .eq("user_id", uid)
        .ilike("title", params.start_title as string)
        .limit(1);

      if (!seed?.length) return { success: false, output: `Note "${params.start_title}" not found.` };

      // BFS over wikilinks
      const visited  = new Set<string>([seed[0].id]);
      const frontier = [seed[0].id];
      const nodes: Array<{ id: string; title: string; tags: string[] }> = [{ id: seed[0].id, title: seed[0].title, tags: seed[0].tags ?? [] }];
      const edges: Array<{ from: string; to: string }> = [];

      for (let hop = 0; hop < depth; hop++) {
        if (!frontier.length) break;
        const { data: links } = await supabase
          .from("mavis_note_wikilinks")
          .select("source_note_id, target_slug")
          .in("source_note_id", frontier)
          .eq("user_id", uid);

        frontier.length = 0;
        for (const link of (links ?? [])) {
          const { data: targets } = await supabase
            .from("mavis_notes")
            .select("id, title, tags")
            .eq("user_id", uid)
            .ilike("title", link.target_slug)
            .limit(1);
          for (const t of (targets ?? [])) {
            edges.push({ from: link.source_note_id, to: t.id });
            if (!visited.has(t.id)) {
              visited.add(t.id);
              frontier.push(t.id);
              nodes.push({ id: t.id, title: t.title, tags: t.tags ?? [] });
            }
          }
        }
      }

      const summary = [
        `Graph from "${params.start_title}" (depth ${depth}): ${nodes.length} nodes, ${edges.length} edges`,
        "Nodes: " + nodes.map(n => `"${n.title}" [${(n.tags ?? []).join(", ")}]`).join(" → "),
      ].join("\n");

      return { success: true, output: summary, data: { nodes, edges } };
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message };
    }
  },
});
