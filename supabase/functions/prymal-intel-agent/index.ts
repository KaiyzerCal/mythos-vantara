// prymal-intel-agent — Monday morning business intelligence briefing
// Pulls last 7 days of data from connected sources, synthesizes via Claude,
// flags threshold crossings, delivers via email or SMS.
//
// Trigger: pg_cron every Monday at 08:00 local (13:00 UTC for US Eastern)
//   select cron.schedule('prymal-intel-weekly', '0 13 * * 1',
//     $$select net.http_post('https://fjkkcrmhptrzobajjsqg.supabase.co/functions/v1/prymal-intel-agent',
//       '{"trigger":"cron"}', '{"Content-Type":"application/json","Authorization":"Bearer <service_role>"}')$$);
//
// Required Supabase secrets (set in Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY
//   RESEND_API_KEY            — for email delivery
//   TWILIO_ACCOUNT_SID        — for SMS delivery (optional)
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER
//   GA4_PROPERTY_ID           — Google Analytics 4 property ID (optional)
//   GOOGLE_OAUTH_CLIENT_ID    — Google OAuth app credentials (optional)
//   GOOGLE_OAUTH_CLIENT_SECRET

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLAUDE  = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const RESEND  = Deno.env.get("RESEND_API_KEY") ?? "";
const TWILIO_SID   = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM  = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";
const GA4_PROPERTY = Deno.env.get("GA4_PROPERTY_ID") ?? "";
const G_CLIENT_ID  = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const G_CLIENT_SEC = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Threshold defaults ─────────────────────────────────────────────────────
// Overridable per client in prymal_client_settings.intel_thresholds
const DEFAULT_THRESHOLDS = {
  email_response_rate_min: 0.20,       // alert if <20% of emails get replies
  new_leads_min_weekly: 3,             // alert if fewer than 3 new contacts this week
  website_sessions_drop_pct: 0.25,     // alert if sessions drop >25% week-over-week
  google_reviews_new_min: 1,           // alert if no new Google reviews this week
  social_posts_min_weekly: 3,          // alert if fewer than 3 posts scheduled/sent
  unanswered_messages_max: 5,          // alert if >5 unanswered inbound messages
  approval_queue_max: 10,              // alert if >10 items pending approval
};

// ── Claude synthesis ───────────────────────────────────────────────────────
async function callClaude(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.content?.[0]?.text ?? "";
}

// ── Google OAuth token refresh ─────────────────────────────────────────────
async function refreshGoogleToken(clientId: string): Promise<string | null> {
  const { data } = await sb
    .from("prymal_client_integrations")
    .select("config")
    .eq("client_id", clientId)
    .eq("provider", "google")
    .single();
  if (!data?.config?.refresh_token) return null;
  const cfg = data.config;
  // Return existing token if not expiring in next 5 min
  if (cfg.expires_at && cfg.expires_at > Date.now() / 1000 + 300) return cfg.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: G_CLIENT_ID || cfg.client_id,
      client_secret: G_CLIENT_SEC || cfg.client_secret,
      refresh_token: cfg.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const d = await res.json();
  if (!d.access_token) return null;
  const newCfg = { ...cfg, access_token: d.access_token, expires_at: Math.floor(Date.now() / 1000) + (d.expires_in ?? 3600) };
  await sb.from("prymal_client_integrations").update({ config: newCfg }).eq("client_id", clientId).eq("provider", "google");
  return d.access_token;
}

