// mavis-autonomous-actions
// Autonomous action queue with tier-based execution and learning from operator feedback.
// Modes: cron (process all), enqueue, approve, reject, process (single user), GET (fetch queue).
// verify_jwt = false (cron + service-role)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ── Telegram helpers ──────────────────────────────────────────────────────────

async function sendTelegram(text: string): Promise<string | null> {
  if (!BOT_TOKEN || !CHAT_ID) return null;
  const payload = text.length > 4096 ? text.slice(0, 4056) + "\n…[truncated]" : text;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: payload, parse_mode: "Markdown" }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.result?.message_id ? String(data.result.message_id) : null;
}

// ── Default tier for action types ────────────────────────────────────────────

function defaultTier(actionType: string): string {
  if (["create_task", "create_note", "send_notification"].includes(actionType)) return "auto";
  if (["update_quest", "schedule_event", "draft_email"].includes(actionType)) return "queue";
  // send_message, make_call, web_post and anything unknown → approve
  return "approve";
}

// ── Tier determination ────────────────────────────────────────────────────────

async function getTier(userId: string, actionType: string): Promise<string> {
  const { data: existing } = await sb
    .from("mavis_autonomy_settings")
    .select("tier")
    .eq("user_id", userId)
    .eq("action_type", actionType)
    .maybeSingle();

  if (existing) return existing.tier;

  // Not found — insert defaults and return the default tier
  const tier = defaultTier(actionType);
  await sb.from("mavis_autonomy_settings").upsert(
    { user_id: userId, action_type: actionType, tier, approval_count: 0, rejection_count: 0 },
    { onConflict: "user_id,action_type" },
  );
  return tier;
}

// ── Tier learning ─────────────────────────────────────────────────────────────

