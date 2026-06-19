// mavis-critic-agent
// Quality gate: reviews content before it's sent or published.
// Returns a structured verdict with score, specific feedback, and an improved version.
// Wire before any outbound send — email drafts, tweets, proposals, announcements.
//
// Actions: review | batch_review

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHRO_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const CRITERIA: Record<string, string> = {
  email: "Professional tone, clear subject, actionable CTA, correct grammar, no filler phrases, appropriate length (under 300 words), personalised opener",
  tweet: "Under 280 chars, strong hook in first 5 words, no filler hashtags, direct value statement, authentic voice",
  linkedin: "Professional but human, story structure, insight-dense, clear CTA, no engagement-bait, 300-500 chars ideal",
  proposal: "Clear value prop in first sentence, specific outcomes stated, realistic timeline, no overpromising, professional tone",
  announcement: "Excitement without hype, clear what/why/when, includes link or CTA, appropriate for audience",
  sms: "Under 160 chars, clear sender identity, no spam trigger words, direct",
  general: "Clear, concise, correct grammar, appropriate tone for context",
};

async function callClaude(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHRO_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

async function reviewOne(content: string, type: string, context?: string): Promise<{
  approved: boolean; score: number; feedback: string; issues: string[]; improved: string;
}> {
  const criteria = CRITERIA[type] ?? CRITERIA.general;

  const raw = await callClaude(
    `You are a rigorous content quality reviewer for a high-performance AI system called MAVIS.
Review the provided ${type} content against the given criteria. Be strict but fair.

Output ONLY a JSON object (no markdown, no preamble):
{
  "score": <1-10 integer>,
  "approved": <true if score >= 7>,
  "issues": ["specific issue 1", "specific issue 2"],
  "feedback": "<one concise paragraph>",
  "improved": "<improved version of the content — apply all fixes>"
}`,
    `CONTENT TYPE: ${type}
CRITERIA: ${criteria}
${context ? `CONTEXT: ${context}\n` : ""}
CONTENT TO REVIEW:
${content}`
  );

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch { /* fall through */ }

  return { approved: false, score: 5, feedback: "Review parse error", issues: ["Parse error"], improved: content };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "review");

    if (action === "batch_review") {
      const items = Array.isArray(body.items) ? body.items as Array<{ content: string; type: string; context?: string; id?: string }> : [];
      if (!items.length) return json({ error: "items[] required for batch_review" }, 400);

      const results = await Promise.all(
        items.map(async (item) => ({
          id:     item.id ?? null,
          type:   item.type,
          result: await reviewOne(item.content, item.type, item.context),
        }))
      );

      const allApproved = results.every(r => r.result.approved);
      return json({ all_approved: allApproved, results });
    }

    // Single review
    const content = String(body.content ?? "");
    const type    = String(body.type ?? "general");
    const context = body.context ? String(body.context) : undefined;

    if (!content) return json({ error: "content required" }, 400);

    const result = await reviewOne(content, type, context);
    return json(result);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-critic-agent]", message);
    return json({ error: message }, 500);
  }
});