// ── Data source: GA4 website sessions ─────────────────────────────────────
async function fetchGA4Stats(clientId: string, accessToken: string): Promise<{ sessions: number; prevSessions: number; topPages: string[] } | null> {
  if (!GA4_PROPERTY) return null;
  const now = new Date();
  const thisWeekStart = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const prevWeekStart = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
  const prevWeekEnd   = new Date(now.getTime() - 8 * 86400000).toISOString().slice(0, 10);

  async function runReport(startDate: string, endDate: string) {
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY}:runReport`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 5,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return null;
    return res.json();
  }

  const [thisWeek, prevWeek] = await Promise.all([
    runReport(thisWeekStart, "today"),
    runReport(prevWeekStart, prevWeekEnd),
  ]);
  if (!thisWeek) return null;

  const sessions = thisWeek.rows?.reduce((s: number, r: any) => s + parseInt(r.metricValues?.[0]?.value ?? "0"), 0) ?? 0;
  const prevSessions = prevWeek?.rows?.reduce((s: number, r: any) => s + parseInt(r.metricValues?.[0]?.value ?? "0"), 0) ?? 0;
  const topPages = (thisWeek.rows ?? []).slice(0, 3).map((r: any) => r.dimensionValues?.[0]?.value ?? "");

  return { sessions, prevSessions, topPages };
}

// ── Data source: Gmail inbox summary ──────────────────────────────────────
async function fetchGmailStats(accessToken: string): Promise<{ received: number; unread: number; responded: number } | null> {
  const sevenDaysAgo = Math.floor((Date.now() - 7 * 86400000) / 1000);
  try {
    // Count messages received this week
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=after:${sevenDaysAgo}&maxResults=100`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) }
    );
    const listData = await listRes.json();
    const received = listData.resultSizeEstimate ?? (listData.messages?.length ?? 0);

    const unreadRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread after:${sevenDaysAgo}&maxResults=100`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) }
    );
    const unreadData = await unreadRes.json();
    const unread = unreadData.resultSizeEstimate ?? (unreadData.messages?.length ?? 0);

    const sentRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:sent after:${sevenDaysAgo}&maxResults=100`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) }
    );
    const sentData = await sentRes.json();
    const responded = sentData.resultSizeEstimate ?? (sentData.messages?.length ?? 0);

    return { received, unread, responded };
  } catch {
    return null;
  }
}

