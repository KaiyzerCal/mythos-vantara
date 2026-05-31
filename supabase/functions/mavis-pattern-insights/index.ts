// MAVIS Pattern Insights
// Proactive pattern detection — runs weekly (cron) or on-demand.
// For each user in profiles, queries the last 30 days of behavioural data,
// calls GPT-4o-mini to surface 3-5 actionable insights, and upserts them
// into mavis_insights. Optionally notifies via Telegram.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? "";
const BOT_TOKEN  = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

// ─────────────────────────────────────────────────────────────
// Telegram helper
// ─────────────────────────────────────────────────────────────

async function sendTelegram(chatId: string, text: string): Promise<void> {
  if (!BOT_TOKEN || !chatId) return;
  const payload = text.length > 4096 ? text.slice(0, 4056) + "\n…[truncated]" : text;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: payload }),
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────
// Per-user pattern analysis
// ─────────────────────────────────────────────────────────────

async function analyzeUser(userId: string): Promise<number> {
  const now     = new Date();
  const ago30   = new Date(now.getTime() - 30 * 86400_000).toISOString();

  // Parallel fetch of all needed data
  const [ritualsRes, tasksRes, journalRes, energyRes, tacitRes] = await Promise.all([
    supabase
      .from("rituals")
      .select("name, streak, completed, created_at")
      .eq("user_id", userId)
      .gte("created_at", ago30)
      .limit(60),

    supabase
      .from("tasks")
      .select("title, status, completed_count, streak")
      .eq("user_id", userId)
      .neq("recurrence", "once")
      .gte("created_at", ago30)
      .limit(60),

    supabase
      .from("journal_entries")
      .select("mood, created_at")
      .eq("user_id", userId)
      .gte("created_at", ago30)
      .order("created_at", { ascending: false })
      .limit(30),

    supabase
      .from("energy_systems")
      .select("type, current_value, max_value")
      .eq("user_id", userId),

    supabase
      .from("mavis_tacit")
      .select("category, key, value")
      .eq("user_id", userId)
      .in("category", ["correction", "hard_rule"])
      .limit(20),
  ]);

  const rituals = (ritualsRes.data ?? []) as any[];
  const tasks   = (tasksRes.data ?? []) as any[];
  const journal = (journalRes.data ?? []) as any[];
  const energy  = (energyRes.data ?? []) as any[];
  const tacit   = (tacitRes.data ?? []) as any[];

  // Build compact summary
  const ritualSummary = rituals.length
    ? `Rituals (${rituals.length}): ` +
      rituals.map((r: any) => `${r.name}(streak=${r.streak},completed=${r.completed})`).join("; ")
    : "No ritual data";

  const taskSummary = tasks.length
    ? `Recurring tasks (${tasks.length}): ` +
      tasks.map((t: any) => `${t.title}(status=${t.status},streak=${t.streak ?? 0},completions=${t.completed_count ?? 0})`).join("; ")
    : "No recurring task data";

  const moodSummary = journal.length
    ? `Mood entries (${journal.length}): ` +
      journal.map((j: any) => `${j.created_at?.slice(0, 10)}:${j.mood}`).join(", ")
    : "No journal mood data";

  const energySummary = energy.length
    ? `Energy systems: ` +
      energy.map((e: any) => `${e.type}(${e.current_value}/${e.max_value})`).join(", ")
    : "No energy data";

  const tacitSummary = tacit.length
    ? `Known rules/corrections: ` + tacit.map((t: any) => `[${t.category}] ${t.value}`).join("; ")
    : "No tacit rules recorded";

  const dataBlock = [ritualSummary, taskSummary, moodSummary, energySummary, tacitSummary].join("\n");

  if (!OPENAI_KEY) {
    console.warn("[mavis-pattern-insights] OPENAI_API not set, skipping AI analysis");
    return 0;
  }

  const prompt = `You are MAVIS analyzing operator behavioral patterns. Based on this data, identify 3-5 actionable insights about patterns, correlations, or risks the operator should know. Focus on: habit completion trends, energy patterns, journal mood correlations, stalled streaks, and overlooked areas.

DATA:
${dataBlock}

Return ONLY a valid JSON array with no prose:
[{"title": "...", "insight": "...", "category": "habit|energy|mood|streak|opportunity", "severity": "info|warning|critical"}]`;

  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1200,
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    console.error("[mavis-pattern-insights] OpenAI error:", aiRes.status, errText.slice(0, 200));
    return 0;
  }

  const aiData = await aiRes.json() as any;
  const rawContent: string = aiData?.choices?.[0]?.message?.content ?? "";

  // Parse the JSON array from AI response
  const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error("[mavis-pattern-insights] AI returned non-JSON:", rawContent.slice(0, 200));
    return 0;
  }

  let insights: any[];
  try {
    insights = JSON.parse(jsonMatch[0]);
  } catch {
    console.error("[mavis-pattern-insights] JSON parse error");
    return 0;
  }

  if (!Array.isArray(insights) || insights.length === 0) return 0;

  const generatedAt = new Date().toISOString();
  let inserted = 0;

  for (const ins of insights) {
    if (!ins.title || !ins.insight) continue;

    const { error } = await supabase
      .from("mavis_insights")
      .upsert(
        {
          user_id:      userId,
          title:        String(ins.title).slice(0, 200),
          content:      String(ins.insight).slice(0, 1000),
          category:     ins.category ?? "opportunity",
          severity:     ins.severity ?? "info",
          source:       "pattern_detection",
          generated_at: generatedAt,
        },
        { onConflict: "user_id,title" },
      );

    if (!error) inserted++;
    else console.error("[mavis-pattern-insights] upsert error:", error.message);
  }

  return inserted;
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Fetch all user profiles
    const { data: profiles, error: profilesErr } = await supabase
      .from("profiles")
      .select("id, telegram_chat_id")
      .limit(200);

    if (profilesErr) throw profilesErr;
    if (!profiles?.length) {
      return new Response(
        JSON.stringify({ ok: true, users_processed: 0, insights_generated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let totalInsights = 0;
    const results: { userId: string; insights: number }[] = [];

    for (const profile of profiles as any[]) {
      try {
        const count = await analyzeUser(profile.id);
        results.push({ userId: profile.id, insights: count });
        totalInsights += count;

        // Notify via Telegram if user has a chat_id configured and we got insights
        if (count > 0 && profile.telegram_chat_id) {
          await sendTelegram(
            profile.telegram_chat_id,
            `MAVIS Pattern Report\n\n${count} new insight${count !== 1 ? "s" : ""} detected from your last 30 days.\n\nOpen the app to review them under Insights.`,
          );
        }
      } catch (userErr: any) {
        console.error(`[mavis-pattern-insights] user ${profile.id} failed:`, userErr?.message);
      }
    }

    return new Response(
      JSON.stringify({
        ok:               true,
        users_processed:  profiles.length,
        insights_generated: totalInsights,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[mavis-pattern-insights]", err?.message ?? err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
