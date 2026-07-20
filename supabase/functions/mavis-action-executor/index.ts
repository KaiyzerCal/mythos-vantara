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

  // Accept both the tool-schema field names (name/mimeType) and the
  // executor's canonical snake_case (title/mime_type) so queued Claude
  // actions and internal callers both work.
  const p = payload as Record<string, unknown>;
  const title     = String(p.title ?? p.name ?? "");
  const content   = String(p.content ?? "");
  const mime_type = String(p.mime_type ?? p.mimeType ?? "application/vnd.google-apps.document");
  const folder_id = p.folder_id ?? p.folderId;

  if (!title) throw new Error("create_drive_file payload must include: title (or name)");

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
// Routes to the platform-specific Nora publisher edge functions. Each accepts
// { user_id, content, ... } with verify_jwt off, so we call with the service key.

const SOCIAL_FN_BY_PLATFORM: Record<string, string> = {
  twitter:   "mavis-nora-post",
  x:         "mavis-nora-post",
  linkedin:  "mavis-nora-linkedin",
  instagram: "mavis-nora-instagram",
  ig:        "mavis-nora-instagram",
  tiktok:    "mavis-nora-tiktok",
  discord:   "mavis-nora-discord",
};

async function executePostSocial(
  payload: Record<string, unknown>,
  userId: string,
): Promise<Record<string, unknown>> {
  const platform = String(payload.platform ?? payload.network ?? "twitter").toLowerCase().trim();
  const fn = SOCIAL_FN_BY_PLATFORM[platform];
  if (!fn) {
    throw new Error(`Unsupported social platform '${platform}'. Supported: ${Object.keys(SOCIAL_FN_BY_PLATFORM).join(", ")}`);
  }

  const content = String(payload.content ?? payload.text ?? payload.message ?? "").trim();
  const res = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`,
    {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        user_id:   userId,
        content,
        generate:  content ? false : true,   // let Nora draft if no content given
        image_url: payload.image_url ?? payload.imageUrl,
        video_url: payload.video_url ?? payload.videoUrl,
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as Record<string, unknown>).error) {
    throw new Error(`${platform} post failed: ${String((data as Record<string, unknown>).error ?? res.status)}`);
  }
  return { platform, ...(data as Record<string, unknown>) };
}

// ── Shared Google token helper ────────────────────────────────────────────────
async function getGoogleToken(
  provider: string,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<string> {
  const { data: int, error } = await adminSb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (error || !int?.config) {
    throw new Error(`${provider} not connected. Go to Settings → Integrations to connect.`);
  }
  return refreshGoogleToken(int.config as Record<string, unknown>, adminSb, userId, provider);
}

function decodeGmailBody(data: string): string {
  try { return atob(data.replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; }
}
function extractEmailBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeGmailBody(payload.body.data);
  if (payload.parts) {
    for (const p of payload.parts) if (p.mimeType === "text/plain" && p.body?.data) return decodeGmailBody(p.body.data);
    for (const p of payload.parts) if (p.body?.data) return decodeGmailBody(p.body.data);
  }
  return "";
}

// ── GMAIL: GET EMAILS ─────────────────────────────────────────────────────────
async function executeGetEmails(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gmail", uid, sb);
  const q = encodeURIComponent(String(p.query ?? "is:inbox"));
  const max = Number(p.max_results ?? 15);
  const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${max}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.json());
  if (!list.messages?.length) return { emails: [], total: 0 };
  const emails = await Promise.all((list.messages as any[]).map(async (m: any) => {
    const msg = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json());
    const h = (msg.payload?.headers ?? []) as any[];
    const hv = (n: string) => h.find((x: any) => x.name === n)?.value ?? "";
    return { id: m.id, thread_id: msg.threadId, from: hv("From"), to: hv("To"), subject: hv("Subject") || "(no subject)", date: hv("Date"), snippet: msg.snippet ?? "", is_unread: (msg.labelIds ?? []).includes("UNREAD") };
  }));
  return { emails, total: list.resultSizeEstimate ?? emails.length };
}

// ── GMAIL: GET EMAIL THREAD ───────────────────────────────────────────────────
async function executeGetEmailThread(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gmail", uid, sb);
  const threadId = String(p.thread_id ?? ""); if (!threadId) throw new Error("thread_id required");
  const data = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.json());
  const messages = ((data.messages ?? []) as any[]).map((msg: any) => {
    const h = (msg.payload?.headers ?? []) as any[];
    const hv = (n: string) => h.find((x: any) => x.name === n)?.value ?? "";
    return { id: msg.id, from: hv("From"), to: hv("To"), subject: hv("Subject"), date: hv("Date"), body: extractEmailBody(msg.payload).slice(0, 4000), is_unread: (msg.labelIds ?? []).includes("UNREAD") };
  });
  return { thread_id: threadId, message_count: messages.length, messages };
}

// ── GMAIL: LIST LABELS ────────────────────────────────────────────────────────
async function executeListGmailLabels(_p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gmail", uid, sb);
  const data = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels",
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { labels: ((data.labels ?? []) as any[]).map((l: any) => ({ id: l.id, name: l.name, type: l.type })) };
}

// ── GMAIL: CREATE LABEL ───────────────────────────────────────────────────────
async function executeCreateGmailLabel(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gmail", uid, sb);
  const name = String(p.name ?? ""); if (!name) throw new Error("name required");
  const data = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { label_id: data.id, name: data.name, timestamp: new Date().toISOString() };
}

// ── GMAIL: APPLY LABEL ────────────────────────────────────────────────────────
async function executeApplyGmailLabel(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gmail", uid, sb);
  const { thread_id: tid, label_id: lid } = p;
  if (!tid || !lid) throw new Error("thread_id and label_id required");
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${tid}/modify`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ addLabelIds: [lid] }), signal: AbortSignal.timeout(10_000) });
  return { ok: true, thread_id: tid, label_applied: lid, timestamp: new Date().toISOString() };
}

