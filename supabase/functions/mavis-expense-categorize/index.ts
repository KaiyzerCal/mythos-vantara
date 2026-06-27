// mavis-expense-categorize — AI auto-categorization for expenses
// Given a description + amount, returns: category, tax_deductible, merchant_type, confidence
// Called from FinancePage on description blur / "Auto-detect" button, and from Plaid webhook.

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.3";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const supabase  = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const CATEGORIES = [
  "food", "travel", "tech", "software", "marketing", "advertising",
  "fitness", "health", "education", "entertainment", "utilities",
  "office_supplies", "professional_services", "subscriptions", "other",
];

const SYSTEM = `You are an expert accountant and expense categorizer.
Given an expense description and amount, classify it into one of these categories:
${CATEGORIES.join(", ")}

Also determine:
- tax_deductible: true if this is a typical business expense (software, marketing, professional services, travel, office supplies, etc.)
- merchant_type: short label for the type of merchant (e.g. "SaaS", "Restaurant", "Airline", "Pharmacy")
- confidence: 0.0–1.0

Respond ONLY with valid JSON, no markdown:
{"category": "...", "tax_deductible": true, "merchant_type": "...", "confidence": 0.9}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
    }

    const { description, amount, currency = "USD" } = await req.json() as {
      description: string;
      amount?: number;
      currency?: string;
    };

    if (!description?.trim()) {
      return new Response(JSON.stringify({ error: "description required" }), { status: 400, headers: CORS });
    }

    const userMsg = `Expense: "${description}"${amount != null ? ` | Amount: ${currency} ${amount}` : ""}`;

    const res = await anthropic.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 120,
      system:     SYSTEM,
      messages:   [{ role: "user", content: userMsg }],
    });

    const raw = ((res.content[0] as { text: string }).text ?? "").trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```\s*$/, ""));
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse LLM response" }), { status: 500, headers: CORS });
    }

    // Clamp category to known values
    if (!CATEGORIES.includes(String(parsed.category))) parsed.category = "other";

    return new Response(JSON.stringify(parsed), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch (err) {
    console.error("[mavis-expense-categorize]", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
