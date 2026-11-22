// Google Drive / Docs / Sheets / Gmail / Calendar reads through Composio.
//
// MAVIS's Google tools were written for a direct Google OAuth connection (mavis_user_integrations) that was never set up;
// the operator's Google accounts are authorized through Composio instead. Without this, every Drive/Sheets/Gmail/Calendar
// tool answered "not connected" while the accounts were active (live 2026-11-22: "Drive appears disconnected" with Drive,
// Docs, Sheets, Gmail and Calendar all ACTIVE in Composio). Results use the same shapes as the direct-OAuth versions so
// callers and the model see no difference.
//
// `viaComposio(...)` returns undefined when it does not handle the action (not a Google read, a direct connection exists, or
// Composio has no active account for that toolkit), and the caller then runs its existing direct path.

import { composioReady, composioRun } from "./composio.ts";
import { extractLocalText } from "./localExtract.ts";
import { localLibs } from "./localExtractLibs.ts";
import { buildDriveQuery, q1, GOOGLE_DOC, GOOGLE_SHEET, COMPOSIO_GOOGLE_ACTIONS } from "./googleQuery.ts";

const FILE_FIELDS = "files(id,name,mimeType,size,modifiedTime,webViewLink)";
const MAX_CONTENT = 60_000;

const mapFile = (f: any) => ({
  id: f.id, name: f.name, mime_type: f.mimeType, size: f.size ?? null, modified: f.modifiedTime, web_view_link: f.webViewLink ?? null,
});

export async function driveSearch(uid: string, p: Record<string, unknown>) {
  const q = buildDriveQuery(p);
  const data = await composioRun(uid, "GOOGLEDRIVE_FIND_FILE", {
    q, pageSize: Math.min(Number(p.max_results ?? 10), 30), fields: FILE_FIELDS, orderBy: "modifiedTime desc",
  });
  const files = ((data?.files ?? []) as any[]).map(mapFile);
  return { files, count: files.length, query: q };
}

export async function driveList(uid: string, p: Record<string, unknown>) {
  const q = [p.folder_id ? `'${q1(String(p.folder_id))}' in parents` : "", "trashed = false"].filter(Boolean).join(" and ");
  const data = await composioRun(uid, "GOOGLEDRIVE_FIND_FILE", {
    q, pageSize: Math.min(Number(p.max_results ?? 20), 100), fields: FILE_FIELDS, orderBy: "modifiedTime desc",
  });
  const files = ((data?.files ?? []) as any[]).map(mapFile);
  return { files, count: files.length };
}

async function metadata(uid: string, fileId: string) {
  const m = await composioRun(uid, "GOOGLEDRIVE_GET_FILE_METADATA", { fileId });
  return { id: m?.id ?? fileId, name: String(m?.name ?? ""), mimeType: String(m?.mimeType ?? ""), size: m?.size ?? null };
}

export async function driveInfo(uid: string, p: Record<string, unknown>) {
  const fileId = String(p.file_id ?? "");
  if (!fileId) throw new Error("file_id required");
  const m = await metadata(uid, fileId);
  return { id: m.id, name: m.name, mime_type: m.mimeType, size: m.size };
}

async function resolveFileId(uid: string, p: Record<string, unknown>): Promise<string> {
  const id = String(p.file_id ?? "").trim();
  if (id) return id;
  const name = String(p.file_name ?? p.name ?? "").trim();
  if (!name) throw new Error("Provide file_id or file_name");
  const data = await composioRun(uid, "GOOGLEDRIVE_FIND_FILE", { q: `name contains '${q1(name)}' and trashed = false`, pageSize: 1, fields: "files(id,name)" });
  const hit = (data?.files ?? [])[0];
  if (!hit?.id) throw new Error(`File not found: ${name}`);
  return String(hit.id);
}