// ── GMAIL: ARCHIVE ────────────────────────────────────────────────────────────
async function executeArchiveEmail(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gmail", uid, sb);
  const tid = String(p.thread_id ?? ""); if (!tid) throw new Error("thread_id required");
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${tid}/modify`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ removeLabelIds: ["INBOX"] }), signal: AbortSignal.timeout(10_000) });
  return { ok: true, thread_id: tid, archived: true, timestamp: new Date().toISOString() };
}

// ── GMAIL: DELETE ─────────────────────────────────────────────────────────────
async function executeDeleteEmail(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gmail", uid, sb);
  const mid = String(p.message_id ?? ""); if (!mid) throw new Error("message_id required");
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${mid}/trash`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  return { ok: true, message_id: mid, trashed: true, timestamp: new Date().toISOString() };
}

// ── GMAIL: MARK READ / UNREAD ─────────────────────────────────────────────────
async function executeMarkEmail(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gmail", uid, sb);
  const tid = String(p.thread_id ?? ""); if (!tid) throw new Error("thread_id required");
  const markRead = p.mark_read !== false;
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${tid}/modify`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(markRead ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] }), signal: AbortSignal.timeout(10_000) });
  return { ok: true, thread_id: tid, mark_read: markRead, timestamp: new Date().toISOString() };
}

// ── CALENDAR: GET EVENTS ──────────────────────────────────────────────────────
async function executeGetCalendarEvents(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("google_calendar", uid, sb);
  const tMin = encodeURIComponent(String(p.time_min ?? new Date().toISOString()));
  const tMax = encodeURIComponent(String(p.time_max ?? new Date(Date.now() + 7 * 86400000).toISOString()));
  const max = Number(p.max_results ?? 20);
  const data = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${tMin}&timeMax=${tMax}&maxResults=${max}&singleEvents=true&orderBy=startTime`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.json());
  const events = ((data.items ?? []) as any[]).map((e: any) => ({
    id: e.id, summary: e.summary ?? "(no title)", start: e.start?.dateTime ?? e.start?.date ?? "", end: e.end?.dateTime ?? e.end?.date ?? "",
    location: e.location ?? null, description: e.description ?? null, attendees: ((e.attendees ?? []) as any[]).map((a: any) => a.email),
    html_link: e.htmlLink, meet_link: (e.conferenceData?.entryPoints ?? []).find((ep: any) => ep.entryPointType === "video")?.uri ?? null,
  }));
  return { events, count: events.length };
}

