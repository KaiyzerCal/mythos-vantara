// MAVIS Web Scraper — extract structured content from any URL via self-hosted Playwright.
// Requires BROWSER_URL (browser-server/Dockerfile) to be set.
// Falls back to a simple fetch-based HTML parse when BROWSER_URL is unavailable.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BROWSER_URL = Deno.env.get("BROWSER_URL") ?? "";
const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SB_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Minimal HTML-to-text without a browser (JS-less pages only)
async function fetchFallback(url: string): Promise<{ title: string; text: string; links: { text: string; href: string }[] }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MAVIS/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // Strip tags, keep text
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 8000);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const links = [...html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]+)</gi)]
    .slice(0, 30)
    .map((m) => ({ href: m[1], text: m[2].trim() }));
  return { title: titleMatch?.[1]?.trim() ?? url, text: stripped, links };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const url       = String(body.url ?? "").trim();
    const selectors = body.selectors as Record<string, string> | undefined;
    const mode      = String(body.mode ?? "auto"); // auto | browse | scrape

    if (!url) {
      return new Response(JSON.stringify({ error: "url is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Playwright path ───────────────────────────────────────────────────────
    if (BROWSER_URL) {
      const endpoint = selectors ? "/scrape" : "/browse";
      const payload  = selectors
        ? { url, selectors }
        : { url, extract: body.extract ?? "text" };

      const res = await fetch(`${BROWSER_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000),
      });

      if (res.ok) {
        const data = await res.json();
        return new Response(JSON.stringify({ ...data, provider: "playwright" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Simple fetch fallback (JS-less pages) ─────────────────────────────────
    const data = await fetchFallback(url);
    return new Response(JSON.stringify({ ...data, provider: "fetch-fallback" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
