import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { audio_base64, mime_type = "audio/webm" } = await req.json();
    if (!audio_base64) {
      return new Response(JSON.stringify({ error: "audio_base64 is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: mime_type, data: audio_base64 } },
              { text: `Transcribe this audio recording accurately. Then provide a 1-sentence title for a journal entry. Return JSON only, no markdown: { "transcript": "...", "suggested_title": "...", "mood": "focused|energized|reflective|tired|motivated|anxious" }` },
            ],
          }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const geminiData = await res.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    let parsed: { transcript?: string; suggested_title?: string; mood?: string } = {};
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { transcript: rawText, suggested_title: "Voice Memo", mood: "reflective" };
    }

    const transcript = parsed.transcript ?? "";
    const wordCount = transcript.trim().split(/\s+/).length;
    const duration_seconds = Math.round((wordCount / 150) * 60);

    return new Response(
      JSON.stringify({
        transcript,
        suggested_title: parsed.suggested_title ?? "Voice Memo",
        mood: parsed.mood ?? "reflective",
        duration_seconds,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("mavis-transcribe-memo error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