// ── CALENDAR: FREE/BUSY ───────────────────────────────────────────────────────
async function executeGetAvailability(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("google_calendar", uid, sb);
  const timeMin = String(p.time_min ?? new Date().toISOString());
  const timeMax = String(p.time_max ?? new Date(Date.now() + 7 * 86400000).toISOString());
  const data = await fetch("https://www.googleapis.com/calendar/v3/freeBusy",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ timeMin, timeMax, items: [{ id: "primary" }] }), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { time_min: timeMin, time_max: timeMax, busy_slots: data.calendars?.primary?.busy ?? [] };
}

// ── CALENDAR: UPDATE EVENT ────────────────────────────────────────────────────
async function executeUpdateCalendarEvent(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("google_calendar", uid, sb);
  const eventId = String(p.event_id ?? ""); if (!eventId) throw new Error("event_id required");
  const existing = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  const updated: any = { ...existing };
  if (p.title) updated.summary = p.title;
  if (p.start) updated.start = { dateTime: p.start, timeZone: "UTC" };
  if (p.end) updated.end = { dateTime: p.end, timeZone: "UTC" };
  if (p.description) updated.description = p.description;
  if (p.location) updated.location = p.location;
  const data = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(updated), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { event_id: eventId, summary: data.summary, html_link: data.htmlLink, timestamp: new Date().toISOString() };
}

// ── CALENDAR: DELETE EVENT ────────────────────────────────────────────────────
async function executeDeleteCalendarEvent(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("google_calendar", uid, sb);
  const eventId = String(p.event_id ?? ""); if (!eventId) throw new Error("event_id required");
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  return { ok: true, event_id: eventId, deleted: true, timestamp: new Date().toISOString() };
}

// ── CALENDAR: SCHEDULE GOOGLE MEET ────────────────────────────────────────────
async function executeScheduleMeet(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("google_calendar", uid, sb);
  const { title = "Meeting", start, end, description, attendees: att } = p;
  if (!start || !end) throw new Error("start and end required");
  const body: any = {
    summary: title, start: { dateTime: start, timeZone: "UTC" }, end: { dateTime: end, timeZone: "UTC" },
    attendees: Array.isArray(att) ? (att as string[]).map(e => ({ email: e })) : [],
    conferenceData: { createRequest: { requestId: `meet-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
  };
  if (description) body.description = description;
  const data = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }).then(r => r.json());
  const meetLink = (data.conferenceData?.entryPoints ?? []).find((ep: any) => ep.entryPointType === "video")?.uri ?? null;
  return { event_id: data.id, summary: data.summary, meet_link: meetLink, html_link: data.htmlLink, timestamp: new Date().toISOString() };
}

// ── GOOGLE TASKS: LIST ────────────────────────────────────────────────────────
async function executeListGoogleTasks(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("google_tasks", uid, sb);
  const listId = String(p.tasklist_id ?? "@default");
  const data = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=false&maxResults=50`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  const tasks = ((data.items ?? []) as any[]).map((t: any) => ({ id: t.id, title: t.title, notes: t.notes ?? null, due: t.due ?? null, status: t.status }));
  return { tasks, count: tasks.length };
}

// ── GOOGLE TASKS: COMPLETE ────────────────────────────────────────────────────
async function executeCompleteGoogleTask(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("google_tasks", uid, sb);
  const taskId = String(p.task_id ?? ""); if (!taskId) throw new Error("task_id required");
  const listId = String(p.tasklist_id ?? "@default");
  const data = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { ok: true, task_id: taskId, title: data.title, status: data.status, timestamp: new Date().toISOString() };
}

// ── GOOGLE TASKS: UPDATE ──────────────────────────────────────────────────────
async function executeUpdateGoogleTask(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("google_tasks", uid, sb);
  const taskId = String(p.task_id ?? ""); if (!taskId) throw new Error("task_id required");
  const listId = String(p.tasklist_id ?? "@default");
  const patch: any = {};
  if (p.title) patch.title = p.title;
  if (p.notes) patch.notes = p.notes;
  if (p.due) patch.due = p.due;
  const data = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(patch), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { ok: true, task_id: taskId, title: data.title, timestamp: new Date().toISOString() };
}

// ── DRIVE: LIST FILES ─────────────────────────────────────────────────────────
async function executeListDriveFiles(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const parts = [p.folder_id ? `'${p.folder_id}' in parents` : "", "trashed=false"].filter(Boolean);
  const max = Number(p.max_results ?? 20);
  const data = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(parts.join(" and "))}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,thumbnailLink)&pageSize=${max}&orderBy=modifiedTime+desc`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.json());
  const files = ((data.files ?? []) as any[]).map((f: any) => {
    const thumb = f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, "=s1200") : null;
    return { id: f.id, name: f.name, mime_type: f.mimeType, size: f.size ?? null, modified: f.modifiedTime, web_view_link: f.webViewLink, thumbnail: thumb, inline_image: (thumb && f.mimeType?.startsWith("image/")) ? `![${f.name}](${thumb})` : null };
  });
  return { files, count: files.length };
}

// ── DRIVE: SEARCH FILES ───────────────────────────────────────────────────────
async function executeSearchDriveFiles(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const parts = [p.name ? `name contains '${p.name}'` : "", p.text ? `fullText contains '${p.text}'` : "", "trashed=false"].filter(Boolean);
  const data = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(parts.join(" and "))}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,thumbnailLink)&pageSize=20`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.json());
  const files = ((data.files ?? []) as any[]).map((f: any) => ({ id: f.id, name: f.name, mime_type: f.mimeType, modified: f.modifiedTime, web_view_link: f.webViewLink, thumbnail: f.thumbnailLink?.replace(/=s\d+$/, "=s800") ?? null }));
  return { files, count: files.length };
}

