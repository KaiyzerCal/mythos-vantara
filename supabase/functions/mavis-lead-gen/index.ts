import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const TAVILY_KEY    = Deno.env.get("TAVILY_API_KEY") ?? "";
const BROWSER_URL   = Deno.env.get("BROWSER_URL") ?? "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function claude(system: string, user: string, maxTokens = 1024): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.content?.[0]?.text ?? "";
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in LLM response");
  return JSON.parse(match[0]);
}

async function webSearch(company: string): Promise<string> {
  if (TAVILY_KEY) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `company site:linkedin.com OR contact info ${company}`,
        api_key: TAVILY_KEY,
        max_results: 5,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const d = await res.json();
      const results = (d.results ?? []) as Array<{ title: string; url: string; content: string }>;
      return results.map((r) => `${r.title}\n${r.url}\n${r.content}`).join("\n\n---\n\n");
    }
  }

  // Fallback: scrape Google search results page
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(company + " CEO founder contact email")}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MAVIS/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const html = await res.text();
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .slice(0, 4000);
    }
  } catch { /* skip */ }

  return "";
}

async function browseSite(url: string): Promise<string> {
  if (!BROWSER_URL) return "";
  try {
    const res = await fetch(`${BROWSER_URL}/browse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, extract: "text" }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      const d = await res.json();
      return String(d.text ?? "").slice(0, 3000);
    }
  } catch { /* skip */ }
  return "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action         = String(body.action ?? "research");
    const company        = String(body.company ?? "").trim();
    const targetRole     = String(body.target_role ?? "").trim();
    const productContext = String(body.product_context ?? "SkyforgeAI — AI automation for SMBs").trim();

    if (action === "list") {
      const { data, error: listErr } = await sb
        .from("mavis_leads")
        .select("*")
        .eq("user_id", user.id)
        .order("score", { ascending: false });
      if (listErr) throw listErr;
      return json({ leads: data ?? [] });
    }

    if (action === "draft_outreach") {
      const leadId = String(body.lead_id ?? "").trim();
      if (!leadId) return json({ error: "lead_id is required for draft_outreach" }, 400);

      const { data: lead, error: leadErr } = await sb
        .from("mavis_leads")
        .select("*")
        .eq("id", leadId)
        .eq("user_id", user.id)
        .single();
      if (leadErr || !lead) return json({ error: "Lead not found" }, 404);

      const draft = await claude(
        "You are an expert B2B copywriter. Write a concise, personalized cold email (under 150 words) that doesn't sound like a template.",
        `Company: ${lead.company_name}\nContact: ${lead.contact_name ?? "Decision maker"} (${lead.contact_title ?? ""})\nResearch: ${lead.research_summary ?? ""}\nProduct: ${productContext}\n\nReturn JSON: { "subject": string, "body": string }`,
        512,
      );

      const parsed = extractJson(draft) as { subject: string; body: string };

      const { error: updateErr } = await sb
        .from("mavis_leads")
        .update({ outreach_draft: `Subject: ${parsed.subject}\n\n${parsed.body}` })
        .eq("id", leadId);
      if (updateErr) throw updateErr;

      return json({ subject: parsed.subject, body: parsed.body, lead_id: leadId });
    }

    // action = "research" (default)
    if (!company) return json({ error: "company is required" }, 400);
    if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const searchContext = await webSearch(company);

    // Guess likely domain for browser fetch
    const guessedDomain = company.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
    const siteContent = await browseSite(`https://${guessedDomain}`);

    const extractPrompt = `Company to research: "${company}"${targetRole ? ` (target role: ${targetRole})` : ""}

Search results:
${searchContext.slice(0, 3000)}

Website content:
${siteContent}

Return JSON only:
{
  "company_name": string,
  "website": string,
  "description": string,
  "key_people": [{ "name": string, "title": string, "linkedin": string }],
  "estimated_size": string,
  "industry": string,
  "pain_points": string[]
}`;

    const extracted = await claude(
      "You are a B2B sales researcher. Extract structured company information from the provided data. Return only valid JSON.",
      extractPrompt,
      800,
    );

    let profile: Record<string, unknown>;
    try {
      profile = extractJson(extracted) as Record<string, unknown>;
    } catch {
      profile = { company_name: company, description: extracted };
    }

    // Score prompt separate to keep token usage predictable
    const scoreText = await claude(
      "You are a B2B sales analyst. Score this lead for SkyforgeAI (AI automation for SMBs, growth-stage companies). Return JSON only: { \"score\": number(1-10), \"rationale\": string }",
      `Company: ${JSON.stringify(profile)}\nTarget role: ${targetRole || "any decision maker"}`,
      256,
    );

    let score = 5;
    try {
      const scoreData = extractJson(scoreText) as { score: number };
      score = Math.min(10, Math.max(1, Number(scoreData.score) || 5));
    } catch { /* use default */ }

    const keyPeople = (profile.key_people as Array<{ name: string; title: string; linkedin?: string }> | undefined) ?? [];
    const primaryContact = keyPeople[0];

    const researchSummary = `${profile.description ?? ""}\n\nKey people: ${keyPeople.map((p) => `${p.name} (${p.title})`).join(", ")}\nSize: ${profile.estimated_size ?? "unknown"}\nIndustry: ${profile.industry ?? "unknown"}\nPain points: ${(profile.pain_points as string[] | undefined ?? []).join(", ")}`;

    const { data: lead, error: insertErr } = await sb
      .from("mavis_leads")
      .insert({
        user_id:          user.id,
        company_name:     String(profile.company_name ?? company),
        contact_name:     primaryContact?.name ?? null,
        contact_title:    primaryContact?.title ?? null,
        contact_email:    null,
        linkedin_url:     primaryContact?.linkedin ?? null,
        research_summary: researchSummary.slice(0, 4000),
        status:           "new",
        score,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;
    return json({ lead, profile });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
