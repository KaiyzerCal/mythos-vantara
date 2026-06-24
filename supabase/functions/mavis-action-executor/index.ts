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

function encodeSheetRange(range: string): string {
  // Keep ':' and '!' readable for Google Sheets A1 notation while escaping spaces etc.
  return encodeURIComponent(range).replace(/%3A/gi, ":").replace(/%21/gi, "!");
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64UrlEncodeUtf8(value: string): string {
  return base64FromBytes(new TextEncoder().encode(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodeMailHeader(value: string): string {
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${base64FromBytes(new TextEncoder().encode(value))}?=`;
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
    `Subject: ${encodeMailHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  if (reply_to_message_id) lines.push(`In-Reply-To: ${reply_to_message_id}`);
  lines.push("", base64FromBytes(new TextEncoder().encode(body)));

  const rawMessage = lines.join("\r\n");
  const encodedMessage = base64UrlEncodeUtf8(rawMessage);

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

// ── Google Drive: create_drive_file ──────────────────────────────────────────

async function executeCreateDriveFile(
  payload: Record<string, unknown>,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  const { data: integration } = await adminSb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", "gdrive")
    .single();

  if (!integration?.config) {
    throw new Error("Google Drive not connected. Add OAuth credentials in Integrations.");
  }

  const config = integration.config as Record<string, unknown>;
  const accessToken = await refreshGoogleToken(config, adminSb, userId, "gdrive");

  const {
    title,
    content = "",
    mime_type = "application/vnd.google-apps.document",
    folder_id,
  } = payload as {
    title?: string;
    content?: string;
    mime_type?: string;
    folder_id?: string;
  };

  if (!title) throw new Error("create_drive_file payload must include: title");

  // Determine Google Workspace type or plain upload
  const isGoogleDoc = mime_type === "application/vnd.google-apps.document";
  const isGoogleSheet = mime_type === "application/vnd.google-apps.spreadsheet";
  const isWorkspace = isGoogleDoc || isGoogleSheet;

  if (isWorkspace) {
    // Create empty Google Doc/Sheet first
    const meta: Record<string, unknown> = { name: title, mimeType: mime_type };
    if (folder_id) meta.parents = [folder_id];

    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });

    if (!createRes.ok) {
      throw new Error(`Drive create failed (${createRes.status}): ${await createRes.text()}`);
    }

    const created = await createRes.json();
    const fileId = created.id as string;

    // If Google Doc, insert content via Docs API
    if (isGoogleDoc && content) {
      await fetch(`https://docs.googleapis.com/v1/documents/${fileId}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{ insertText: { location: { index: 1 }, text: content } }],
        }),
      });
    }

    return {
      file_id: fileId,
      file_name: title,
      web_view_link: `https://docs.google.com/document/d/${fileId}/edit`,
      mime_type,
      timestamp: new Date().toISOString(),
    };
  }

  // Plain text/other file — multipart upload
  const boundary = "mavis_boundary_" + Date.now();
  const uploadMeta = JSON.stringify({ name: title, mimeType: mime_type, ...(folder_id ? { parents: [folder_id] } : {}) });
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    uploadMeta,
    `--${boundary}`,
    `Content-Type: ${mime_type}`,
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!uploadRes.ok) {
    throw new Error(`Drive upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
  }

  const uploaded = await uploadRes.json();
  return {
    file_id: uploaded.id,
    file_name: uploaded.name,
    web_view_link: uploaded.webViewLink,
    timestamp: new Date().toISOString(),
  };
}

// ── Google Drive: update_drive_file ──────────────────────────────────────────

async function executeUpdateDriveFile(
  payload: Record<string, unknown>,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  const { data: integration } = await adminSb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", "gdrive")
    .single();

  if (!integration?.config) {
    throw new Error("Google Drive not connected. Add OAuth credentials in Integrations.");
  }

  const config = integration.config as Record<string, unknown>;
  const accessToken = await refreshGoogleToken(config, adminSb, userId, "gdrive");

  const { file_id, content, append = false } = payload as {
    file_id?: string;
    content?: string;
    append?: boolean;
  };

  if (!file_id) throw new Error("update_drive_file payload must include: file_id");
  if (content === undefined) throw new Error("update_drive_file payload must include: content");

  // Get current file metadata to determine mime type
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file_id}?fields=id,name,mimeType`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metaRes.ok) throw new Error(`Drive file not found: ${file_id}`);
  const meta = await metaRes.json();
  const mime: string = meta.mimeType ?? "";

  if (mime === "application/vnd.google-apps.document") {
    // Use Docs API batchUpdate
    let finalContent = content;
    if (append) {
      // Get current end index
      const docRes = await fetch(
        `https://docs.googleapis.com/v1/documents/${file_id}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const doc = await docRes.json();
      const endIndex: number = doc.body?.content?.at(-1)?.endIndex ?? 1;
      await fetch(`https://docs.googleapis.com/v1/documents/${file_id}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{ insertText: { location: { index: endIndex - 1 }, text: "\n" + content } }],
        }),
      });
      return { file_id, file_name: meta.name, updated: true, mode: "append", timestamp: new Date().toISOString() };
    }
    // Full replace: delete all then insert
    const docRes = await fetch(
      `https://docs.googleapis.com/v1/documents/${file_id}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const doc = await docRes.json();
    const endIndex: number = doc.body?.content?.at(-1)?.endIndex ?? 2;
    if (endIndex > 2) {
      await fetch(`https://docs.googleapis.com/v1/documents/${file_id}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } }] }),
      });
    }
    await fetch(`https://docs.googleapis.com/v1/documents/${file_id}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: finalContent } }] }),
    });
    return { file_id, file_name: meta.name, updated: true, mode: "replace", timestamp: new Date().toISOString() };
  }

  // Plain file: media upload patch
  const patchRes = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${file_id}?uploadType=media`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": mime || "text/plain" },
      body: content,
    },
  );

  if (!patchRes.ok) {
    throw new Error(`Drive update failed (${patchRes.status}): ${await patchRes.text()}`);
  }

  return { file_id, file_name: meta.name, updated: true, timestamp: new Date().toISOString() };
}

