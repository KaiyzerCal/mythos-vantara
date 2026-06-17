// mavis-airtable-agent
// Read/write Airtable records across any base and table.
// Requires: AIRTABLE_API_KEY (Personal Access Token — pat...)
//
// Actions: list_records | create_record | update_record | delete_record | search_records | list_bases

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AT_KEY    = Deno.env.get("AIRTABLE_API_KEY") ?? "";
const AT_API    = "https://api.airtable.com/v0";
const AT_META   = "https://api.airtable.com/v0/meta";

function requireAirtable() {
  if (!AT_KEY) throw new Error("Airtable not configured. Set AIRTABLE_API_KEY in Supabase secrets.");
}

async function atReq(path: string, method = "GET", body?: unknown): Promise<any> {
  requireAirtable();
  const res = await fetch(`${AT_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${AT_KEY}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Airtable API error (${res.status}): ${JSON.stringify(data.error ?? data).slice(0, 200)}`);
  return data;
}

async function atMetaReq(path: string): Promise<any> {
  requireAirtable();
  const res = await fetch(`${AT_META}${path}`, {
    headers: { "Authorization": `Bearer ${AT_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Airtable Meta API error (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // base_id and table are required for most record actions
    const baseId = String(body.base_id ?? body.base ?? "");
    const table  = encodeURIComponent(String(body.table ?? body.table_name ?? ""));

    switch (action) {
      case "list_bases": {
        const result = await atMetaReq("/bases");
        return json({
          bases: (result.bases as any[]).map(b => ({ id: b.id, name: b.name, permission: b.permissionLevel })),
        });
      }

      case "list_records": {
        if (!baseId || !table) return json({ error: "base_id and table required" }, 400);
        const max     = Math.min(Number(body.max_records ?? 100), 100);
        const view    = body.view    ? `&view=${encodeURIComponent(String(body.view))}`   : "";
        const formula = body.formula ? `&filterByFormula=${encodeURIComponent(String(body.formula))}` : "";
        const fields  = body.fields  ? `&${(body.fields as string[]).map(f => `fields[]=${encodeURIComponent(f)}`).join("&")}` : "";
        const sort    = body.sort_field
          ? `&sort[0][field]=${encodeURIComponent(String(body.sort_field))}&sort[0][direction]=${body.sort_dir ?? "asc"}`
          : "";

        const result = await atReq(`/${baseId}/${table}?maxRecords=${max}${view}${formula}${fields}${sort}`);
        return json({ records: result.records, offset: result.offset });
      }

      case "search_records": {
        if (!baseId || !table) return json({ error: "base_id and table required" }, 400);
        const term  = String(body.term ?? body.query ?? "");
        const field = body.field ? String(body.field) : null;
        if (!term) return json({ error: "term required" }, 400);

        const formula = field
          ? `SEARCH("${term.replace(/"/g, '\\"')}", {${field}})`
          : `OR(${["Name","Title","Email","Notes"].map(f => `SEARCH("${term.replace(/"/g, '\\"')}", {${f}})`).join(",")})`;

        const result = await atReq(
          `/${baseId}/${table}?maxRecords=25&filterByFormula=${encodeURIComponent(formula)}`
        );
        return json({ records: result.records, count: result.records?.length ?? 0 });
      }

      case "create_record": {
        if (!baseId || !table) return json({ error: "base_id and table required" }, 400);
        const fields = (body.fields ?? body.data) as Record<string, unknown>;
        if (!fields) return json({ error: "fields required" }, 400);

        // Support creating multiple records at once
        const recordsPayload = Array.isArray(body.records)
          ? body.records
          : [{ fields }];

        const result = await atReq(`/${baseId}/${table}`, "POST", { records: recordsPayload });
        return json({ records: result.records, count: result.records?.length ?? 0 });
      }

      case "update_record": {
        if (!baseId || !table) return json({ error: "base_id and table required" }, 400);
        const recordId = String(body.record_id ?? body.id ?? "");
        const fields   = (body.fields ?? body.data) as Record<string, unknown>;
        if (!recordId || !fields) return json({ error: "record_id and fields required" }, 400);

        // PATCH = partial update (preserves unset fields); PUT = replace
        const method = body.replace ? "PUT" : "PATCH";
        const result = await atReq(`/${baseId}/${table}/${recordId}`, method, { fields });
        return json({ id: result.id, fields: result.fields });
      }

      case "delete_record": {
        if (!baseId || !table) return json({ error: "base_id and table required" }, 400);
        const recordId = String(body.record_id ?? body.id ?? "");
        if (!recordId) return json({ error: "record_id required" }, 400);

        const result = await atReq(`/${baseId}/${table}/${recordId}`, "DELETE");
        return json({ deleted: result.deleted, id: result.id });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: list_bases | list_records | search_records | create_record | update_record | delete_record`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-airtable-agent]", message);
    const status = message.includes("not configured") ? 503 : 500;
    return json({ error: message }, status);
  }
});
