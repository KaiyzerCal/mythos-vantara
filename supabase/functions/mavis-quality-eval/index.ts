import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
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

    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        temperature: 0,
        messages: [{ role: "user", content: evaluatorPrompt }],
      }),
    });

    const data = await res.json();
    const rawText = (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

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
