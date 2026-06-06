/**
 * mavis-computer-use — OpenAI Responses API with Computer Use tool.
 *
 * Uses o4-mini computer_use_preview to perform browser/desktop automation tasks.
 * Accepts a task description and optional screenshot, returns structured actions.
 *
 * Required Supabase secrets:
 *   OPENAI_API  (or OPENAI_API_KEY)
 *
 * Request body:
 *   { task: string, screenshot_base64?: string, url?: string, model?: string, user_id: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_KEY      = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const ANTHROPIC_KEY   = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SB_URL          = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY          = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BROWSER_URL     = Deno.env.get("BROWSER_URL") ?? "";

// Anthropic Computer Use — multi-turn vision loop using claude-opus-4-8.
// When a screenshot is provided, Claude sees the screen and decides what to do.
// Actions are executed via Playwright, then Claude sees the result and continues.
async function runAnthropicComputerUse(task: string, screenshotB64?: string, url?: string): Promise<ComputerUseResponse> {
  const DISPLAY_W = 1280;
  const DISPLAY_H = 800;

  // If no screenshot but URL given, fetch page content via Playwright as initial context
  let initialScreenshot = screenshotB64;
  let pageContext = "";
  if (!initialScreenshot && url && BROWSER_URL) {
    try {
      const browseRes = await fetch(`${BROWSER_URL}/browse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, extract: "text" }),
        signal: AbortSignal.timeout(30000),
      });
      if (browseRes.ok) {
        const d = await browseRes.json() as Record<string, unknown>;
        pageContext = `Current page: ${d.url}\nTitle: ${d.title}\nContent: ${String(d.text ?? d.content ?? "").slice(0, 3000)}`;
        initialScreenshot = d.screenshot as string | undefined;
      }
    } catch { /* non-fatal */ }
  }

  const messages: any[] = [{
    role: "user",
    content: [
      ...(initialScreenshot ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: initialScreenshot } }] : []),
      { type: "text", text: pageContext ? `${pageContext}\n\nTask: ${task}` : task },
    ],
  }];

  const allActions: ComputerAction[] = [];
  let thinkingLog = "";
  const MAX_TURNS = 5;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "computer-use-2025-01-24",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 4096,
        tools: [{
          type: "computer_20250124",
          name: "computer",
          display_width_px: DISPLAY_W,
          display_height_px: DISPLAY_H,
        }],
        messages,
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      throw new Error(`Anthropic Computer Use ${claudeRes.status}: ${err.slice(0, 200)}`);
    }

    const claudeData = await claudeRes.json() as any;
    const content: any[] = claudeData.content ?? [];

    // Collect thinking/text
    for (const block of content) {
      if (block.type === "text") thinkingLog += block.text + "\n";
    }

    // Check if done (no tool_use blocks)
    const toolUses = content.filter((b: any) => b.type === "tool_use" && b.name === "computer");
    if (!toolUses.length || claudeData.stop_reason === "end_turn") {
      return { actions: allActions, thinking: thinkingLog.trim(), completed: true };
    }

    // Add Claude's response to message history
    messages.push({ role: "assistant", content });

    // Execute each action via Playwright and collect results
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      const inp = tu.input as Record<string, unknown>;
      const actionType = String(inp.action ?? "");
      let resultScreenshot: string | undefined;

      // Execute action via Playwright if available
      if (BROWSER_URL && (actionType === "screenshot" || actionType === "left_click" || actionType === "type")) {
        try {
          const actionRes = await fetch(`${BROWSER_URL}/browse`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url ?? "about:blank", action: actionType, params: inp }),
            signal: AbortSignal.timeout(15000),
          });
          if (actionRes.ok) {
            const d = await actionRes.json() as Record<string, unknown>;
            resultScreenshot = d.screenshot as string | undefined;
          }
        } catch { /* non-fatal */ }
      }

      // Parse action for our response format
      if (actionType === "left_click" || actionType === "right_click" || actionType === "double_click") {
        const coord = inp.coordinate as [number, number] | undefined;
        allActions.push({ type: "click", x: coord?.[0], y: coord?.[1] });
      } else if (actionType === "type") {
        allActions.push({ type: "type", text: String(inp.text ?? "") });
      } else if (actionType === "scroll") {
        const coord = inp.coordinate as [number, number] | undefined;
        allActions.push({ type: "scroll", x: coord?.[0], y: coord?.[1], direction: (inp.direction as any) ?? "down" });
      } else if (actionType === "key") {
        allActions.push({ type: "key", text: String(inp.key ?? "") });
      } else {
        allActions.push({ type: "screenshot" });
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: resultScreenshot
          ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: resultScreenshot } }]
          : [{ type: "text", text: `Action "${actionType}" executed.` }],
      });
    }

    // Send results back to Claude for next turn
    messages.push({ role: "user", content: toolResults });
  }

  return { actions: allActions, thinking: thinkingLog.trim(), completed: false };
}

