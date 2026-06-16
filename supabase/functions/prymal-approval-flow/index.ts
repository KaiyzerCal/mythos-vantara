// prymal-approval-flow — unified approval queue for all client-facing agent actions
//
// Three entry points:
//   POST /queue        — agent queues a draft for owner review
//   POST /notify       — (re)send approval request to owner (called by queue + cron)
//   POST /reply        — owner sends APPROVE / EDIT <new text> / REJECT
//   GET  /approve/:token — one-click approve link (sent in email)
//   GET  /reject/:token  — one-click reject link
//
// Owner receives SMS or email with:
//   - The draft content
//   - Reply APPROVE, EDIT <revised text>, or REJECT
//   - One-click links (email only)
//
// pg_cron re-notification: every 30 minutes, find pending items where
//   notified_at < now() - interval '4 hours' AND renotified_at IS NULL
//   and call /notify with renotify=true
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   RESEND_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL       = Deno.env.get("SUPABASE_URL")!;
const SB_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND       = Deno.env.get("RESEND_API_KEY") ?? "";
const TWILIO_SID   = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM  = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";
const FUNCTION_URL = Deno.env.get("SUPABASE_URL")?.replace("supabase.co", "supabase.co/functions/v1/prymal-approval-flow") ?? "";

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function html(body: string, status = 200) {
  return new Response(body, {
    status, headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
  });
}

// ── Twilio SMS ─────────────────────────────────────────────────────────────
async function sendSMS(to: string, message: string): Promise<boolean> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return false;
  const body = message.length > 1600 ? message.slice(0, 1560) + "…" : message;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
    },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }),
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}

// ── Resend email ───────────────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, htmlBody: string): Promise<boolean> {
  if (!RESEND) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND}` },
    body: JSON.stringify({ from: "approvals@prymalai.com", to, subject, html: htmlBody }),
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}

// ── Build approval notification ────────────────────────────────────────────
function buildSMSMessage(item: any, client: any, isRenotify: boolean): string {
  const prefix = isRenotify
    ? `⏰ REMINDER (4hr): Action still waiting for your approval.`
    : `📋 ${client.business_name} — Action needs your review:`;

  return `${prefix}

[${item.agent.toUpperCase()} → ${item.action_type}]
${item.draft_content.slice(0, 400)}${item.draft_content.length > 400 ? "…" : ""}

Reply:
APPROVE — send it
EDIT <your revised text> — use your version
REJECT — discard

Approval ID: ${item.id.slice(0, 8)}`;
}

function buildEmailHTML(item: any, client: any, isRenotify: boolean): { subject: string; html: string } {
  const approveUrl = `${FUNCTION_URL}/approve/${item.delivery_token}`;
  const rejectUrl  = `${FUNCTION_URL}/reject/${item.delivery_token}`;
  const subject = isRenotify
    ? `⏰ Reminder: Action awaiting your approval — ${client.business_name}`
    : `Action needs your review — ${client.business_name}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Georgia,serif;background:#0d1117;color:#eef2f7;padding:32px;max-width:600px;margin:0 auto;">
  ${isRenotify ? `<div style="background:#7c3aed22;border:1px solid #7c3aed44;border-radius:8px;padding:12px 16px;margin-bottom:24px;font-size:13px;color:#a78bfa;">⏰ This action has been waiting 4 hours for your approval.</div>` : ""}
  <p style="font-size:11px;letter-spacing:2px;color:#666;text-transform:uppercase;margin-bottom:8px;">PRYMAL AI · APPROVAL REQUEST</p>
  <h2 style="color:#fff;margin:0 0 4px;">${client.business_name}</h2>
  <p style="color:#666;font-size:13px;margin:0 0 24px;">${item.agent.toUpperCase()} → ${item.action_type}</p>

  <div style="margin-bottom:8px;font-size:11px;color:#666;letter-spacing:1px;text-transform:uppercase;">Action Summary</div>
  <p style="color:#ccc;font-size:14px;margin:0 0 24px;">${item.action_summary}</p>

  <div style="margin-bottom:8px;font-size:11px;color:#666;letter-spacing:1px;text-transform:uppercase;">Draft Content</div>
  <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:16px;font-size:14px;color:#e5e7eb;line-height:1.6;white-space:pre-wrap;margin-bottom:32px;">${item.draft_content}</div>

  <table style="width:100%;border-collapse:separate;border-spacing:8px;">
    <tr>
      <td><a href="${approveUrl}" style="display:block;background:#059669;color:#fff;text-align:center;padding:12px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">✓ APPROVE</a></td>
      <td><a href="${rejectUrl}" style="display:block;background:#7f1d1d;color:#fff;text-align:center;padding:12px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">✗ REJECT</a></td>
    </tr>
  </table>

  <p style="color:#4b5563;font-size:12px;margin-top:24px;text-align:center;">
    To edit: reply to this email with EDIT followed by your revised text.<br>
    Approval ID: <code style="color:#9ca3af;">${item.id}</code>
  </p>

  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #1f2937;font-size:11px;color:#4b5563;">
    PrymalAI · <a href="https://prymalai.com" style="color:#00c8ff;text-decoration:none;">prymalai.com</a>
  </div>
