// mavis-notebook-podcast
// Generates a multi-speaker podcast script from notebook sources.
// The script is in dialogue format; the frontend handles TTS playback.
//
// POST { notebook_id, focus_topic?, num_speakers?: 2|3|4, max_exchanges?: number }
// Returns { title, description, speakers: [{name, voice, role}], segments: [{speaker_index, speaker_name, text}] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_KEY    = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GOOGLE_API_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function verifyAuth(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) return false;
  if (token === SERVICE_KEY) return true;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_KEY },
    });
    return res.ok;
  } catch { return false; }
}

// ── Default speaker profiles ──────────────────────────────────────────────────

const DEFAULT_SPEAKERS = [
  { name: "Alex", role: "Host",     voice: "George",    elevenlabs_id: "JBFqnCBsd6RMkjVDRZzb", kokoro: "bm_george" },
  { name: "Maya", role: "Expert",   voice: "Sarah",     elevenlabs_id: "EXAVITQu4vr4xnSDxMaL", kokoro: "af_sarah"  },
  { name: "Sam",  role: "Guest",    voice: "Liam",      elevenlabs_id: "TX3LPaxmHKxFdv7VOSVN", kokoro: "am_liam"   },
  { name: "Jordan", role: "Narrator", voice: "Charlotte", elevenlabs_id: "XB0fDUnXU5powFXDhCwa", kokoro: "bf_emma" },
];

// ── LLM (Gemini-first, Anthropic fallback) ────────────────────────────────────

async function callLLM(system: string, prompt: string): Promise<string> {
  // Try Gemini 2.0 Flash first (free tier)
  if (GEMINI_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          signal: AbortSignal.timeout(55000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: system }] },
            generationConfig: { maxOutputTokens: 2048 },
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
      }
    } catch { /* fall through */ }
  }

  // Anthropic fallback
  if (!ANTHROPIC_KEY) throw new Error("No LLM provider configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(55000),
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Anthropic ${res.status}`);
  return data.content?.[0]?.text ?? "";
}

// ── Script parser ─────────────────────────────────────────────────────────────

interface Segment { speaker_index: number; speaker_name: string; text: string; }

function parseScript(raw: string, speakerNames: string[]): Segment[] {
  const segments: Segment[] = [];
  // Match [SPEAKER]: text patterns
  const lineRe = /^\[([^\]]+)\]:\s*(.+)/;
  const altRe  = /^([A-Z][A-Z ]+):\s*(.+)/;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let match = lineRe.exec(trimmed) ?? altRe.exec(trimmed);
    if (!match) continue;

    const speakerRaw = match[1].trim();
    const text = match[2].trim();
    if (!text) continue;

    // Find speaker index by name match (case-insensitive)
    const idx = speakerNames.findIndex(n =>
      n.toLowerCase() === speakerRaw.toLowerCase() ||
      speakerRaw.toLowerCase().includes(n.toLowerCase())
    );
    if (idx === -1) continue;

    segments.push({ speaker_index: idx, speaker_name: speakerNames[idx], text });
  }

  return segments;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await verifyAuth(req))) return err("Unauthorized", 401);

  let body: any = {};
  try { body = await req.json(); } catch { return err("Invalid JSON", 400); }

  const { notebook_id, focus_topic = "", num_speakers = 2, max_exchanges = 10 } = body;
  if (!notebook_id) return err("notebook_id required");

  const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Fetch notebook + sources
  const [{ data: notebook }, { data: sources }] = await Promise.all([
    adminSb.from("notebooks").select("title, description").eq("id", notebook_id).single(),
    adminSb.from("notebook_sources").select("title, content, url, source_type").eq("notebook_id", notebook_id).order("created_at"),
  ]);

  if (!notebook) return err("Notebook not found", 404);
  if (!sources || sources.length === 0) return err("Add sources to the notebook before generating a podcast", 400);

  // Build source context (cap each at 1500 chars for token budget)
  const context = (sources as any[]).map((s, i) =>
    `--- Source ${i + 1}: ${s.title} ---\n${(s.content ?? "").slice(0, 1500)}`
  ).join("\n\n");

  // Select speakers
  const speakers = DEFAULT_SPEAKERS.slice(0, Math.min(Math.max(num_speakers, 2), 4));
  const speakerNames = speakers.map(s => s.name);
  const speakerList = speakers.map(s => `${s.name} (${s.role})`).join(", ");

  const episodeTitle = focus_topic
    ? `${notebook.title}: ${focus_topic}`
    : notebook.title;

  const system = `You are a podcast script writer. Write engaging, natural-sounding dialogue.
Speakers: ${speakerList}.
Rules:
- Format each line as: [SPEAKER_NAME]: dialogue text
- Make dialogue feel natural and conversational, not like a lecture
- Each speaker has 1-3 sentences per turn
- Host guides the conversation, Expert provides depth, others add perspectives
- ${max_exchanges} exchanges total (${max_exchanges * speakers.length} total lines approximately)
- Start with a brief intro from the Host, end with a wrap-up
- Do NOT include stage directions, sound effects, or music cues`;

  const prompt = `Create a ${max_exchanges}-exchange podcast episode based on these research sources.

Notebook: "${notebook.title}"
${focus_topic ? `Focus: ${focus_topic}` : ""}

Sources:
${context}

Write the complete podcast script now.`;

  try {
    const raw = await callLLM(system, prompt);
    const segments = parseScript(raw, speakerNames);

    if (segments.length < 3) {
      return err("Failed to generate a parseable podcast script. Try again or add more sources.", 500);
    }

    return ok({
      title: episodeTitle,
      description: `AI-generated podcast from ${sources.length} source${sources.length !== 1 ? "s" : ""}`,
      speakers: speakers.map(({ name, role, voice, elevenlabs_id, kokoro }) => ({ name, role, voice, elevenlabs_id, kokoro })),
      segments,
      raw_script: raw,
    });
  } catch (e: any) {
    return err(e?.message ?? "Failed to generate podcast", 500);
  }
});