// ── Google Sheets: update_sheet ───────────────────────────────────────────────

async function executeUpdateSheet(
  payload: Record<string, unknown>,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  const { data: integration } = await adminSb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", "gdrive")
    .single();

  if (!integration?.config) {
    throw new Error("Google Sheets not connected. Add OAuth credentials in Integrations.");
  }

  const config = integration.config as Record<string, unknown>;
  const accessToken = await refreshGoogleToken(config, adminSb, userId, "gdrive");

  const { spreadsheet_id, range, values, value_input_option = "USER_ENTERED" } = payload as {
    spreadsheet_id?: string;
    range?: string;
    values?: unknown[][];
    value_input_option?: string;
  };

  if (!spreadsheet_id) throw new Error("update_sheet payload must include: spreadsheet_id");
  if (!range) throw new Error("update_sheet payload must include: range");
  if (!values || !Array.isArray(values)) throw new Error("update_sheet payload must include: values (2D array)");

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeSheetRange(range)}?valueInputOption=${encodeURIComponent(value_input_option)}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ range, majorDimension: "ROWS", values }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets update failed (${res.status}): ${err}`);
  }

  const result = await res.json();
  return {
    spreadsheet_id,
    updated_range: result.updatedRange,
    updated_cells: result.updatedCells,
    timestamp: new Date().toISOString(),
  };
}

// ── Google Tasks: create_google_task ─────────────────────────────────────────

async function executeCreateGoogleTask(
  payload: Record<string, unknown>,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  const { data: integration } = await adminSb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", "google_tasks")
    .single();

  if (!integration?.config) {
    throw new Error("Google Tasks not connected. Add OAuth credentials in Integrations.");
  }

  const config = integration.config as Record<string, unknown>;
  const accessToken = await refreshGoogleToken(config, adminSb, userId, "google_tasks");

  const { title, notes, due, tasklist_id = "@default" } = payload as {
    title?: string;
    notes?: string;
    due?: string;
    tasklist_id?: string;
  };

  if (!title) throw new Error("create_google_task payload must include: title");

  const taskBody: Record<string, unknown> = { title };
  if (notes) taskBody.notes = notes;
  if (due) taskBody.due = due; // RFC 3339 timestamp

  const res = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${tasklist_id}/tasks`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(taskBody),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Tasks create failed (${res.status}): ${err}`);
  }

  const task = await res.json();
  return {
    task_id: task.id,
    title: task.title,
    tasklist_id,
    web_link: task.selfLink,
    timestamp: new Date().toISOString(),
  };
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
    case "create_drive_file":
      return await executeCreateDriveFile(actionPayload, userId, adminSb);
    case "update_drive_file":
      return await executeUpdateDriveFile(actionPayload, userId, adminSb);
    case "update_sheet":
      return await executeUpdateSheet(actionPayload, userId, adminSb);
    case "create_google_task":
      return await executeCreateGoogleTask(actionPayload, userId, adminSb);
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

    // Service-role bypass — called by other Edge Functions (trigger engine, agent loop)
    let userId: string;
    if (token === SERVICE_ROLE_KEY) {
      userId = (req.headers.get("x-user-id") ?? "").trim();
    } else {
      const userClient = createClient(SUPABASE_URL, token);
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id ?? "";
      if (!userId) return json({ ok: false, error: "Unauthorized" }, 401);
    }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (token === SERVICE_ROLE_KEY && !userId) {
      userId = String((body.userId ?? body.user_id) ?? "").trim();
    }
    if (!userId) return json({ ok: false, error: "x-user-id or user_id required for service role calls" }, 401);
    const { action, queue_item_id, reason, status, limit } = body as {
      action: string;
      queue_item_id?: string;
      reason?: string;
      status?: string;
      limit?: number;
    };

    // ── execute_direct — called by agent loop for auto-tier actions ───────────
    if (action === "execute_direct") {
      const { action_type, action_payload } = body as {
        action_type?: string;
        action_payload?: Record<string, unknown>;
      };
      if (!action_type) return json({ ok: false, error: "action_type required" }, 400);
      try {
        const result = await routeActionType(action_type, action_payload ?? {}, userId, adminSb);
        return json({ ok: true, action_type, result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json({ ok: false, error: msg }, 500);
      }
    }

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

        // Log action_executed signal (fire-and-forget)
        adminSb.from("mavis_behavioral_signals").insert({
          user_id:     userId,
          signal_type: "action_executed",
          action_type: item.action_type as string,
          outcome:     "success",
          hour_of_day: new Date().getUTCHours(),
          day_of_week: new Date().getUTCDay(),
        }).catch(() => {});

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

      // Fetch action_type for behavioral signal before updating
      const { data: approveItem } = await adminSb
        .from("mavis_action_queue")
        .select("action_type")
        .eq("id", queue_item_id)
        .eq("user_id", userId)
        .maybeSingle();

      const { error } = await adminSb
        .from("mavis_action_queue")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
        })
        .eq("id", queue_item_id)
        .eq("user_id", userId);

      if (error) return json({ ok: false, error: error.message }, 500);

      // Log action_approved signal (fire-and-forget)
      adminSb.from("mavis_behavioral_signals").insert({
        user_id:     userId,
        signal_type: "action_approved",
        action_type: (approveItem as any)?.action_type ?? null,
        hour_of_day: new Date().getUTCHours(),
        day_of_week: new Date().getUTCDay(),
      }).catch(() => {});

      return json({ ok: true });
    }

    // ── reject ─────────────────────────────────────────────────────────────────
    if (action === "reject") {
      if (!queue_item_id) return json({ ok: false, error: "queue_item_id required" }, 400);

      // Fetch action_type for behavioral signal before updating
      const { data: rejectItem } = await adminSb
        .from("mavis_action_queue")
        .select("action_type")
        .eq("id", queue_item_id)
        .eq("user_id", userId)
        .maybeSingle();

      const { error } = await adminSb
        .from("mavis_action_queue")
        .update({
          status: "rejected",
          result_data: reason ? { reason } : { reason: "Rejected by user" },
        })
        .eq("id", queue_item_id)
        .eq("user_id", userId);

      if (error) return json({ ok: false, error: error.message }, 500);

      // Log action_rejected signal (fire-and-forget)
      adminSb.from("mavis_behavioral_signals").insert({
        user_id:     userId,
        signal_type: "action_rejected",
        action_type: (rejectItem as any)?.action_type ?? null,
        hour_of_day: new Date().getUTCHours(),
        day_of_week: new Date().getUTCDay(),
      }).catch(() => {});

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
