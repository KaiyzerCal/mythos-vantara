import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface PlanStep {
  title: string;
  description: string;
  estimated_minutes: number;
  dependencies: string[];
  tools: string[];
}

interface PlanPhase {
  phase: string;
  description: string;
  steps: PlanStep[];
}

interface GeminiPlan {
  title: string;
  summary: string;
  phases: PlanPhase[];
}

async function decomposePlan(goal: string, context?: string): Promise<GeminiPlan> {
  const prompt = `You are a strategic planning AI. Decompose the following goal into an actionable plan.

GOAL: ${goal}
${context ? `CONTEXT: ${context}` : ""}

Respond with ONLY valid JSON matching this exact schema:
{
  "title": "concise plan title (max 60 chars)",
  "summary": "2-sentence overview",
  "phases": [
    {
      "phase": "Phase name",
      "description": "What this phase achieves",
      "steps": [
        {
          "title": "Step title (max 80 chars)",
          "description": "Clear action description (1-3 sentences)",
          "estimated_minutes": 30,
          "dependencies": [],
          "tools": ["optional: list of tools/resources needed"]
        }
      ]
    }
  ]
}

Rules:
- 2-5 phases
- 2-6 steps per phase
- Steps must be concrete and actionable (not vague like "research")
- estimated_minutes must be realistic (15-480)
- Include only steps that move toward the goal`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p: any) => !p.thought).map((p: any) => p.text).join("");
  if (!text) throw new Error("Empty response from Gemini");

  return JSON.parse(text) as GeminiPlan;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Accept calls from mavis-actions (service key) or direct user auth
    const authHeader = req.headers.get("Authorization") ?? "";

    let userId: string;

    // If called with service key from mavis-actions, body contains user_id directly
    const body = await req.json();
    const { user_id, params } = body as {
      user_id?: string;
      params?: {
        goal: string;
        context?: string;
        auto_create_quests?: boolean;
      };
    };

    if (user_id) {
      // Service-to-service call from mavis-actions
      userId = user_id;
    } else {
      // Direct user call — validate JWT
      const anonKey =
        Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
        Deno.env.get("SUPABASE_ANON_KEY") ??
        "";
      const userClient = createClient(SUPABASE_URL, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const {
        data: { user },
        error: authErr,
      } = await userClient.auth.getUser();
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    // Resolve goal from params or top-level body fields
    const goal = String(params?.goal ?? (body as any).goal ?? "").trim();
    const context = String(params?.context ?? (body as any).context ?? "").slice(0, 1000);
    const autoCreateQuests = params?.auto_create_quests !== false;

    if (!goal || goal.length < 10) {
      return new Response(
        JSON.stringify({ error: "goal must be at least 10 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (goal.length > 500) {
      return new Response(
        JSON.stringify({ error: "goal must be at most 500 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decompose goal into phases/steps via Gemini
    const plan = await decomposePlan(goal, context || undefined);

    // Persist plan row
    const { data: planRow, error: planErr } = await sb
      .from("mavis_plans")
      .insert({
        user_id: userId,
        title: String(plan.title ?? goal).slice(0, 200),
        goal,
        summary: String(plan.summary ?? "").slice(0, 500),
        status: "active",
        context,
        total_steps: plan.phases.reduce((acc, ph) => acc + ph.steps.length, 0),
      })
      .select("id")
      .single();

    if (planErr || !planRow) {
      throw new Error(`Failed to create plan: ${planErr?.message}`);
    }

    const planId = planRow.id;

    // Persist steps and optionally create quests
    const resultPhases: Array<{
      phase: string;
      steps: Array<{
        id: string;
        title: string;
        description: string;
        estimated_minutes: number;
        quest_id?: string;
      }>;
    }> = [];

    let stepOrder = 0;
    for (const ph of plan.phases) {
      const phaseSteps: Array<{
        id: string;
        title: string;
        description: string;
        estimated_minutes: number;
        quest_id?: string;
      }> = [];

      // Optionally create one quest per phase
      let questId: string | undefined;
      if (autoCreateQuests) {
        const { data: questRow } = await sb
          .from("quests")
          .insert({
            user_id: userId,
            title: `[Plan] ${String(ph.phase).slice(0, 120)}`,
            description: String(ph.description ?? "").slice(0, 500),
            status: "active",
            priority: "medium",
            xp_reward: ph.steps.length * 10,
          })
          .select("id")
          .single();
        questId = questRow?.id;
      }

      for (const step of ph.steps) {
        const estimatedMinutes = Math.min(
          480,
          Math.max(15, Number(step.estimated_minutes) || 30)
        );

        const { data: stepRow, error: stepErr } = await sb
          .from("mavis_plan_steps")
          .insert({
            plan_id: planId,
            user_id: userId,
            phase: String(ph.phase).slice(0, 120),
            title: String(step.title ?? "").slice(0, 200),
            description: String(step.description ?? "").slice(0, 1000),
            estimated_minutes: estimatedMinutes,
            status: "pending",
            quest_id: questId ?? null,
            step_order: stepOrder,
          })
          .select("id")
          .single();

        if (stepErr) {
          console.warn("Step insert error:", stepErr.message);
          continue;
        }

        phaseSteps.push({
          id: stepRow!.id,
          title: step.title,
          description: step.description,
          estimated_minutes: estimatedMinutes,
          ...(questId ? { quest_id: questId } : {}),
        });

        stepOrder++;
      }

      resultPhases.push({ phase: ph.phase, steps: phaseSteps });
    }

    return new Response(
      JSON.stringify({
        plan_id: planId,
        title: plan.title,
        summary: plan.summary,
        phases: resultPhases,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("mavis-planner error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
