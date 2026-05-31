// MAVIS Self-Reflection & Correction Synthesis
//
// Periodically runs (or triggered manually) to:
//   1. Fetch all raw "correction" entries from mavis_tacit
//   2. Group them by topic using AI
//   3. Synthesize each group into a durable "hard_rule" or "preference"
//   4. Upsert the synthesized rules back to mavis_tacit
//   5. Optionally send a Telegram summary
//
// Trigger: POST with { user_id?: string } — defaults to TELEGRAM_OPERATOR_USER_ID
// Auth: service-role key required (pass as Authorization: Bearer <service_key>)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callAI(prompt: string, key: string): Promise<string> {
  // Try Lovable gateway (Gemini Flash) first, fallback to Claude Haiku
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (lovableKey) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2000,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const d = await res.json();
        return d?.choices?.[0]?.message?.content ?? "";
      }
    } catch { /* fall through */ }
  }

  // Fallback: Claude Haiku
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (claudeKey) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      const d = await res.json();
      return d?.content?.[0]?.text ?? "";
    }
  }

  throw new Error("No AI key available for self-reflection");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const userId: string = body?.user_id ?? Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? "";
    if (!userId) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all raw corrections
    const { data: corrections, error: fetchErr } = await sb
      .from("mavis_tacit")
      .select("id, key, value, created_at")
      .eq("user_id", userId)
      .eq("category", "correction")
      .order("created_at", { ascending: false })
      .limit(100);

    if (fetchErr) throw fetchErr;
    if (!corrections?.length) {
      return new Response(JSON.stringify({ ok: true, synthesized: 0, message: "No corrections to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const correctionList = (corrections as any[]).map((c: any, i: number) =>
      `${i + 1}. ${c.value}`
    ).join("\n");

    const synthesisPrompt = `You are MAVIS's self-reflection engine. Below are raw operator corrections logged when the operator told MAVIS something was wrong or to stop doing something.

Your job:
1. Group these corrections by topic/theme
2. For each group, write ONE clear, actionable rule in MAVIS's voice (what she must always/never do)
3. Classify each synthesized rule as either "hard_rule" (absolute, non-negotiable) or "preference" (strong preference but context-dependent)

RAW CORRECTIONS:
${correctionList}

Respond with ONLY a valid JSON array. Each element must have:
  - "category": "hard_rule" or "preference"
  - "key": short snake_case identifier (max 40 chars)
  - "value": the synthesized rule (clear, actionable, max 200 chars)
  - "source_count": number of raw corrections this was derived from
  - "confidence": 0.0–1.0 (higher = more certain this is a durable rule)

Example:
[
  {"category":"hard_rule","key":"no_unsolicited_advice","value":"Never give unsolicited life advice unless explicitly asked.","source_count":3,"confidence":0.9},
  {"category":"preference","key":"concise_responses","value":"Operator prefers short, direct answers — avoid lengthy preambles.","source_count":2,"confidence":0.75}
]

Only output the JSON array. No prose.`;

    const aiResponse = await callAI(synthesisPrompt, "");

    // Parse AI output
    const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error(`AI returned non-JSON: ${aiResponse.slice(0, 200)}`);
    }
    const synthesized: any[] = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(synthesized) || synthesized.length === 0) {
      return new Response(JSON.stringify({ ok: true, synthesized: 0, message: "AI found no patterns to synthesize" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert synthesized rules
    const upserted: string[] = [];
    for (const rule of synthesized) {
      if (!rule.key || !rule.value || !rule.category) continue;
      const { error: upsertErr } = await sb
        .from("mavis_tacit")
        .upsert({
          user_id:    userId,
          category:   rule.category,
          key:        `synth_${rule.key}`.slice(0, 60),
          value:      String(rule.value).slice(0, 500),
          confidence: Math.min(1, Math.max(0, Number(rule.confidence) || 0.7)),
          metadata:   { synthesized: true, source_count: rule.source_count ?? 1, synthesized_at: new Date().toISOString() },
        }, { onConflict: "user_id,key" });

      if (!upsertErr) upserted.push(rule.key);
    }

    // Optional Telegram summary
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatId   = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID");
    if (botToken && chatId && upserted.length > 0) {
      const ruleLines = synthesized
        .filter(r => upserted.includes(r.key))
        .map(r => `• [${r.category}] ${r.value}`)
        .join("\n");
      const msg = `MAVIS Self-Reflection Complete\n\nSynthesized ${upserted.length} rule(s) from ${corrections.length} correction(s):\n\n${ruleLines}\n\nThese are now active in standing orders.`;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: msg.slice(0, 4096) }),
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({ ok: true, synthesized: upserted.length, corrections_processed: corrections.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[mavis-self-reflect]", e?.message ?? e);
    return new Response(
      JSON.stringify({ error: e?.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
