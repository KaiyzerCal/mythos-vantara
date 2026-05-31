import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const claudeKey   = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const adminSb     = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Step 1 — Determine uid
  let uid: string;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const userSb = createClient(supabaseUrl, token, { auth: { persistSession: false } });
    const { data: { user } } = await userSb.auth.getUser();
    uid = user?.id ?? Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? "";
  } else {
    uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? "";
  }
  if (!uid) {
    return new Response(JSON.stringify({ error: "No user" }), { status: 401, headers: corsHeaders });
  }

  // Step 2 — Fetch all data in parallel
  const todayIso   = new Date().toISOString().slice(0, 10);
  const startOfDay = todayIso + "T00:00:00Z";
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [
    questsRes,
    tasksRes,
    overdueRes,
    eventsRes,
    healthRes,
    revenueRes,
    habitsRes,
    weatherResult,
  ] = await Promise.all([
    // a) Active quests
    adminSb
      .from("quests")
      .select("title, progress_current, progress_target, due_date")
      .eq("user_id", uid)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(5),

    // b) Tasks due today
    adminSb
      .from("tasks")
      .select("title, type, priority")
      .eq("user_id", uid)
      .neq("status", "completed")
      .eq("due_date", todayIso)
      .limit(8),

    // c) Overdue tasks
    adminSb
      .from("tasks")
      .select("title, due_date")
      .eq("user_id", uid)
      .neq("status", "completed")
      .lt("due_date", todayIso)
      .limit(5),

    // d) Calendar events today (graceful)
    adminSb
      .from("calendar_events")
      .select("title, start_time, end_time")
      .eq("user_id", uid)
      .gte("start_time", startOfDay)
      .lt("start_time", todayIso + "T23:59:59Z")
      .limit(6)
      .then((r) => r)
      .catch(() => ({ data: [], error: null })),

    // e) Latest health metrics (last 2 days, graceful)
    adminSb
      .from("health_metrics")
      .select("metric_type, value, unit, source")
      .eq("user_id", uid)
      .gte("metric_date", twoDaysAgo)
      .then((r) => r)
      .catch(() => ({ data: [], error: null })),

    // f) Revenue this week (graceful)
    adminSb
      .from("mavis_revenue")
      .select("amount, source, created_at")
      .eq("user_id", uid)
      .gte("created_at", sevenDaysAgo)
      .then((r) => r)
      .catch(() => ({ data: [], error: null })),

    // g) Habits streak
    adminSb
      .from("tasks")
      .select("title, streak")
      .eq("user_id", uid)
      .eq("type", "habit")
      .gt("streak", 0)
      .limit(5),

    // h) Weather (optional, graceful)
    (async () => {
      const weatherKey = Deno.env.get("OPENWEATHERMAP_API_KEY");
      if (!weatherKey) return null;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?q=New+York&units=imperial&appid=${weatherKey}`,
          { signal: controller.signal },
        );
        clearTimeout(timeout);
        return await res.json();
      } catch {
        return null;
      }
    })(),
  ]);

  const quests       = questsRes.data ?? [];
  const tasks        = tasksRes.data ?? [];
  const overdue      = overdueRes.data ?? [];
  const events       = (eventsRes.data ?? []) as any[];
  const healthMetrics = (healthRes.data ?? []) as any[];
  const revenue      = (revenueRes.data ?? []) as any[];
  const habits       = habitsRes.data ?? [];

  let weatherSummary = "unavailable";
  if (weatherResult && weatherResult.main) {
    const w = weatherResult as any;
    weatherSummary = `${w.weather?.[0]?.description ?? ""}, ${Math.round(w.main.temp)}°F (${w.name})`.trim();
  }

  // Step 3 — Fetch recent MAVIS intel notes
  const { data: intelNotesRaw } = await adminSb
    .from("mavis_notes")
    .select("title, content")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(5);
  const intelNotes = (intelNotesRaw ?? []).map((n: any) => ({
    title: n.title,
    content: String(n.content ?? "").slice(0, 200),
  }));

  // Step 4 — Build data summary block
  const now = new Date();
  const dataBlock = `
TODAY: ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
TIME: ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC

ACTIVE QUESTS (${quests.length}): ${quests.map((q: any) => `${q.title} [${q.progress_current}/${q.progress_target}]`).join(" | ") || "none"}
TASKS DUE TODAY (${tasks.length}): ${tasks.map((t: any) => t.title).join(", ") || "none"}
OVERDUE (${overdue.length}): ${overdue.map((t: any) => `${t.title} (due ${t.due_date})`).join(", ") || "none"}
CALENDAR: ${events.map((e: any) => `${new Date(e.start_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} ${e.title}`).join(" | ") || "no events"}
HEALTH: ${healthMetrics.map((m: any) => `${m.metric_type}: ${m.value}${m.unit}`).join(", ") || "no data"}
REVENUE THIS WEEK: $${revenue.reduce((s: number, r: any) => s + Number(r.amount || 0), 0).toFixed(2)}
HABITS STRONG: ${habits.map((h: any) => `${h.title} (${h.streak}🔥)`).join(", ") || "none"}
WEATHER: ${weatherSummary}
INTEL/NEWS: ${intelNotes.map((n) => n.title).join(" | ") || "none"}
`;

  // Step 5 — System prompt
  const systemPrompt = `You are MAVIS Prime delivering the morning briefing to the Sovereign Operator.

Deliver a concise 6-section briefing:
1. PRIORITIES — Top 3 actions the operator MUST do today. Flag overdue items urgently.
2. SCHEDULE — Today's calendar events with time context.
3. INTEL — Revenue status, quest progress, relevant news from the intel feed.
4. HEALTH — Interpret health trends conversationally. Never state raw numbers as facts. Say "solid" or "recovering" etc.
5. WORLD — Weather, anything notable from intel/news.
6. SIGNAL — One forward-looking closing sentence with energy and intent.

Rules:
- ONLY facts from the data block. Zero hallucination.
- No markdown, no bullet points, no headers. Flowing prose per section.
- Each section: 1-2 sentences max.
- Address the operator as "Sovereign" once, then no more honorifics.
- Total length: 150-200 words.
- Tone: calm authority, tactical clarity.`;

  // Step 6 — Generate via Claude Sonnet
  const claudeBody = {
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: `Generate the morning briefing from this data:\n${dataBlock}` }],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(claudeBody),
  });
  let digest: string = (await res.json()).content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  // Step 7 — Quality evaluation (regenerate once if below threshold)
  let evalData: { score?: number; feedback?: string; passed?: boolean } = { passed: true };
  try {
    const evalRes = await fetch(`${supabaseUrl}/functions/v1/mavis-quality-eval`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        content: digest,
        context: "morning briefing for a personal AI OS",
        criteria: ["accuracy", "actionability", "conciseness", "no hallucination", "motivating tone"],
      }),
    });
    evalData = await evalRes.json().catch(() => ({ passed: true }));
  } catch {
    evalData = { passed: true };
  }

  if (!evalData.passed) {
    // Regenerate with feedback appended
    const regenBody = {
      ...claudeBody,
      messages: [
        ...claudeBody.messages,
        { role: "assistant", content: digest },
        {
          role: "user",
          content: `Quality feedback: ${evalData.feedback ?? "improve quality"}. Please regenerate the briefing addressing this feedback while keeping the same structure and data.`,
        },
      ],
    };
    try {
      const regenRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": claudeKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(regenBody),
      });
      const regenText = (await regenRes.json()).content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      if (regenText) digest = regenText;
    } catch {
      // Keep original digest if regen fails
    }
  }

  // Step 8 — Store in journal_entries
  await adminSb.from("journal_entries").insert({
    user_id: uid,
    title: `Morning Briefing — ${todayIso}`,
    content: digest,
    tags: ["morning-digest", "auto", "mavis"],
    mood: null,
  });

  // Step 9 — Send to Telegram
  const chatId = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID");
  if (chatId && Deno.env.get("TELEGRAM_BOT_TOKEN")) {
    const msg = `🌅 *MAVIS Morning Briefing*\n\n${digest}`;
    await fetch(
      `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" }),
      },
    ).catch(() => {});
  }

  // Step 10 — Return
  return new Response(
    JSON.stringify({ success: true, digest, quality_score: evalData.score ?? null }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
