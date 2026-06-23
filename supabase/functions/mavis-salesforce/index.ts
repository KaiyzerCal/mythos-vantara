// mavis-salesforce
// Salesforce CRM integration for MAVIS — OAuth2 + SOQL/SOSL + full record CRUD.
// Actions: get_auth_url | exchange_code | query | search | get_record |
//          create_record | update_record | log_activity | get_crm_context

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL   = Deno.env.get("SUPABASE_URL")!;
const SB_SRK   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SF_ID    = Deno.env.get("SALESFORCE_CLIENT_ID")!;
const SF_SEC   = Deno.env.get("SALESFORCE_CLIENT_SECRET")!;
const SF_CB    = Deno.env.get("SALESFORCE_REDIRECT_URI") ?? "https://app.mythosvantara.com/oauth/salesforce/callback";

const SF_AUTH  = "https://login.salesforce.com/services/oauth2";
const SF_VER   = "v59.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Token helpers ────────────────────────────────────────────────────────────

interface SFTokenRow {
  access_token:  string;
  refresh_token: string;
  instance_url:  string;
  expires_at:    number;
}

async function storeTokens(
  sb: ReturnType<typeof createClient>,
  userId: string,
  tokens: { access_token: string; refresh_token?: string; instance_url: string; expires_in?: number },
  existingRefresh?: string,
): Promise<void> {
  await sb.from("mavis_oauth_tokens").upsert(
    {
      user_id:       userId,
      provider:      "salesforce",
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token ?? existingRefresh ?? null,
      instance_url:  tokens.instance_url,
      expires_at:    Date.now() + (tokens.expires_in ?? 7200) * 1000,
      updated_at:    new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
}

async function refreshSFToken(
  sb: ReturnType<typeof createClient>,
  userId: string,
  row: SFTokenRow,
): Promise<string> {
  const res = await fetch(`${SF_AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     SF_ID,
      client_secret: SF_SEC,
      refresh_token: row.refresh_token,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Salesforce token refresh failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const tokens = await res.json();
  await storeTokens(sb, userId, { ...tokens, instance_url: tokens.instance_url ?? row.instance_url }, row.refresh_token);
  return tokens.access_token as string;
}

async function getSFToken(sb: ReturnType<typeof createClient>, userId: string): Promise<{ token: string; instance_url: string }> {
  const { data, error } = await sb
    .from("mavis_oauth_tokens")
    .select("access_token, refresh_token, instance_url, expires_at")
    .eq("user_id", userId)
    .eq("provider", "salesforce")
    .single();

  if (error || !data?.access_token) {
    throw new Error("Salesforce account not connected. Use get_auth_url to link your Salesforce account.");
  }

  const row = data as SFTokenRow;

  if (typeof row.expires_at === "number" && row.expires_at > Date.now() + 60_000) {
    return { token: row.access_token, instance_url: row.instance_url };
  }

  const token = await refreshSFToken(sb, userId, row);
  return { token, instance_url: row.instance_url };
}

// ── Salesforce API request ───────────────────────────────────────────────────

async function sfReq(
  token: string,
  instanceUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${instanceUrl}/services/data/${SF_VER}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 204) return { ok: true, status: 204, data: null };
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function sfError(r: { status: number; data: unknown }): Error {
  const detail = Array.isArray(r.data)
    ? (r.data[0] as Record<string, unknown>)?.message ?? JSON.stringify(r.data).slice(0, 300)
    : JSON.stringify(r.data).slice(0, 300);
  return new Error(`Salesforce error (${r.status}): ${detail}`);
}

// ── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const userId = String(body.userId ?? "");

    const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

    switch (action) {

      // ── AUTH URL ───────────────────────────────────────────────────────────
      case "get_auth_url": {
        if (!userId) return json({ error: "userId required" }, 400);

        const params = new URLSearchParams({
          response_type: "code",
          client_id:     SF_ID,
          redirect_uri:  SF_CB,
          scope:         "api refresh_token offline_access",
          state:         userId,
        });
        const auth_url = `${SF_AUTH}/authorize?${params}`;
        return json({ ok: true, auth_url });
      }

      // ── EXCHANGE CODE ──────────────────────────────────────────────────────
      case "exchange_code": {
        const code = String(body.code ?? "");
        if (!code)   return json({ error: "code required" }, 400);
        if (!userId) return json({ error: "userId required" }, 400);

        const res = await fetch(`${SF_AUTH}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type:    "authorization_code",
            client_id:     SF_ID,
            client_secret: SF_SEC,
            redirect_uri:  SF_CB,
            code,
          }),
          signal: AbortSignal.timeout(20_000),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          return json({ error: `Token exchange failed (${res.status}): ${detail.slice(0, 200)}` }, 502);
        }

        const tokens = await res.json();
        await storeTokens(sb, userId, tokens);
        return json({ ok: true, instance_url: tokens.instance_url });
      }

      // ── SOQL QUERY ─────────────────────────────────────────────────────────
      case "query": {
        if (!userId)      return json({ error: "userId required" }, 400);
        const soql = String(body.soql ?? "");
        if (!soql)        return json({ error: "soql required" }, 400);

        const { token, instance_url } = await getSFToken(sb, userId);
        const r = await sfReq(token, instance_url, "GET", `query?q=${encodeURIComponent(soql)}`);
        if (!r.ok) throw sfError(r);

        const d = r.data as Record<string, unknown>;
        return json({ ok: true, records: d.records, totalSize: d.totalSize, done: d.done });
      }

      // ── SOSL SEARCH ────────────────────────────────────────────────────────
      case "search": {
        if (!userId)       return json({ error: "userId required" }, 400);
        const term = String(body.term ?? body.query ?? "");
        if (!term)         return json({ error: "term required" }, 400);

        const sosl = `FIND {${term}} IN ALL FIELDS RETURNING Contact(Id,Name,Email,Account.Name),Account(Id,Name,Industry),Opportunity(Id,Name,StageName)`;
        const { token, instance_url } = await getSFToken(sb, userId);
        const r = await sfReq(token, instance_url, "GET", `search?q=${encodeURIComponent(sosl)}`);
        if (!r.ok) throw sfError(r);

        const d = r.data as Record<string, unknown>;
        return json({ ok: true, searchRecords: d.searchRecords });
      }

      // ── GET RECORD ─────────────────────────────────────────────────────────
      case "get_record": {
        if (!userId) return json({ error: "userId required" }, 400);
        const object_type = String(body.object_type ?? "");
        const record_id   = String(body.record_id ?? "");
        if (!object_type) return json({ error: "object_type required" }, 400);
        if (!record_id)   return json({ error: "record_id required" }, 400);

        const { token, instance_url } = await getSFToken(sb, userId);
        const r = await sfReq(token, instance_url, "GET", `sobjects/${object_type}/${record_id}`);
        if (!r.ok) throw sfError(r);
        return json({ ok: true, record: r.data });
      }

      // ── CREATE RECORD ──────────────────────────────────────────────────────
      case "create_record": {
        if (!userId) return json({ error: "userId required" }, 400);
        const object_type = String(body.object_type ?? "");
        const fields      = body.fields as Record<string, unknown> | undefined;
        if (!object_type) return json({ error: "object_type required" }, 400);
        if (!fields)      return json({ error: "fields required" }, 400);

        const { token, instance_url } = await getSFToken(sb, userId);
        const r = await sfReq(token, instance_url, "POST", `sobjects/${object_type}`, fields);
        if (!r.ok) throw sfError(r);
        const d = r.data as Record<string, unknown>;
        return json({ ok: true, id: d.id, success: d.success });
      }

      // ── UPDATE RECORD ──────────────────────────────────────────────────────
      case "update_record": {
        if (!userId) return json({ error: "userId required" }, 400);
        const object_type = String(body.object_type ?? "");
        const record_id   = String(body.record_id ?? "");
        const fields      = body.fields as Record<string, unknown> | undefined;
        if (!object_type) return json({ error: "object_type required" }, 400);
        if (!record_id)   return json({ error: "record_id required" }, 400);
        if (!fields)      return json({ error: "fields required" }, 400);

        const { token, instance_url } = await getSFToken(sb, userId);
        const r = await sfReq(token, instance_url, "PATCH", `sobjects/${object_type}/${record_id}`, fields);
        if (!r.ok) throw sfError(r);
        return json({ ok: true, updated: true });
      }

      // ── LOG ACTIVITY (Task) ────────────────────────────────────────────────
      case "log_activity": {
        if (!userId) return json({ error: "userId required" }, 400);
        const subject = String(body.subject ?? "");
        if (!subject) return json({ error: "subject required" }, 400);

        const taskFields: Record<string, unknown> = {
          Subject:      subject,
          Status:       "Completed",
          Type:         body.type ?? "Call",
        };
        if (body.description)   taskFields.Description  = String(body.description);
        if (body.contact_id)    taskFields.WhoId        = String(body.contact_id);
        if (body.account_id)    taskFields.WhatId       = String(body.account_id);
        if (body.activity_date) taskFields.ActivityDate = String(body.activity_date);

        const { token, instance_url } = await getSFToken(sb, userId);
        const r = await sfReq(token, instance_url, "POST", "sobjects/Task", taskFields);
        if (!r.ok) throw sfError(r);
        const d = r.data as Record<string, unknown>;
        return json({ ok: true, task_id: d.id });
      }

      // ── CRM CONTEXT ────────────────────────────────────────────────────────
      case "get_crm_context": {
        if (!userId) return json({ error: "userId required" }, 400);
        const { name, email, account_name } = body as { name?: string; email?: string; account_name?: string };
        if (!name && !email && !account_name) {
          return json({ error: "At least one of name, email, or account_name required" }, 400);
        }

        const { token, instance_url } = await getSFToken(sb, userId);

        const runSOQL = async (soql: string) => {
          const r = await sfReq(token, instance_url, "GET", `query?q=${encodeURIComponent(soql)}`);
          if (!r.ok) throw sfError(r);
          return ((r.data as Record<string, unknown>).records ?? []) as Record<string, unknown>[];
        };

        // 1. Find contact
        let contactRecords: Record<string, unknown>[];
        if (email) {
          contactRecords = await runSOQL(
            `SELECT Id,Name,Email,Phone,Title,AccountId,Account.Name,LastActivityDate FROM Contact WHERE Email = '${email.replace(/'/g, "\\'")}' LIMIT 1`,
          );
        } else if (name) {
          const safeName = name.replace(/'/g, "\\'");
          contactRecords = await runSOQL(
            `SELECT Id,Name,Email,Phone,Title,AccountId,Account.Name,LastActivityDate FROM Contact WHERE Name LIKE '%${safeName}%' LIMIT 1`,
          );
        } else {
          contactRecords = [];
        }

        const contact = contactRecords[0] ?? null;
        const contactId  = contact ? String(contact.Id) : null;
        const accountId  = contact
          ? String(contact.AccountId ?? "")
          : null;

        // 2. Find account directly if no contact found or account_name provided
        let account: Record<string, unknown> | null = null;
        if (accountId) {
          const rows = await runSOQL(
            `SELECT Id,Name,Industry,Phone,Website,BillingCity,BillingCountry,NumberOfEmployees,AnnualRevenue FROM Account WHERE Id = '${accountId}' LIMIT 1`,
          );
          account = rows[0] ?? null;
        } else if (account_name) {
          const safeAcct = account_name.replace(/'/g, "\\'");
          const rows = await runSOQL(
            `SELECT Id,Name,Industry,Phone,Website,BillingCity,BillingCountry,NumberOfEmployees,AnnualRevenue FROM Account WHERE Name LIKE '%${safeAcct}%' LIMIT 1`,
          );
          account = rows[0] ?? null;
        }

        const resolvedAccountId = accountId ?? (account ? String(account.Id) : null);

        // 3. Open opportunities
        let open_opportunities: Record<string, unknown>[] = [];
        if (resolvedAccountId) {
          open_opportunities = await runSOQL(
            `SELECT Id,Name,StageName,Amount,CloseDate FROM Opportunity WHERE AccountId = '${resolvedAccountId}' AND IsClosed = false ORDER BY CloseDate ASC LIMIT 5`,
          );
        }

        // 4. Recent tasks
        let recent_activities: Record<string, unknown>[] = [];
        if (contactId) {
          recent_activities = await runSOQL(
            `SELECT Id,Subject,Description,Type,ActivityDate FROM Task WHERE WhoId = '${contactId}' ORDER BY ActivityDate DESC LIMIT 5`,
          );
        }

        // 5. Build summary text
        const parts: string[] = [];

        if (contact) {
          const title   = contact.Title ? ` (${contact.Title})` : "";
          const acctStr = (contact.Account as Record<string, unknown> | null)?.Name ?? account?.Name ?? "";
          parts.push(`Contact: ${contact.Name}${title}${acctStr ? ` at ${acctStr}` : ""}, email: ${contact.Email ?? "unknown"}.`);
        } else if (account) {
          parts.push(`Account: ${account.Name}${account.Industry ? ` — ${account.Industry}` : ""}.`);
        }

        if (open_opportunities.length > 0) {
          const oppList = open_opportunities
            .map((o) => `${o.Name} (${o.StageName}${o.Amount ? `, $${Number(o.Amount).toLocaleString()}` : ""})`)
            .join("; ");
          parts.push(`${open_opportunities.length} open opportunity(ies): ${oppList}.`);
        } else {
          parts.push("No open opportunities.");
        }

        if (recent_activities.length > 0) {
          const latest = recent_activities[0];
          parts.push(`Last logged activity: "${latest.Subject}" on ${latest.ActivityDate ?? "unknown date"}.`);
        }

        const summary_text = parts.join(" ");

        return json({
          ok: true,
          contact,
          account,
          open_opportunities,
          recent_activities,
          summary_text,
        });
      }

      default:
        return json(
          {
            error: `Unknown action: ${action}. Use: get_auth_url | exchange_code | query | search | get_record | create_record | update_record | log_activity | get_crm_context`,
          },
          400,
        );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-salesforce]", message);
    const status = message.includes("not connected") ? 409
      : message.includes("not configured")           ? 503
      : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
