// MAVIS Director — Intent classification + specialist dispatch
// The routing brain between any inbound source and MAVIS specialist systems.
//
// Input (POST):
//   { message, source, user_id, chat_id?, intent_hint? }
//
// Sources: "telegram" | "web" | "webhook" | "cron" | "make"
// Intent categories: query | social | research | action | status | comms
//
// Routes to:
//   social    → mavis-content-pipeline (47 social commands across all platforms)
//   research  → Perplexity sonar-pro (+ Tavily fallback) → synthesized report
//   action    → mavis-actions (full action grammar)
//   status    → live DB pull → formatted summary
//   comms     → mavis-email-send (Resend) + mavis-calendar-manage (Google Calendar)
//   query     → Claude Sonnet inline response with user context

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const PERPLEXITY_KEY = Deno.env.get("PERPLEXITY_API_KEY") ?? "";
const TAVILY_KEY    = Deno.env.get("Tavily_API") ?? Deno.env.get("TAVILY_API_KEY") ?? "";
const LOVABLE_KEY   = Deno.env.get("LOVABLE_API_KEY") ?? "";
const OPENAI_KEY    = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─────────────────────────────────────────────────────────────
// AI HELPERS — same cascade as telegram-webhook
// ─────────────────────────────────────────────────────────────

async function callAI(
  system: string,
  user: string,
  maxTokens = 512,
  preferFast = true,
): Promise<string> {
  // Tier 1: Gemini Flash via Lovable (free)
  if (LOVABLE_KEY) {
    try {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: maxTokens,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      if (r.ok) {
        const d = await r.json();
        const t = d.choices?.[0]?.message?.content ?? "";
        if (t) return t;
      }
    } catch { /* fall through */ }
  }

  // Tier 2: Claude Haiku (fast/cheap) or Sonnet (quality)
  if (ANTHROPIC_KEY) {
    const model = preferFast ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6";
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, system,
          messages: [{ role: "user", content: user }] }),
      });
      if (r.ok) {
        const d = await r.json();
        return d.content?.[0]?.text ?? "";
      }
    } catch { /* fall through */ }
  }

  // Tier 3: OpenAI mini
  if (OPENAI_KEY) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: maxTokens,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      if (r.ok) {
        const d = await r.json();
        return d.choices?.[0]?.message?.content ?? "";
      }
    } catch { /* fall through */ }
  }

  return "[No AI provider available]";
}

// ─────────────────────────────────────────────────────────────
// INTENT CLASSIFICATION
// ─────────────────────────────────────────────────────────────

type Intent = "query" | "social" | "research" | "action" | "status" | "comms";

const INTENT_KEYWORDS: Record<Intent, string[]> = {
  social:   ["post", "tweet", "content", "write a post", "linkedin", "twitter", "instagram", "caption", "draft a", "create content", "publish", "nora"],
  research: ["research", "find out", "investigate", "deep dive", "what's going on", "look into", "analyze", "study", "search for", "report on", "latest on"],
  action:   ["create quest", "add task", "log", "update my", "complete", "set a goal", "new quest", "add to my", "delete", "record", "track"],
  status:   ["status", "how am i doing", "progress", "what's pending", "pending approvals", "how many", "overview", "dashboard", "brief me", "what do i have"],
  comms:    ["email", "schedule", "calendar", "meeting", "meet with", "contact", "reach out", "send to", "book", "appointment"],
  query:    [],
};

async function classifyIntent(message: string, hint?: string): Promise<{ intent: Intent; confidence: number; target?: string }> {
  if (hint && INTENT_KEYWORDS[hint as Intent]) return { intent: hint as Intent, confidence: 100 };

  const lower = message.toLowerCase();
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as [Intent, string[]][]) {
    if (intent === "query") continue;
    const hits = keywords.filter(k => lower.includes(k));
    if (hits.length >= 2 || (hits.length === 1 && message.length < 80)) {
      return { intent, confidence: 85 };
    }
  }

  // Claude Haiku for ambiguous cases
  const raw = await callAI(
    `Classify the intent of this message into one of: query, social, research, action, status, comms.
Respond ONLY as JSON: {"intent":"<category>","confidence":0-100,"target":"<main subject>"}
- social: creating/drafting social media posts or content
- research: finding information, web search, investigating topics
- action: creating/updating/deleting MAVIS data (quests, goals, tasks, journal)
- status: checking current state, pending items, progress
- comms: email, calendar, scheduling, contacting people
- query: general question/conversation`,
    message,
    128,
    true,
  );

  try {
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        intent:     parsed.intent as Intent ?? "query",
        confidence: Number(parsed.confidence ?? 70),
        target:     parsed.target,
      };
    }
  } catch { /* fall through */ }

  return { intent: "query", confidence: 60 };
}

