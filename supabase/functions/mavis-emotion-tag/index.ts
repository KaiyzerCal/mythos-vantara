import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { aiComplete } from "../_shared/providers.ts";
import { isServiceRoleCaller } from "../_shared/auth.ts";

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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_KEY}`,
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

const EMOTIONS = ["joy", "sadness", "anxiety", "determination", "excitement", "gratitude", "frustration", "pride", "tiredness", "focus"];

// Scores through the shared provider cascade (Groq -> OpenAI -> ... -> gateway) instead of Gemini alone: Gemini
// had been out of credit, so with no other path every entry stayed untagged (0 of 77 ever tagged).
async function cascadeTextEmotion(text: string): Promise<Record<string, number>> {
  const { content } = await aiComplete({
    system: `You rate the emotional content of a journal entry. Fiction, worldbuilding and dark themes are the author's creative work: rate the emotion the writing expresses, do not refuse. Return ONLY JSON with these keys, each 0.0 to 1.0: ${EMOTIONS.join(", ")}.`,
    user: text.slice(0, 1500),
  });
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in emotion reply");
  const raw = JSON.parse(m[0]);
  const scores: Record<string, number> = {};
  for (const k of EMOTIONS) {
    const v = Number(raw[k]);
    scores[k] = Number.isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 1000) / 1000)) : 0;
  }
  return scores;
}

async function scoreText(content: string): Promise<{ scores: Record<string, number>; provider: string }> {
  if (HUME_KEY) {
    try { return { scores: await humeTextEmotion(content), provider: "hume" }; }
    catch (e: any) { console.warn("Hume failed, falling back to the cascade:", e.message); }
  }
  try { return { scores: await cascadeTextEmotion(content), provider: "cascade" }; }
  catch (e: any) { console.warn("cascade emotion failed:", e.message); }
  if (GEMINI_KEY) {
    try { return { scores: await geminiTextEmotion(content), provider: "gemini" }; }
    catch (e: any) { console.warn("Gemini emotion failed:", e.message); }
  }
  return { scores: {}, provider: "none" };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Tags journal entries nothing has tagged. Entries written in the app never triggered tagging, and the
// fire-and-forget call from mavis-actions can be cut off when the response returns, so this sweep (cron,
// service-role only) is what actually keeps every entry tagged. A small batch per run keeps it cheap.
async function backfill(limit: number, retryFailed: boolean) {
  let q = sb.from("journal_entries").select("id,user_id,title,content").or("emotion_tagged.is.null,emotion_tagged.eq.false").order("created_at", { ascending: false }).limit(limit);
  q = retryFailed ? q : q.is("emotion_scores", null);
  const { data, error } = await q;
  if (error) throw error;
  let tagged = 0, failed = 0;
  for (const row of (data ?? []) as { id: string; user_id: string; title: string; content: string }[]) {
    const text = `${row.title ?? ""}\n${row.content ?? ""}`.trim();
    if (!text) { await sb.from("journal_entries").update({ emotion_scores: { _skipped: "empty" } }).eq("id", row.id); continue; }
    const { scores } = await scoreText(text);
    if (!Object.keys(scores).length) {
      // Mark it so the sweep does not retry the same entry forever; retry_failed:true re-runs these.
      await sb.from("journal_entries").update({ emotion_scores: { _failed: true } }).eq("id", row.id);
      failed++;
      continue;
    }
    await sb.from("journal_entries").update({ emotion_scores: scores, emotion_tagged: true, dominant_emotion: getDominantEmotion(scores) }).eq("id", row.id);
    tagged++;
  }
  const { count } = await sb.from("journal_entries").select("*", { count: "exact", head: true }).or("emotion_tagged.is.null,emotion_tagged.eq.false").is("emotion_scores", null);
  return { tagged, failed, remaining: count ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));

    if (body.backfill === true) {
      if (!isServiceRoleCaller(req)) return json({ error: "Forbidden: backfill requires the service-role key" }, 403);
      return json({ ok: true, ...(await backfill(Math.min(Number(body.limit) || 8, 20), body.retry_failed === true)) });
    }

    const { journal_entry_id, content, user_id } = body;
    if (!journal_entry_id || !content || !user_id) return json({ error: "journal_entry_id, content, user_id required" }, 400);

    const { scores, provider } = await scoreText(content);
    if (!Object.keys(scores).length) return json({ tagged: false, reason: "no provider could score this entry" });

    const dominant = getDominantEmotion(scores);
    await sb.from("journal_entries")
      .update({ emotion_scores: scores, emotion_tagged: true, dominant_emotion: dominant })
      .eq("id", journal_entry_id)
      .eq("user_id", user_id);

    return json({ tagged: true, provider, dominant, scores });
  } catch (err: any) {
    console.error("mavis-emotion-tag error:", err.message);
    return json({ error: err.message }, 500);
  }
});