// ── Data source: Supabase internal (prymal client tables) ─────────────────
async function fetchInternalStats(clientId: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [approvalsRes, messagesRes, postsRes, newContactsRes] = await Promise.all([
    // Pending approval queue
    sb.from("prymal_approval_queue")
      .select("id, action_type, created_at", { count: "exact" })
      .eq("client_id", clientId)
      .eq("status", "pending"),

    // Inbound messages awaiting response
    sb.from("prymal_inbound_messages")
      .select("id, channel, created_at", { count: "exact" })
      .eq("client_id", clientId)
      .eq("status", "pending")
      .gte("created_at", sevenDaysAgo),

    // Social posts published this week
    sb.from("prymal_social_posts")
      .select("id, platform, status, published_at", { count: "exact" })
      .eq("client_id", clientId)
      .eq("status", "published")
      .gte("published_at", sevenDaysAgo),

    // New contacts/leads captured this week
    sb.from("prymal_contacts")
      .select("id, source, created_at", { count: "exact" })
      .eq("client_id", clientId)
      .gte("created_at", sevenDaysAgo),
  ]);

  return {
    pendingApprovals: approvalsRes.count ?? 0,
    unansweredMessages: messagesRes.count ?? 0,
    postsPublished: postsRes.count ?? 0,
    newLeads: newContactsRes.count ?? 0,
    postsByPlatform: (postsRes.data ?? []).reduce((acc: Record<string, number>, p: any) => {
      acc[p.platform] = (acc[p.platform] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

// ── Threshold checker ──────────────────────────────────────────────────────
function checkThresholds(data: {
  ga4: { sessions: number; prevSessions: number } | null;
  gmail: { received: number; unread: number; responded: number } | null;
  internal: { pendingApprovals: number; unansweredMessages: number; postsPublished: number; newLeads: number };
}, thresholds: typeof DEFAULT_THRESHOLDS): string[] {
  const flags: string[] = [];

  if (data.ga4) {
    const { sessions, prevSessions } = data.ga4;
    if (prevSessions > 0 && sessions < prevSessions * (1 - thresholds.website_sessions_drop_pct)) {
      const drop = Math.round(((prevSessions - sessions) / prevSessions) * 100);
      flags.push(`⚠️ Website traffic dropped ${drop}% vs last week (${sessions} vs ${prevSessions} sessions)`);
    }
  }

  if (data.gmail) {
    const { received, unread, responded } = data.gmail;
    if (received > 0) {
      const responseRate = responded / received;
      if (responseRate < thresholds.email_response_rate_min) {
        flags.push(`⚠️ Email response rate is ${Math.round(responseRate * 100)}% — below ${Math.round(thresholds.email_response_rate_min * 100)}% target`);
      }
    }
  }

  if (data.internal.newLeads < thresholds.new_leads_min_weekly) {
    flags.push(`⚠️ Only ${data.internal.newLeads} new leads this week — target is ${thresholds.new_leads_min_weekly}`);
  }

  if (data.internal.postsPublished < thresholds.social_posts_min_weekly) {
    flags.push(`⚠️ Only ${data.internal.postsPublished} social posts published — target is ${thresholds.social_posts_min_weekly}/week`);
  }

  if (data.internal.unansweredMessages > thresholds.unanswered_messages_max) {
    flags.push(`🚨 ${data.internal.unansweredMessages} unanswered inbound messages — exceeds ${thresholds.unanswered_messages_max} threshold`);
  }

  if (data.internal.pendingApprovals > thresholds.approval_queue_max) {
    flags.push(`🚨 ${data.internal.pendingApprovals} items sitting in your approval queue`);
  }

  return flags;
}

// ── Briefing synthesis ─────────────────────────────────────────────────────
async function generateBriefing(
  client: { business_name: string; owner_name: string },
  data: {
    ga4: { sessions: number; prevSessions: number; topPages: string[] } | null;
    gmail: { received: number; unread: number; responded: number } | null;
    internal: { pendingApprovals: number; unansweredMessages: number; postsPublished: number; newLeads: number; postsByPlatform: Record<string, number> };
  },
  flags: string[],
  weekOf: string,
): Promise<string> {
  const dataBlock = JSON.stringify({
    ga4_sessions_this_week: data.ga4?.sessions ?? "not connected",
    ga4_sessions_last_week: data.ga4?.prevSessions ?? "not connected",
    ga4_top_pages: data.ga4?.topPages ?? [],
    emails_received: data.gmail?.received ?? "not connected",
    emails_unread: data.gmail?.unread ?? "not connected",
    emails_sent: data.gmail?.responded ?? "not connected",
    new_leads_this_week: data.internal.newLeads,
    social_posts_published: data.internal.postsPublished,
    posts_by_platform: data.internal.postsByPlatform,
    messages_awaiting_response: data.internal.unansweredMessages,
    items_in_approval_queue: data.internal.pendingApprovals,
    alerts: flags,
  }, null, 2);

  const system = `You write Monday morning business briefings for small business owners. Plain language only — no jargon, no fluff. Under 380 words. Structure: opening line with the week summary, then three sections: MOMENTUM (what's working), WATCH (numbers that need attention), ACTION (the top 3 things to do today). End with one direct recommendation. Never say "it's important to note" or "leveraging." Write like you're talking to a smart, busy business owner.`;

  const user = `Business: ${client.business_name}
Owner: ${client.owner_name}
Week of: ${weekOf}

Data from the past 7 days:
${dataBlock}

Write their Monday morning briefing.`;

  return callClaude(system, user);
}

// ── Delivery: Email via Resend ─────────────────────────────────────────────
async function sendEmail(to: string, ownerName: string, businessName: string, briefing: string, weekOf: string): Promise<void> {
  if (!RESEND) return;
  const subject = `${businessName} — Week of ${weekOf}`;
  const html = `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#0d1117;color:#eef2f7;">
  <p style="font-size:11px;letter-spacing:2px;color:#666;text-transform:uppercase;margin-bottom:24px;">PRYMAL AI · WEEKLY BRIEF</p>
  <h1 style="font-size:22px;font-weight:700;margin-bottom:4px;color:#fff;">${businessName}</h1>
  <p style="font-size:12px;color:#666;margin-bottom:32px;">Week of ${weekOf}</p>
  <div style="font-size:15px;line-height:1.8;color:#ccc;white-space:pre-wrap;">${briefing.replace(/\n/g, "<br>")}</div>
  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #222;font-size:11px;color:#444;">
    Powered by PrymalAI · <a href="https://prymalai.com" style="color:#00c8ff;text-decoration:none;">prymalai.com</a>
  </div>
</div>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND}` },
    body: JSON.stringify({ from: "brief@prymalai.com", to, subject, html }),
    signal: AbortSignal.timeout(10000),
  });
}

// ── Delivery: SMS via Twilio ───────────────────────────────────────────────
async function sendSMS(to: string, text: string): Promise<void> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return;
  const body = text.length > 1600 ? text.slice(0, 1560) + "\n[See full brief in your email]" : text;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
    },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }),
    signal: AbortSignal.timeout(10000),
  });
}

