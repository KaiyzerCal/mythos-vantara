// mavis-browser-agent
// Persistent multi-turn web browsing agent with session checkpointing.
// POST { goal, session_id?, max_turns? } — resumes from where it left off.
//
// config.toml entry required (do NOT edit that file — note only):
//   [functions.mavis-browser-agent]
//   verify_jwt = true

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// ── Env ───────────────────────────────────────────────────────────────────────
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const TAVILY_KEY = Deno.env.get("Tavily_API") ?? "";

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_MAX_TURNS = 6;
const HARD_CAP_TURNS = 8;
const BROWSER_MODEL = "claude-haiku-4-5-20251001";
const MAX_PAGE_CHARS = 3000;
const MAX_CONSEC_FAILURES = 3;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type BrowserAction = "search" | "read" | "extract" | "complete";
type SessionStatus = "running" | "completed" | "failed" | "paused";

interface ActionDecision {
  action: BrowserAction;
  query: string;
  url: string;
  reason: string;
}

interface BrowseStep {
  turn: number;
  action: BrowserAction;
  query: string;
  result: string;
  success: boolean;
  duration_ms: number;
  url?: string;
}

interface BrowserContext {
  goal: string;
  findings: string[];
  visited_urls: string[];
}

interface BrowserSession {
  id: string;
  user_id: string;
  goal: string;
  steps: BrowseStep[];
  current_step: number;
  context: BrowserContext;
  status: SessionStatus;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/** Raw Claude API call — same pattern as mavis-autonomous-runner. */
async function claudeCall(
  system: string,
  userMessage: string,
  maxTokens: number,
): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: BROWSER_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text: string = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");

  if (!text) throw new Error("Claude returned an empty response");
  return text;
}

/** Ask Claude what action to take next given goal + prior steps. */
async function decideAction(
  goal: string,
  steps: BrowseStep[],
): Promise<ActionDecision> {
  const system =
    'You are MAVIS Browser Agent. Given a goal and what you\'ve found so far, decide the next action. ' +
    'Respond with JSON only: { "action": "search"|"read"|"extract"|"complete", "query": string, "url": string, "reason": string }';

  const formattedSteps =
    steps.length === 0
      ? "None yet."
      : steps
          .map(
            (s) =>
              `Turn ${s.turn} [${s.action}]${s.url ? ` ${s.url}` : ""}${s.query ? ` "${s.query}"` : ""}: ${s.result.slice(0, 400)}`,
          )
          .join("\n");

  const userMsg = `GOAL: ${goal}\n\nPREVIOUS STEPS:\n${formattedSteps}\n\nDecide next action:`;

  const raw = await claudeCall(system, userMsg, 512);

  // Extract JSON from response (robust against prose preamble)
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude did not return valid JSON for action decision");

  const parsed = JSON.parse(match[0]) as Partial<ActionDecision>;
  const validActions = new Set<BrowserAction>(["search", "read", "extract", "complete"]);
  const action = validActions.has(parsed.action as BrowserAction)
    ? (parsed.action as BrowserAction)
    : "search";

  return {
    action,
    query: String(parsed.query ?? "").slice(0, 500),
    url: String(parsed.url ?? "").slice(0, 1000),
    reason: String(parsed.reason ?? "").slice(0, 300),
  };
}

// ── Action executors ──────────────────────────────────────────────────────────

/** Tavily search — falls back to Jina s.jina.ai on failure. */
async function execSearch(query: string): Promise<string> {
  if (TAVILY_KEY) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: TAVILY_KEY,
          query,
          search_depth: "basic",
          max_results: 5,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json();
        const results: Array<{ title: string; content: string; url: string }> =
          data.results ?? [];
        return results
          .slice(0, 5)
          .map((r) => `[${r.title}] ${r.content} (${r.url})`)
          .join("\n\n");
      }
    } catch (err) {
      console.warn("[browser-agent] Tavily failed, falling back to Jina search:", err);
    }
  }

  // Fallback: Jina reader search endpoint
  const jinaUrl = `https://s.jina.ai/${encodeURIComponent(query)}`;
  const jinaRes = await fetch(jinaUrl, {
    headers: { Accept: "text/plain" },
    signal: AbortSignal.timeout(15000),
  });
  if (!jinaRes.ok) throw new Error(`Jina search failed: ${jinaRes.status}`);
  const text = await jinaRes.text();
  return text.slice(0, MAX_PAGE_CHARS);
}

