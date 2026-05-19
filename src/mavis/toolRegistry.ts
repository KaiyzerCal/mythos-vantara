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

import { supabase } from "@/integrations/supabase/client";

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
    await supabase
      .from("mavis_tool_registry")
      .update({ usage_count: supabase.rpc as never, last_used_at: new Date().toISOString() })
      .eq("name", name)
      .catch(() => {/* non-fatal */});
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

  try {
    const result = await Promise.race([tool.execute(call.params, userId), timeoutPromise]);
    return { toolCallId: call.id, name: call.name, result };
  } catch (err) {
    return {
      toolCallId: call.id,
      name: call.name,
      result: { success: false, output: "", error: (err as Error).message },
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
  description: "Create a new quest task in MAVIS",
  category: "data",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Task title" },
      description: { type: "string", description: "Task description" },
      quest_id: { type: "string", description: "Optional quest UUID to attach to" },
      due_date: { type: "string", description: "Due date in ISO format (optional)" },
    },
    required: ["title"],
  },
  async execute(params, userId) {
    const { data, error } = await supabase
      .from("mavis_tasks")
      .insert({
        user_id: userId,
        title: params.title,
        description: params.description ?? null,
        quest_id: params.quest_id ?? null,
        due_date: params.due_date ?? null,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) return { success: false, output: `Failed to create task: ${error.message}`, error: error.message };
    return { success: true, output: `Task created: "${params.title}" (ID: ${data.id})`, data };
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
