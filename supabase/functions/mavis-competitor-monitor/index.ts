import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { callWithFallback } from "../_shared/providers.ts";
import { reembedRow } from "../_shared/reembedRow.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SB_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const BROWSER_URL   = Deno.env.get("BROWSER_URL") ?? "";
const PROVIDER_KEYS = {
  openai: Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "",
  claude: ANTHROPIC_KEY,
  grok:   Deno.env.get("GROK_API_KEY") ?? Deno.env.get("XAI_API_KEY") ?? "",
  gemini: Deno.env.get("GEMINI_API_KEY") ?? "",
  groq:   Deno.env.get("GROQ_API_KEY") ?? "",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getUserId(req: Request, sb: ReturnType<typeof createClient>): Promise<string | null> {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;

    const secret = Deno.env.get("SUPABASE_JWT_SECRET");
    const parts = token.split(".");
    // Manual HMAC verification only applies to HS256-signed tokens. Projects
    // migrated to asymmetric (ES256) signing keys silently failed this check
    // forever (secret being set was wrongly treated as "this is HS256") —
    // now only attempted when the token's own header says HS256; anything
    // else (including an HMAC failure) falls through to Supabase directly.
    let alg: string | undefined;
    try {
      const headerB64 = parts[0]?.replace(/-/g, "+").replace(/_/g, "/") ?? "";
      alg = JSON.parse(atob(headerB64 + "=".repeat((4 - (headerB64.length % 4)) % 4))).alg;
    } catch { /* fall through */ }
    if (secret && alg === "HS256" && parts.length === 3) {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signedPart = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const b64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const sig = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const valid = await crypto.subtle.verify("HMAC", key, sig, signedPart);
      if (valid) {
        const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4)));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload.sub ?? null;
      }
    }

    const { data } = await sb.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function hashContent(content: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchSiteContent(url: string): Promise<string> {
  if (BROWSER_URL) {
    const res = await fetch(`${BROWSER_URL}/browse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, extract: "text" }),
      signal: AbortSignal.timeout(45000),
    });
    if (res.ok) {
      const data = await res.json();
      return String(data.text ?? "");
    }
  }

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MAVIS/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function analyzeChange(oldContent: string, newContent: string): Promise<{
  changes: string[];
  significance: "minor" | "moderate" | "major";
  insight: string;
}> {
  const prompt = `Compare these two website snapshots and summarize what changed:\n\nOLD:\n${oldContent.slice(0, 2000)}\n\nNEW:\n${newContent.slice(0, 2000)}\n\nReturn JSON only: { "changes": string[], "significance": "minor"|"moderate"|"major", "insight": string }`;

  const text = (await callWithFallback("claude", [{ role: "user", content: prompt }], "", PROVIDER_KEYS)).content || "{}";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Failed to parse AI response");
  return JSON.parse(match[0]);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(SB_URL, SB_KEY);
    const userId = await getUserId(req, sb);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "check");

    if (action === "add") {
      const name = String(body.name ?? "").trim();
      const url  = String(body.url ?? "").trim();
      if (!name || !url) return json({ error: "name and url are required" }, 400);

      const { data, error } = await sb
        .from("mavis_competitors")
        .insert({ user_id: userId, name, url, changes_detected: 0 })
        .select()
        .single();

      if (error) throw error;
      return json({ competitor: data });
    }

    // action === "check" (default)
    const { data: competitors, error: listErr } = await sb
      .from("mavis_competitors")
      .select("*")
      .eq("user_id", userId);

    if (listErr) throw listErr;
    if (!competitors?.length) return json({ checked: 0, changes: 0 });

    let checked = 0;
    let changesFound = 0;
    const now = new Date().toISOString();

    for (const competitor of competitors) {
      try {
        const content = await fetchSiteContent(competitor.url);
        const newHash = await hashContent(content);
        checked++;

        if (newHash !== competitor.last_content_hash) {
          const oldContent = (competitor.snapshot as any)?.content ?? "";

          const hasAnyKey = PROVIDER_KEYS.gemini || PROVIDER_KEYS.groq || PROVIDER_KEYS.claude || PROVIDER_KEYS.openai || PROVIDER_KEYS.grok;
          if (hasAnyKey && oldContent) {
            try {
              const analysis = await analyzeChange(oldContent, content);

              const { data: changeInsight } = await sb.from("mavis_insights").insert({
                user_id: userId,
                title: `${competitor.name} — Site Change Detected`,
                content: analysis.insight,
                category: "competitive",
                severity: analysis.significance === "major" ? "warning" : "info",
                generated_at: now,
              }).select("id").single();
              const changeInsightId = changeInsight?.id;
              if (changeInsightId) reembedRow(sb, "mavis_insights", String(changeInsightId), userId);
            } catch (aiErr) {
              console.error(`[competitor-monitor] AI analysis failed for ${competitor.name}:`, aiErr);
            }
          }

          await sb.from("mavis_competitors").update({
            last_content_hash: newHash,
            last_checked_at: now,
            changes_detected: (competitor.changes_detected ?? 0) + 1,
            snapshot: { content: content.slice(0, 5000) },
          }).eq("id", competitor.id);

          changesFound++;
        } else {
          await sb.from("mavis_competitors").update({ last_checked_at: now }).eq("id", competitor.id);
        }
      } catch (fetchErr) {
        console.error(`[competitor-monitor] Failed to check ${competitor.url}:`, fetchErr);
      }
    }

    return json({ checked, changes: changesFound });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
