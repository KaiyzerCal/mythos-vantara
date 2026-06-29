// mavis-capability-audit
// Runs every 6 hours via pg_cron.
// Scans connected integrations, active cron jobs, and action types.
// Saves a structured capability snapshot to mavis_notes so MAVIS always
// knows exactly what it can do. Sends a Telegram diff if anything changed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN     = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const OPERATOR_CHAT = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const OPERATOR_UID  = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? "";

const NOTE_TITLE = "MAVIS System Capabilities — Live Audit";
const NOTE_TAGS  = ["system", "capabilities", "audit", "self-knowledge"];

// ── Telegram helper ───────────────────────────────────────────────────────────

async function tgSend(text: string): Promise<void> {
  if (!BOT_TOKEN || !OPERATOR_CHAT) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: OPERATOR_CHAT, text }),
  }).catch(() => {});
}

// ── Google token refresh ──────────────────────────────────────────────────────

async function refreshGoogleToken(config: Record<string, unknown>): Promise<string> {
  if (typeof config.expires_at === "number" && config.expires_at > Date.now() / 1000 + 60) {
    return config.access_token as string;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     config.client_id as string,
      client_secret: config.client_secret as string,
      refresh_token: config.refresh_token as string,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed");
  return data.access_token as string;
}

// ── Google Cloud API live probes ──────────────────────────────────────────────

const GOOGLE_API_PROBES: Array<{ key: string; label: string; url: string }> = [
  { key: "gmail",            label: "Gmail",            url: "https://gmail.googleapis.com/gmail/v1/users/me/profile" },
  { key: "gdrive",           label: "Google Drive",     url: "https://www.googleapis.com/drive/v3/about?fields=user" },
  { key: "google_calendar",  label: "Google Calendar",  url: "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1" },
  { key: "google_tasks",     label: "Google Tasks",     url: "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1" },
  { key: "gcontacts",        label: "Google Contacts",  url: "https://people.googleapis.com/v1/people/me?personFields=names" },
  { key: "google_photos",    label: "Google Photos",    url: "https://photoslibrary.googleapis.com/v1/albums?pageSize=1" },
  { key: "youtube",          label: "YouTube",          url: "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=1" },
  { key: "google_analytics", label: "Google Analytics", url: "https://analyticsdata.googleapis.com/v1beta/properties" },
  { key: "google_fit",       label: "Google Fit",       url: "https://www.googleapis.com/fitness/v1/users/me/dataSources?dataTypeName=com.google.step_count.delta" },
  { key: "search_console",   label: "Search Console",   url: "https://searchconsole.googleapis.com/webmasters/v3/sites" },
  { key: "google_ads",       label: "Google Ads",       url: "https://googleads.googleapis.com/v17/customers:listAccessibleCustomers" },
  { key: "blogger",          label: "Blogger",          url: "https://www.googleapis.com/blogger/v3/users/self/blogs" },
];

async function probeGoogleAPIs(sb: ReturnType<typeof createClient>, uid: string): Promise<Array<{ key: string; label: string; accessible: boolean; note: string }>> {
  let token: string | null = null;
  const PROVIDERS_TO_TRY = ["gdrive", "gmail", "google_calendar", "google_tasks", "gcontacts"];
  for (const p of PROVIDERS_TO_TRY) {
    const { data } = await sb.from("mavis_user_integrations").select("config").eq("user_id", uid).eq("provider", p).maybeSingle();
    if (data?.config) {
      try { token = await refreshGoogleToken(data.config as Record<string, unknown>); break; } catch { /* try next */ }
    }
  }

  if (!token) return GOOGLE_API_PROBES.map(p => ({ ...p, accessible: false, note: "No Google account connected" }));

  return await Promise.all(GOOGLE_API_PROBES.map(async (probe) => {
    try {
      const res = await fetch(probe.url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 200 || res.status === 204) return { ...probe, accessible: true, note: "✅ Live" };
      if (res.status === 401 || res.status === 403) {
        const body = await res.json().catch(() => ({}));
        const reason = (body?.error?.message ?? String(res.status)).slice(0, 80);
        return { ...probe, accessible: false, note: `❌ Auth error — ${reason}. Re-authenticate with expanded scopes.` };
      }
      if (res.status >= 400 && res.status < 500) return { ...probe, accessible: true, note: `✅ Accessible (${res.status})` };
      return { ...probe, accessible: false, note: `⚠️ HTTP ${res.status}` };
    } catch (err) {
      return { ...probe, accessible: false, note: `⚠️ Probe failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }));
}


// ── Integration display labels ────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  gmail:            "Gmail (read + send)",
  gdrive:           "Google Drive (read + write Docs/Sheets/files)",
  gcontacts:        "Google Contacts (read)",
  google_tasks:     "Google Tasks (read + write)",
  google_calendar:  "Google Calendar (read + write events)",
  google_photos:    "Google Photos (albums + media items)",
  youtube:          "YouTube (channel + videos + analytics)",
  google_analytics: "Google Analytics (traffic + conversion reports)",
  google_fit:       "Google Fit (activity + sleep + health data)",
  search_console:   "Search Console (search performance + index coverage)",
  google_ads:       "Google Ads (campaigns + performance)",
  blogger:          "Blogger (posts + blogs)",
  spotify:          "Spotify (playback control + library)",
  strava:           "Strava (activity sync)",
  whoop:            "Whoop (sleep + recovery data)",
  oura:             "Oura Ring (sleep + HRV data)",
  github:           "GitHub (repos + issues)",
  notion:           "Notion (pages + databases)",
  airtable:         "Airtable (bases + tables)",
  linear:           "Linear (issues + projects)",
  shopify:          "Shopify (store + orders)",
  slack:            "Slack (messages + channels)",
  discord:          "Discord (messages + servers)",
  twitter:          "Twitter/X (posting + reading)",
  instagram:        "Instagram (posting)",
  linkedin:         "LinkedIn (posting)",
  tiktok:           "TikTok (posting)",
  wordpress:        "WordPress.com (posts + pages)",
  salesforce:       "Salesforce (CRM)",
  hubspot:          "HubSpot (CRM)",
  calendly:         "Calendly (scheduling)",
  reclaim:          "Reclaim.ai (calendar optimization)",
};

// ── Core capability sections (static — always available) ─────────────────────

function buildStaticCapabilities(): string {
  return `## CORE ACTION GRAMMAR (telegram-webhook)
Quests: create_quest, update_quest, complete_quest, delete_quest
Tasks: create_task, complete_task, update_task, delete_task
Skills: create_skill, create_subskill, update_skill, delete_skill
Journal: create_journal, update_journal, delete_journal
Vault: create_vault, update_vault, delete_vault
Council: create_council_member, update_council_member, delete_council_member
Allies: create_ally, update_ally, delete_ally
Inventory: create_inventory_item, update_inventory_item, delete_inventory_item
Energy: create_energy_system, update_energy
Transformations: create_transformation, update_transformation
Rankings: create_ranking, update_ranking
Rituals: create_ritual, complete_ritual, log_bpm_session
Profile: update_profile, award_xp
Personas (NAVI): forge_persona, delete_persona
Revenue: propose_product, nora_tweet
Knowledge Graph: create_note, update_note, delete_note, link_notes, unlink_notes
Autonomous Goals: goal (sets a background objective MAVIS pursues every 15 min)
Store: create_store_item

## GOOGLE ACTIONS (via mavis-action-executor)
draft_email        → queued for Telegram approval, then sent via Gmail
schedule_event     → queued for Telegram approval, then created in Calendar
create_drive_file  → auto-executed (creates Google Doc / Sheet / file)
update_drive_file  → auto-executed (updates existing Drive file)
update_sheet       → auto-executed (writes values to Sheets cell range)
create_google_task → auto-executed (adds task to Google Tasks)

## MAVIS-AGENT TOOLS (Claude tool_use loop)
search_drive, read_drive_file, read_sheet_range, read_google_tasks
queue_action (email/calendar/Drive — Google Workspace), read_emails, read_calendar
google_api — generic caller for ANY Google Cloud Console API (Photos, YouTube, Analytics,
             Fit, Search Console, Ads, Blogger, or any other googleapis.com endpoint)
search_web (Tavily), get_pending_actions, get_user_context
create_campaign, think, recall_memory, save_memory, codexos_action

## WEB SEARCH
Tavily: real-time web search — proactive (auto-triggered on relevant queries) +
        reactive (:::SEARCH{"query":"..."} grammar in MAVIS responses)

## AI PROVIDER CASCADE
1. Gemini 2.5 Flash (free, via Lovable gateway)
2. GPT-4o-mini (OpenAI)
3. Claude Haiku (Anthropic)
4. Claude Sonnet (Anthropic — premium)
5. Grok 3 Mini (xAI — fallback)`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const now = new Date();
    const ts  = now.toISOString();

    // ── 1. Query connected integrations ──────────────────────────────────────
    const { data: integrations } = await sb
      .from("mavis_user_integrations")
      .select("provider, created_at, updated_at")
      .eq("user_id", OPERATOR_UID)
      .order("provider");

    const connectedProviders = (integrations ?? []).map((r: any) => r.provider as string);

    // ── 2. Query active cron jobs ─────────────────────────────────────────────
    const { data: cronJobs } = await sb
      .from("mavis_cron_config")
      .select("job_name, schedule, edge_function, enabled")
      .eq("enabled", true)
      .order("job_name");

    const activeCrons = (cronJobs ?? []) as any[];

    // ── 3. Build capability document ──────────────────────────────────────────
    const integrationSection = connectedProviders.length > 0
      ? `## CONNECTED INTEGRATIONS (${connectedProviders.length})\n` +
        connectedProviders
          .map(p => `- ${p}: ${PROVIDER_LABELS[p] ?? p}`)
          .join("\n")
      : "## CONNECTED INTEGRATIONS\nNone yet — connect via Integrations page.";

    const cronSection = activeCrons.length > 0
      ? `## ACTIVE BACKGROUND JOBS (${activeCrons.length})\n` +
        activeCrons
          .map((c: any) => `- ${c.edge_function} [${c.schedule}]`)
          .join("\n")
      : "## ACTIVE BACKGROUND JOBS\nNone registered — run mavis-cron-setup to activate.";

    const staticCaps = buildStaticCapabilities();

    // ── Google API live probe ─────────────────────────────────────────────────
    const googleProbeResults = await probeGoogleAPIs(sb, OPERATOR_UID);
    const accessibleApis = googleProbeResults.filter(r => r.accessible);
    const blockedApis    = googleProbeResults.filter(r => !r.accessible);

    const googleApiSection = [
      `## GOOGLE CLOUD API STATUS (live probe)`,
      ...accessibleApis.map(r => `- ${r.label}: ${r.note}`),
      ...(blockedApis.length > 0 ? [`\n### Needs Re-authentication (expanded scopes):`, ...blockedApis.map(r => `- ${r.label}: ${r.note}`)] : []),
      "",
      "To enable blocked APIs: re-authenticate via /integrations → Google Workspace (scopes have been expanded).",
    ].join("\n");

    const fullContent = [
      `# MAVIS System Capabilities — Live Audit`,
      `Last updated: ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`,
      "",
      integrationSection,
      "",
      googleApiSection,
      "",
      cronSection,
      "",
      staticCaps,
      "",
      "---",
      "This note is auto-updated every 6 hours. MAVIS reads it to understand its current capabilities.",
      "When Calvin asks 'what can you do?', draw from this note.",
    ].join("\n");

    // ── 4. Fetch the previous audit note for diff ─────────────────────────────
    const { data: existingNote } = await sb
      .from("mavis_notes")
      .select("id, content")
      .eq("user_id", OPERATOR_UID)
      .eq("title", NOTE_TITLE)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Detect integration and API access changes
    let diffMsg = "";
    if (existingNote?.content) {
      const prevConnected = (existingNote.content.match(/^- (\w[\w-]+):/gm) ?? [])
        .map((m: string) => m.replace(/^- /, "").replace(/:.*$/, "").trim());
      const newProviders  = connectedProviders.filter(p => !prevConnected.includes(p));
      const lostProviders = prevConnected.filter((p: string) => !connectedProviders.includes(p));
      if (newProviders.length > 0)  diffMsg += `New integrations: ${newProviders.join(", ")}\n`;
      if (lostProviders.length > 0) diffMsg += `Removed integrations: ${lostProviders.join(", ")}\n`;

      // Detect newly accessible Google APIs
      const prevAccessible = (existingNote.content.match(/^- (.+?): ✅/gm) ?? [])
        .map((m: string) => m.replace(/^- /, "").replace(/:.*$/, "").trim());
      const nowAccessible  = accessibleApis.map(r => r.label);
      const newlyOpen = nowAccessible.filter(l => !prevAccessible.includes(l));
      const newlyClosed = prevAccessible.filter(l => !nowAccessible.includes(l));
      if (newlyOpen.length > 0)   diffMsg += `Newly accessible APIs: ${newlyOpen.join(", ")}\n`;
      if (newlyClosed.length > 0) diffMsg += `Lost API access: ${newlyClosed.join(", ")}\n`;
    }

    // ── 5. Upsert the capability note ─────────────────────────────────────────
    if (existingNote?.id) {
      await sb.from("mavis_notes")
        .update({ content: fullContent, updated_at: ts })
        .eq("id", existingNote.id);
    } else {
      await sb.from("mavis_notes").insert({
        user_id:    OPERATOR_UID,
        title:      NOTE_TITLE,
        content:    fullContent,
        tags:       NOTE_TAGS,
        updated_at: ts,
      });
    }

    // ── 6. Trigger memory re-embed so the note is searchable ─────────────────
    fetch(`${SUPABASE_URL}/functions/v1/mavis-memory-embed`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body:    JSON.stringify({ user_id: OPERATOR_UID }),
    }).catch(() => {});

    // ── 7. Send Telegram notification ─────────────────────────────────────────
    const summary = [
      `System audit complete — ${connectedProviders.length} integration(s) connected, ${activeCrons.length} background job(s) active.`,
      diffMsg ? `\nChanges detected:\n${diffMsg}` : "",
    ].filter(Boolean).join("");

    if (diffMsg) {
      await tgSend(`MAVIS Capability Update\n\n${summary}`);
    }

    return new Response(JSON.stringify({
      ok:           true,
      connectedCount: connectedProviders.length,
      cronCount:    activeCrons.length,
      diff:         diffMsg || null,
      updatedAt:    ts,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[mavis-capability-audit]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