interface ComputerUseRequest {
  task: string;
  screenshot_base64?: string;
  url?: string;
  model?: string;
  user_id: string;
}

interface ComputerAction {
  type: "click" | "type" | "screenshot" | "scroll" | "key" | "move";
  x?: number;
  y?: number;
  text?: string;
  direction?: "up" | "down" | "left" | "right";
  coordinate?: [number, number];
}

interface ComputerUseResponse {
  actions: ComputerAction[];
  thinking: string;
  completed: boolean;
  task_id?: string;
  screenshot?: string;
}

// Detect if a task is browse/scrape (can run locally without OpenAI vision)
function isBrowseTask(task: string): boolean {
  const t = task.toLowerCase();
  return t.includes("browse") || t.includes("visit") || t.includes("scrape") ||
    t.includes("extract") || t.includes("get info from") || t.includes("read the page") ||
    t.includes("go to ") || t.includes("check the website") || t.includes("look up") ||
    t.includes("find on") || t.includes("search the web") || t.includes("open url");
}

function extractUrlFromTask(text: string): string | undefined {
  return text.match(/https?:\/\/[^\s"'<>)]+/)?.[0];
}

async function browseWithPlaywright(task: string, url: string | undefined): Promise<ComputerUseResponse> {
  const targetUrl = url ?? extractUrlFromTask(task);
  if (!targetUrl) throw new Error("No URL found in task. Provide url parameter or include a URL in the task.");
  const res = await fetch(`${BROWSER_URL}/browse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: targetUrl, extract: "text" }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Browser server error: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    actions: [{ type: "screenshot" }],
    thinking: `Browsed ${data.url}\nTitle: ${data.title}\n\n${String(data.content ?? "").slice(0, 4000)}`,
    completed: true,
    screenshot: data.screenshot as string | undefined,
  };
}

function parseActions(output: unknown[]): ComputerAction[] {
  const actions: ComputerAction[] = [];

  for (const item of output) {
    const block = item as Record<string, unknown>;
    if (block.type !== "tool_use" && block.type !== "computer_call") continue;

    // Handle Responses API computer_call format
    if (block.type === "computer_call") {
      const action = block.action as Record<string, unknown>;
      if (!action) continue;
      const actionType = action.type as string;

      if (actionType === "click" || actionType === "left_click" || actionType === "right_click" || actionType === "double_click") {
        actions.push({
          type: "click",
          x: action.x as number,
          y: action.y as number,
        });
      } else if (actionType === "type") {
        actions.push({
          type: "type",
          text: action.text as string,
        });
      } else if (actionType === "screenshot") {
        actions.push({ type: "screenshot" });
      } else if (actionType === "scroll") {
        actions.push({
          type: "scroll",
          x: action.x as number,
          y: action.y as number,
          direction: (action.direction as "up" | "down" | "left" | "right") ?? "down",
        });
      } else if (actionType === "key") {
        actions.push({
          type: "key",
          text: action.key as string,
        });
      } else if (actionType === "move") {
        actions.push({
          type: "move",
          x: action.x as number,
          y: action.y as number,
        });
      }
    }

    // Handle tool_use format (legacy)
    if (block.type === "tool_use" && block.name === "computer") {
      const input = block.input as Record<string, unknown>;
      if (!input) continue;
      const actionType = input.action as string;

      if (actionType === "screenshot") {
        actions.push({ type: "screenshot" });
      } else if (actionType === "left_click" || actionType === "right_click" || actionType === "double_click") {
        const coord = input.coordinate as [number, number];
        actions.push({ type: "click", x: coord?.[0], y: coord?.[1] });
      } else if (actionType === "type") {
        actions.push({ type: "type", text: input.text as string });
      } else if (actionType === "scroll") {
        const coord = input.coordinate as [number, number];
        actions.push({
          type: "scroll",
          x: coord?.[0],
          y: coord?.[1],
          direction: (input.direction as "up" | "down") ?? "down",
        });
      } else if (actionType === "key") {
        actions.push({ type: "key", text: input.key as string });
      }
    }
  }

  return actions;
}

function extractThinking(output: unknown[]): string {
  for (const item of output) {
    const block = item as Record<string, unknown>;
    if (block.type === "reasoning" || block.type === "thinking") {
      return (block.summary as string) ?? (block.thinking as string) ?? "";
    }
    if (block.type === "message" || block.type === "text") {
      const content = block.content ?? block.text;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const cb = c as Record<string, unknown>;
          if (cb.type === "text" || cb.type === "output_text") return cb.text as string;
        }
      }
    }
  }
  return "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Auth gate
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error: authErr } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { task, screenshot_base64, url, model, user_id } = await req.json() as ComputerUseRequest;

    if (!task) {
      return new Response(JSON.stringify({ error: "task is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Tier 0: Playwright browse tasks (no AI cost, fastest) ──────────────────
    if (BROWSER_URL && isBrowseTask(task)) {
      try {
        const result = await browseWithPlaywright(task, url);
        try {
          await createClient(SB_URL, SB_KEY)
            .from("computer_use_tasks")
            .insert({ user_id: user_id ?? user.id, task_description: task, model: "playwright", actions_taken: result.actions, status: "completed", result: result.thinking });
        } catch { /* non-fatal */ }
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        console.warn("[mavis-computer-use] Playwright fallback failed, cascading:", (e as Error).message);
      }
    }

    // ── Tier 1: Anthropic Computer Use (vision loop, best accuracy) ─────────────
    if (ANTHROPIC_KEY) {
      try {
        const result = await runAnthropicComputerUse(task, screenshot_base64, url);
        try {
          await createClient(SB_URL, SB_KEY)
            .from("computer_use_tasks")
            .insert({ user_id: user_id ?? user.id, task_description: task, model: "claude-opus-4-8-computer-use", actions_taken: result.actions, status: result.completed ? "completed" : "partial", result: result.thinking });
        } catch { /* non-fatal */ }
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        console.warn("[mavis-computer-use] Anthropic Computer Use failed, trying OpenAI:", (e as Error).message);
      }
    }

    if (!OPENAI_KEY) {
      return new Response(
        JSON.stringify({ error: "No automation service available. Set ANTHROPIC_API_KEY, OPENAI_API, or BROWSER_URL.", configured: false }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build content array — task text + optional screenshot
    const contentItems: unknown[] = [
      { type: "input_text", text: url ? `URL context: ${url}\n\nTask: ${task}` : task },
    ];
    if (screenshot_base64) {
      contentItems.push({
        type: "input_image",
        image_url: `data:image/png;base64,${screenshot_base64}`,
      });
    }

    const requestBody = {
      model: model ?? "computer-use-preview",
      input: [
        {
          role: "user",
          content: contentItems,
        },
      ],
      tools: [
        {
          type: "computer_use_preview",
          display_width_px: 1280,
          display_height_px: 800,
          environment: "browser",
        },
      ],
      max_output_tokens: 4096,
      truncation: "auto",
    };

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      throw new Error(`OpenAI Responses API error ${openaiRes.status}: ${errText.slice(0, 400)}`);
    }

    const data = await openaiRes.json() as Record<string, unknown>;
    const output = (data.output ?? []) as unknown[];

    const actions = parseActions(output);
    const thinking = extractThinking(output);

    // Check if completed — no more tool_use/computer_call blocks means done
    const hasMoreActions = output.some((item) => {
      const b = item as Record<string, unknown>;
      return b.type === "tool_use" || b.type === "computer_call";
    });
    const completed = !hasMoreActions;

    // Log to computer_use_tasks table
    let task_id: string | undefined;
    try {
      const { data: inserted } = await sb
        .from("computer_use_tasks")
        .insert({
          user_id: user_id ?? user.id,
          task_description: task,
          model: model ?? "computer-use-preview",
          actions_taken: actions,
          status: completed ? "completed" : "in_progress",
          result: thinking || null,
        })
        .select("id")
        .single();
      task_id = inserted?.id;
    } catch (_e) {
      // Non-fatal — logging failure shouldn't break the response
    }

    const response: ComputerUseResponse = { actions, thinking, completed, task_id };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-computer-use]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
