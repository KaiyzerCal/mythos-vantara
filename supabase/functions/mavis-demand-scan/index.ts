import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceRoleCaller, resolveOperatorUid } from "../_shared/auth.ts";
import { callWithFallback } from "../_shared/providers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROK_API_KEY = Deno.env.get("GROK_API_KEY") ?? Deno.env.get("XAI_API_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const PROVIDER_KEYS = {
  openai: Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "",
  claude: ANTHROPIC_API_KEY,
  grok:   GROK_API_KEY,
  gemini: Deno.env.get("GEMINI_API_KEY") ?? "",
  groq:   Deno.env.get("GROQ_API_KEY") ?? "",
};

interface ProductProposal {
  title: string;
  description: string;
  target_audience: string;
  price_cents: number;
  category: string;
  confidence: number;
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

// Free-first cascade (Gemini 2.0 Flash / Groq before paid providers), keeping
// Grok as the designated "primary" tier since real-time trend awareness was
// the original reason Grok was preferred here over Claude.
async function callAI(prompt: string): Promise<string> {
  return (await callWithFallback("grok", [{ role: "user", content: prompt }], "", PROVIDER_KEYS)).content;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!isServiceRoleCaller(req)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    let userId: string | undefined;
    try {
      const body = await req.json();
      userId = body?.userId ?? body?.user_id;
    } catch {
      // body is optional — ignore parse errors
    }
    userId = userId ?? resolveOperatorUid(req) ?? undefined;

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId is required (body or TELEGRAM_OPERATOR_USER_ID env var)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Load operator's top skills
    const { data: skillsData, error: skillsError } = await supabase
      .from("skills")
      .select("name, description")
      .eq("user_id", userId)
      .limit(20);

    if (skillsError) {
      console.error("Error loading skills:", skillsError);
    }

    const skills =
      skillsData && skillsData.length > 0
        ? skillsData.map((s: { name: string; description?: string }) =>
            s.description ? `${s.name}: ${s.description}` : s.name
          )
        : ["general digital product creation", "online business"];

    // 2. Load recent product titles to avoid duplication
    const { data: productsData, error: productsError } = await supabase
      .from("mavis_products")
      .select("title")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (productsError) {
      console.error("Error loading products:", productsError);
    }

    const existingTitles =
      productsData && productsData.length > 0
        ? productsData.map((p: { title: string }) => p.title)
        : [];

    // 3. Load revenue sources and past proposal outcomes for price optimisation
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [revenueRes, pastProposalsRes] = await Promise.all([
      supabase.from("mavis_revenue").select("source, amount").eq("user_id", userId).gte("created_at", thirtyDaysAgo).limit(50),
      supabase.from("mavis_tasks").select("payload, status").eq("user_id", userId).eq("type", "create_product").limit(50),
    ]);

    // Tally revenue by source keyword
    const revenueBySource: Record<string, number> = {};
    for (const r of (revenueRes.data ?? []) as any[]) {
      const src = String(r.source ?? "other").toLowerCase();
      revenueBySource[src] = (revenueBySource[src] ?? 0) + Number(r.amount ?? 0);
    }

    // Tally proposal hit rate by category
    const proposalCounts: Record<string, number> = {};
    const proposalSales: Record<string, number> = {};
    for (const t of (pastProposalsRes.data ?? []) as any[]) {
      const cat = String((t.payload as any)?.category ?? "other").toLowerCase();
      proposalCounts[cat] = (proposalCounts[cat] ?? 0) + 1;
      if (t.status === "completed") proposalSales[cat] = (proposalSales[cat] ?? 0) + 1;
    }

    const hitRateLines: string[] = [];
    for (const cat of Object.keys(proposalCounts)) {
      const total = proposalCounts[cat];
      const sold  = proposalSales[cat] ?? 0;
      hitRateLines.push(`  ${cat}: ${sold}/${total} proposals sold (${Math.round((sold / total) * 100)}% hit rate)`);
    }
    const revenueLines: string[] = Object.entries(revenueBySource)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([src, amt]) => `  ${src}: $${amt.toFixed(2)}`);

    const performanceBlock = [
      hitRateLines.length > 0 ? `Past proposal hit rates (boost confidence for proven categories):\n${hitRateLines.join("\n")}` : "",
      revenueLines.length > 0 ? `Top revenue sources last 30 days:\n${revenueLines.join("\n")}` : "",
    ].filter(Boolean).join("\n\n");

    // 4. Build prompt
    const skillsList = skills.join("\n- ");
    const existingList =
      existingTitles.length > 0
        ? existingTitles.join(", ")
        : "none yet";

    const prompt = `Given these skills/expertise:
- ${skillsList}

And these existing products (do NOT duplicate these):
${existingList}

${performanceBlock ? `PERFORMANCE DATA — use this to calibrate your confidence scores:\n${performanceBlock}\n\n` : ""}Identify the top 5 trending pain points right now in these niches that could become a $19–$97 digital product (guide, prompt pack, template, framework, or mini course).

For each, return a JSON array with objects containing exactly these fields:
- title (string)
- description (string, 1–2 sentences)
- target_audience (string)
- price_cents (integer, e.g. 2700 for $27)
- category (string, one of: guide, prompt_pack, template, framework, mini_course)
- confidence (integer 1–10, boosted for categories with proven sales history)

Respond with ONLY the JSON array, no explanation.`;

    // 4. Call AI via the free-first cascade (Gemini/Groq free tiers, then Grok, then Claude/OpenAI)
    const hasAnyKey = PROVIDER_KEYS.gemini || PROVIDER_KEYS.groq || PROVIDER_KEYS.grok || PROVIDER_KEYS.claude || PROVIDER_KEYS.openai;
    if (!hasAnyKey) {
      return new Response(
        JSON.stringify({ error: "No AI API key configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    const rawResponse = await callAI(prompt);

    // 4 cont. Parse JSON (handle code fences)
    let proposals: ProductProposal[] = [];
    try {
      proposals = JSON.parse(stripCodeFences(rawResponse));
      if (!Array.isArray(proposals)) {
        throw new Error("Parsed value is not an array");
      }
    } catch (parseErr) {
      console.error("Failed to parse AI response:", parseErr, "\nRaw:", rawResponse);
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response", raw: rawResponse }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 5. Insert high-confidence proposals as mavis_tasks
    const highConfidence = proposals.filter((p) => p.confidence >= 7);
    let proposalsCreated = 0;

    for (const proposal of highConfidence) {
      const { error: insertError } = await supabase.from("mavis_tasks").insert({
        user_id: userId,
        type: "create_product",
        status: "requires_confirmation",
        payload: proposal,
      });
      if (insertError) {
        console.error("Error inserting mavis_task for proposal:", proposal.title, insertError);
      } else {
        proposalsCreated++;
      }
    }

    // 6. Return result
    return new Response(
      JSON.stringify({
        success: true,
        proposalsCreated,
        proposals,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unhandled error in mavis-demand-scan:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
