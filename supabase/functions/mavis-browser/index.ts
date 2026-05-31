/**
 * mavis-browser — Cloud browser automation via Browserbase REST API.
 *
 * Called by MAVIS when the local stagehand-mcp server isn't running.
 * Provides the same interface as the local Stagehand path without requiring
 * anything installed on the user's machine.
 *
 * Required Supabase secrets:
 *   BROWSERBASE_API_KEY
 *   BROWSERBASE_PROJECT_ID
 *
 * Supported actions:
 *   navigate   — load URL, return text + optional screenshot
 *   extract    — structured extraction with a natural language instruction
 *   screenshot — return base64 PNG of current page
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BB_API   = "https://www.browserbase.com/v1";
const BB_KEY   = Deno.env.get("BROWSERBASE_API_KEY")    ?? "";
const BB_PROJ  = Deno.env.get("BROWSERBASE_PROJECT_ID") ?? "";
const SB_URL   = Deno.env.get("SUPABASE_URL")           ?? "";
const SB_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Auth gate
    const auth   = req.headers.get("Authorization") ?? "";
    const sb     = createClient(SB_URL, SB_KEY);
    const { data: { user }, error: authErr } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

    if (!BB_KEY || !BB_PROJ) {
      return new Response(JSON.stringify({
        error: "Browserbase not configured. Add BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID to Supabase secrets.",
      }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const body = await req.json() as { action: string; url?: string; instruction?: string; schema?: string };
    const { action, url, instruction } = body;

    // Create a Browserbase session
    const sessionRes = await fetch(`${BB_API}/sessions`, {
      method: "POST",
      headers: { "X-BB-API-Key": BB_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: BB_PROJ }),
    });
    if (!sessionRes.ok) throw new Error(`Browserbase session create failed: ${sessionRes.status}`);
    const session = await sessionRes.json() as { id: string; connectUrl: string };

    try {
      // Navigate (via CDP commands through Browserbase REST API)
      if (action === "navigate" || action === "extract" || action === "screenshot") {
        if (!url) throw new Error("url is required");

        // Use Browserbase's page.goto CDP command
        await fetch(`${BB_API}/sessions/${session.id}/navigate`, {
          method: "POST",
          headers: { "X-BB-API-Key": BB_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });

        // Wait for load
        await new Promise(r => setTimeout(r, 2000));

        // Get page content
        const contentRes = await fetch(`${BB_API}/sessions/${session.id}/content`, {
          headers: { "X-BB-API-Key": BB_KEY },
        });
        const content = await contentRes.json() as { text?: string; html?: string };
        const pageText = (content.text ?? content.html ?? "")
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 6000);

        let screenshot: string | undefined;
        if (action === "screenshot" || action === "extract") {
          const shotRes = await fetch(`${BB_API}/sessions/${session.id}/screenshot`, {
            headers: { "X-BB-API-Key": BB_KEY },
          });
          if (shotRes.ok) {
            const buf = await shotRes.arrayBuffer();
            screenshot = btoa(String.fromCharCode(...new Uint8Array(buf)));
          }
        }

        // For extract: call Anthropic with the screenshot + instruction
        let extractedData: string | undefined;
        if (action === "extract" && instruction && screenshot) {
          const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
          if (anthropicKey) {
            const visionRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 1024,
                messages: [{
                  role: "user",
                  content: [
                    { type: "image", source: { type: "base64", media_type: "image/png", data: screenshot } },
                    { type: "text",  text: `${instruction}\n\nAlso use this page text: ${pageText.slice(0, 2000)}` },
                  ],
                }],
              }),
            });
            if (visionRes.ok) {
              const vr = await visionRes.json() as { content: Array<{ text: string }> };
              extractedData = vr.content[0]?.text;
            }
          }
        }

        return new Response(JSON.stringify({
          text:      extractedData ?? pageText,
          screenshot,
          provider:  "browserbase-cloud",
          sessionId: session.id,
        }), { headers: { ...CORS, "Content-Type": "application/json" } });
      }

      throw new Error(`Unknown action: ${action}`);
    } finally {
      // Always close the session
      await fetch(`${BB_API}/sessions/${session.id}`, {
        method: "DELETE",
        headers: { "X-BB-API-Key": BB_KEY },
      }).catch(() => {});
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