// ─────────────────────────────────────────────────────────────
// SPECIALIST HANDLERS
// ─────────────────────────────────────────────────────────────

// --- Research via Perplexity (primary) + Tavily (fallback) ---
async function handleResearch(userId: string, message: string, target?: string): Promise<string> {
  const query = target || message;

  // Perplexity sonar-pro — real-time web with citations
  if (PERPLEXITY_KEY) {
    try {
      const r = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${PERPLEXITY_KEY}`,
        },
        body: JSON.stringify({
          model: "sonar-pro",
          max_tokens: 1024,
          messages: [
            {
              role: "system",
              content: "You are a research specialist. Provide a concise, fact-based report with key findings, data points, and actionable insights. Use bullet points for scannability.",
            },
            { role: "user", content: query },
          ],
        }),
      });
      if (r.ok) {
        const d = await r.json();
        const report = d.choices?.[0]?.message?.content ?? "";
        if (report) {
          // Save as a MAVIS note for future recall
          await supabase.from("mavis_notes").insert({
            user_id: userId,
            title:   `Research: ${query.slice(0, 60)}`,
            content: report,
            tags:    ["research", "director"],
          }).catch(() => {});
          return `🔍 *Research Report*\n\n${report}\n\n_Saved to Knowledge Graph._`;
        }
      }
    } catch { /* fall through to Tavily */ }
  }

  // Tavily fallback
  if (TAVILY_KEY) {
    try {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key:        TAVILY_KEY,
          query,
          search_depth:   "advanced",
          max_results:    6,
          include_answer: true,
        }),
      });
      if (r.ok) {
        const d = await r.json();
        const answer  = d.answer ?? "";
        const sources = (d.results ?? [] as any[]).slice(0, 4).map((s: any) => `• ${s.title}: ${(s.content ?? "").slice(0, 200)}`).join("\n");
        const report  = [answer, sources].filter(Boolean).join("\n\n");
        return `🔍 *Research Results*\n\n${report}`;
      }
    } catch { /* fall through */ }
  }

  return `I don't have a research provider configured (PERPLEXITY_API_KEY or Tavily_API). Add one to enable deep research.`;
}

// --- Social content via content pipeline (or full publisher if URL detected) ---
async function handleSocial(userId: string, message: string, target?: string): Promise<string> {
  // If a URL is embedded, route through the full AI Social Media System pipeline
  const urlMatch = message.match(/https?:\/\/[^\s]+/);
  if (urlMatch) {
    const sourceUrl = urlMatch[0];
    const r = await fetch(`${SUPABASE_URL}/functions/v1/mavis-social-publisher`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source_url: sourceUrl, user_id: userId, dry_run: true }),
      signal: AbortSignal.timeout(60000),
    }).catch(() => null);
    if (r?.ok) {
      const d = await r.json();
      const pkg = d.content ?? {};
      const preview = [
        pkg.twitter   ? `*Twitter:* ${pkg.twitter.slice(0, 200)}` : null,
        pkg.linkedin  ? `*LinkedIn:* ${pkg.linkedin.slice(0, 200)}` : null,
        pkg.instagram ? `*Instagram:* ${pkg.instagram.slice(0, 200)}` : null,
      ].filter(Boolean).join("\n\n");
      return `📱 *Content Campaign Draft*\nSource: ${sourceUrl}\n\n${preview || "Content generated — see Social Queue."}\n\n_Saved to queue (ID: ${d.queue_id}). Reply "publish" to go live on all platforms._`;
    }
  }

  const topic = target || message;

  // Extract platform hints from message
  const lower = message.toLowerCase();
  const platforms = [
    lower.includes("linkedin") ? "linkedin" : null,
    lower.includes("twitter") || lower.includes("tweet") ? "twitter" : null,
    lower.includes("instagram") ? "instagram" : null,
    lower.includes("tiktok") ? "tiktok" : null,
  ].filter(Boolean) as string[];

  if (platforms.length === 0) platforms.push("twitter", "linkedin");

  const drafts: string[] = [];

  for (const platform of platforms) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/mavis-content-pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          action:   "create_post",
          platform,
          topic,
          style:    "nora",
        }),
      });
      if (r.ok) {
        const d = await r.json();
        const content = d.content ?? d.post ?? d.text ?? "";
        if (content) {
          // Queue for approval
          await supabase.from("mavis_action_queue").insert({
            user_id:       userId,
            action_type:   "social_draft",
            title:         `${platform.toUpperCase()} Draft Ready`,
            description:   topic.slice(0, 120),
            status:        "pending",
            autonomy_tier: "approve",
            payload:       { platform, content, topic },
          }).catch(() => {});
          drafts.push(`*${platform.toUpperCase()}:*\n${content}`);
        }
      }
    } catch { /* non-fatal */ }
  }

  if (drafts.length === 0) {
    // Inline fallback using Claude
    const fallback = await callAI(
      `You are Nora Vale — a tech-forward business strategist. Create compelling social media content. Be direct, no fluff.`,
      `Create social content about: ${topic}\n\nProvide Twitter (280 chars max) and LinkedIn versions.`,
      512,
      false,
    );
    await supabase.from("mavis_action_queue").insert({
      user_id:       userId,
      action_type:   "social_draft",
      title:         "Social Content Draft",
      description:   topic.slice(0, 120),
      status:        "pending",
      autonomy_tier: "approve",
      payload:       { content: fallback, topic },
    }).catch(() => {});
    return `📱 *Social Content Draft*\n\n${fallback}\n\n_Saved to Approval Queue._`;
  }

  return `📱 *Social Drafts Ready* (${drafts.length} platform${drafts.length > 1 ? "s" : ""})\n\n${drafts.join("\n\n---\n\n")}\n\n_All saved to your Approval Queue._`;
}

