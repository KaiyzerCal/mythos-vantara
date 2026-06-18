// mavis-compound-learning
// Records learning signals and synthesizes them into operator preferences.
// Called after significant interactions to capture what worked and what didn't.
// Also runs weekly to consolidate signals into lasting preference updates.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const sb = () => createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function consolidateSignals(userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: signals } = await sb()
    .from("mavis_learning_signals")
    .select("signal_type,context,response_excerpt,mode,tool_used,learned_preference")
    .eq("user_id", userId)
    .gte("created_at", cutoff)
    .limit(100);

  if (!signals || signals.length < 5) return 0;
  if (!ANTHROPIC_KEY) return 0;

  const signalSummary = signals.map((s: any) =>
    `[${s.signal_type}] Mode:${s.mode || "?"} Tool:${s.tool_used || "?"} — ${s.context.slice(0, 80)} → ${s.learned_preference || s.response_excerpt.slice(0, 60)}`
  ).join("\n");

  const prompt = `You are MAVIS analyzing learning signals to extract lasting operator preferences.

SIGNALS (last 30 days):
${signalSummary}

Extract 3-6 clear, durable preferences from these patterns. Each preference should be actionable and specific.

Return JSON array:
[{"key": "short_key_snake_case", "value": "specific preference description", "confidence": 0.0-1.0}]

Examples: "response_length: Keep responses under 200 words for quick questions", "code_style: Always provide TypeScript with explicit types"
Return ONLY valid JSON array.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return 0;
    const d = await res.json();
    const text = d.content?.find((b: any) => b.type === "text")?.text ?? "[]";
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return 0;
    const prefs = JSON.parse(m[0]);

    let upserted = 0;
    for (const pref of prefs) {
      if (!pref.key || !pref.value) continue;
      // Upsert into learned preferences
      await sb().from("mavis_learned_preferences").upsert({
        user_id: userId,
        preference_key: String(pref.key).slice(0, 100),
        preference_value: String(pref.value).slice(0, 500),
        confidence: Math.min(1, Math.max(0, Number(pref.confidence ?? 0.7))),
        last_reinforced: new Date().toISOString(),
      }, { onConflict: "user_id,preference_key" });

      // Also sync high-confidence preferences into mavis_tacit for immediate injection
      if (Number(pref.confidence ?? 0) >= 0.8) {
        await sb().from("mavis_tacit").upsert({
          user_id: userId,
          category: "preference",
          key: `learned_${pref.key}`,
          value: String(pref.value).slice(0, 500),
          confidence: Number(pref.confidence),
        }, { onConflict: "user_id,key" });
      }
      upserted++;
    }
    return upserted;
  } catch {
    return 0;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  let body: any = {};
  try { if (req.method === "POST") body = await req.json().catch(() => ({})); } catch { /**/ }

  const action = body.action ?? "record";
  const isCron = Boolean(body?.cron) || action === "consolidate_all";

  if (isCron) {
    // Consolidate for all users
    const { data: users } = await sb().from("mavis_learning_signals").select("user_id").limit(200);
    const uniqueUsers = [...new Set((users ?? []).map((r: any) => r.user_id as string))];
    let total = 0;
    for (const uid of uniqueUsers) {
      try { total += await consolidateSignals(uid); } catch { /**/ }
    }
    return json({ users_processed: uniqueUsers.length, preferences_updated: total });
  }

  // Resolve user
  let userId: string | null = null;
  if (token === SB_KEY && body.user_id) {
    userId = String(body.user_id);
  } else {
    const { data: { user } } = await createClient(SB_URL, SB_KEY).auth.getUser(token);
    userId = user?.id ?? null;
  }
  if (!userId) return json({ error: "Unauthorized" }, 401);

  if (action === "record") {
    // Record a learning signal
    const { signal_type, context, response_excerpt, mode, tool_used, learned_preference } = body;
    if (!signal_type || !context) return json({ error: "signal_type and context required" }, 400);
    const validTypes = ["positive", "negative", "correction", "preference"];
    if (!validTypes.includes(signal_type)) return json({ error: "Invalid signal_type" }, 400);

    await sb().from("mavis_learning_signals").insert({
      user_id: userId,
      signal_type,
      context: String(context).slice(0, 500),
      response_excerpt: String(response_excerpt ?? "").slice(0, 500),
      mode: String(mode ?? ""),
      tool_used: String(tool_used ?? ""),
      learned_preference: String(learned_preference ?? ""),
    });
    return json({ recorded: true });
  }

  if (action === "consolidate") {
    const count = await consolidateSignals(userId);
    return json({ preferences_updated: count });
  }

  if (action === "list") {
    const { data } = await sb().from("mavis_learned_preferences").select("*").eq("user_id", userId).order("confidence", { ascending: false }).limit(30);
    return json({ preferences: data ?? [] });
  }

  return json({ error: "Unknown action. Use record, consolidate, or list." }, 400);
});