async function learnFromFeedback(userId: string, actionId: string, approved: boolean): Promise<void> {
  // Get action type
  const { data: action } = await sb
    .from("mavis_action_queue")
    .select("action_type")
    .eq("id", actionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!action) return;

  const { action_type: actionType } = action;

  // Increment the appropriate counter
  const increment = approved ? { approval_count: 1 } : { rejection_count: 1 };
  await sb.rpc("mavis_autonomy_increment", {
    p_user_id: userId,
    p_action_type: actionType,
    p_approval: approved,
  }).catch(async () => {
    // Fallback: manual read-modify-write if rpc not available
    const { data: settings } = await sb
      .from("mavis_autonomy_settings")
      .select("tier, approval_count, rejection_count")
      .eq("user_id", userId)
      .eq("action_type", actionType)
      .maybeSingle();

    const current = settings ?? { tier: defaultTier(actionType), approval_count: 0, rejection_count: 0 };
    const newApprovals = current.approval_count + (approved ? 1 : 0);
    const newRejections = current.rejection_count + (approved ? 0 : 1);

    // Determine new tier
    let newTier = current.tier;
    if (newRejections >= 2) {
      // Demote
      if (current.tier === "auto") newTier = "queue";
      else if (current.tier === "queue") newTier = "approve";
    } else if (newApprovals >= 5 && newRejections === 0) {
      // Promote
      if (current.tier === "approve") newTier = "queue";
      else if (current.tier === "queue") newTier = "auto";
    }

    await sb.from("mavis_autonomy_settings").upsert({
      user_id: userId,
      action_type: actionType,
      tier: newTier,
      approval_count: newApprovals,
      rejection_count: newRejections,
      last_action_at: new Date().toISOString(),
    }, { onConflict: "user_id,action_type" });

    // Log tier change to mavis_tacit if tier changed
    if (newTier !== current.tier) {
      await sb.from("mavis_tacit").upsert({
        user_id: userId,
        category: "autonomy",
        key: `autonomy_tier_${actionType}`,
        value: newTier,
        confidence: 0.9,
      }, { onConflict: "user_id,key" }).catch(() => {});
    }
  });

  // After rpc (if it succeeded), we still need to check for tier changes
  // Re-read current state and apply promotion/demotion
  const { data: refreshed } = await sb
    .from("mavis_autonomy_settings")
    .select("tier, approval_count, rejection_count")
    .eq("user_id", userId)
    .eq("action_type", actionType)
    .maybeSingle();

  if (!refreshed) return;

  let newTier = refreshed.tier;
  if (refreshed.rejection_count >= 2) {
    if (refreshed.tier === "auto") newTier = "queue";
    else if (refreshed.tier === "queue") newTier = "approve";
  } else if (refreshed.approval_count >= 5 && refreshed.rejection_count === 0) {
    if (refreshed.tier === "approve") newTier = "queue";
    else if (refreshed.tier === "queue") newTier = "auto";
  }

  if (newTier !== refreshed.tier) {
    await sb.from("mavis_autonomy_settings").update({
      tier: newTier,
      last_action_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("action_type", actionType);

    // Log to mavis_tacit
    await sb.from("mavis_tacit").upsert({
      user_id: userId,
      category: "autonomy",
      key: `autonomy_tier_${actionType}`,
      value: newTier,
      confidence: 0.9,
    }, { onConflict: "user_id,key" }).catch(() => {});
  }
}

// ── Action executor ───────────────────────────────────────────────────────────

async function executeAction(action: Record<string, unknown>): Promise<void> {
  const payload = (action.action_payload as Record<string, unknown>) ?? {};
  const userId = action.user_id as string;

  switch (action.action_type) {
    case "create_task":
      await sb.from("tasks").insert({
        user_id: userId,
        title: payload.title,
        description: payload.description,
        type: payload.type ?? "task",
        status: "active",
        xp_reward: payload.xp_reward ?? 10,
      });
      break;

    case "create_note":
      await sb.from("mavis_notes").insert({
        user_id: userId,
        title: payload.title,
        content: payload.content,
        tags: payload.tags ?? [],
        importance: payload.importance ?? 5,
      });
      break;

    case "send_notification":
      await sendTelegram(payload.message as string);
      break;

    case "update_quest": {
      const updateFields: Record<string, unknown> = {};
      if (payload.status) updateFields.status = payload.status;
      if (payload.progress_current) updateFields.progress_current = payload.progress_current;
      await sb.from("quests").update(updateFields)
        .eq("id", payload.quest_id)
        .eq("user_id", userId);
      break;
    }

    case "draft_email":
      await sb.from("mavis_notes").insert({
        user_id: userId,
        title: `Email Draft: ${payload.subject}`,
        content: payload.body,
        tags: ["email", "draft"],
        importance: 7,
      });
      break;

    default:
      throw new Error(`Action type ${action.action_type} requires external integration not yet available`);
  }
}

// ── Priority label helper ─────────────────────────────────────────────────────

function priorityLabel(priority: number): string {
  if (priority <= 2) return "CRITICAL";
  if (priority <= 4) return "HIGH";
  if (priority <= 6) return "MEDIUM";
  return "LOW";
}

// ── Process a single user's queue ─────────────────────────────────────────────

async function processUser(userId: string): Promise<{ executed: number; messaged: number; expired: number }> {
  const now = new Date().toISOString();
  let executed = 0;
  let messaged = 0;
  let expired = 0;

  // Expire stale actions
  const { count: expiredCount } = await sb
    .from("mavis_action_queue")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .eq("status", "pending")
    .lt("expires_at", now)
    .select("id", { count: "exact", head: true });
  expired = expiredCount ?? 0;

  // Fetch all pending actions for this user
  const { data: pending } = await sb
    .from("mavis_action_queue")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (!pending?.length) return { executed, messaged, expired };

  // ── Auto tier: execute immediately ────────────────────────────────────────
  const autoActions = pending.filter((a: Record<string, unknown>) => a.autonomy_tier === "auto");
  for (const action of autoActions) {
    try {
      await executeAction(action);
      await sb.from("mavis_action_queue").update({
        status: "executed",
        executed_at: new Date().toISOString(),
        result_data: { success: true },
      }).eq("id", action.id);
      executed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sb.from("mavis_action_queue").update({
        status: "failed",
        result_data: { error: msg },
      }).eq("id", action.id);
    }
  }

  // ── Queue tier: send one batch Telegram message ──────────────────────────
  const queueActions = pending.filter(
    (a: Record<string, unknown>) => a.autonomy_tier === "queue" && a.telegram_message_id === null,
  );
  if (queueActions.length > 0) {
    const lines = queueActions.map((a: Record<string, unknown>, i: number) => {
      const payload = (a.action_payload as Record<string, unknown>) ?? {};
      const label = payload.title ?? payload.subject ?? payload.message ?? a.action_type;
      return (
        `${i + 1}. [${a.action_type}] ${label}\n` +
        `   Priority: ${priorityLabel(a.priority as number)} | Source: ${a.source_system ?? "mavis"}\n` +
        `   → Reply /approve_${a.id} or /reject_${a.id}`
      );
    });

    const msgText =
      `⚡ *Action Queue* — ${queueActions.length} pending\n\n` +
      lines.join("\n\n");

    const msgId = await sendTelegram(msgText);
    if (msgId) {
      // Mark all these actions as having a message sent
      for (const action of queueActions) {
        await sb.from("mavis_action_queue").update({ telegram_message_id: msgId })
          .eq("id", action.id);
      }
      messaged += queueActions.length;
    }
  }

  // ── Approve tier: individual Telegram messages ───────────────────────────
  const approveActions = pending.filter(
    (a: Record<string, unknown>) => a.autonomy_tier === "approve" && a.telegram_message_id === null,
  );
  for (const action of approveActions) {
    const payload = (action.action_payload as Record<string, unknown>) ?? {};
    const target = payload.target ?? payload.recipient ?? payload.to ?? "";
    const content = payload.message ?? payload.body ?? payload.title ?? payload.content ?? "";

    let msgText =
      `🔐 *Action Approval Required*\n` +
      `Type: ${action.action_type}\n`;
    if (target) msgText += `Target: ${target}\n`;
    if (content) msgText += `Message: "${String(content).slice(0, 200)}"\n`;
    msgText += `Source: ${action.source_system ?? "mavis"}${action.source_context ? ` (${action.source_context})` : ""}\n\n`;
    msgText += `Reply /approve_${action.id} to execute or /reject_${action.id} to skip.`;

    const msgId = await sendTelegram(msgText);
    if (msgId) {
      await sb.from("mavis_action_queue").update({ telegram_message_id: msgId })
        .eq("id", action.id);
      messaged++;
    }
  }

  return { executed, messaged, expired };
}

// ── Cron: process all users ───────────────────────────────────────────────────

async function processCron(): Promise<{ users: number; executed: number; messaged: number; expired: number }> {
  // Get all users who have pending actions
  const { data: rows } = await sb
    .from("mavis_action_queue")
    .select("user_id")
    .eq("status", "pending");

  if (!rows?.length) return { users: 0, executed: 0, messaged: 0, expired: 0 };

  // Deduplicate user IDs
  const userIds = [...new Set(rows.map((r: Record<string, unknown>) => r.user_id as string))];

  let totalExecuted = 0;
  let totalMessaged = 0;
  let totalExpired = 0;

  for (const userId of userIds) {
    try {
      const result = await processUser(userId);
      totalExecuted += result.executed;
      totalMessaged += result.messaged;
      totalExpired += result.expired;
    } catch { /* per-user error — continue */ }
  }

  return { users: userIds.length, executed: totalExecuted, messaged: totalMessaged, expired: totalExpired };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // GET: return pending queue + recent executed actions for a user
    if (req.method === "GET") {
      const url = new URL(req.url);
      const userId = url.searchParams.get("user_id");
      if (!userId) return json({ error: "user_id required" }, 400);

      const [pendingRes, recentRes] = await Promise.all([
        sb.from("mavis_action_queue")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "pending")
          .order("priority", { ascending: true })
          .order("created_at", { ascending: true }),
        sb.from("mavis_action_queue")
          .select("*")
          .eq("user_id", userId)
          .in("status", ["executed", "failed", "rejected"])
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      return json({
        pending: pendingRes.data ?? [],
        recent: recentRes.data ?? [],
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // ── cron: process all users ──────────────────────────────────────────────
    if (body.cron === true) {
      const result = await processCron();
      return json(result);
    }

    const action = body.action as string | undefined;

    // ── enqueue: add action to queue ─────────────────────────────────────────
    if (action === "enqueue") {
      const { user_id, action_type, action_payload, source_system, source_context, priority } = body;
      if (!user_id || !action_type) return json({ error: "user_id and action_type required" }, 400);

      const tier = await getTier(user_id, action_type);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

      const { data: inserted, error } = await sb.from("mavis_action_queue").insert({
        user_id,
        action_type,
        action_payload: action_payload ?? {},
        autonomy_tier: tier,
        status: "pending",
        priority: priority ?? 5,
        source_system: source_system ?? null,
        source_context: source_context ?? null,
        expires_at: expiresAt,
      }).select("id, autonomy_tier, status").single();

      if (error) return json({ error: error.message }, 500);

      // If auto-tier, execute immediately
      if (tier === "auto" && inserted) {
        const { data: fullAction } = await sb
          .from("mavis_action_queue")
          .select("*")
          .eq("id", inserted.id)
          .single();

        if (fullAction) {
          try {
            await executeAction(fullAction);
            await sb.from("mavis_action_queue").update({
              status: "executed",
              executed_at: new Date().toISOString(),
              result_data: { success: true },
            }).eq("id", inserted.id);
            return json({ id: inserted.id, tier, status: "executed" });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await sb.from("mavis_action_queue").update({
              status: "failed",
              result_data: { error: msg },
            }).eq("id", inserted.id);
            return json({ id: inserted.id, tier, status: "failed", error: msg });
          }
        }
      }

      return json({ id: inserted?.id, tier, status: inserted?.status ?? "pending" });
    }

    // ── approve: approve a queued action ─────────────────────────────────────
    if (action === "approve") {
      const { user_id, action_id } = body;
      if (!user_id || !action_id) return json({ error: "user_id and action_id required" }, 400);

      const { data: queuedAction } = await sb
        .from("mavis_action_queue")
        .select("*")
        .eq("id", action_id)
        .eq("user_id", user_id)
        .maybeSingle();

      if (!queuedAction) return json({ error: "Action not found" }, 404);
      if (queuedAction.status !== "pending") return json({ error: `Action status is '${queuedAction.status}', not pending` }, 400);

      // Mark as approved
      await sb.from("mavis_action_queue").update({
        status: "approved",
        approved_at: new Date().toISOString(),
      }).eq("id", action_id);

      // Execute
      try {
        await executeAction(queuedAction);
        await sb.from("mavis_action_queue").update({
          status: "executed",
          executed_at: new Date().toISOString(),
          result_data: { success: true },
        }).eq("id", action_id);

        // Learn from approval
        await learnFromFeedback(user_id, action_id, true);

        return json({ id: action_id, status: "executed" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sb.from("mavis_action_queue").update({
          status: "failed",
          result_data: { error: msg },
        }).eq("id", action_id);
        return json({ id: action_id, status: "failed", error: msg }, 500);
      }
    }

    // ── reject: reject and log learning signal ────────────────────────────────
    if (action === "reject") {
      const { user_id, action_id } = body;
      if (!user_id || !action_id) return json({ error: "user_id and action_id required" }, 400);

      const { data: queuedAction } = await sb
        .from("mavis_action_queue")
        .select("id, user_id, status")
        .eq("id", action_id)
        .eq("user_id", user_id)
        .maybeSingle();

      if (!queuedAction) return json({ error: "Action not found" }, 404);
      if (queuedAction.status !== "pending") return json({ error: `Action status is '${queuedAction.status}', not pending` }, 400);

      await sb.from("mavis_action_queue").update({ status: "rejected" }).eq("id", action_id);

      // Learn from rejection
      await learnFromFeedback(user_id, action_id, false);

      return json({ id: action_id, status: "rejected" });
    }

    // ── process: process queue for single user ────────────────────────────────
    if (action === "process") {
      const { user_id } = body;
      if (!user_id) return json({ error: "user_id required" }, 400);
      const result = await processUser(user_id);
      return json(result);
    }

    return json({ error: "Unknown action. Valid: enqueue, approve, reject, process. Or POST { cron: true } / GET ?user_id=..." }, 400);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[autonomous-actions]", msg);
    return json({ error: msg }, 500);
  }
});
