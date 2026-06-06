// mavis-self-evolve
// Weekly self-improvement engine: reads Mavis's own outcome accuracy, behavioral patterns,
// causal chains, and current tacit rules — then uses Claude Opus with extended thinking
// to rewrite its own rules. Underperforming rules get pruned. Successful patterns get
// crystallized into new rules. Confidence levels are adjusted based on evidence.
// Runs weekly Sunday 3am. verify_jwt = false (cron + service-role).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

interface EvolutionPlan {
  rules_to_strengthen: Array<{ key: string; reason: string; confidence_boost: number }>;
  rules_to_weaken: Array<{ key: string; reason: string; confidence_reduction: number }>;
  rules_to_prune: Array<{ key: string; reason: string }>;
  rules_to_add: Array<{ category: string; key: string; value: string; confidence: number; reason: string }>;
  insights: string;
}

interface EvolutionSummary {
  rules_strengthened: number;
  rules_weakened: number;
  rules_pruned: number;
  rules_added: number;
  insights: string;
}

async function evolveFor(userId: string, sb: ReturnType<typeof createClient>): Promise<EvolutionSummary> {
  // ── Step 1: Gather evidence in parallel ──────────────────────────────────
  const [tacitRes, outcomesRes, chainsRes, insightsRes, journalRes, questsRes] = await Promise.all([
    sb.from("mavis_tacit")
      .select("*")
      .eq("user_id", userId)
      .order("confidence", { ascending: false })
      .limit(100),
    sb.from("mavis_outcome_events")
      .select("source_type,prediction_text,outcome_status,confidence_score,actual_outcome")
      .eq("user_id", userId)
      .not("outcome_status", "eq", "pending")
      .order("created_at", { ascending: false })
      .limit(50),
    sb.from("mavis_causal_chains")
      .select("cause,effect,confidence,description,action_implication")
      .eq("user_id", userId)
      .order("confidence", { ascending: false })
      .limit(10),
    sb.from("mavis_insights")
      .select("type,title,content")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
    sb.from("journal_entries")
      .select("content,mood")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
    sb.from("quests")
      .select("title,status,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);

  const tacit = tacitRes.data ?? [];
  const outcomes = outcomesRes.data ?? [];
  const chains = chainsRes.data ?? [];
  const insights = insightsRes.data ?? [];
  // journal and quests used for context but not directly in prompts below
  void journalRes;
  void questsRes;

  // ── Step 2: Build accuracy context ──────────────────────────────────────
  const accuracyByType: Record<string, { confirmed: number; failed: number; partial: number; total: number }> = {};
  for (const o of outcomes) {
    const t = String(o.source_type ?? "unknown");
    if (!accuracyByType[t]) accuracyByType[t] = { confirmed: 0, failed: 0, partial: 0, total: 0 };
    accuracyByType[t].total++;
    if (o.outcome_status === "confirmed") accuracyByType[t].confirmed++;
    else if (o.outcome_status === "failed") accuracyByType[t].failed++;
    else if (o.outcome_status === "partial") accuracyByType[t].partial++;
  }

  const outcomeBlock = Object.entries(accuracyByType).map(([type, stats]) => {
    const accuracy = stats.total > 0 ? Math.round((stats.confirmed / stats.total) * 100) : 0;
    return `  ${type}: ${accuracy}% accuracy (${stats.confirmed} confirmed, ${stats.failed} failed, ${stats.partial} partial of ${stats.total} total)`;
  }).join("\n") || "  No outcome data available yet.";

  // ── Step 3: Claude Opus + extended thinking analysis ─────────────────────
  if (!ANTHROPIC_KEY || tacit.length === 0) {
    return { rules_strengthened: 0, rules_weakened: 0, rules_pruned: 0, rules_added: 0, insights: "Skipped: no API key or no tacit rules." };
  }

  const systemPrompt = `You are Mavis's self-improvement engine. You have full access to Mavis's current operating rules (tacit memory), outcome accuracy data, causal patterns, and behavioral insights. Your job is to make Mavis smarter.

Current date: ${new Date().toISOString().slice(0, 10)}
Operator ID: ${userId}`;

  const userPrompt = `
CURRENT TACIT RULES (${tacit.length} rules):
${tacit.map((t: any) => `[${t.category}] ${t.key}: "${t.value}" (confidence: ${t.confidence})`).join("\n")}

OUTCOME ACCURACY (last 30 days):
${outcomeBlock}

CAUSAL PATTERNS DISCOVERED:
${chains.length > 0 ? chains.map((c: any) => `• ${c.description} → ${c.action_implication} (confidence: ${c.confidence})`).join("\n") : "  No causal patterns yet."}

BEHAVIORAL INSIGHTS:
${insights.length > 0 ? insights.map((i: any) => `• [${i.type}] ${i.title}: ${i.content}`).join("\n") : "  No behavioral insights yet."}

Based on this evidence, generate a JSON evolution plan:
{
  "rules_to_strengthen": [{"key": "...", "reason": "...", "confidence_boost": 0.05-0.15}],
  "rules_to_weaken": [{"key": "...", "reason": "...", "confidence_reduction": 0.05-0.20}],
  "rules_to_prune": [{"key": "...", "reason": "..."}],
  "rules_to_add": [{"category": "preference|lesson|workflow_habit|standing_order", "key": "...", "value": "...", "confidence": 0.6-0.8, "reason": "..."}],
  "insights": "2-3 sentence narrative of what changed and why"
}

Be conservative: strengthen rules that have ≥70% outcome accuracy. Prune only rules that are actively hurting performance or have <30% accuracy AND ≥5 data points. Add rules only when there is strong evidence (≥3 consistent data points). Prefer boosting existing rules over adding new ones.`;

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "enabled", budget_tokens: 6000 },
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    console.error("[self-evolve] Claude error:", errText);
    return { rules_strengthened: 0, rules_weakened: 0, rules_pruned: 0, rules_added: 0, insights: "Claude API error." };
  }

  const claudeData = await claudeRes.json();
  const rawText = claudeData.content?.find((b: any) => b.type === "text")?.text ?? "";

  // Parse JSON from response
  let plan: EvolutionPlan = {
    rules_to_strengthen: [],
    rules_to_weaken: [],
    rules_to_prune: [],
    rules_to_add: [],
    insights: "",
  };

  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      plan = {
        rules_to_strengthen: Array.isArray(parsed.rules_to_strengthen) ? parsed.rules_to_strengthen : [],
        rules_to_weaken: Array.isArray(parsed.rules_to_weaken) ? parsed.rules_to_weaken : [],
        rules_to_prune: Array.isArray(parsed.rules_to_prune) ? parsed.rules_to_prune : [],
        rules_to_add: Array.isArray(parsed.rules_to_add) ? parsed.rules_to_add : [],
        insights: String(parsed.insights ?? ""),
      };
    }
  } catch (err) {
    console.error("[self-evolve] JSON parse error:", err);
    return { rules_strengthened: 0, rules_weakened: 0, rules_pruned: 0, rules_added: 0, insights: "Failed to parse evolution plan." };
  }

  // Build a lookup map of tacit rules for quick reference
  const tacitByKey: Record<string, any> = {};
  for (const t of tacit) {
    tacitByKey[String(t.key)] = t;
  }

  let strengthened = 0;
  let weakened = 0;
  let pruned = 0;
  let added = 0;

  // ── Step 4: Execute the evolution plan ───────────────────────────────────

  // 4a. Strengthen rules
  for (const item of plan.rules_to_strengthen) {
    const key = String(item.key ?? "");
    const boost = Math.min(0.15, Math.max(0.05, Number(item.confidence_boost ?? 0.05)));
    if (!key) continue;
    const existing = tacitByKey[key];
    if (!existing) continue;

    const oldConf = Number(existing.confidence ?? 0.5);
    const newConf = Math.min(0.99, oldConf + boost);

    const { error } = await sb.from("mavis_tacit")
      .update({ confidence: newConf, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("key", key);

    if (!error) {
      await sb.from("mavis_evolution_log").insert({
        user_id: userId,
        evolution_type: "rule_strengthened",
        affected_key: key,
        old_value: existing.value,
        new_value: existing.value,
        old_confidence: oldConf,
        new_confidence: newConf,
        reason: String(item.reason ?? "").slice(0, 500),
      });
      strengthened++;
    }
  }

  // 4b. Weaken rules
  for (const item of plan.rules_to_weaken) {
    const key = String(item.key ?? "");
    const reduction = Math.min(0.20, Math.max(0.05, Number(item.confidence_reduction ?? 0.05)));
    if (!key) continue;
    const existing = tacitByKey[key];
    if (!existing) continue;

    const oldConf = Number(existing.confidence ?? 0.5);
    const newConf = Math.max(0.1, oldConf - reduction);

    const { error } = await sb.from("mavis_tacit")
      .update({ confidence: newConf, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("key", key);

    if (!error) {
      await sb.from("mavis_evolution_log").insert({
        user_id: userId,
        evolution_type: "rule_weakened",
        affected_key: key,
        old_value: existing.value,
        new_value: existing.value,
        old_confidence: oldConf,
        new_confidence: newConf,
        reason: String(item.reason ?? "").slice(0, 500),
      });
      weakened++;
    }
  }

  // 4c. Prune rules
  for (const item of plan.rules_to_prune) {
    const key = String(item.key ?? "");
    if (!key) continue;
    const existing = tacitByKey[key];
    if (!existing) continue;

    const { error } = await sb.from("mavis_tacit")
      .delete()
      .eq("user_id", userId)
      .eq("key", key);

    if (!error) {
      await sb.from("mavis_evolution_log").insert({
        user_id: userId,
        evolution_type: "rule_pruned",
        affected_key: key,
        old_value: existing.value,
        new_value: null,
        old_confidence: Number(existing.confidence ?? 0),
        new_confidence: null,
        reason: String(item.reason ?? "").slice(0, 500),
      });
      pruned++;
    }
  }

  // 4d. Add new rules
  for (const item of plan.rules_to_add) {
    const key = String(item.key ?? "");
    const value = String(item.value ?? "");
    const category = String(item.category ?? "lesson_learned");
    const confidence = Math.min(0.8, Math.max(0.6, Number(item.confidence ?? 0.7)));
    if (!key || !value) continue;

    // Map category aliases used by Claude to valid DB values
    const categoryMap: Record<string, string> = {
      preference: "preference",
      lesson: "lesson_learned",
      lesson_learned: "lesson_learned",
      workflow_habit: "workflow_habit",
      standing_order: "standing_order",
      communication_style: "communication_style",
      hard_rule: "hard_rule",
    };
    const validCategory = categoryMap[category] ?? "lesson_learned";

    const { error } = await sb.from("mavis_tacit").upsert({
      user_id: userId,
      category: validCategory,
      key,
      value,
      confidence,
      source: "self-evolve",
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,key" });

    if (!error) {
      await sb.from("mavis_evolution_log").insert({
        user_id: userId,
        evolution_type: "rule_added",
        affected_key: key,
        old_value: null,
        new_value: value,
        old_confidence: null,
        new_confidence: confidence,
        reason: String(item.reason ?? "").slice(0, 500),
      });
      added++;
    }
  }

  // ── Step 5: Store evolution summary in tacit ─────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  await sb.from("mavis_tacit").upsert([
    {
      user_id: userId,
      category: "preference",
      key: "last_evolution_date",
      value: today,
      confidence: 0.99,
      source: "self-evolve",
      updated_at: new Date().toISOString(),
    },
    {
      user_id: userId,
      category: "preference",
      key: "evolution_summary",
      value: plan.insights || `Evolution run on ${today}: ${strengthened} strengthened, ${weakened} weakened, ${pruned} pruned, ${added} added.`,
      confidence: 0.99,
      source: "self-evolve",
      updated_at: new Date().toISOString(),
    },
  ], { onConflict: "user_id,key" });

  // ── Step 6: Return summary ────────────────────────────────────────────────
  return {
    rules_strengthened: strengthened,
    rules_weakened: weakened,
    rules_pruned: pruned,
    rules_added: added,
    insights: plan.insights,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  try {
    // GET: return evolution log for a user (last 30 days)
    if (req.method === "GET") {
      const url = new URL(req.url);
      const userId = url.searchParams.get("user_id");
      if (!userId) return json({ error: "user_id required" }, 400);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data, error } = await sb.from("mavis_evolution_log")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: false });

      if (error) return json({ error: error.message }, 500);
      return json({ evolution_log: data ?? [] });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // POST cron: fan out to all users (limit 50)
    if (body.cron === true) {
      const { data: users } = await sb.from("profiles").select("id").limit(50);
      if (!users?.length) return json({ evolved: 0 });

      let evolved = 0;
      const results: Array<{ user_id: string; summary: EvolutionSummary | { error: string } }> = [];

      for (const { id: userId } of users) {
        try {
          const summary = await evolveFor(userId, sb);
          results.push({ user_id: userId, summary });
          evolved++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[self-evolve] user", userId, msg);
          results.push({ user_id: userId, summary: { error: msg } });
        }
      }

      return json({ evolved, results });
    }

    // POST single user
    const userId = String(body.user_id ?? "");
    if (!userId) return json({ error: "user_id required" }, 400);

    const summary = await evolveFor(userId, sb);
    return json(summary);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[self-evolve]", msg);
    return json({ error: msg }, 500);
  }
});