// ── Main handler ───────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));

    // If called for a specific client, run for that client only.
    // If called by cron with no client_id, run for ALL active clients.
    let clientIds: string[] = [];
    if (body.client_id) {
      clientIds = [String(body.client_id)];
    } else {
      const { data } = await sb.from("prymal_clients").select("id").eq("status", "active");
      clientIds = (data ?? []).map((r: any) => r.id);
    }

    if (clientIds.length === 0) return json({ ok: true, processed: 0 });

    const weekOf = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const results: Array<{ client_id: string; status: string; error?: string }> = [];

    for (const clientId of clientIds) {
      try {
        // Load client profile + settings
        const { data: client } = await sb
          .from("prymal_clients")
          .select("id, business_name, owner_name, owner_email, owner_phone, delivery_channel, intel_thresholds")
          .eq("id", clientId)
          .single();
        if (!client) { results.push({ client_id: clientId, status: "skip", error: "client not found" }); continue; }

        const thresholds = { ...DEFAULT_THRESHOLDS, ...(client.intel_thresholds ?? {}) };

        // Get Google access token (if connected)
        const googleToken = await refreshGoogleToken(clientId);

        // Pull data from all sources in parallel
        const [ga4, gmail] = await Promise.all([
          googleToken ? fetchGA4Stats(clientId, googleToken) : Promise.resolve(null),
          googleToken ? fetchGmailStats(googleToken) : Promise.resolve(null),
        ]);
        const internal = await fetchInternalStats(clientId);

        const flags = checkThresholds({ ga4, gmail, internal }, thresholds);
        const briefing = await generateBriefing(
          { business_name: client.business_name, owner_name: client.owner_name },
          { ga4, gmail, internal },
          flags,
          weekOf,
        );

        // Store briefing
        await sb.from("prymal_intel_briefings").insert({
          client_id: clientId,
          week_of: new Date().toISOString().slice(0, 10),
          briefing_text: briefing,
          flags,
          raw_data: { ga4, gmail, internal },
        });

        // Deliver
        const channel = client.delivery_channel ?? "email";
        if ((channel === "email" || channel === "both") && client.owner_email) {
          await sendEmail(client.owner_email, client.owner_name, client.business_name, briefing, weekOf);
        }
        if ((channel === "sms" || channel === "both") && client.owner_phone) {
          const smsText = `${client.business_name} — Week of ${weekOf}\n\n${briefing}`;
          await sendSMS(client.owner_phone, smsText);
        }

        results.push({ client_id: clientId, status: "sent" });
      } catch (err: any) {
        results.push({ client_id: clientId, status: "error", error: err.message });
      }
    }

    return json({ ok: true, week_of: weekOf, processed: results.length, results });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