/** Jina reader — fetches and converts a URL to clean text. */
async function execRead(url: string): Promise<string> {
  if (!url) throw new Error("No URL provided for read action");
  const jinaUrl = `https://r.jina.ai/${url}`;
  const res = await fetch(jinaUrl, {
    headers: { Accept: "text/plain" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Jina read failed for ${url}: ${res.status}`);
  const text = await res.text();
  return text.slice(0, MAX_PAGE_CHARS);
}

/** Claude extracts specific info from last available page content. */
async function execExtract(
  query: string,
  steps: BrowseStep[],
): Promise<string> {
  // Find the most recent read/search result to extract from
  const lastContentStep = [...steps].reverse().find(
    (s) => s.success && (s.action === "read" || s.action === "search"),
  );
  const content = lastContentStep?.result ?? "No prior content available.";

  return claudeCall(
    "You are MAVIS Browser Agent. Extract only the requested information from the provided content. Be concise and precise.",
    `Given this page content:\n${content}\n\nExtract: ${query}`,
    1024,
  );
}

/** Claude synthesises all steps into a final answer. */
async function execComplete(
  goal: string,
  steps: BrowseStep[],
  context: BrowserContext,
): Promise<string> {
  const findingsSummary =
    context.findings.length > 0
      ? `\n\nKey findings so far:\n${context.findings.join("\n")}`
      : "";

  const stepsSummary = steps
    .filter((s) => s.success)
    .map((s) => `[Turn ${s.turn} – ${s.action}] ${s.result.slice(0, 300)}`)
    .join("\n\n");

  return claudeCall(
    "You are MAVIS Browser Agent. Synthesize all research into a clear, comprehensive final answer for the user's goal. Be direct and actionable.",
    `GOAL: ${goal}${findingsSummary}\n\nRESEARCH STEPS:\n${stepsSummary}\n\nProvide the final synthesized answer:`,
    2048,
  );
}

// ── JWT auth ──────────────────────────────────────────────────────────────────

async function getUserId(req: Request): Promise<string | null> {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;

    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (jwtSecret) {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(jwtSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signedPart = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const b64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const sig = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const valid = await crypto.subtle.verify("HMAC", key, sig, signedPart);
      if (!valid) return null;
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(
        atob(payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4)),
      );
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload.sub ?? null;
    }

    // Fallback: ask Supabase to validate the token
    const userSb = createClient(SB_URL, token, { auth: { persistSession: false } });
    const { data } = await userSb.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Session helpers ───────────────────────────────────────────────────────────

/** Load existing session or create a new one. */
async function loadOrCreateSession(
  sb: ReturnType<typeof createClient>,
  userId: string,
  goal: string,
  sessionId: string | undefined,
): Promise<BrowserSession> {
  if (sessionId) {
    const { data, error } = await sb
      .from("mavis_browser_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single();

    if (error || !data) throw new Error(`Session not found: ${sessionId}`);
    return data as BrowserSession;
  }

  // Create new session
  const initContext: BrowserContext = {
    goal,
    findings: [],
    visited_urls: [],
  };

  const { data, error } = await sb
    .from("mavis_browser_sessions")
    .insert({
      user_id: userId,
      goal,
      steps: [],
      current_step: 0,
      context: initContext,
      status: "running",
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create session: ${error?.message}`);
  return data as BrowserSession;
}

/** Persist session checkpoint to DB. */
async function saveCheckpoint(
  sb: ReturnType<typeof createClient>,
  sessionId: string,
  patch: Partial<BrowserSession>,
): Promise<void> {
  const { error } = await sb
    .from("mavis_browser_sessions")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", sessionId);

  if (error) {
    console.error(`[browser-agent] Checkpoint save failed for ${sessionId}:`, error.message);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const userId = await getUserId(req);
  if (!userId) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!ANTHROPIC_KEY) {
    return json({ error: "ANTHROPIC_API_KEY is not configured" }, 500);
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const goal = String(body.goal ?? "").trim();
  if (!goal) return json({ error: '"goal" is required' }, 400);

  const sessionIdInput = body.session_id ? String(body.session_id) : undefined;
  const rawMax = Number(body.max_turns ?? DEFAULT_MAX_TURNS);
  const maxTurns = Math.min(
    HARD_CAP_TURNS,
    Math.max(1, isNaN(rawMax) ? DEFAULT_MAX_TURNS : rawMax),
  );

  // ── Service-role client for DB operations ─────────────────────────────────
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  // ── Load or create session ────────────────────────────────────────────────
  let session: BrowserSession;
  try {
    session = await loadOrCreateSession(sb, userId, goal, sessionIdInput);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[browser-agent] Session init failed:", message);
    return json({ error: message }, 500);
  }

  // Resume only if status is 'running'
  if (session.status !== "running") {
    return json({
      status: session.status,
      session_id: session.id,
      result: session.result,
      error: session.error,
      steps_taken: session.steps.length,
    });
  }

  // ── Turn loop ─────────────────────────────────────────────────────────────
  const steps: BrowseStep[] = [...session.steps];
  const context: BrowserContext = {
    goal: session.context.goal ?? goal,
    findings: [...(session.context.findings ?? [])],
    visited_urls: [...(session.context.visited_urls ?? [])],
  };

  let consecutiveFailures = 0;
  let turnsThisCall = 0;
  let lastAction: BrowserAction = "search";

  while (turnsThisCall < maxTurns) {
    const turnNumber = steps.length + 1;
    const turnStart = Date.now();
    let stepResult: string = "";
    let stepSuccess = false;
    let actionDecision: ActionDecision | null = null;

    try {
      // ── 2a. Ask Claude what to do next ──────────────────────────────────
      actionDecision = await decideAction(goal, steps);
      lastAction = actionDecision.action;

      console.log(
        `[browser-agent] Session ${session.id} turn ${turnNumber}: ${actionDecision.action} — ${actionDecision.reason.slice(0, 80)}`,
      );

      // ── 2c. Execute the action ───────────────────────────────────────────
      switch (actionDecision.action) {
        // ── search ────────────────────────────────────────────────────────
        case "search": {
          stepResult = await execSearch(actionDecision.query);
          // Accumulate key finding
          context.findings.push(
            `[Turn ${turnNumber}] Search "${actionDecision.query}": ${stepResult.slice(0, 300)}`,
          );
          stepSuccess = true;
          break;
        }

        // ── read ──────────────────────────────────────────────────────────
        case "read": {
          stepResult = await execRead(actionDecision.url);
          if (actionDecision.url) context.visited_urls.push(actionDecision.url);
          context.findings.push(
            `[Turn ${turnNumber}] Read ${actionDecision.url}: ${stepResult.slice(0, 300)}`,
          );
          stepSuccess = true;
          break;
        }

        // ── extract ───────────────────────────────────────────────────────
        case "extract": {
          stepResult = await execExtract(actionDecision.query, steps);
          context.findings.push(
            `[Turn ${turnNumber}] Extracted "${actionDecision.query}": ${stepResult.slice(0, 300)}`,
          );
          stepSuccess = true;
          break;
        }

        // ── complete ──────────────────────────────────────────────────────
        case "complete": {
          stepResult = await execComplete(goal, steps, context);
          stepSuccess = true;

          // ── 2d. Append step ──────────────────────────────────────────────
          const completionStep: BrowseStep = {
            turn: turnNumber,
            action: "complete",
            query: actionDecision.query,
            result: stepResult,
            success: true,
            duration_ms: Date.now() - turnStart,
          };
          steps.push(completionStep);

          // ── 2e. Save final checkpoint ────────────────────────────────────
          await saveCheckpoint(sb, session.id, {
            steps,
            current_step: steps.length,
            context,
            status: "completed",
            result: stepResult,
          } as Partial<BrowserSession>);

          console.log(`[browser-agent] Session ${session.id} completed after ${steps.length} turns`);

          return json({
            status: "completed",
            result: stepResult,
            session_id: session.id,
            steps_taken: steps.length,
          });
        }
      }

      consecutiveFailures = 0;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[browser-agent] Session ${session.id} turn ${turnNumber} (${actionDecision?.action ?? "decide"}) error:`,
        errMsg,
      );

      stepResult = `Error: ${errMsg}`;
      stepSuccess = false;
      consecutiveFailures++;

      // ── 3 consecutive failures → mark session failed ──────────────────
      if (consecutiveFailures >= MAX_CONSEC_FAILURES) {
        const failMsg = `Aborted after ${MAX_CONSEC_FAILURES} consecutive failures. Last error: ${errMsg}`;
        await saveCheckpoint(sb, session.id, {
          steps,
          current_step: steps.length,
          context,
          status: "failed",
          error: failMsg,
        } as Partial<BrowserSession>);

        return json({ error: failMsg, session_id: session.id, steps_taken: steps.length }, 500);
      }
    }

    // ── 2d. Append step ────────────────────────────────────────────────────
    const browseStep: BrowseStep = {
      turn: turnNumber,
      action: actionDecision?.action ?? "search",
      query: actionDecision?.query ?? "",
      result: stepResult,
      success: stepSuccess,
      duration_ms: Date.now() - turnStart,
      ...(actionDecision?.url ? { url: actionDecision.url } : {}),
    };
    steps.push(browseStep);
    turnsThisCall++;

    // ── 2e. Save checkpoint after each turn ────────────────────────────────
    await saveCheckpoint(sb, session.id, {
      steps,
      current_step: steps.length,
      context,
    } as Partial<BrowserSession>);
  }

  // ── max_turns reached without 'complete' — return running status ──────────
  console.log(
    `[browser-agent] Session ${session.id} paused after ${turnsThisCall} turns this call (${steps.length} total)`,
  );

  return json({
    status: "running",
    session_id: session.id,
    steps_taken: steps.length,
    last_action: lastAction,
  });
});
