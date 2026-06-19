// mavis-sheets-agent
// Google Sheets — intelligent structured-data querying inspired by the n8n pattern:
//   don't dump the whole sheet, let MAVIS query columns/rows it actually needs.
// Requires: Google OAuth via mavis_user_integrations (provider: "gsheets")
//   Run the standard Google OAuth flow with scope:
//   https://www.googleapis.com/auth/spreadsheets
//
// Actions: list_sheets | get_columns | get_column_values | get_row | search_rows
//          append_row  | update_row  | get_range          | batch_get | clear_range

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

// ── OAuth helpers ──────────────────────────────────────────────

async function refreshGoogleToken(
  config: Record<string, any>,
  sb: ReturnType<typeof createClient>,
  uid: string,
): Promise<string> {
  const now = Date.now();
  if (config.access_token && config.expires_at && config.expires_at > now + 60_000) {
    return config.access_token as string;
  }

  const params = new URLSearchParams({
    client_id:     config.client_id,
    client_secret: config.client_secret,
    refresh_token: config.refresh_token,
    grant_type:    "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${data.error_description ?? data.error}`);

  const newConfig = {
    ...config,
    access_token: data.access_token,
    expires_at:   now + (data.expires_in ?? 3600) * 1000,
  };

  await sb.from("mavis_user_integrations")
    .update({ config: newConfig })
    .eq("user_id", uid)
    .eq("provider", "gsheets")
    .eq("key_name", "oauth");

  return data.access_token as string;
}

async function getToken(sb: ReturnType<typeof createClient>, uid: string): Promise<string> {
  const { data, error } = await sb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", uid)
    .eq("provider", "gsheets")
    .eq("key_name", "oauth")
    .single();

  if (error || !data) {
    throw new Error("Google Sheets not connected. Complete the OAuth flow at Settings → Integrations → Google Sheets.");
  }
  return refreshGoogleToken(data.config as Record<string, any>, sb, uid);
}

// ── Sheets API helper ──────────────────────────────────────────

async function sReq(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  const res = await fetch(`${SHEETS_BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets error (${res.status}): ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// ── Helpers ────────────────────────────────────────────────────

/** Convert 0-based column index to A1 letter (0→A, 25→Z, 26→AA …) */
function colLetter(n: number): string {
  let s = "";
  n++;
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

/** Convert column name (A, B, AA …) or 1-based number to 0-based index */
function colIndex(col: string | number): number {
  if (typeof col === "number") return col - 1;
  return col.toUpperCase().split("").reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

/** Parse a values array-of-arrays into array of objects using first row as headers */
function rowsToObjects(values: string[][]): Record<string, string>[] {
  if (!values || values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) obj[h] = row[i] ?? ""; });
    return obj;
  });
}

// ── Main ───────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Auth
    const authHeader = req.headers.get("Authorization") ?? "";
    let uid: string | null = null;

    const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

    if (authHeader === `Bearer ${SB_SRK}`) {
      // Service-role call from task-executor or mavis-actions — userId in body
      const body = await req.json().catch(() => ({}));
      uid = String(body.userId ?? body.user_id ?? "");
      if (!uid) return json({ error: "userId required for service-role calls" }, 400);

      // Re-attach body for switch below
      (req as any)._body = body;
    } else if (authHeader.startsWith("Bearer eyJ")) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      const userClient = createClient(SB_URL, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: ud } = await userClient.auth.getUser();
      if (!ud?.user?.id) return json({ error: "Unauthorized" }, 401);
      uid = ud.user.id;
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = (req as any)._body ?? await req.json().catch(() => ({}));
    const action     = String(body.action ?? "");
    const sheetId    = String(body.spreadsheet_id ?? body.sheet_id ?? "");
    const sheetName  = String(body.sheet_name ?? "Sheet1");

    if (!action) return json({ error: "action required" }, 400);

    const token = await getToken(sb, uid);

    switch (action) {

      // ── Metadata ──────────────────────────────────────────

      case "list_sheets": {
        if (!sheetId) return json({ error: "spreadsheet_id required" }, 400);

        const data = await sReq(
          `/${sheetId}?fields=spreadsheetId,properties.title,sheets.properties`,
          token,
        );

        return json({
          spreadsheet_id: data.spreadsheetId,
          title:          data.properties?.title,
          sheets: (data.sheets ?? []).map((s: any) => ({
            id:         s.properties.sheetId,
            name:       s.properties.title,
            row_count:  s.properties.gridProperties?.rowCount,
            col_count:  s.properties.gridProperties?.columnCount,
          })),
        });
      }

      // ── Column helpers (the n8n pattern) ──────────────────

      case "get_columns": {
        // Returns the header row — tells MAVIS what columns exist
        if (!sheetId) return json({ error: "spreadsheet_id required" }, 400);

        const range = `${sheetName}!1:1`;
        const data  = await sReq(`/${sheetId}/values/${encodeURIComponent(range)}`, token);
        const headers: string[] = data.values?.[0] ?? [];

        return json({
          spreadsheet_id: sheetId,
          sheet_name:     sheetName,
          columns:        headers.map((h, i) => ({ index: i, letter: colLetter(i), name: h })),
        });
      }

      case "get_column_values": {
        // Returns all values in a single column (by name or letter)
        if (!sheetId) return json({ error: "spreadsheet_id required" }, 400);
        const col    = body.column ?? "";  // header name or A/B/C letter
        const limit  = Math.min(Number(body.limit ?? 200), 1000);

        // First get headers to resolve column name → letter
        const headerData = await sReq(`/${sheetId}/values/${encodeURIComponent(`${sheetName}!1:1`)}`, token);
        const headers: string[] = headerData.values?.[0] ?? [];
        let colIdx: number;

        if (typeof col === "string" && /^[A-Za-z]+$/.test(col) && !headers.includes(col)) {
          colIdx = colIndex(col);
        } else {
          colIdx = headers.findIndex((h) => h.toLowerCase() === String(col).toLowerCase());
          if (colIdx === -1) return json({ error: `Column "${col}" not found. Available: ${headers.join(", ")}` }, 400);
        }

        const letter = colLetter(colIdx);
        const range  = `${sheetName}!${letter}2:${letter}${limit + 1}`;
        const data   = await sReq(`/${sheetId}/values/${encodeURIComponent(range)}`, token);
        const values = (data.values ?? []).flat().filter((v: string) => v !== "");

        return json({
          spreadsheet_id: sheetId,
          sheet_name:     sheetName,
          column:         headers[colIdx] ?? letter,
          letter,
          values,
          count:          values.length,
        });
      }

      case "get_row": {
        // Returns a single row as an object keyed by column headers
        if (!sheetId) return json({ error: "spreadsheet_id required" }, 400);
        const rowNum = Number(body.row_number ?? body.row ?? 2);  // 1-based; row 1 = headers

        const headerData = await sReq(`/${sheetId}/values/${encodeURIComponent(`${sheetName}!1:1`)}`, token);
        const headers: string[] = headerData.values?.[0] ?? [];

        const range  = `${sheetName}!${rowNum}:${rowNum}`;
        const data   = await sReq(`/${sheetId}/values/${encodeURIComponent(range)}`, token);
        const rowVals: string[] = data.values?.[0] ?? [];

        const row: Record<string, string> = {};
        headers.forEach((h, i) => { if (h) row[h] = rowVals[i] ?? ""; });

        return json({ spreadsheet_id: sheetId, sheet_name: sheetName, row_number: rowNum, row });
      }

      // ── Read ──────────────────────────────────────────────

      case "get_range": {
        if (!sheetId) return json({ error: "spreadsheet_id required" }, 400);
        const range = String(body.range ?? `${sheetName}!A1:Z100`);
        const data  = await sReq(`/${sheetId}/values/${encodeURIComponent(range)}`, token);
        return json({ spreadsheet_id: sheetId, range: data.range, values: data.values ?? [] });
      }

      case "batch_get": {
        if (!sheetId) return json({ error: "spreadsheet_id required" }, 400);
        const ranges: string[] = Array.isArray(body.ranges) ? body.ranges : [String(body.ranges ?? `${sheetName}!A1:Z10`)];
        const qs   = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
        const data = await sReq(`/${sheetId}/values:batchGet?${qs}`, token);
        return json({
          spreadsheet_id: sheetId,
          results: (data.valueRanges ?? []).map((vr: any) => ({
            range:  vr.range,
            values: vr.values ?? [],
          })),
        });
      }

      case "search_rows": {
        // Fetch all rows and filter where column = value
        if (!sheetId) return json({ error: "spreadsheet_id required" }, 400);
        const searchCol   = String(body.column ?? "");
        const searchVal   = String(body.value ?? "");
        const limit       = Math.min(Number(body.limit ?? 50), 500);
        const caseSensitive = Boolean(body.case_sensitive ?? false);

        const data   = await sReq(`/${sheetId}/values/${encodeURIComponent(`${sheetName}!A1:ZZ`)}`, token);
        const values: string[][] = data.values ?? [];
        if (values.length < 2) return json({ rows: [], count: 0 });

        const headers = values[0];
        const colIdx  = headers.findIndex((h) =>
          caseSensitive ? h === searchCol : h.toLowerCase() === searchCol.toLowerCase(),
        );
        if (colIdx === -1) return json({ error: `Column "${searchCol}" not found. Available: ${headers.join(", ")}` }, 400);

        const matches = values.slice(1)
          .map((row, i) => ({ rowNumber: i + 2, row }))
          .filter(({ row }) => {
            const cell = row[colIdx] ?? "";
            return caseSensitive
              ? cell === searchVal
              : cell.toLowerCase().includes(searchVal.toLowerCase());
          })
          .slice(0, limit)
          .map(({ rowNumber, row }) => {
            const obj: Record<string, string> = { _row_number: String(rowNumber) };
            headers.forEach((h, i) => { if (h) obj[h] = row[i] ?? ""; });
            return obj;
          });

        return json({ spreadsheet_id: sheetId, sheet_name: sheetName, rows: matches, count: matches.length });
      }

      // ── Write ─────────────────────────────────────────────

      case "append_row": {
        // Append a new row — pass values as array or object keyed by header name
        if (!sheetId) return json({ error: "spreadsheet_id required" }, 400);

        let rowValues: string[];

        if (Array.isArray(body.values)) {
          rowValues = body.values.map(String);
        } else if (body.values && typeof body.values === "object") {
          // Object keyed by column header — resolve order from headers
          const headerData = await sReq(`/${sheetId}/values/${encodeURIComponent(`${sheetName}!1:1`)}`, token);
          const headers: string[] = headerData.values?.[0] ?? [];
          rowValues = headers.map((h) => String((body.values as Record<string, unknown>)[h] ?? ""));
        } else {
          return json({ error: "values must be array or object keyed by column header" }, 400);
        }

        const range = `${sheetName}!A1`;
        const data  = await sReq(
          `/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=${body.raw ? "RAW" : "USER_ENTERED"}&insertDataOption=INSERT_ROWS`,
          token,
          "POST",
          { range, majorDimension: "ROWS", values: [rowValues] },
        );

        return json({
          spreadsheet_id:  sheetId,
          sheet_name:      sheetName,
          updated_range:   data.updates?.updatedRange,
          rows_appended:   data.updates?.updatedRows ?? 1,
        });
      }

      case "update_row": {
        // Update an existing row by row number
        if (!sheetId) return json({ error: "spreadsheet_id required" }, 400);
        const rowNum = Number(body.row_number ?? body.row ?? 2);

        let rowValues: string[];

        if (Array.isArray(body.values)) {
          rowValues = body.values.map(String);
        } else if (body.values && typeof body.values === "object") {
          const headerData = await sReq(`/${sheetId}/values/${encodeURIComponent(`${sheetName}!1:1`)}`, token);
          const headers: string[] = headerData.values?.[0] ?? [];
          rowValues = headers.map((h) => String((body.values as Record<string, unknown>)[h] ?? ""));
        } else {
          return json({ error: "values must be array or object keyed by column header" }, 400);
        }

        const range = `${sheetName}!A${rowNum}`;
        const data  = await sReq(
          `/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=${body.raw ? "RAW" : "USER_ENTERED"}`,
          token,
          "PUT",
          { range, majorDimension: "ROWS", values: [rowValues] },
        );

        return json({
          spreadsheet_id: sheetId,
          sheet_name:     sheetName,
          updated_range:  data.updatedRange,
          row_number:     rowNum,
        });
      }

      case "clear_range": {
        if (!sheetId) return json({ error: "spreadsheet_id required" }, 400);
        const range = String(body.range ?? `${sheetName}!A2:Z`);
        await sReq(`/${sheetId}/values/${encodeURIComponent(range)}:clear`, token, "POST");
        return json({ spreadsheet_id: sheetId, cleared_range: range });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: list_sheets | get_columns | get_column_values | get_row | search_rows | append_row | update_row | get_range | batch_get | clear_range`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-sheets-agent]", message);
    return json({ error: message }, message.includes("not connected") ? 503 : 500);
  }
});
