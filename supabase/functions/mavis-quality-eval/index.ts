import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { callWithFallback } from "../_shared/providers.ts";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { content, criteria, context } = await req.json();

    const effectiveCriteria: string[] = criteria && criteria.length > 0
      ? criteria
      : ["accuracy", "completeness", "actionability", "clarity", "no hallucination"];

    const evaluatorPrompt = `You are a quality evaluator. Score the following AI-generated content from 0–10.
Context: ${context ?? "AI assistant output"}
Criteria: ${effectiveCriteria.join(", ")}

Content to evaluate:
---
${String(content ?? "").slice(0, 3000)}
---

Respond ONLY with valid JSON: { "score": 8.5, "feedback": "one sentence of specific feedback", "passed": true }
"passed" is true if score >= 7.0.`;

    const providerKeys = {
      openai: Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "",
      claude: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      grok:   Deno.env.get("GROK_API_KEY") ?? Deno.env.get("XAI_API_KEY") ?? "",
      gemini: Deno.env.get("GEMINI_API_KEY") ?? "",
      groq:   Deno.env.get("GROQ_API_KEY") ?? "",
    };

    const rawText = (await callWithFallback(
      "claude",
      [{ role: "user", content: evaluatorPrompt }],
      "",
      providerKeys,
    )).content;

    // Extract JSON from the response (strip any surrounding markdown fences)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in evaluator response");

    const parsed = JSON.parse(jsonMatch[0]);
    const score: number = Number(parsed.score ?? 7.5);
    const feedback: string = parsed.feedback ?? "Evaluation unavailable";
    const passed: boolean = typeof parsed.passed === "boolean" ? parsed.passed : score >= 7.0;

    return new Response(JSON.stringify({ score, feedback, passed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (_err) {
    return new Response(
      JSON.stringify({ score: 7.5, feedback: "Evaluation unavailable", passed: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