// ── DRIVE: GET FILE INFO ──────────────────────────────────────────────────────
async function executeGetFileInfo(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const fileId = String(p.file_id ?? ""); if (!fileId) throw new Error("file_id required");
  const f = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink,thumbnailLink,owners`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  const thumb = f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, "=s1600") : null;
  return { id: f.id, name: f.name, mime_type: f.mimeType, size: f.size ?? null, created: f.createdTime, modified: f.modifiedTime, web_view_link: f.webViewLink, thumbnail: thumb, inline_image: (thumb && f.mimeType?.startsWith("image/")) ? `![${f.name}](${thumb})` : null, owners: ((f.owners ?? []) as any[]).map((o: any) => o.emailAddress) };
}

// ── DRIVE: READ FILE CONTENT ──────────────────────────────────────────────────
async function executeReadDriveFile(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const fileId = String(p.file_id ?? ""); if (!fileId) throw new Error("file_id required");
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink,thumbnailLink`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  let content = "";
  if (meta.mimeType === "application/vnd.google-apps.document") {
    content = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.text());
  } else if (meta.mimeType === "application/vnd.google-apps.spreadsheet") {
    content = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.text());
  } else if (meta.mimeType?.startsWith("text/")) {
    content = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.text());
  } else if (meta.mimeType?.startsWith("image/")) {
    const thumb = meta.thumbnailLink ? meta.thumbnailLink.replace(/=s\d+$/, "=s1600") : null;
    return { id: fileId, name: meta.name, mime_type: meta.mimeType, web_view_link: meta.webViewLink, inline_image: thumb ? `![${meta.name}](${thumb})` : null };
  }
  return { id: fileId, name: meta.name, mime_type: meta.mimeType, content: content.slice(0, 20000), web_view_link: meta.webViewLink };
}

// ── DRIVE: CREATE FOLDER ──────────────────────────────────────────────────────
async function executeCreateDriveFolder(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const body: any = { name: String(p.name ?? "New Folder"), mimeType: "application/vnd.google-apps.folder" };
  if (p.parent_id) body.parents = [p.parent_id];
  const data = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { folder_id: data.id, name: data.name, web_view_link: data.webViewLink, timestamp: new Date().toISOString() };
}

// ── DRIVE: MOVE FILE ──────────────────────────────────────────────────────────
async function executeMoveFile(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const { file_id: fid, new_parent_id: npid } = p; if (!fid || !npid) throw new Error("file_id and new_parent_id required");
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${fid}?fields=parents`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  const oldParents = ((meta.parents ?? []) as string[]).join(",");
  const data = await fetch(`https://www.googleapis.com/drive/v3/files/${fid}?addParents=${npid}&removeParents=${oldParents}&fields=id,name`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { ok: true, file_id: fid, name: data.name, new_parent: npid, timestamp: new Date().toISOString() };
}

