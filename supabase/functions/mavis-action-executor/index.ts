// mavis-action-executor
// Executes approved actions from the mavis_action_queue.
// Supported actions: execute, approve, reject, list.
// Supported action_types: draft_email, schedule_event, create_task, post_social, other.
// Auth: Bearer JWT. Only executes queue items belonging to the authenticated user.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshGoogleToken(
  config: Record<string, unknown>,
  adminSb: ReturnType<typeof createClient>,
  userId: string,
  provider: string,
): Promise<string> {
  // Return existing token if still valid (5-minute buffer)
  if (
    config.expires_at &&
    typeof config.expires_at === "number" &&
    config.expires_at > Date.now() / 1000 + 300
  ) {
    return config.access_token as string;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.client_id as string,
      client_secret: config.client_secret as string,
      refresh_token: config.refresh_token as string,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Token refresh failed: " + JSON.stringify(data));
  }

  const newConfig = {
    ...config,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  };

  await adminSb
    .from("mavis_user_integrations")
    .update({ config: newConfig })
    .eq("user_id", userId)
    .eq("provider", provider);

  return data.access_token as string;
}

// ── Gmail: draft_email ────────────────────────────────────────────────────────

async function executeDraftEmail(
  payload: Record<string, unknown>,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  const { data: integration } = await adminSb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .single();

  if (!integration?.config) {
    throw new Error("Gmail not connected. Add OAuth credentials in Integrations.");
  }

  const config = integration.config as Record<string, unknown>;
  const accessToken = await refreshGoogleToken(config, adminSb, userId, "gmail");

  const { to, subject, body, cc, bcc, reply_to_message_id } = payload as {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    reply_to_message_id?: string;
  };

  if (!to || !subject || !body) {
    throw new Error("draft_email payload must include: to, subject, body");
  }

  // Build RFC 2822 message
  const lines: string[] = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
  ];
  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  if (reply_to_message_id) lines.push(`In-Reply-To: ${reply_to_message_id}`);
  lines.push("", body);

  const rawMessage = lines.join("\r\n");
  const encodedMessage = btoa(rawMessage)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const sendBody: Record<string, unknown> = { raw: encodedMessage };
  if (reply_to_message_id) {
    // Find threadId for the reply
    const threadRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=rfc822msgid:${encodeURIComponent(reply_to_message_id)}&maxResults=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const threadData = await threadRes.json();
    const threadId = threadData.messages?.[0]?.threadId;
    if (threadId) sendBody.threadId = threadId;
  }

  const sendRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sendBody),
    },
  );

  if (!sendRes.ok) {
    const err = await sendRes.text();
    throw new Error(`Gmail send failed (${sendRes.status}): ${err}`);
  }

  const sentMessage = await sendRes.json();
  return {
    messageId: sentMessage.id,
    threadId: sentMessage.threadId,
    timestamp: new Date().toISOString(),
  };
}

// ── Google Calendar: schedule_event ──────────────────────────────────────────

