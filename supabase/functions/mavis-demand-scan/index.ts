import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROK_API_KEY = Deno.env.get("GROK_API_KEY") ?? Deno.env.get("XAI_API_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const TELEGRAM_OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID");

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

async function callGrok(prompt: string): Promise<string> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "grok-3-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grok API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callClaude(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
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
    userId = userId ?? TELEGRAM_OPERATOR_USER_ID;

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

    // 3. Build prompt
    const skillsList = skills.join("\n- ");
    const existingList =
      existingTitles.length > 0
        ? existingTitles.join(", ")
        : "none yet";

    const prompt = `Given these skills/expertise:
- ${skillsList}

And these existing products (do NOT duplicate these):
${existingList}

Identify the top 5 trending pain points right now in these niches that could become a $19–$97 digital product (guide, prompt pack, template, framework, or mini course).

For each, return a JSON array with objects containing exactly these fields:
- title (string)
- description (string, 1–2 sentences)
- target_audience (string)
- price_cents (integer, e.g. 2700 for $27)
- category (string, one of: guide, prompt_pack, template, framework, mini_course)
- confidence (integer 1–10)

Respond with ONLY the JSON array, no explanation.`;

    // 4. Call AI (Grok preferred, Claude fallback)
    let rawResponse: string;
    if (GROK_API_KEY) {
      rawResponse = await callGrok(prompt);
    } else if (ANTHROPIC_API_KEY) {
      rawResponse = await callClaude(prompt);
    } else {
      return new Response(
        JSON.stringify({ error: "No AI API key configured (XAI_API_KEY or ANTHROPIC_API_KEY required)" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

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
