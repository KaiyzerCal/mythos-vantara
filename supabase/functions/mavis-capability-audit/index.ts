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

// ── Integration display labels ────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  gmail:            "Gmail (read + send)",
  gdrive:           "Google Drive (read + write Docs/Sheets/files)",
  gcontacts:        "Google Contacts (read)",
  google_tasks:     "Google Tasks (read + write)",
  google_calendar:  "Google Calendar (read + write events)",
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
  youtube:          "YouTube (video data)",
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
queue_action (email/calendar/tasks/Drive), read_emails, read_calendar
search_web (Tavily), get_pending_actions, get_user_context
create_campaign, think, recall_memory, save_memory

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

    const fullContent = [
      `# MAVIS System Capabilities — Live Audit`,
      `Last updated: ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`,
      "",
      integrationSection,
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

    // Detect integration changes
    let diffMsg = "";
    if (existingNote?.content) {
      const prevConnected = (existingNote.content.match(/^- (\w[\w-]+):/gm) ?? [])
        .map((m: string) => m.replace(/^- /, "").replace(/:.*$/, "").trim());
      const newProviders  = connectedProviders.filter(p => !prevConnected.includes(p));
      const lostProviders = prevConnected.filter((p: string) => !connectedProviders.includes(p));

      if (newProviders.length > 0) {
        diffMsg += `New integrations: ${newProviders.join(", ")}\n`;
      }
      if (lostProviders.length > 0) {
        diffMsg += `Removed integrations: ${lostProviders.join(", ")}\n`;
      }
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
