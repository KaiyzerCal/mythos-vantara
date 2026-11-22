// Pure helpers for the Google-via-Composio reads (no Deno or network imports, so they can be unit-tested).
export const GOOGLE_DOC = "application/vnd.google-apps.document";
export const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";

/** The Google read actions chat and the agent advertise; each must have a route in googleViaComposio.ts. */
export const COMPOSIO_GOOGLE_ACTIONS = [
  "search_drive_files", "search_drive", "list_drive_files", "get_file_info", "read_drive_file", "read_file", "read_document", "read_doc",
  "read_sheet", "read_sheet_range", "get_emails", "read_emails", "get_calendar_events", "read_calendar",
  "list_google_tasks", "read_google_tasks", "create_google_task", "complete_google_task", "update_google_task",
] as const;

export const q1 = (s: string) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** The Drive `q` for a search: raw Drive queries pass through, plain words search name and content. */
export function buildDriveQuery(p: Record<string, unknown>): string {
  const raw = String(p.query ?? "").trim();
  const name = String(p.name ?? "").trim();
  const text = String(p.text ?? "").trim();
  let q: string;
  if (raw && /\b(contains|in parents)\b|=/.test(raw)) q = /trashed/.test(raw) ? raw : `${raw} and trashed = false`; // already a Drive query
  else if (raw) q = `(name contains '${q1(raw)}' or fullText contains '${q1(raw)}') and trashed = false`;
  else q = [name ? `name contains '${q1(name)}'` : "", text ? `fullText contains '${q1(text)}'` : "", "trashed = false"].filter(Boolean).join(" and ");
  const ft = String(p.file_type ?? "");
  if (ft === "doc") q += ` and mimeType = '${GOOGLE_DOC}'`;
  else if (ft === "sheet") q += ` and mimeType = '${GOOGLE_SHEET}'`;
  else if (ft === "pdf") q += " and mimeType = 'application/pdf'";
  else if (ft === "folder") q += " and mimeType = 'application/vnd.google-apps.folder'";
  return q;
}

