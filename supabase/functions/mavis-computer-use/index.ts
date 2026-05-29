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

const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

    if (!OPENAI_KEY) {
      return new Response(
        JSON.stringify({ error: "OpenAI not configured", configured: false }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { task, screenshot_base64, url, model, user_id } = await req.json() as ComputerUseRequest;

    if (!task) {
      return new Response(JSON.stringify({ error: "task is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