</body>
</html>`;

  return { subject, html };
}

// ── Execute approved action ────────────────────────────────────────────────
async function executeAction(item: any, overrideDraft?: string): Promise<{ ok: boolean; error?: string }> {
  const payload = { ...item.action_payload };
  // If owner edited, inject their version
  if (overrideDraft) {
    payload.content = overrideDraft;
    payload.body    = overrideDraft;
    payload.caption = overrideDraft;
    payload.message = overrideDraft;
  }

  // Route to the appropriate PrymalAI execution function
  const routeMap: Record<string, string> = {
    send_email:      "prymal-service-agent",
    send_sms:        "prymal-service-agent",
    publish_post:    "prymal-brand-agent",
    send_dm:         "prymal-service-agent",
    send_outreach:   "prymal-outreach-agent",
    reply_review:    "prymal-google-agent",
    post_gbp_update: "prymal-google-agent",
  };
  const targetFn = routeMap[item.action_type] ?? "prymal-service-agent";
  const fnUrl = `${SB_URL}/functions/v1/${targetFn}`;

  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SB_KEY}`,
    },
    body: JSON.stringify({ execute: true, item_id: item.id, payload, client_id: item.client_id }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    return { ok: false, error: err };
  }
  return { ok: true };
}

// ── Route handler ──────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url      = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // Strip function prefix: /prymal-approval-flow/...
  const route    = pathParts.slice(-2).join("/");  // e.g. "approve/abc123" or "queue"
  const action   = pathParts[pathParts.length - 2] || pathParts[pathParts.length - 1];
  const token    = pathParts[pathParts.length - 1];

  // ── GET /approve/:token ─────────────────────────────────────
  if (req.method === "GET" && action === "approve") {
    const { data: item } = await sb
      .from("prymal_approval_queue")
      .select("*, prymal_clients(*)")
      .eq("delivery_token", token)
      .single();

    if (!item) return html(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0d1117;color:#eef2f7;"><h2>Invalid or expired approval link.</h2></body></html>`, 404);
    if (item.status !== "pending") return html(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0d1117;color:#eef2f7;"><h2>This action was already ${item.status}.</h2></body></html>`, 200);

    await sb.from("prymal_approval_queue").update({ status: "executing", resolved_at: new Date().toISOString() }).eq("id", item.id);
    const result = await executeAction(item);
    const finalStatus = result.ok ? "executed" : "failed";
    await sb.from("prymal_approval_queue").update({ status: finalStatus, executed_at: new Date().toISOString(), error_msg: result.error ?? null }).eq("id", item.id);

    return html(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0d1117;color:#eef2f7;">
      <h2>${result.ok ? "✓ Approved and sent." : "❌ Execution failed."}</h2>
      <p style="color:#9ca3af;">${result.ok ? item.action_summary : result.error}</p>
    </body></html>`);
  }

  // ── GET /reject/:token ──────────────────────────────────────
  if (req.method === "GET" && action === "reject") {
    const { data: item } = await sb
      .from("prymal_approval_queue")
      .select("id, status, action_summary")
      .eq("delivery_token", token)
      .single();

    if (!item || item.status !== "pending") {
      return html(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0d1117;color:#eef2f7;"><h2>${!item ? "Invalid link." : `Already ${item.status}.`}</h2></body></html>`);
    }
    await sb.from("prymal_approval_queue").update({ status: "rejected", resolved_at: new Date().toISOString() }).eq("id", item.id);
    return html(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0d1117;color:#eef2f7;"><h2>✗ Rejected and discarded.</h2><p style="color:#9ca3af;">${item.action_summary}</p></body></html>`);
  }

  const body = await req.json().catch(() => ({}));

  // ── POST /queue ─────────────────────────────────────────────
  // Called by any agent to submit a draft for approval
  if (action === "queue" || (req.method === "POST" && pathParts.length === 1)) {
    const { client_id, agent, action_type, action_summary, action_payload, draft_content } = body;
    if (!client_id || !agent || !action_type || !draft_content) {
      return json({ error: "Missing required fields: client_id, agent, action_type, draft_content" }, 400);
    }

    const { data: item, error } = await sb
      .from("prymal_approval_queue")
      .insert({ client_id, agent, action_type, action_summary: action_summary ?? action_type, action_payload: action_payload ?? {}, draft_content })
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);

    // Immediately send notification
    const { data: client } = await sb.from("prymal_clients").select("owner_name, owner_email, owner_phone, delivery_channel, business_name").eq("id", client_id).single();
    if (client) {
      await notifyOwner(item, client, false);
      await sb.from("prymal_approval_queue").update({ notified_at: new Date().toISOString() }).eq("id", item.id);
    }

    return json({ ok: true, item_id: item.id, delivery_token: item.delivery_token });
  }

  // ── POST /reply — owner replies via SMS or email body ───────
  if (action === "reply") {
    const { item_id, reply_text, from_phone } = body;
    if (!item_id && !from_phone) return json({ error: "item_id or from_phone required" }, 400);

    // Find the pending item
    let query = sb.from("prymal_approval_queue").select("*, prymal_clients(owner_name, owner_email, owner_phone, delivery_channel, business_name)");
    if (item_id) query = query.eq("id", item_id);
    else {
      // Match by phone — find client with this phone, take their most recent pending item
      const { data: clientRow } = await sb.from("prymal_clients").select("id").eq("owner_phone", from_phone).single();
      if (!clientRow) return json({ error: "No client found for this phone number" }, 404);
      query = query.eq("client_id", clientRow.id).eq("status", "pending").order("created_at", { ascending: false }).limit(1);
    }
    const { data: items } = await query;
    const item = Array.isArray(items) ? items[0] : items;
    if (!item) return json({ error: "No pending item found" }, 404);
    if (item.status !== "pending") return json({ error: `Item already ${item.status}` }, 409);

    const text = String(reply_text ?? "").trim().toUpperCase();

    if (text === "APPROVE") {
      await sb.from("prymal_approval_queue").update({ status: "executing", resolved_at: new Date().toISOString() }).eq("id", item.id);
      const result = await executeAction(item);
      const finalStatus = result.ok ? "executed" : "failed";
      await sb.from("prymal_approval_queue").update({ status: finalStatus, executed_at: new Date().toISOString(), error_msg: result.error ?? null }).eq("id", item.id);
      if (from_phone && finalStatus === "executed") {
        await sendSMS(from_phone, `✓ Approved and executed. "${item.action_summary}"`);
      }
      return json({ ok: true, status: finalStatus });
    }

    if (text === "REJECT") {
      await sb.from("prymal_approval_queue").update({ status: "rejected", resolved_at: new Date().toISOString() }).eq("id", item.id);
      if (from_phone) await sendSMS(from_phone, `✗ Rejected and discarded. "${item.action_summary}"`);
      return json({ ok: true, status: "rejected" });
    }

    if (text.startsWith("EDIT ")) {
      const editedContent = reply_text.slice(5).trim();  // preserve original case
      await sb.from("prymal_approval_queue").update({ status: "executing", owner_edit: editedContent, resolved_at: new Date().toISOString() }).eq("id", item.id);
      const result = await executeAction(item, editedContent);
      const finalStatus = result.ok ? "executed" : "failed";
      await sb.from("prymal_approval_queue").update({ status: finalStatus, executed_at: new Date().toISOString(), error_msg: result.error ?? null }).eq("id", item.id);
      if (from_phone) await sendSMS(from_phone, `✓ Sent with your edits. "${item.action_summary}"`);
      return json({ ok: true, status: finalStatus, used_edit: true });
    }

    return json({
      error: "Reply must be APPROVE, REJECT, or EDIT <your revised text>",
      hint: "Example: EDIT Hi there, thanks for reaching out! We'd love to help...",
    }, 400);
  }

  // ── POST /renotify — called by pg_cron every 30 min ─────────
  if (action === "renotify") {
    const fourHoursAgo = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
    const { data: stale } = await sb
      .from("prymal_approval_queue")
      .select("*, prymal_clients(owner_name, owner_email, owner_phone, delivery_channel, business_name)")
      .eq("status", "pending")
      .lt("notified_at", fourHoursAgo)
      .is("renotified_at", null)
      .limit(50);

    const renotified: string[] = [];
    for (const item of stale ?? []) {
      if (!item.prymal_clients) continue;
      await notifyOwner(item, item.prymal_clients, true);
      await sb.from("prymal_approval_queue").update({ renotified_at: new Date().toISOString() }).eq("id", item.id);
      renotified.push(item.id);
    }
    return json({ ok: true, renotified: renotified.length });
  }

  return json({ error: "Unknown route" }, 404);
});

// ── Notification dispatcher ────────────────────────────────────────────────
async function notifyOwner(item: any, client: any, isRenotify: boolean): Promise<void> {
  const channel = client.delivery_channel ?? "email";

  if ((channel === "sms" || channel === "both") && client.owner_phone) {
    await sendSMS(client.owner_phone, buildSMSMessage(item, client, isRenotify));
  }

  if ((channel === "email" || channel === "both") && client.owner_email) {
    const { subject, html: htmlBody } = buildEmailHTML(item, client, isRenotify);
    await sendEmail(client.owner_email, subject, htmlBody);
  }
}

