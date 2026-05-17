// MAVIS Meeting Notes — extracts structured meeting notes from raw transcript or text

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY  = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY     = Deno.env.get("OPENAI_API") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── JWT auth ───────────────────────────────────────────────────
async function getUserId(req: Request): Promise<string | null> {
  try {
    const auth  = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const secret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (secret) {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signedPart = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const b64        = parts[2].replace(/-/g, "+").replace(/_/g, "/");
      const padded     = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const sig        = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const valid      = await crypto.subtle.verify("HMAC", key, sig, signedPart);
      if (!valid) return null;
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload    = JSON.parse(atob(payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4)));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload.sub ?? null;
    }
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Embedding generation ───────────────────────────────────────
async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// ── Structured meeting notes shape ────────────────────────────
interface ActionItem {
  owner: string;
  task: string;
  due_date: string;
}

interface MeetingNotes {
  title: string;
  date: string;
  attendees: string[];
  decisions: string[];
  action_items: ActionItem[];
  key_points: string[];
  summary: string;
}

// ── Extract structured notes via Claude ───────────────────────
async function extractMeetingNotes(transcript: string): Promise<MeetingNotes> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: "You are a meeting notes extractor. Extract structured meeting notes from transcripts.",
      messages: [
        {
          role: "user",
          content: `Extract structured meeting notes from this transcript. Return ONLY valid JSON with this exact shape: { title, date, attendees: string[], decisions: string[], action_items: [{owner, task, due_date}], key_points: string[], summary: string }\n\nTranscript:\n${transcript}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude extraction error ${res.status}: ${errText}`);
  }

  const data    = await res.json();
  const rawText = data.content?.[0]?.text ?? "";
  const match   = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Failed to parse meeting notes JSON from Claude response");
  return JSON.parse(match[0]) as MeetingNotes;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const userId = await getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const transcript   = String(body.transcript ?? "").trim();
  const titleOverride = body.title       ? String(body.title)        : null;
  const meetingDate  = body.meeting_date ? String(body.meeting_date) : null;
  const saveToDb     = body.save_to_db !== false; // default true

  if (!transcript) {
    return new Response(JSON.stringify({ error: "transcript is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Step 1: Extract structured notes via Claude
    const structured = await extractMeetingNotes(transcript);

    // Use provided title/date overrides if given
    if (titleOverride) structured.title = titleOverride;
    if (meetingDate)   structured.date  = meetingDate;

    let meetingId: string | null = null;

    if (saveToDb) {
      // Step 2a: Insert to meeting_notes table
      const { data: meetingRow, error: meetingErr } = await supabase
        .from("meeting_notes")
        .insert({
          user_id:        userId,
          title:          structured.title,
          meeting_date:   structured.date || null,
          attendees:      structured.attendees ?? [],
          decisions:      structured.decisions ?? [],
          action_items:   structured.action_items ?? [],
          key_points:     structured.key_points ?? [],
          summary:        structured.summary ?? "",
          raw_transcript: transcript,
        })
        .select("id")
        .single();

      if (meetingErr) throw meetingErr;
      meetingId = meetingRow?.id ?? null;

      // Step 2b: Embed summary and insert to mavis_notes
      const noteTitle = `[Meeting] ${structured.title}`;
      const embedding = await generateEmbedding(structured.summary ?? "");

      await supabase
        .from("mavis_notes")
        .upsert(
          {
            user_id:    userId,
            title:      noteTitle,
            content:    structured.summary ?? "",
            tags:       ["meeting", "meeting-notes"],
            embedding,
            properties: { meeting_id: meetingId, meeting_date: structured.date },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,title" },
        );
    }

    return new Response(
      JSON.stringify({ meeting_id: meetingId, structured }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[mavis-meeting-notes]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