/** Download a Drive file through Composio and return its text: native Docs/Sheets are exported, PDFs and Office files are read locally. */
export async function driveRead(uid: string, p: Record<string, unknown>) {
  const fileId = await resolveFileId(uid, p);
  const meta = await metadata(uid, fileId);
  const mime = meta.mimeType;
  const exportAs = mime === GOOGLE_DOC ? "text/plain" : mime === GOOGLE_SHEET ? "text/csv" : undefined;
  const dl = await composioRun(uid, "GOOGLEDRIVE_DOWNLOAD_FILE", { file_id: fileId, ...(exportAs ? { mime_type: exportAs } : {}) });
  const url = dl?.downloaded_file_content?.s3url;
  if (!url) throw new Error("Drive returned no downloadable content for this file");
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Downloading the file failed (${res.status})`);
  const buf = await res.arrayBuffer();
  let content = "";
  if (exportAs) {
    content = new TextDecoder().decode(buf);
  } else {
    const local = await extractLocalText(buf, mime, meta.name, localLibs);
    if (local) content = local;
    else {
      const text = new TextDecoder().decode(buf);
      const sample = text.slice(0, 500);
      const printable = [...sample].filter((c) => c.charCodeAt(0) >= 32 || c === "\n" || c === "\t").length;
      if (mime.startsWith("text/") || (sample.length > 0 && printable / sample.length > 0.9)) content = text;
      else if (mime === "application/pdf") throw new Error("This PDF has no text layer (it is a scan). Upload it to the chat so MAVIS can read it with vision.");
      else throw new Error(`MAVIS cannot read the text of a ${mime || "this"} file`);
    }
  }
  return {
    file_id: fileId, file_name: meta.name, mime_type: mime, id: fileId, name: meta.name,
    content: content.slice(0, MAX_CONTENT), truncated: content.length > MAX_CONTENT, total_chars: content.length,
  };
}

export async function sheetRead(uid: string, p: Record<string, unknown>) {
  let sid = String(p.spreadsheet_id ?? "").trim();
  if (!sid) {
    const name = String(p.spreadsheet_name ?? "").trim();
    if (!name) throw new Error("spreadsheet_id required");
    const data = await composioRun(uid, "GOOGLEDRIVE_FIND_FILE", { q: `name contains '${q1(name)}' and mimeType = '${GOOGLE_SHEET}' and trashed = false`, pageSize: 1, fields: "files(id,name)" });
    sid = String((data?.files ?? [])[0]?.id ?? "");
    if (!sid) throw new Error(`Spreadsheet not found: ${name}`);
  }
  const range = String(p.range ?? "A1:Z100");
  const data = await composioRun(uid, "GOOGLESHEETS_BATCH_GET", { spreadsheet_id: sid, ranges: [range] });
  const vr = (data?.valueRanges ?? [])[0] ?? {};
  const values = (vr.values ?? []) as unknown[][];
  return { spreadsheet_id: sid, range: vr.range ?? range, values, rows: values, row_count: values.length, total_rows: values.length };
}

export async function gmailList(uid: string, p: Record<string, unknown>) {
  const max = Math.min(Number(p.max_results ?? 15), 30);
  const query = String(p.query ?? "").trim();
  const data = await composioRun(uid, "GMAIL_FETCH_EMAILS", {
    max_results: query ? 50 : max, label_ids: ["INBOX"], verbose: true, include_payload: false,
    ...(query ? { query } : {}),
  });
  let msgs = (data?.messages ?? []) as any[];
  // Composio's `query` is not reliably applied to this tool, so also filter on the text of what came back.
  if (query && !/\b(is|in|label|from|to|category|has):/.test(query)) {
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const hit = msgs.filter((m) => terms.every((t) => `${m.subject ?? ""} ${m.sender ?? ""} ${m.messageText ?? ""}`.toLowerCase().includes(t)));
    if (hit.length > 0) msgs = hit;
  }
  const emails = msgs.slice(0, max).map((m: any) => {
    const text = String(m.messageText ?? m.preview?.body ?? "");
    return {
      id: m.messageId, thread_id: m.threadId ?? null, from: String(m.sender ?? ""), to: String(m.to ?? ""), subject: String(m.subject ?? "") || "(no subject)",
      date: String(m.messageTimestamp ?? ""), snippet: text.slice(0, 200), is_unread: Array.isArray(m.labelIds) ? m.labelIds.includes("UNREAD") : undefined,
    };
  });
  return { emails, total: emails.length, query: query || "inbox" };
}

export async function calendarList(uid: string, p: Record<string, unknown>) {
  const timeMin = String(p.time_min ?? new Date().toISOString());
  const timeMax = String(p.time_max ?? new Date(Date.now() + Number(p.days_ahead ?? 7) * 86400_000).toISOString());
  const data = await composioRun(uid, "GOOGLECALENDAR_EVENTS_LIST", {
    calendarId: "primary", timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: Math.min(Number(p.max_results ?? 20), 100),
  });
  const events = ((data?.items ?? []) as any[]).map((e: any) => ({
    id: e.id, summary: e.summary ?? "(no title)", title: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "", end: e.end?.dateTime ?? e.end?.date ?? "",
    location: e.location ?? null, description: e.description ?? null,
    attendees: ((e.attendees ?? []) as any[]).map((a: any) => a.email), html_link: e.htmlLink ?? null,
  }));
  return { events, count: events.length, total: events.length };
}

// ── Google Tasks ──────────────────────────────────────────────────────────
async function defaultTaskList(uid: string, p: Record<string, unknown>): Promise<string> {
  const given = String(p.tasklist_id ?? "").trim();
  if (given) return given;
  const lists = await composioRun(uid, "GOOGLETASKS_LIST_TASK_LISTS", {});
  const first = ((lists?.items ?? lists?.tasklists ?? lists?.task_lists ?? []) as any[])[0];
  return String(first?.id ?? "@default");
}
const mapTask = (t: any) => ({ id: t.id, title: t.title, status: t.status, due: t.due ?? null, notes: t.notes ?? null, completed: t.completed ?? null });

export async function tasksList(uid: string, p: Record<string, unknown>) {
  const tasklist_id = await defaultTaskList(uid, p);
  const data = await composioRun(uid, "GOOGLETASKS_LIST_TASKS", {
    tasklist_id, showCompleted: Boolean(p.show_completed ?? false), maxResults: Math.min(Number(p.max_results ?? 20), 100),
  });
  const tasks = ((data?.items ?? data?.tasks ?? []) as any[]).map(mapTask);
  return { tasks, total: tasks.length, tasklist_id };
}

export async function taskCreate(uid: string, p: Record<string, unknown>) {
  const title = String(p.title ?? "").trim();
  if (!title) throw new Error("title required");
  const tasklist_id = await defaultTaskList(uid, p);
  const data = await composioRun(uid, "GOOGLETASKS_INSERT_TASK", {
    tasklist_id, title, status: "needsAction",
    ...(p.notes ? { notes: String(p.notes) } : {}), ...(p.due ? { due: new Date(String(p.due)).toISOString() } : {}),
  });
  return { task_id: data?.id ?? null, title, tasklist_id };
}

async function taskPatch(uid: string, p: Record<string, unknown>, changes: Record<string, unknown>) {
  const task_id = String(p.task_id ?? p.id ?? "").trim();
  if (!task_id) throw new Error("task_id required");
  const tasklist_id = await defaultTaskList(uid, p);
  const cur = await composioRun(uid, "GOOGLETASKS_GET_TASK", { tasklist_id, task_id });
  const data = await composioRun(uid, "GOOGLETASKS_PATCH_TASK", {
    tasklist_id, task_id, title: String(changes.title ?? cur?.title ?? "Task"), status: String(changes.status ?? cur?.status ?? "needsAction"),
    ...(changes.notes !== undefined ? { notes: String(changes.notes) } : {}), ...(changes.due ? { due: new Date(String(changes.due)).toISOString() } : {}),
  });
  return { task_id, title: data?.title ?? changes.title ?? cur?.title, status: data?.status ?? changes.status ?? cur?.status };
}
export const taskComplete = (uid: string, p: Record<string, unknown>) => taskPatch(uid, p, { status: "completed" });
export const taskUpdate = (uid: string, p: Record<string, unknown>) =>
  taskPatch(uid, p, { ...(p.title ? { title: p.title } : {}), ...(p.notes !== undefined ? { notes: p.notes } : {}), ...(p.due ? { due: p.due } : {}), ...(p.status ? { status: p.status } : {}) });

type Handler = (uid: string, p: Record<string, unknown>) => Promise<unknown>;
// action type -> [Composio toolkit, direct-OAuth provider in mavis_user_integrations, handler]
const ROUTES: Record<string, [string, string, Handler]> = {
  search_drive_files: ["googledrive", "gdrive", driveSearch],
  search_drive: ["googledrive", "gdrive", driveSearch],
  list_drive_files: ["googledrive", "gdrive", driveList],
  get_file_info: ["googledrive", "gdrive", driveInfo],
  read_drive_file: ["googledrive", "gdrive", driveRead],
  read_file: ["googledrive", "gdrive", driveRead],
  read_document: ["googledrive", "gdrive", driveRead],
  read_doc: ["googledrive", "gdrive", driveRead],
  read_sheet: ["googlesheets", "gdrive", sheetRead],
  read_sheet_range: ["googlesheets", "gdrive", sheetRead],
  get_emails: ["gmail", "gmail", gmailList],
  read_emails: ["gmail", "gmail", gmailList],
  get_calendar_events: ["googlecalendar", "google_calendar", calendarList],
  read_calendar: ["googlecalendar", "google_calendar", calendarList],
  list_google_tasks: ["googletasks", "google_tasks", tasksList],
  read_google_tasks: ["googletasks", "google_tasks", tasksList],
  create_google_task: ["googletasks", "google_tasks", taskCreate],
  complete_google_task: ["googletasks", "google_tasks", taskComplete],
  update_google_task: ["googletasks", "google_tasks", taskUpdate],
};

export function composioHandles(actionType: string): boolean {
  return actionType in ROUTES;
}
// Keep the advertised list and the route table in step.
for (const t of COMPOSIO_GOOGLE_ACTIONS) if (!(t in ROUTES)) console.warn(`[googleViaComposio] no route for ${t}`);

/** Run a Google read through Composio when there is no direct connection and Composio has the account active. */
export async function viaComposio(sb: any, uid: string, actionType: string, payload: Record<string, unknown>): Promise<unknown | undefined> {
  const route = ROUTES[actionType];
  if (!route) return undefined;
  const [toolkit, provider, handler] = route;
  const { data: direct } = await sb.from("mavis_user_integrations").select("config").eq("user_id", uid).eq("provider", provider).maybeSingle();
  if (direct?.config) return undefined;
  if (!(await composioReady(uid, toolkit))) return undefined;
  return await handler(uid, payload);
}