// ── DRIVE: DELETE / TRASH FILE ────────────────────────────────────────────────
async function executeDeleteFile(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const fid = String(p.file_id ?? ""); if (!fid) throw new Error("file_id required");
  await fetch(`https://www.googleapis.com/drive/v3/files/${fid}/trash`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  return { ok: true, file_id: fid, trashed: true, timestamp: new Date().toISOString() };
}

// ── DRIVE: RENAME FILE ────────────────────────────────────────────────────────
async function executeRenameFile(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const fid = String(p.file_id ?? ""); const newName = String(p.new_name ?? ""); if (!fid || !newName) throw new Error("file_id and new_name required");
  const data = await fetch(`https://www.googleapis.com/drive/v3/files/${fid}?fields=id,name`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { ok: true, file_id: fid, new_name: data.name, timestamp: new Date().toISOString() };
}

// ── DRIVE: SHARE FILE ─────────────────────────────────────────────────────────
async function executeShareFile(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const { file_id: fid, email, role = "reader" } = p; if (!fid || !email) throw new Error("file_id and email required");
  const data = await fetch(`https://www.googleapis.com/drive/v3/files/${fid}/permissions`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "user", role, emailAddress: email }), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { ok: true, file_id: fid, shared_with: email, role, permission_id: data.id, timestamp: new Date().toISOString() };
}

// ── DOCS: READ ────────────────────────────────────────────────────────────────
async function executeReadDocument(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const docId = String(p.document_id ?? ""); if (!docId) throw new Error("document_id required");
  const doc = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.json());
  let text = "";
  for (const el of (doc.body?.content ?? []) as any[]) for (const te of el.paragraph?.elements ?? []) text += te.textRun?.content ?? "";
  return { document_id: docId, title: doc.title ?? "(untitled)", content: text.slice(0, 20000), revision_id: doc.revisionId, web_view_link: `https://docs.google.com/document/d/${docId}/edit` };
}

async function executeDeleteDocument(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  return executeDeleteFile({ file_id: p.document_id }, uid, sb);
}

// ── SHEETS: CREATE ────────────────────────────────────────────────────────────
async function executeCreateSheet(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const data = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: String(p.title ?? "New Spreadsheet"), mimeType: "application/vnd.google-apps.spreadsheet" }), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { spreadsheet_id: data.id, title: data.name, web_view_link: data.webViewLink, timestamp: new Date().toISOString() };
}

// ── SHEETS: READ ──────────────────────────────────────────────────────────────
async function executeReadSheet(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const sid = String(p.spreadsheet_id ?? ""); if (!sid) throw new Error("spreadsheet_id required");
  const range = encodeSheetRange(String(p.range ?? "A1:Z100"));
  const data = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.json());
  return { spreadsheet_id: sid, range: data.range, values: data.values ?? [], row_count: (data.values ?? []).length };
}

// ── SLIDES: CREATE ────────────────────────────────────────────────────────────
async function executeCreatePresentation(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const data = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: String(p.title ?? "New Presentation"), mimeType: "application/vnd.google-apps.presentation" }), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { presentation_id: data.id, title: data.name, web_view_link: data.webViewLink, timestamp: new Date().toISOString() };
}

