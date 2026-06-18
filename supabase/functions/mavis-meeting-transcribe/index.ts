import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY    = Deno.env.get("OPENAI_API_KEY") ?? "";
const WHISPER_URL   = Deno.env.get("WHISPER_URL") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

interface ActionItem {
  owner: string;
  action: string;
  deadline?: string;
}

interface MeetingStructure {
  summary: string;
  decisions: string[];
  action_items: ActionItem[];
  next_steps: string[];
}

async function transcribeAudio(audioBytes: Uint8Array, mimeType: string): Promise<string> {
  const blob     = new Blob([audioBytes], { type: mimeType });
  const formData = new FormData();
  formData.append("file", blob, `audio.${mimeType.split("/")[1] ?? "mp3"}`);
  formData.append("model", "whisper-1");

  if (WHISPER_URL) {
    const res = await fetch(`${WHISPER_URL}/v1/audio/transcriptions`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Self-hosted Whisper error ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.text ?? "";
  }

  if (!OPENAI_KEY) throw new Error("No transcription service configured. Set OPENAI_API_KEY or WHISPER_URL.");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: formData,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI Whisper error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.text ?? "";
}

async function extractStructure(transcript: string): Promise<MeetingStructure> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: "You are a meeting analyst. Extract structured data from meeting transcripts and return ONLY valid JSON — no markdown, no explanation.",
      messages: [{
        role: "user",
        content: `Extract from this meeting transcript:
1) Summary (2-3 sentences)
2) Key decisions (array of strings)
3) Action items (array of {owner: string, action: string, deadline?: string})
4) Next steps (array of strings)

Return JSON with shape: { "summary": string, "decisions": string[], "action_items": [{owner, action, deadline?}], "next_steps": string[] }

Transcript:
${transcript}`,
      }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data    = await res.json();
  const rawText = data.content?.[0]?.text ?? "{}";
  const match   = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Failed to parse meeting structure JSON from Claude response");
  return JSON.parse(match[0]) as MeetingStructure;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const audioUrl    = body.audio_url    ? String(body.audio_url)    : null;
    const audioB64    = body.audio_base64 ? String(body.audio_base64) : null;
    const mimeType    = body.mime_type    ? String(body.mime_type)    : "audio/mp3";
    const title       = body.meeting_title ? String(body.meeting_title) : `Meeting — ${new Date().toISOString().slice(0, 10)}`;
    const participants = Array.isArray(body.participants) ? body.participants.map(String) : [];
    const createQuests = body.create_quests === true;

    if (!audioUrl && !audioB64) {
      return new Response(
        JSON.stringify({ error: "Provide audio_url or audio_base64" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let audioBytes: Uint8Array;

    if (audioB64) {
      // atob is synchronous and fine for typical meeting audio sizes
      const binaryStr = atob(audioB64);
      audioBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) audioBytes[i] = binaryStr.charCodeAt(i);
    } else {
      const audioRes = await fetch(audioUrl!, { signal: AbortSignal.timeout(60000) });
      if (!audioRes.ok) throw new Error(`Failed to fetch audio (${audioRes.status})`);
      audioBytes = new Uint8Array(await audioRes.arrayBuffer());
    }

    if (audioBytes.byteLength === 0) {
      return new Response(JSON.stringify({ error: "Audio file is empty" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const transcript = await transcribeAudio(audioBytes, mimeType);
    if (!transcript.trim()) throw new Error("Transcription returned empty text");

    const structured = await extractStructure(transcript);

    const { summary, decisions, action_items, next_steps } = structured;

    const { error: notesErr } = await sb.from("meeting_notes").insert({
      user_id:      user.id,
      title,
      transcript,
      summary:      summary ?? "",
      action_items: action_items ?? [],
      decisions:    decisions ?? [],
      participants,
      created_at:   new Date().toISOString(),
    });

    if (notesErr) {
      // Table may not exist; non-fatal
      console.error("[mavis-meeting-transcribe] meeting_notes insert error:", notesErr.message);
    }

    let questsCreated = 0;
    if (createQuests && Array.isArray(action_items) && action_items.length > 0) {
      const questRows = action_items.map((item: ActionItem) => ({
        user_id:     user.id,
        type:        "goal",
        description: item.action,
        payload:     { objective: item.action, owner: item.owner, deadline: item.deadline ?? null },
        status:      "pending",
        created_at:  new Date().toISOString(),
      }));
      const { error: questErr, data: insertedQuests } = await sb.from("mavis_tasks").insert(questRows).select("id");
      if (questErr) {
        console.error("[mavis-meeting-transcribe] mavis_tasks insert error:", questErr.message);
      } else {
        questsCreated = insertedQuests?.length ?? 0;
      }
    }

    await sb.from("mavis_memory").insert({
      user_id:          user.id,
      role:             "assistant",
      content:          `[MEETING SUMMARY] ${title}\n\n${summary}`,
      importance_score: 7,
      created_at:       new Date().toISOString(),
    }).catch((e: any) => console.error("[mavis-meeting-transcribe] mavis_memory insert error:", e.message));

    return new Response(
      JSON.stringify({ transcript, summary, decisions, action_items, next_steps, quests_created: questsCreated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[mavis-meeting-transcribe]", e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