// --- MAVIS action dispatch ---
async function handleAction(userId: string, message: string): Promise<string> {
  // Parse natural language into an action
  const raw = await callAI(
    `Convert this natural language request into a MAVIS action JSON.
Common types: create_quest, create_task, create_goal, create_journal, create_note, complete_task, award_xp, update_profile
Respond ONLY as JSON: {"type":"<action_type>","params":{<fields>}}`,
    message,
    256,
    true,
  );

  let action = { type: "create_task", params: { title: message.slice(0, 100) } };
  try {
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.type) action = parsed;
    }
  } catch { /* use fallback */ }

  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/mavis-actions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ actions: [action], userId }),
    });
    if (r.ok) return `⚡ *Action Executed*\n\`${action.type}\` completed.`;
  } catch { /* fall through */ }

  // Queue if execution fails
  await supabase.from("mavis_action_queue").insert({
    user_id:       userId,
    action_type:   action.type,
    title:         `Queued: ${action.type}`,
    description:   message.slice(0, 120),
    status:        "pending",
    autonomy_tier: "approve",
    payload:       action,
  }).catch(() => {});
  return `📥 Action queued for manual execution: \`${action.type}\``;
}

// --- Status summary ---
async function handleStatus(userId: string, operatorName: string): Promise<string> {
  const [goals, pending, tasks, quests] = await Promise.all([
    supabase.from("mavis_goals").select("objective,progress_pct,status").eq("user_id", userId).eq("status", "active").limit(5),
    supabase.from("mavis_action_queue").select("id").eq("user_id", userId).eq("status", "pending").eq("autonomy_tier", "approve"),
    supabase.from("mavis_tasks").select("id").eq("user_id", userId).in("status", ["pending", "running"]),
    supabase.from("quests").select("title,status").eq("user_id", userId).eq("status", "active").limit(5),
  ]);

  const goalLines  = goals.data?.map((g: any) => `• ${g.objective.slice(0, 60)} — ${g.progress_pct || 0}%`).join("\n") || "_No active goals_";
  const questLines = quests.data?.map((q: any) => `• ${q.title}`).join("\n") || "_No active quests_";

  return `📊 *MAVIS Status — ${operatorName}*

🎯 *Goals:*
${goalLines}

⚔️ *Active Quests:*
${questLines}

⏳ *Pending Approvals:* ${pending.data?.length || 0}
🔄 *Running Tasks:* ${tasks.data?.length || 0}

_Systems operational._`;
}

