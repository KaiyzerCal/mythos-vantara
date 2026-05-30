import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HUME_KEY = Deno.env.get("HUME_API_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// Hume Expression Measurement: text-based emotion scoring
async function humeTextEmotion(text: string): Promise<Record<string, number>> {
  const res = await fetch("https://api.hume.ai/v0/batch/jobs", {
    method: "POST",
    headers: {
      "X-Hume-Api-Key": HUME_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      models: { language: { granularity: "passage" } },
      text: [text.slice(0, 2000)],
    }),
  });
  if (!res.ok) throw new Error(`Hume API ${res.status}: ${await res.text().catch(() => "")}`);
  const job = await res.json();
  const jobId = job?.job_id;
  if (!jobId) throw new Error("Hume: no job_id returned");

  // Poll for results (max 15s)
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const statusRes = await fetch(`https://api.hume.ai/v0/batch/jobs/${jobId}/predictions`, {
      headers: { "X-Hume-Api-Key": HUME_KEY },
    });
    if (!statusRes.ok) continue;
    const preds = await statusRes.json();
    const emotions: any[] = preds?.[0]?.results?.predictions?.[0]?.models?.language?.grouped_predictions?.[0]?.predictions?.[0]?.emotions ?? [];
    if (emotions.length) {
      const scores: Record<string, number> = {};
      for (const e of emotions) {
        scores[e.name.toLowerCase().replace(/\s+/g, "_")] = Math.round(e.score * 1000) / 1000;
      }
      return scores;
    }
  }
  throw new Error("Hume: timeout waiting for results");
}

// Fallback: Gemini-based emotion scoring (10 emotions, not 48)
async function geminiTextEmotion(text: string): Promise<Record<string, number>> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Rate the emotional content of this journal entry on a scale of 0.0 to 1.0 for each emotion. Return ONLY valid JSON, no markdown:\n\n${text.slice(0, 1500)}\n\nReturn: {"joy":0.0,"sadness":0.0,"anxiety":0.0,"determination":0.0,"excitement":0.0,"gratitude":0.0,"frustration":0.0,"pride":0.0,"tiredness":0.0,"focus":0.0}` }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 200 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini emotion ${res.status}`);
  const d = await res.json();
  const raw = d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return JSON.parse(raw);
}

function getDominantEmotion(scores: Record<string, number>): string {
  const topEntry = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return topEntry?.[0] ?? "neutral";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { journal_entry_id, content, user_id } = await req.json();
    if (!journal_entry_id || !content || !user_id) {
      return new Response(JSON.stringify({ error: "journal_entry_id, content, user_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let scores: Record<string, number> = {};
    let provider = "none";

    if (HUME_KEY) {
      try {
        scores = await humeTextEmotion(content);
        provider = "hume";
      } catch (e: any) {
        console.warn("Hume failed, falling back to Gemini:", e.message);
      }
    }

    if (!Object.keys(scores).length && GEMINI_KEY) {
      try {
        scores = await geminiTextEmotion(content);
        provider = "gemini";
      } catch (e: any) {
        console.warn("Gemini emotion failed:", e.message);
      }
    }

    if (!Object.keys(scores).length) {
      return new Response(JSON.stringify({ tagged: false, reason: "no API keys available" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dominant = getDominantEmotion(scores);

    await sb.from("journal_entries")
      .update({ emotion_scores: scores, emotion_tagged: true, dominant_emotion: dominant })
      .eq("id", journal_entry_id)
      .eq("user_id", user_id);

    return new Response(JSON.stringify({ tagged: true, provider, dominant, scores }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("mavis-emotion-tag error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
