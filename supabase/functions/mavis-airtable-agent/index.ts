// mavis-airtable-agent
// Read/write Airtable records across any base and table.
// Requires: AIRTABLE_API_KEY (Personal Access Token — pat...)
//           ANTHROPIC_API_KEY (for enrich_record AI enrichment)
//
// Actions: list_records | get_record | create_record | update_record | delete_record
//          search_records | list_bases | enrich_record

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AT_KEY        = Deno.env.get("AIRTABLE_API_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
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

async function callClaude(system: string, user: string, model = "claude-haiku-4-5-20251001", maxTokens = 512): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude API error: ${JSON.stringify(data?.error).slice(0, 200)}`);
  return data.content?.[0]?.text ?? "";
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

      case "get_record": {
        if (!baseId || !table) return json({ error: "base_id and table required" }, 400);
        const recordId = String(body.record_id ?? body.id ?? "");
        if (!recordId) return json({ error: "record_id required" }, 400);
        const result = await atReq(`/${baseId}/${table}/${recordId}`);
        return json({ id: result.id, created_time: result.createdTime, fields: result.fields });
      }

      case "delete_record": {
        if (!baseId || !table) return json({ error: "base_id and table required" }, 400);
        const recordId = String(body.record_id ?? body.id ?? "");
        if (!recordId) return json({ error: "record_id required" }, 400);

        const result = await atReq(`/${baseId}/${table}/${recordId}`, "DELETE");
        return json({ deleted: result.deleted, id: result.id });
      }

      case "enrich_record": {
        // Webhook → get record → Claude enrichment → write result back.
        // Mirrors Make.com: webhook → ActionGetRecord → AI → ActionUpdateRecord.
        if (!baseId || !table) return json({ error: "base_id and table required" }, 400);
        const recordId    = String(body.record_id ?? body.id ?? "");
        const prompt      = String(body.prompt ?? "Analyze this record and provide a concise summary and insights.");
        const outputField = String(body.output_field ?? "AI_Output");
        const model       = String(body.model ?? "claude-haiku-4-5-20251001");
        const maxTokens   = Math.min(Number(body.max_tokens ?? 512), 2048);
        if (!recordId) return json({ error: "record_id required" }, 400);

        // 1. Fetch record
        const record  = await atReq(`/${baseId}/${table}/${recordId}`);
        const fields  = record.fields ?? {};
        const context = Object.entries(fields)
          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
          .join("\n");

        // 2. AI enrichment
        const aiOutput = await callClaude(prompt, `Record data:\n${context}`, model, maxTokens);

        // 3. Write result back
        const updated = await atReq(`/${baseId}/${table}/${recordId}`, "PATCH", {
          fields: { [outputField]: aiOutput },
        });

        return json({
          record_id:     recordId,
          output_field:  outputField,
          ai_output:     aiOutput,
          ai_preview:    aiOutput.slice(0, 200),
          updated_id:    updated.id,
          source_fields: fields,
        });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: list_bases | list_records | get_record | search_records | create_record | update_record | delete_record | enrich_record`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-airtable-agent]", message);
    const status = message.includes("not configured") ? 503 : 500;
    return json({ error: message }, status);
  }
});
