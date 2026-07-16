// mavis-apify — Apify actor proxy
// Calls any Apify actor synchronously and returns dataset items.
// Requires APIFY_API_KEY in Supabase secrets.
//
// POST body: { actorId: string, input: object, timeout?: number (seconds, max 180) }
// GET  ?catalog=1 returns a curated list of recommended actors

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Curated catalog of high-value Apify actors for MAVIS
const ACTOR_CATALOG = [
  // Research & Intelligence
  { id: "louisdeconinck/ai-company-researcher-agent", label: "Company Research", category: "research" },
  { id: "fiery_dream/crypto-intel",                   label: "Crypto Intel",     category: "finance" },
  { id: "visita/global-markets-intelligence",          label: "Financial News",   category: "finance" },
  { id: "louisdeconinck/ai-finance-monitoring-agent",  label: "Finance Monitor",  category: "finance" },
  { id: "apify/competitive-intelligence-agent",        label: "Competitive Intel",category: "research" },
  { id: "bala-ceg/ai-company-researcher",              label: "Company Intel",    category: "research" },
  // Web & Content
  { id: "janbuchar/crawl4ai",                          label: "Web Scraper",      category: "content" },
  { id: "raizen/ai-web-scraper",                       label: "AI Web Scraper",   category: "content" },
  { id: "supreme_coder/youtube-transcript-scraper",    label: "YT Transcript",    category: "content" },
  { id: "dz_omar/youtube-transcript-metadata-extractor", label: "YT Metadata",   category: "content" },
  { id: "apify/ai-web-agent",                          label: "AI Web Agent",     category: "content" },
  // Social & Influencers
  { id: "apify/influencer-discovery-agent",            label: "Influencer Discovery", category: "social" },
  { id: "hypebridge/influencer-discovery-agent-instagram-tiktok", label: "IG+TT Influencers", category: "social" },
  { id: "apify/comments-analyzer-agent",               label: "Comments Analyzer",category: "social" },
  { id: "nextapi/reddit-user-analyzer",                label: "Reddit Analyzer",  category: "social" },
  // Leads & Outreach
  { id: "louisdeconinck/ai-job-search-agent",          label: "Job Search",       category: "leads" },
  { id: "code_crafter/leads-finder",                   label: "Leads Finder",     category: "leads" },
  { id: "daniil.poletaev/backlink-building-agent",     label: "Backlink Builder", category: "leads" },
  // Data & Documents
  { id: "devaditya/pdf-ai-extractor-mcp",              label: "PDF Extractor",    category: "data" },
  { id: "parseforge/audio-transcriber",                label: "Audio Transcriber",category: "data" },
  { id: "valid_headlamp/ai-content-processor",         label: "Content Processor",category: "data" },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Auth check ─────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.replace("Bearer ", "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (token !== serviceRoleKey) {
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const APIFY_KEY = Deno.env.get("APIFY_API_KEY") ?? Deno.env.get("APIFY_TOKEN") ?? "";

  // Catalog endpoint — lists available actors without needing Apify key
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("catalog") === "1") {
    return new Response(JSON.stringify({ catalog: ACTOR_CATALOG }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!APIFY_KEY) {
    return new Response(JSON.stringify({ error: "APIFY_API_KEY not configured. Set it in Supabase secrets vault." }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const actorId: string = body.actorId ?? "";
    const input: Record<string, unknown> = body.input ?? {};
    const timeoutSec = Math.min(Number(body.timeout ?? 60), 180);

    if (!actorId) {
      return new Response(JSON.stringify({ error: "actorId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use run-sync-get-dataset-items for actors that write to a dataset
    // Falls back to run-sync for actors that return output directly
    const apifyUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?timeout=${timeoutSec}`;

    const res = await fetch(apifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${APIFY_KEY}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((timeoutSec + 15) * 1000),
    });

    if (!res.ok) {
      const errText = await res.text();
      // If dataset endpoint fails, try direct run-sync
      if (res.status === 400 || res.status === 404) {
        const runUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync?timeout=${timeoutSec}`;
        const runRes = await fetch(runUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${APIFY_KEY}` },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout((timeoutSec + 15) * 1000),
        });
        if (!runRes.ok) throw new Error(`Apify returned ${runRes.status}: ${await runRes.text()}`);
        const runData = await runRes.json();
        return new Response(JSON.stringify({ ok: true, data: [runData], source: "run-sync" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Apify returned ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return new Response(JSON.stringify({ ok: true, data: Array.isArray(data) ? data : [data] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
