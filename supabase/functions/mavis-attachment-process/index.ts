// Process a chat attachment: extract text from documents, transcribe audio/video,
// describe images. Stores extracted_text on the chat_attachments row so AI chats
// can reference it.
//
// Body: { attachment_id: string }
// Auth: requires user JWT (we read it to confirm ownership via service-role query).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_BYTES_FOR_INLINE = 18 * 1024 * 1024; // 18 MB hard cap (Gemini limit ~20MB inline)

function categorize(mime: string): "image" | "audio" | "video" | "pdf" | "text" | "other" {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m === "application/pdf") return "pdf";
  if (
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/xml" ||
    m === "application/javascript"
  ) {
    return "text";
  }
  return "other";
}

async function transcribeWithScribe(file: Blob, fileName: string): Promise<string> {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

  const fd = new FormData();
  fd.append("file", file, fileName);
  fd.append("model_id", "scribe_v1");
  fd.append("tag_audio_events", "true");
  fd.append("diarize", "true");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: fd,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Scribe ${res.status}: ${err.slice(0, 300)}`);
  }
  const json = await res.json();
  return String(json.text ?? "").slice(0, 60000);
}

async function describeWithGemini(
  base64: string,
  mime: string,
  prompt: string,
): Promise<string> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 300)}`);
  }
  const j = await res.json();
  return String(j?.choices?.[0]?.message?.content ?? "").slice(0, 60000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let attachmentId: string | undefined;
  try {
    const body = await req.json();
    attachmentId = body?.attachment_id;
    if (!attachmentId) {
      return new Response(JSON.stringify({ error: "attachment_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth check
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    const { data: userData } = await sb.auth.getUser(jwt);
    const userId = userData?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: attachment, error: aErr } = await sb
      .from("chat_attachments")
      .select("*")
      .eq("id", attachmentId)
      .eq("user_id", userId)
      .single();
    if (aErr || !attachment) {
      return new Response(JSON.stringify({ error: "attachment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await sb
      .from("chat_attachments")
      .update({ processing_status: "processing", error_message: null })
      .eq("id", attachmentId);

    // Download from storage
    const { data: blob, error: dlErr } = await sb.storage
      .from("chat-attachments")
      .download(attachment.storage_path);
    if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message ?? "no blob"}`);

    const kind = categorize(attachment.mime_type);
    const size = blob.size;
    let extracted = "";

    if (kind === "text") {
      extracted = (await blob.text()).slice(0, 60000);
    } else if (kind === "audio" || kind === "video") {
      // Use ElevenLabs Scribe
      if (size > 100 * 1024 * 1024) {
        extracted = `[File too large for transcription — ${(size / 1024 / 1024).toFixed(1)} MB]`;
      } else {
        extracted = await transcribeWithScribe(blob, attachment.file_name);
      }
    } else if (kind === "image") {
      if (size > MAX_BYTES_FOR_INLINE) {
        extracted = `[Image too large — ${(size / 1024 / 1024).toFixed(1)} MB]`;
      } else {
        const buf = await blob.arrayBuffer();
        const b64 = base64Encode(buf);
        extracted = await describeWithGemini(
          b64,
          attachment.mime_type,
          `Describe this image in detail. Note any text, people, objects, scene, mood, colors, style. Be thorough — this description will be the AI's only way to "see" the image. File: ${attachment.file_name}`,
        );
      }
    } else if (kind === "pdf") {
      if (size > MAX_BYTES_FOR_INLINE) {
        extracted = `[PDF too large — ${(size / 1024 / 1024).toFixed(1)} MB]`;
      } else {
        const buf = await blob.arrayBuffer();
        const b64 = base64Encode(buf);
        extracted = await describeWithGemini(
          b64,
          "application/pdf",
          `Extract all readable text and key visual information from this PDF. Include headings, body text, captions, table contents, and a brief description of any diagrams or images. Preserve the logical flow. File: ${attachment.file_name}`,
        );
      }
    } else {
      extracted = `[Binary file — type ${attachment.mime_type}, size ${size} bytes. Cannot extract content.]`;
    }

    await sb
      .from("chat_attachments")
      .update({
        extracted_text: extracted,
        processing_status: "done",
      })
      .eq("id", attachmentId);

    return new Response(
      JSON.stringify({ ok: true, length: extracted.length, kind }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("mavis-attachment-process error", e?.message ?? e);
    if (attachmentId) {
      await sb
        .from("chat_attachments")
        .update({
          processing_status: "failed",
          error_message: String(e?.message ?? e).slice(0, 500),
        })
        .eq("id", attachmentId);
    }
    return new Response(
      JSON.stringify({ error: e?.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
