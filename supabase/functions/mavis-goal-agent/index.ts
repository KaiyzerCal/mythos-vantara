// mavis-goal-agent
// Proactive goal pursuit. Runs every 4 hours via pg_cron.
// For each user with active quests: reads the quest, checks what's already been
// done, then takes autonomous action to advance it — no prompting required.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Quest {
  id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  progress: number;
  status: string;
}

interface MemoryRow {
  key: string;
  value: string;
  created_at: string;
}

interface QueueRow {
  action_type: string;
  source_context: string;
  status: string;
  created_at: string;
}

function daysUntil(deadline: string | null): string {
  if (!deadline) return "no deadline set";
  const d = new Date(deadline);
  const diff = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return `${Math.abs(diff)} days overdue`;
  if (diff === 0) return "due today";
  return `${diff} days away`;
}

async function pursueQuest(
  quest: Quest,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<{ actionsQueued: number; response: string }> {
  // ── 1. Load recent memory about this quest ──────────────────────────────────
  const { data: memories } = await adminSb
    .from("mavis_persona_memory")
    .select("key, value, created_at")
    .eq("user_id", userId)
    .ilike("key", `%${quest.title.slice(0, 30)}%`)
    .order("created_at", { ascending: false })
    .limit(5);

  // ── 2. Load recent actions already taken for this quest ─────────────────────
  const { data: recentActions } = await adminSb
    .from("mavis_action_queue")
    .select("action_type, source_context, status, created_at")
    .eq("user_id", userId)
    .ilike("source_context", `%${quest.title.slice(0, 30)}%`)
    .order("created_at", { ascending: false })
    .limit(8);

  const memoryText = memories?.length
    ? (memories as MemoryRow[]).map((m) => `• [${m.created_at.slice(0, 10)}] ${m.key}: ${m.value}`).join("\n")
    : "No previous actions recorded for this goal.";

  const actionsText = recentActions?.length
    ? (recentActions as QueueRow[]).map((a) => `• [${a.status}] ${a.action_type}: ${a.source_context}`).join("\n")
    : "No actions queued yet for this goal.";

  // ── 3. Build goal-directed prompt ───────────────────────────────────────────
  const goal = `You are MAVIS — a proactive AI agent working autonomously toward the operator's goals.

ACTIVE GOAL: "${quest.title}"
${quest.description ? `DESCRIPTION: ${quest.description}` : ""}
DEADLINE: ${daysUntil(quest.deadline)}
CURRENT PROGRESS: ${quest.progress ?? 0}%

WHAT YOU REMEMBER ABOUT THIS GOAL:
${memoryText}

RECENT ACTIONS ALREADY TAKEN:
${actionsText}

YOUR MISSION: Take 1-3 concrete next steps RIGHT NOW to advance this goal.

RULES:
- DO things — don't just describe what could be done
- Check emails or calendar if relevant to this goal (use read_emails, read_calendar)
- Search Drive for any relevant documents (use search_drive)
- Queue emails, calendar events, or Drive files if needed (use queue_action)
- Create tasks for yourself to track follow-ups (auto-executed)
- After acting, write a brief memory note: "Goal progress: [what was done, what's next]"
- Do NOT repeat actions that are already listed above
- If there genuinely is nothing to do right now, say so in one sentence and stop`;

  // ── 4. Run agent loop ───────────────────────────────────────────────────────
  const agentRes = await fetch(`${SUPABASE_URL}/functions/v1/mavis-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ user_id: userId, goal, mode: "GOAL_AGENT" }),
    signal: AbortSignal.timeout(90_000),
  });

  const agentData = agentRes.ok ? await agentRes.json() : { content: "", actionsQueued: 0 };

  // ── 5. Store progress memory ─────────────────────────────────────────────────
  if (agentData.content) {
    await adminSb.from("mavis_persona_memory").upsert(
      {
        user_id:      userId,
        persona_name: "MAVIS",
        key:          `goal_progress:${quest.id}`,
        value:        `[${new Date().toISOString().slice(0, 10)}] ${agentData.content.slice(0, 500)}`,
        category:     "goal",
        importance:   7,
        source:       "mavis-goal-agent",
        role:         "summary",
      },
      { onConflict: "user_id,key" },
    );
  }

  return {
    actionsQueued: agentData.actionsQueued ?? 0,
    response:      agentData.content ?? "",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Heartbeat: mark running
    adminSb.from("mavis_function_health").upsert({
      function_name: "mavis-goal-agent",
      last_started_at: new Date().toISOString(),
      last_status: "running",
      run_count: 1,
      expected_interval_min: 240,
      updated_at: new Date().toISOString(),
    }, { onConflict: "function_name" }).catch(() => {});

    const body = await req.json().catch(() => ({})) as Record<string, string>;
    const action = body.action ?? "run";

    // ── run: full sweep across all users ───────────────────────────────────────
    if (action === "run") {
      // Find users who have active quests
      const { data: questRows } = await adminSb
        .from("quests")
        .select("id, user_id, title, description, deadline, progress, status")
        .eq("status", "active")
        .order("deadline", { ascending: true });

      if (!questRows?.length) return json({ ok: true, processed: 0 });

      // Group by user
      const byUser = new Map<string, Quest[]>();
      for (const q of questRows as (Quest & { user_id: string })[]) {
        if (!byUser.has(q.user_id)) byUser.set(q.user_id, []);
        byUser.get(q.user_id)!.push(q);
      }

      const results: { user_id: string; quests: number; actionsQueued: number }[] = [];

      for (const [userId, quests] of byUser) {
        let totalQueued = 0;
        // Process up to 3 quests per user per run (prioritise by deadline)
        for (const quest of quests.slice(0, 3)) {
          try {
            const r = await pursueQuest(quest, userId, adminSb);
            totalQueued += r.actionsQueued;
          } catch (err) {
            console.error(`[goal-agent] quest ${quest.id} failed:`, err);
          }
        }
        results.push({ user_id: userId, quests: Math.min(quests.length, 3), actionsQueued: totalQueued });
      }

      adminSb.from("mavis_function_health").upsert({
        function_name: "mavis-goal-agent",
        last_completed_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
        run_count: 1,
        expected_interval_min: 240,
        updated_at: new Date().toISOString(),
      }, { onConflict: "function_name" }).catch(() => {});

      return json({ ok: true, processed: results.length, results });
    }

    // ── run_quest: single quest (for testing) ──────────────────────────────────
    if (action === "run_quest") {
      const { user_id, quest_id } = body;
      if (!user_id || !quest_id) return json({ ok: false, error: "user_id and quest_id required" }, 400);

      const { data: quest } = await adminSb
        .from("quests")
        .select("id, title, description, deadline, progress, status")
        .eq("id", quest_id)
        .eq("user_id", user_id)
        .single();

      if (!quest) return json({ ok: false, error: "Quest not found" }, 404);

      const result = await pursueQuest(quest as Quest, user_id, adminSb);
      return json({ ok: true, ...result });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const _errMsg = err instanceof Error ? err.message : String(err);
    console.error("[mavis-goal-agent]", _errMsg);
    const _errSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    _errSb.from("mavis_function_health").upsert({
      function_name: "mavis-goal-agent",
      last_completed_at: new Date().toISOString(),
      last_status: "error",
      last_error: _errMsg.slice(0, 500),
      run_count: 1,
      error_count: 1,
      expected_interval_min: 240,
      updated_at: new Date().toISOString(),
    }, { onConflict: "function_name" }).catch(() => {});
    return json({ ok: false, error: _errMsg }, 500);
  }
});
