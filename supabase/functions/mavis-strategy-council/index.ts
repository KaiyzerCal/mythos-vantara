// mavis-strategy-council
// Assembles a board of 5 advisor personas to analyze strategic decisions.
// Uses Claude Opus 4 with extended thinking (20K budget) for synthesis.
// This is MAVIS's highest-reasoning capability — reserve for major decisions.

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

const ADVISORS = [
  {
    role: "STRATEGIST",
    persona: "A seasoned business strategist with 20+ years building companies from 0 to exit. You think in systems, incentives, and competitive moats. You are direct and not afraid to challenge assumptions.",
    focus: "Long-term positioning, competitive dynamics, resource allocation, strategic optionality",
  },
  {
    role: "DEVIL'S ADVOCATE",
    persona: "A contrarian thinker whose job is to find every flaw, risk, and hidden assumption. You are not negative — you are rigorous. You surface what others miss.",
    focus: "Risks, blind spots, alternative interpretations, worst-case scenarios",
  },
  {
    role: "OPERATOR",
    persona: "A world-class operator who has scaled teams and systems. You think in process, execution, and practical implementation. What matters is what actually gets done.",
    focus: "Execution feasibility, resource requirements, timeline realism, operational dependencies",
  },
  {
    role: "INVESTOR",
    persona: "A capital allocator with a portfolio perspective. You think in expected value, optionality, and asymmetric returns. You always ask: what's the upside vs. downside?",
    focus: "ROI, opportunity cost, capital efficiency, portfolio fit, exit optionality",
  },
  {
    role: "VISIONARY",
    persona: "A first-principles thinker who asks what the world could look like. You see patterns across industries and time horizons. You ask what nobody else is asking.",
    focus: "Future scenarios, second-order effects, paradigm shifts, emerging opportunities",
  },
];

async function runAdvisor(
  advisor: typeof ADVISORS[0],
  question: string,
  context: string,
  operatorContext: string,
): Promise<{ role: string; analysis: string }> {
  if (!ANTHROPIC_KEY) return { role: advisor.role, analysis: "ANTHROPIC_API_KEY not configured." };

  const system = `You are ${advisor.role} on MAVIS's Strategy Council.
Persona: ${advisor.persona}
Your domain: ${advisor.focus}

Operator context: ${operatorContext}

Provide incisive, specific analysis from your unique perspective. Be direct, cite specific considerations, and do not repeat what other advisors would say. 2-3 focused paragraphs.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: `STRATEGIC QUESTION: ${question}\n\nADDITIONAL CONTEXT: ${context || "None provided"}` }],
      }),
    });
    if (!res.ok) return { role: advisor.role, analysis: `Error: ${res.status}` };
    const d = await res.json();
    return { role: advisor.role, analysis: d.content?.find((b: any) => b.type === "text")?.text ?? "" };
  } catch (err: any) {
    return { role: advisor.role, analysis: `Error: ${err.message}` };
  }
}

async function synthesize(
  question: string,
  advisorOutputs: Array<{ role: string; analysis: string }>,
  operatorContext: string,
): Promise<{ synthesis: string; recommendation: string; confidence: number }> {
  if (!ANTHROPIC_KEY) return { synthesis: "Requires ANTHROPIC_API_KEY.", recommendation: "", confidence: 0.5 };

  const advisorSummary = advisorOutputs.map(a => `[${a.role}]:\n${a.analysis}`).join("\n\n---\n\n");

  const system = `You are MAVIS — a sovereign-class AI performing a master synthesis of your Strategy Council's analysis.
Operator context: ${operatorContext}
Your job: integrate all advisor perspectives into a coherent, actionable recommendation.`;

  const prompt = `STRATEGIC QUESTION: ${question}

COUNCIL ANALYSIS:
${advisorSummary}

Synthesize this into:
1. SYNTHESIS: A 3-4 paragraph integrated analysis that weaves together the key insights from all advisors, resolves tensions, and builds toward a conclusion
2. RECOMMENDATION: A clear, specific recommendation with the 3 most important next actions
3. CONFIDENCE: Your confidence in this recommendation (0.0-1.0)

Format as JSON: {"synthesis": "...", "recommendation": "...", "confidence": 0.0-1.0}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "interleaved-thinking-2025-05-14",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 20000,
        thinking: { type: "enabled", budget_tokens: 16000 },
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Claude Opus error: ${res.status}`);
    const d = await res.json();
    const text = d.content?.find((b: any) => b.type === "text")?.text ?? "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      synthesis: String(parsed.synthesis ?? ""),
      recommendation: String(parsed.recommendation ?? ""),
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.75))),
    };
  } catch {
    const fallback = advisorOutputs.map(a => `${a.role}: ${a.analysis.slice(0, 200)}`).join("\n\n");
    return { synthesis: fallback, recommendation: "Review advisor outputs above for guidance.", confidence: 0.6 };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  // Support service-role calls from mavis-agent (user_id in body)
  let userId: string;
  if (token === SB_KEY) {
    if (!body.user_id) return json({ error: "user_id required for service-role calls" }, 400);
    userId = String(body.user_id);
  } else {
    const { data: { user } } = await createClient(SB_URL, SB_KEY).auth.getUser(token);
    if (!user) return json({ error: "Unauthorized" }, 401);
    userId = user.id;
  }

  const question = String(body.question ?? "");
  const context = String(body.context ?? "");
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];

  if (!question || question.length < 10) return json({ error: "question must be at least 10 characters" }, 400);

  try {
    // Fetch operator context
    const [profileRes, worldModelRes, narrativeRes] = await Promise.all([
      sb().from("profiles").select("display_name,rank,level").eq("id", userId).maybeSingle(),
      sb().from("mavis_world_model").select("summary").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb().from("mavis_narrative").select("identity_summary").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const profile = profileRes.data;
    const worldModel = worldModelRes.data;
    const narrative = narrativeRes.data;

    const operatorContext = [
      profile ? `${profile.display_name ?? "Operator"} (${profile.rank ?? "unknown"} L${profile.level ?? 1})` : "",
      narrative?.identity_summary ?? "",
      worldModel?.summary ?? "",
    ].filter(Boolean).join(" | ");

    // Run all 5 advisors in parallel
    const advisorOutputs = await Promise.all(
      ADVISORS.map(advisor => runAdvisor(advisor, question, context, operatorContext))
    );

    // Synthesize with Opus + extended thinking
    const { synthesis, recommendation, confidence } = await synthesize(question, advisorOutputs, operatorContext);

    // Save memo
    const { data: memo } = await sb()
      .from("mavis_strategy_memos")
      .insert({
        user_id: userId,
        question,
        synthesis,
        advisor_outputs: advisorOutputs,
        recommendation,
        confidence,
        tags,
      })
      .select("id")
      .single();

    return json({
      memo_id: memo?.id,
      question,
      advisor_outputs: advisorOutputs,
      synthesis,
      recommendation,
      confidence,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[strategy-council]", msg);
    return json({ error: msg }, 500);
  }
});