// ── SLIDES: READ ──────────────────────────────────────────────────────────────
async function executeReadPresentation(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gdrive", uid, sb);
  const pid = String(p.presentation_id ?? ""); if (!pid) throw new Error("presentation_id required");
  const data = await fetch(`https://slides.googleapis.com/v1/presentations/${pid}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.json());
  const slides = ((data.slides ?? []) as any[]).map((s: any, i: number) => {
    const texts: string[] = [];
    for (const el of s.pageElements ?? []) { const t = (el.shape?.text?.textElements ?? []).map((te: any) => te.textRun?.content ?? "").join(""); if (t.trim()) texts.push(t.trim()); }
    return { slide_number: i + 1, slide_id: s.objectId, text: texts.join(" | ") };
  });
  return { presentation_id: pid, title: data.title, slide_count: slides.length, slides };
}

// ── CONTACTS: CREATE ──────────────────────────────────────────────────────────
async function executeCreateContact(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gcontacts", uid, sb);
  const name = String(p.name ?? ""); if (!name) throw new Error("name required");
  const parts = name.split(" ");
  const person: any = { names: [{ givenName: parts[0], familyName: parts.slice(1).join(" ") }] };
  if (p.email) person.emailAddresses = [{ value: p.email, type: "work" }];
  if (p.phone) person.phoneNumbers = [{ value: p.phone, type: "mobile" }];
  if (p.company) person.organizations = [{ name: p.company }];
  if (p.notes) person.biographies = [{ value: p.notes }];
  const data = await fetch("https://people.googleapis.com/v1/people:createContact",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(person), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { resource_name: data.resourceName, name, timestamp: new Date().toISOString() };
}

// ── CONTACTS: LIST ────────────────────────────────────────────────────────────
async function executeListContacts(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gcontacts", uid, sb);
  const max = Number(p.max_results ?? 25);
  const data = await fetch(`https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations&pageSize=${max}&sortOrder=LAST_MODIFIED_DESCENDING`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.json());
  const contacts = ((data.connections ?? []) as any[]).map((p: any) => ({ resource_name: p.resourceName, name: p.names?.[0]?.displayName ?? "(no name)", email: p.emailAddresses?.[0]?.value ?? null, phone: p.phoneNumbers?.[0]?.value ?? null, company: p.organizations?.[0]?.name ?? null }));
  return { contacts, count: contacts.length };
}

// ── CONTACTS: SEARCH ──────────────────────────────────────────────────────────
async function executeSearchContacts(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gcontacts", uid, sb);
  const data = await fetch(`https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(String(p.query ?? ""))}&readMask=names,emailAddresses,phoneNumbers,organizations&pageSize=10`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.json());
  const contacts = ((data.results ?? []) as any[]).map((r: any) => {
    const c = r.person ?? {};
    return { resource_name: c.resourceName, name: c.names?.[0]?.displayName ?? "(no name)", email: c.emailAddresses?.[0]?.value ?? null, phone: c.phoneNumbers?.[0]?.value ?? null, company: c.organizations?.[0]?.name ?? null };
  });
  return { contacts, count: contacts.length };
}

// ── CONTACTS: UPDATE ──────────────────────────────────────────────────────────
async function executeUpdateContact(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gcontacts", uid, sb);
  const rn = String(p.resource_name ?? ""); if (!rn) throw new Error("resource_name required");
  const current = await fetch(`https://people.googleapis.com/v1/${rn}?personFields=names,emailAddresses,phoneNumbers,organizations,biographies`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  const updated: any = { ...current };
  const mask: string[] = [];
  if (p.name) { const pts = String(p.name).split(" "); updated.names = [{ givenName: pts[0], familyName: pts.slice(1).join(" ") }]; mask.push("names"); }
  if (p.email) { updated.emailAddresses = [{ value: p.email }]; mask.push("emailAddresses"); }
  if (p.phone) { updated.phoneNumbers = [{ value: p.phone }]; mask.push("phoneNumbers"); }
  if (p.notes) { updated.biographies = [{ value: p.notes }]; mask.push("biographies"); }
  if (!mask.length) return { ok: true, note: "No fields to update" };
  const data = await fetch(`https://people.googleapis.com/v1/${rn}:updateContact?updatePersonFields=${mask.join(",")}`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(updated), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { ok: true, resource_name: data.resourceName, name: data.names?.[0]?.displayName, timestamp: new Date().toISOString() };
}

// ── CONTACTS: DELETE ──────────────────────────────────────────────────────────
async function executeDeleteContact(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("gcontacts", uid, sb);
  const rn = String(p.resource_name ?? ""); if (!rn) throw new Error("resource_name required");
  await fetch(`https://people.googleapis.com/v1/${rn}:deleteContact`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  return { ok: true, resource_name: rn, deleted: true, timestamp: new Date().toISOString() };
}

// ── GOOGLE BUSINESS PROFILE: GET REVIEWS ─────────────────────────────────────
async function executeGetGBPReviews(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("google_business", uid, sb);
  const accounts = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  const accountName = p.account_name ?? accounts.accounts?.[0]?.name;
  if (!accountName) return { reviews: [], note: "No Google Business Profile account found" };
  const locs = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  const locationName = p.location_name ?? locs.locations?.[0]?.name;
  if (!locationName) return { reviews: [], note: "No locations found" };
  const data = await fetch(`https://mybusiness.googleapis.com/v4/${locationName}/reviews?pageSize=20`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then(r => r.json());
  const reviews = ((data.reviews ?? []) as any[]).map((r: any) => ({ review_id: r.reviewId, reviewer: r.reviewer?.displayName ?? "Anonymous", rating: r.starRating, comment: r.comment ?? "", create_time: r.createTime, reply: r.reviewReply?.comment ?? null }));
  return { location: locationName, reviews, count: reviews.length };
}

// ── GOOGLE BUSINESS PROFILE: RESPOND TO REVIEW ───────────────────────────────
async function executeRespondToReview(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("google_business", uid, sb);
  const { location_name: loc, review_id: rid, reply } = p; if (!loc || !rid || !reply) throw new Error("location_name, review_id, reply required");
  await fetch(`https://mybusiness.googleapis.com/v4/${loc}/reviews/${rid}/reply`,
    { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ comment: reply }), signal: AbortSignal.timeout(10_000) });
  return { ok: true, review_id: rid, reply_posted: true, timestamp: new Date().toISOString() };
}

// ── GOOGLE BUSINESS PROFILE: CREATE POST ─────────────────────────────────────
async function executeCreateGBPPost(p: Record<string, unknown>, uid: string, sb: ReturnType<typeof createClient>) {
  const token = await getGoogleToken("google_business", uid, sb);
  const { location_name: loc, content, topic_type = "STANDARD" } = p; if (!loc || !content) throw new Error("location_name and content required");
  const body: any = { topicType: topic_type, languageCode: "en", summary: String(content).slice(0, 1500) };
  if (p.call_to_action_url) body.callToAction = { actionType: "LEARN_MORE", url: p.call_to_action_url };
  const data = await fetch(`https://mybusiness.googleapis.com/v4/${loc}/localPosts`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  return { post_name: data.name, topic_type, timestamp: new Date().toISOString() };
}

// ── Route action_type ─────────────────────────────────────────────────────────

async function routeActionType(
  actionType: string,
  actionPayload: Record<string, unknown>,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  switch (actionType) {
    // ── Existing ──────────────────────────────────────────────────────────────
    case "draft_email":
    case "send_email":             return await executeDraftEmail(actionPayload, userId, adminSb);
    case "schedule_event":
    case "create_event":           return await executeScheduleEvent(actionPayload, userId, adminSb);
    case "create_task":            return await executeCreateTask(actionPayload, userId, adminSb);
    case "post_social":            return await executePostSocial(actionPayload, userId);
    case "create_drive_file":      return await executeCreateDriveFile(actionPayload, userId, adminSb);
    case "update_drive_file":      return await executeUpdateDriveFile(actionPayload, userId, adminSb);
    case "update_sheet":           return await executeUpdateSheet(actionPayload, userId, adminSb);
    case "create_google_task":     return await executeCreateGoogleTask(actionPayload, userId, adminSb);
    // ── Gmail ─────────────────────────────────────────────────────────────────
    case "get_emails":             return await executeGetEmails(actionPayload, userId, adminSb);
    case "get_email_thread":       return await executeGetEmailThread(actionPayload, userId, adminSb);
    case "list_gmail_labels":      return await executeListGmailLabels(actionPayload, userId, adminSb);
    case "create_gmail_label":     return await executeCreateGmailLabel(actionPayload, userId, adminSb);
    case "apply_gmail_label":      return await executeApplyGmailLabel(actionPayload, userId, adminSb);
    case "archive_email":          return await executeArchiveEmail(actionPayload, userId, adminSb);
    case "delete_email":           return await executeDeleteEmail(actionPayload, userId, adminSb);
    case "mark_email":             return await executeMarkEmail(actionPayload, userId, adminSb);
    // ── Google Calendar ───────────────────────────────────────────────────────
    case "get_calendar_events":    return await executeGetCalendarEvents(actionPayload, userId, adminSb);
    case "get_availability":       return await executeGetAvailability(actionPayload, userId, adminSb);
    case "update_calendar_event":
    case "update_event":           return await executeUpdateCalendarEvent(actionPayload, userId, adminSb);
    case "delete_calendar_event":
    case "delete_event":           return await executeDeleteCalendarEvent(actionPayload, userId, adminSb);
    case "schedule_meet":
    case "create_meet":            return await executeScheduleMeet(actionPayload, userId, adminSb);
    // ── Google Tasks ──────────────────────────────────────────────────────────
    case "list_google_tasks":      return await executeListGoogleTasks(actionPayload, userId, adminSb);
    case "complete_google_task":   return await executeCompleteGoogleTask(actionPayload, userId, adminSb);
    case "update_google_task":     return await executeUpdateGoogleTask(actionPayload, userId, adminSb);
    // ── Google Drive ──────────────────────────────────────────────────────────
    case "list_drive_files":       return await executeListDriveFiles(actionPayload, userId, adminSb);
    case "search_drive_files":     return await executeSearchDriveFiles(actionPayload, userId, adminSb);
    case "get_file_info":          return await executeGetFileInfo(actionPayload, userId, adminSb);
    case "read_drive_file":
    case "read_file":              return await executeReadDriveFile(actionPayload, userId, adminSb);
    case "create_drive_folder":    return await executeCreateDriveFolder(actionPayload, userId, adminSb);
    case "move_file":              return await executeMoveFile(actionPayload, userId, adminSb);
    case "delete_file":
    case "trash_file":             return await executeDeleteFile(actionPayload, userId, adminSb);
    case "rename_file":            return await executeRenameFile(actionPayload, userId, adminSb);
    case "share_file":             return await executeShareFile(actionPayload, userId, adminSb);
    // ── Google Docs ───────────────────────────────────────────────────────────
    case "read_document":
    case "read_doc":               return await executeReadDocument(actionPayload, userId, adminSb);
    case "delete_document":        return await executeDeleteDocument(actionPayload, userId, adminSb);
    // ── Google Sheets ─────────────────────────────────────────────────────────
    case "create_sheet":
    case "create_spreadsheet":     return await executeCreateSheet(actionPayload, userId, adminSb);
    case "read_sheet":             return await executeReadSheet(actionPayload, userId, adminSb);
    // ── Google Slides ─────────────────────────────────────────────────────────
    case "create_presentation":
    case "create_slides":          return await executeCreatePresentation(actionPayload, userId, adminSb);
    case "read_presentation":      return await executeReadPresentation(actionPayload, userId, adminSb);
    // ── Google Contacts ───────────────────────────────────────────────────────
    case "create_contact":         return await executeCreateContact(actionPayload, userId, adminSb);
    case "list_contacts":          return await executeListContacts(actionPayload, userId, adminSb);
    case "search_contacts":        return await executeSearchContacts(actionPayload, userId, adminSb);
    case "update_contact":         return await executeUpdateContact(actionPayload, userId, adminSb);
    case "delete_contact":         return await executeDeleteContact(actionPayload, userId, adminSb);
    // ── Google Business Profile ───────────────────────────────────────────────
    case "get_gbp_reviews":
    case "get_reviews":            return await executeGetGBPReviews(actionPayload, userId, adminSb);
    case "respond_to_review":      return await executeRespondToReview(actionPayload, userId, adminSb);
    case "create_gbp_post":
    case "create_business_post":   return await executeCreateGBPPost(actionPayload, userId, adminSb);
    // ── ComfyUI image / video generation ─────────────────────────────────────
    case "generate_image":
    case "generate_video": {
      const comfyRes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-comfyui`,
        {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            prompt:          actionPayload.prompt ?? actionPayload.description ?? "",
            workflow_type:   actionType === "generate_video"
              ? "txt2vid"
              : (actionPayload.workflow_type ?? "txt2img"),
            negative_prompt: actionPayload.negative_prompt,
            width:           actionPayload.width,
            height:          actionPayload.height,
            steps:           actionPayload.steps,
            cfg:             actionPayload.cfg,
            user_id:         userId,
          }),
          signal: AbortSignal.timeout(310_000),
        },
      );
      return await comfyRes.json();
    }
    case "make_call":
    case "phone_call": {
      const callRes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-phone-call`,
        {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            user_id:       userId,
            to:            actionPayload.to ?? actionPayload.phone ?? actionPayload.number,
            purpose:       actionPayload.purpose ?? actionPayload.goal ?? actionPayload.reason,
            caller_name:   actionPayload.caller_name,
            first_message: actionPayload.first_message,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const callData = await callRes.json();
      if (!callRes.ok || callData.error) {
        throw new Error(callData.error ?? `phone call failed (${callRes.status})`);
      }
      return callData;
    }
    default:
      // Unroutable action — surface as an error so the queue item is marked
      // failed, not silently "executed". Prevents false success records.
      throw new Error(`Action type '${actionType}' is not supported by the executor.`);
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
