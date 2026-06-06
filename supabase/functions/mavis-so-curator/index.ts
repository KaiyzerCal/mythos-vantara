// mavis-so-curator
// Curator loop for standing order templates (Hermes pattern).
// Runs weekly (Sunday 2am UTC). Reviews underperforming templates,
// proposes improvements or archives stale ones. Never auto-deletes.
// Lifecycle: active → archived (always recoverable).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CURATOR_PROMPT = `You are a procedure curator reviewing standing order templates. Your job is to:
1. Identify underperforming templates (high usage but low success rate, or never used after 30+ days)
2. Propose specific improvements to struggling templates
3. Mark stale templates for archiving (not deletion — always recoverable)

For each template, output a JSON action:
{"action": "improve" | "archive" | "keep", "reason": "...", "improved_instructions": "..." (only for improve)}

Be specific in improvements. Base recommendations on usage_count, success_count, and last_used_at.
Keep the operator's intent — only suggest tactical improvements, not wholesale replacements.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiKey   = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GOOGLE_AI_API_KEY") ?? "";
  const claudeKey   = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const openaiKey   = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

  const sb = createClient(supabaseUrl, serviceKey);

  // Get all active templates that are old enough to evaluate (created 7+ days ago)
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: templates, error } = await sb
    .from("standing_order_templates")
    .select("id, user_id, slug, name, description, instructions, usage_count, success_count, last_used_at, created_at, category")
    .eq("status", "active")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error || !templates?.length) {
    return new Response(JSON.stringify({ reviewed: 0, message: "No templates to review" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let improved = 0;
  let archived = 0;
  const kept: string[] = [];

  for (const template of templates as any[]) {
    try {
      const daysSinceCreated = (Date.now() - new Date(template.created_at).getTime()) / 86400000;
      const daysSinceUsed = template.last_used_at
        ? (Date.now() - new Date(template.last_used_at).getTime()) / 86400000
        : daysSinceCreated;

      const successRate = template.usage_count > 0
        ? template.success_count / template.usage_count
        : null;

      // Determine if this template needs review
      const isStale = daysSinceUsed > 30 && template.usage_count < 3;
      const isStruggling = template.usage_count >= 3 && successRate !== null && successRate < 0.4;

      if (!isStale && !isStruggling) {
        kept.push(template.slug);
        continue;
      }

      const templateContext = `
Template: ${template.name} (${template.slug})
Category: ${template.category}
Description: ${template.description ?? "None"}
Instructions: ${(template.instructions ?? "").slice(0, 500)}
Usage count: ${template.usage_count}
Success count: ${template.success_count}
Success rate: ${successRate !== null ? `${Math.round(successRate * 100)}%` : "N/A (never used)"}
Days since last used: ${Math.round(daysSinceUsed)}
Days since created: ${Math.round(daysSinceCreated)}
Issue: ${isStale ? "Stale — not used in 30+ days" : "Struggling — below 40% success rate"}`;

      let raw = "";

      if (geminiKey) {
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: CURATOR_PROMPT }] },
              contents: [{ role: "user", parts: [{ text: templateContext }] }],
              generationConfig: { maxOutputTokens: 500, temperature: 0.2 },
            }),
          });
          if (r.ok) { const d = await r.json(); raw = d.candidates?.[0]?.content?.parts?.[0]?.text ?? ""; }
        } catch { /* try next */ }
      }

      if (!raw && claudeKey) {
        try {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 500,
              system: CURATOR_PROMPT,
              messages: [{ role: "user", content: templateContext }],
            }),
          });
          if (r.ok) { const d = await r.json(); raw = d.content?.[0]?.text ?? ""; }
        } catch { /* try next */ }
      }

      if (!raw && openaiKey) {
        try {
          const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "system", content: CURATOR_PROMPT }, { role: "user", content: templateContext }],
              max_tokens: 500,
              temperature: 0.2,
            }),
          });
          if (r.ok) { const d = await r.json(); raw = d.choices?.[0]?.message?.content ?? ""; }
        } catch { /* give up on this template */ }
      }

      if (!raw) continue;

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      let decision: any;
      try { decision = JSON.parse(jsonMatch[0]); } catch { continue; }

      if (decision.action === "archive") {
        await sb.from("standing_order_templates").update({
          status: "archived",
          updated_at: new Date().toISOString(),
        }).eq("id", template.id);
        archived++;
      } else if (decision.action === "improve" && decision.improved_instructions) {
        await sb.from("standing_order_templates").update({
          instructions: String(decision.improved_instructions).slice(0, 5000),
          version: (template.version ?? 1) + 1,
          updated_at: new Date().toISOString(),
        }).eq("id", template.id);
        improved++;
      }
    } catch (e) {
      console.error(`[SO Curator] Failed on ${template.slug}:`, (e as Error).message);
    }
  }

  return new Response(JSON.stringify({
    reviewed: templates.length,
    improved,
    archived,
    kept: kept.length,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
