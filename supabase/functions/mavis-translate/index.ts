// MAVIS Translate — translate text using LibreTranslate (self-hosted or public)
// or DeepL API (free tier: 500k chars/month).
//
// Self-hosted LibreTranslate (zero cost, ~4GB RAM):
//   docker run -d -p 5000:5000 libretranslate/libretranslate
//   Set: LIBRETRANSLATE_URL=http://your-server:5000
//
// DeepL free tier: set DEEPL_API_KEY (https://www.deepl.com/pro-api)
// Falls back to Gemini translate as last resort.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LIBRETRANSLATE_URL = Deno.env.get("LIBRETRANSLATE_URL") ?? "";
const LIBRETRANSLATE_KEY = Deno.env.get("LIBRETRANSLATE_API_KEY") ?? "";
const DEEPL_KEY          = Deno.env.get("DEEPL_API_KEY") ?? "";
const GEMINI_KEY         = Deno.env.get("GEMINI_API_KEY") ?? "";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
  pt: "Portuguese", ru: "Russian", zh: "Chinese", ja: "Japanese", ko: "Korean",
  ar: "Arabic", hi: "Hindi", nl: "Dutch", pl: "Polish", tr: "Turkish",
  sv: "Swedish", da: "Danish", fi: "Finnish", no: "Norwegian", el: "Greek",
  he: "Hebrew", th: "Thai", vi: "Vietnamese", id: "Indonesian", cs: "Czech",
  hu: "Hungarian", ro: "Romanian", uk: "Ukrainian",
};

async function translateWithLibreTranslate(text: string, source: string, target: string): Promise<string | null> {
  if (!LIBRETRANSLATE_URL) return null;
  try {
    const res = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source: source === "auto" ? "auto" : source, target, format: "text", api_key: LIBRETRANSLATE_KEY || undefined }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.translatedText ?? null;
  } catch {
    return null;
  }
}

async function translateWithDeepL(text: string, source: string, target: string): Promise<string | null> {
  if (!DEEPL_KEY) return null;
  try {
    const isFree = DEEPL_KEY.endsWith(":fx");
    const baseUrl = isFree ? "https://api-free.deepl.com" : "https://api.deepl.com";
    const body = new URLSearchParams({
      text,
      target_lang: target.toUpperCase().replace("-", "_"),
      ...(source !== "auto" ? { source_lang: source.toUpperCase() } : {}),
    });
    const res = await fetch(`${baseUrl}/v2/translate`, {
      method: "POST",
      headers: { "Authorization": `DeepL-Auth-Key ${DEEPL_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.translations?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

async function translateWithGemini(text: string, source: string, target: string): Promise<string | null> {
  if (!GEMINI_KEY) return null;
  try {
    const targetName = LANGUAGE_NAMES[target] ?? target;
    const sourceName = source === "auto" ? "the source language" : (LANGUAGE_NAMES[source] ?? source);
    const prompt = `Translate the following text from ${sourceName} to ${targetName}. Return ONLY the translation, nothing else:\n\n${text}`;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2048 } }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const text   = String(body.text ?? "").trim();
    const target = String(body.target ?? "en").toLowerCase();
    const source = String(body.source ?? "auto").toLowerCase();

    if (!text) {
      return new Response(JSON.stringify({ error: "text is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!LANGUAGE_NAMES[target]) {
      return new Response(JSON.stringify({ error: `Unknown target language "${target}". Supported: ${Object.keys(LANGUAGE_NAMES).join(", ")}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Provider cascade: LibreTranslate → DeepL → Gemini
    let translated: string | null = null;
    let provider = "";

    translated = await translateWithLibreTranslate(text, source, target);
    if (translated) { provider = "libretranslate"; }

    if (!translated) {
      translated = await translateWithDeepL(text, source, target);
      if (translated) { provider = "deepl"; }
    }

    if (!translated) {
      translated = await translateWithGemini(text, source, target);
      if (translated) { provider = "gemini"; }
    }

    if (!translated) {
      return new Response(JSON.stringify({ error: "No translation service available. Configure LIBRETRANSLATE_URL, DEEPL_API_KEY, or GEMINI_API_KEY." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ translatedText: translated, source, target, provider, charCount: text.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