// --- General query with context ---
async function handleQuery(userId: string, message: string, operatorName: string): Promise<string> {
  const [memories, profile] = await Promise.all([
    supabase.from("mavis_tacit").select("content,category").eq("user_id", userId).order("confidence", { ascending: false }).limit(8),
    supabase.from("profiles").select("level,rank,current_form").eq("id", userId).single(),
  ]);

  const memCtx = memories.data?.map((m: any) => `[${m.category}] ${m.content}`).join("\n") || "";
  const p = profile.data as any;

  return await callAI(
    `You are MAVIS, the personal AI OS for ${operatorName}.
Level ${p?.level ?? "?"} | Rank: ${p?.rank ?? "?"} | Form: ${p?.current_form ?? "Base"}

Known context:
${memCtx}

Be direct and concise. 2-4 sentences for most replies. Mobile-first format.`,
    message,
    512,
    false,
  );
}

// --- Comms: email send or calendar manage ---
async function handleComms(userId: string, message: string): Promise<string> {
  const lower = message.toLowerCase();

  // ── Calendar path ──────────────────────────────────────────────────────────
  const isCalendar = /schedule|calendar|meeting|book|appointment|event|reschedule|cancel\s+meeting/.test(lower);
  if (isCalendar) {
    // Parse intent: find_free_time | create_event | list_events | reschedule_event | cancel_event
    const actionMap: Record<string, string> = {
      "list|show|what.*meeting|what.*event|upcoming": "list_events",
      "free|available|open slot|when.*free":          "find_free_time",
      "reschedule|move.*meeting":                     "reschedule_event",
      "cancel.*meeting|delete.*event":                "cancel_event",
    };
    let calAction = "create_event";
    for (const [pat, act] of Object.entries(actionMap)) {
      if (new RegExp(pat).test(lower)) { calAction = act; break; }
    }

    // Use AI to extract event details for create/reschedule
    let params: Record<string, unknown> = { action: calAction };
    if (calAction === "create_event" || calAction === "reschedule_event") {
      const raw = await callAI(
        `Extract calendar event details from this request. Respond ONLY as JSON:
{"title":"...","start_date":"YYYY-MM-DD","start_time":"HH:MM","end_time":"HH:MM","attendees":["email"],"description":"..."}
If a field is unclear, omit it.`,
        message, 256, true,
      );
      try {
        const match = raw.match(/\{[\s\S]*?\}/);
        if (match) params = { action: calAction, ...JSON.parse(match[0]) };
      } catch { /* use minimal params */ }
    }

    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/mavis-calendar-manage`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, user_id: userId }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) {
        const d = await r.json();
        if (calAction === "list_events") {
          const events = (d.events ?? d.items ?? []).slice(0, 8);
          if (!events.length) return "📅 *Calendar*\n\nNo upcoming events found.";
          const lines = events.map((e: any) =>
            `• ${e.summary ?? e.title ?? "Event"} — ${e.start?.dateTime?.slice(0, 16) ?? e.start ?? ""}`
          ).join("\n");
          return `📅 *Upcoming Events*\n\n${lines}`;
        }
        if (calAction === "find_free_time") {
          const slots = d.slots ?? d.free_slots ?? [];
          if (!slots.length) return "📅 *Calendar*\n\nNo free slots found in the next 3 days.";
          const lines = (slots as any[]).slice(0, 5).map((s: any) => `• ${s.start} → ${s.end}`).join("\n");
          return `📅 *Free Slots*\n\n${lines}`;
        }
        const evt = d.event ?? d;
        return `📅 *Event ${calAction.replace("_", " ")} — done*\n\n${evt.summary ?? evt.title ?? JSON.stringify(evt).slice(0, 200)}`;
      }
    } catch { /* fall through to queue */ }

    // Calendar not connected or failed — queue the request
    await supabase.from("mavis_action_queue").insert({
      user_id: userId,
      action_type: "calendar_request",
      title: `Calendar: ${calAction.replace("_", " ")}`,
      description: message.slice(0, 200),
      status: "pending",
      autonomy_tier: "approve",
      payload: { action: calAction, message },
    }).catch(() => {});
    return `📅 *Calendar Request Queued*\n\n_${message.slice(0, 150)}_\n\nConnect Google Calendar in _/integrations_ to execute automatically.`;
  }

  // ── Email path ─────────────────────────────────────────────────────────────
  const isEmail = /email|send.*to|message.*to|write.*to|reach out/.test(lower);
  if (isEmail) {
    const raw = await callAI(
      `Extract email send details from this request. Respond ONLY as JSON:
{"to":"recipient@email.com","subject":"...","generate_prompt":"what to write"}
If recipient email isn't clear, set to is empty string.`,
      message, 256, true,
    );

    let to = "", subject = "", generatePrompt = message;
    try {
      const match = raw.match(/\{[\s\S]*?\}/);
      if (match) {
        const d = JSON.parse(match[0]);
        to = d.to ?? ""; subject = d.subject ?? ""; generatePrompt = d.generate_prompt ?? message;
      }
    } catch { /* use defaults */ }

    if (!to) {
      // Can't send without a recipient — queue it
      await supabase.from("mavis_action_queue").insert({
        user_id: userId,
        action_type: "email_request",
        title: "Email Request",
        description: message.slice(0, 200),
        status: "pending",
        autonomy_tier: "approve",
        payload: { message },
      }).catch(() => {});
      return `📧 *Email Request Queued*\n\n_${message.slice(0, 150)}_\n\nCouldn't identify the recipient. Please specify an email address and I'll send it immediately.`;
    }

    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/mavis-email-send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, generate: true, generate_prompt: generatePrompt }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.ok) {
        const d = await r.json();
        return `📧 *Email Sent*\n\nTo: ${to}\nSubject: ${d.subject ?? subject}\n\n_${(d.body ?? "").slice(0, 200)}…_`;
      }
      const err = await r.json().catch(() => ({}));
      return `📧 *Email failed*: ${(err as any).error ?? "Unknown error"}. Check RESEND_API_KEY in secrets.`;
    } catch (e: any) {
      return `📧 *Email error*: ${e.message}`;
    }
  }

  // ── Generic comms fallback ─────────────────────────────────────────────────
  await supabase.from("mavis_action_queue").insert({
    user_id: userId,
    action_type: "comms_request",
    title: "Communications Request",
    description: message.slice(0, 200),
    status: "pending",
    autonomy_tier: "approve",
    payload: { message },
  }).catch(() => {});

  return `📬 *Communications Request Queued*\n\n_${message.slice(0, 200)}_\n\nConnect Gmail and Google Calendar in _/integrations_ for automatic execution.`;
}

// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth: service-role (internal) or user JWT (direct API calls)
    const auth  = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const body = await req.json() as Record<string, unknown>;
    const {
      message,
      source     = "web",
      user_id,
      chat_id,
      intent_hint,
      operator_name,
    } = body as {
      message:        string;
      source?:        string;
      user_id:        string;
      chat_id?:       string | number;
      intent_hint?:   string;
      operator_name?: string;
    };

    if (!user_id) return json({ error: "user_id required" }, 400);
    if (!message) return json({ error: "message required" }, 400);

    // Resolve operator name
    let opName = operator_name ?? "Operator";
    if (!operator_name) {
      const { data: p } = await supabase.from("profiles").select("inscribed_name,display_name").eq("id", user_id).single();
      opName = (p as any)?.inscribed_name || (p as any)?.display_name || "Operator";
    }

    // Classify intent
    const { intent, confidence, target } = await classifyIntent(message, intent_hint);

    // Log routing decision
    await supabase.from("mavis_action_queue").insert({
      user_id,
      action_type:   "director_route",
      title:         `Director → ${intent}`,
      description:   `"${message.slice(0, 80)}" (${confidence}% confidence) from ${source}`,
      status:        "executed",
      autonomy_tier: "auto",
      executed_at:   new Date().toISOString(),
      payload:       { intent, confidence, target, source, message: message.slice(0, 500) },
    }).catch(() => {});

    // Route to specialist
    let reply = "";
    switch (intent) {
      case "social":   reply = await handleSocial(user_id, message, target); break;
      case "research": reply = await handleResearch(user_id, message, target); break;
      case "action":   reply = await handleAction(user_id, message); break;
      case "status":   reply = await handleStatus(user_id, opName); break;
      case "comms":    reply = await handleComms(user_id, message); break;
      default:         reply = await handleQuery(user_id, message, opName); break;
    }

    // Push reply back via Telegram if triggered from there
    if (source === "telegram" && (chat_id || Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID"))) {
      fetch(`${SUPABASE_URL}/functions/v1/telegram-sender`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id:    chat_id || Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID"),
          text:       reply,
          parse_mode: "Markdown",
        }),
      }).catch((e) => console.error("[Director] telegram-sender error:", e));
    }

    return json({ ok: true, intent, confidence, reply });

  } catch (err) {
    console.error("[mavis-director]", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