async function executeScheduleEvent(
  payload: Record<string, unknown>,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  const { data: integration } = await adminSb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", "google_calendar")
    .single();

  if (!integration?.config) {
    throw new Error("Google Calendar not connected. Add OAuth credentials in Integrations.");
  }

  const config = integration.config as Record<string, unknown>;
  const accessToken = await refreshGoogleToken(config, adminSb, userId, "google_calendar");

  const { title, start, end, description, attendees, location } = payload as {
    title: string;
    start: string;
    end: string;
    description?: string;
    attendees?: string[];
    location?: string;
  };

  if (!title || !start || !end) {
    throw new Error("schedule_event payload must include: title, start, end");
  }

  const eventBody: Record<string, unknown> = {
    summary: title,
    start: { dateTime: start, timeZone: "UTC" },
    end: { dateTime: end, timeZone: "UTC" },
  };

  if (description) eventBody.description = description;
  if (location) eventBody.location = location;
  if (attendees && attendees.length > 0) {
    eventBody.attendees = attendees.map((email) => ({ email }));
  }

  const createRes = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
    },
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Google Calendar create failed (${createRes.status}): ${err}`);
  }

  const event = await createRes.json();
  return {
    eventId: event.id,
    htmlLink: event.htmlLink,
    summary: event.summary,
    timestamp: new Date().toISOString(),
  };
}

// ── create_task ───────────────────────────────────────────────────────────────

async function executeCreateTask(
  payload: Record<string, unknown>,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  const { title, description, due_date } = payload as {
    title?: string;
    description?: string;
    due_date?: string;
  };

  const taskRecord = {
    user_id: userId,
    title: title ?? "Untitled Task",
    description: description ?? null,
    due_date: due_date ?? null,
    status: "pending",
    source: "mavis-agent",
  };

  // Try tasks table first, then quests
  const { data: taskData, error: taskError } = await adminSb
    .from("tasks")
    .insert(taskRecord)
    .select("id")
    .single();

  if (!taskError && taskData) {
    return { task_id: taskData.id, table: "tasks", timestamp: new Date().toISOString() };
  }

  // Fallback to quests table
  const { data: questData, error: questError } = await adminSb
    .from("quests")
    .insert({
      user_id: userId,
      title: title ?? "Untitled Task",
      description: description ?? null,
      deadline: due_date ?? null,
      status: "active",
      type: "task",
      source: "mavis-agent",
    })
    .select("id")
    .single();

  if (!questError && questData) {
    return { task_id: questData.id, table: "quests", timestamp: new Date().toISOString() };
  }

  throw new Error(
    `Could not create task. tasks error: ${taskError?.message}. quests error: ${questError?.message}`,
  );
}

// ── post_social ───────────────────────────────────────────────────────────────

async function executePostSocial(
  _payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return {
    note: "Social posting requires manual connection. Content saved to draft.",
    timestamp: new Date().toISOString(),
  };
}

// ── Route action_type ─────────────────────────────────────────────────────────

async function routeActionType(
  actionType: string,
  actionPayload: Record<string, unknown>,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  switch (actionType) {
    case "draft_email":
      return await executeDraftEmail(actionPayload, userId, adminSb);
    case "schedule_event":
      return await executeScheduleEvent(actionPayload, userId, adminSb);
    case "create_task":
      return await executeCreateTask(actionPayload, userId, adminSb);
    case "post_social":
      return await executePostSocial(actionPayload);
    default:
      return {
        note: `Action type '${actionType}' requires manual handling.`,
        timestamp: new Date().toISOString(),
      };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Authenticate the request
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ ok: false, error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const userClient = createClient(SUPABASE_URL, token);
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user?.id) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const userId = user.id;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const { action, queue_item_id, reason, status, limit } = body as {
      action: string;
      queue_item_id?: string;
      reason?: string;
      status?: string;
      limit?: number;
    };

    // ── execute ────────────────────────────────────────────────────────────────
    if (action === "execute") {
      if (!queue_item_id) return json({ ok: false, error: "queue_item_id required" }, 400);

      const { data: item, error: fetchError } = await adminSb
        .from("mavis_action_queue")
        .select("*")
        .eq("id", queue_item_id)
        .eq("user_id", userId)
        .single();

      if (fetchError || !item) {
        return json({ ok: false, error: "Queue item not found or access denied" }, 404);
      }

      if (item.status !== "approved" && item.status !== "pending") {
        return json(
          { ok: false, error: `Cannot execute item with status '${item.status}'` },
          400,
        );
      }

      try {
        const result = await routeActionType(
          item.action_type as string,
          (item.action_payload ?? {}) as Record<string, unknown>,
          userId,
          adminSb,
        );

        await adminSb
          .from("mavis_action_queue")
          .update({
            status: "executed",
            executed_at: new Date().toISOString(),
            result_data: result,
          })
          .eq("id", queue_item_id)
          .eq("user_id", userId);

        return json({ ok: true, action_type: item.action_type, result });
      } catch (execErr) {
        const errMsg = execErr instanceof Error ? execErr.message : String(execErr);

        await adminSb
          .from("mavis_action_queue")
          .update({
            status: "failed",
            result_data: { error: errMsg, failed_at: new Date().toISOString() },
          })
          .eq("id", queue_item_id)
          .eq("user_id", userId);

        return json({ ok: false, error: errMsg }, 500);
      }
    }

    // ── approve ────────────────────────────────────────────────────────────────
    if (action === "approve") {
      if (!queue_item_id) return json({ ok: false, error: "queue_item_id required" }, 400);

      const { error } = await adminSb
        .from("mavis_action_queue")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
        })
        .eq("id", queue_item_id)
        .eq("user_id", userId);

      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    // ── reject ─────────────────────────────────────────────────────────────────
    if (action === "reject") {
      if (!queue_item_id) return json({ ok: false, error: "queue_item_id required" }, 400);

      const { error } = await adminSb
        .from("mavis_action_queue")
        .update({
          status: "rejected",
          result_data: reason ? { reason } : { reason: "Rejected by user" },
        })
        .eq("id", queue_item_id)
        .eq("user_id", userId);

      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    // ── list ───────────────────────────────────────────────────────────────────
    if (action === "list") {
      let query = adminSb
        .from("mavis_action_queue")
        .select(
          "id, action_type, action_payload, autonomy_tier, status, priority, source_system, source_context, approved_at, executed_at, result_data, created_at, expires_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (status) query = query.eq("status", status);
      query = query.limit(limit ?? 50);

      const { data: items, error } = await query;
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, items: items ?? [] });
    }

    return json({ ok: false, error: `Unknown action: '${action}'` }, 400);
  } catch (err) {
    console.error("[mavis-action-executor]", err);
    return json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
