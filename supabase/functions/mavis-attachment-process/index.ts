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
    m === "application/javascript" ||
    m === "application/x-yaml" ||
    m === "application/yaml"
  ) {
    return "text";
  }
  // Common code/text extensions that may arrive as octet-stream
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

async function uploadToGeminiFiles(
  data: Uint8Array,
  mimeType: string,
  displayName: string,
  geminiKey: string,
): Promise<{ uri: string; name: string }> {
  const boundary = "mavis_upload_boundary";
  const metaJson = JSON.stringify({ file: { display_name: displayName } });

  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n`;
  const dataPart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing  = `\r\n--${boundary}--`;

  const encoder = new TextEncoder();
  const metaBytes  = encoder.encode(metaPart);
  const dataHeader = encoder.encode(dataPart);
  const closeBytes = encoder.encode(closing);

  const body = new Uint8Array(metaBytes.length + dataHeader.length + data.length + closeBytes.length);
  body.set(metaBytes,   0);
  body.set(dataHeader,  metaBytes.length);
  body.set(data,        metaBytes.length + dataHeader.length);
  body.set(closeBytes,  metaBytes.length + dataHeader.length + data.length);

  const uploadRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Gemini upload failed ${uploadRes.status}: ${err.slice(0, 300)}`);
  }
  const uploaded = await uploadRes.json();
  return { uri: String(uploaded.file?.uri ?? ""), name: String(uploaded.file?.name ?? "") };
}

async function analyzeVideoWithGemini(blob: Blob, fileName: string, mime: string): Promise<string> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) throw new Error("GEMINI_API_KEY not configured");

  const data = new Uint8Array(await blob.arrayBuffer());
  const { uri, name } = await uploadToGeminiFiles(data, mime, fileName, geminiKey);

  // Poll until ACTIVE
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const statusRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${name}?key=${geminiKey}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (statusRes.ok) {
      const s = await statusRes.json();
      if (s.state === "ACTIVE") break;
      if (s.state === "FAILED") throw new Error("Gemini file processing failed");
    }
    if (i === 39) throw new Error("Gemini file processing timed out after 120s");
  }

  // Analyze
  const prompt = `Analyze this video completely. Provide:

1. VISUAL ANALYSIS (with timestamps):
   Describe what is happening visually, scene by scene. Format as "MM:SS – MM:SS — [description]". Note people, expressions, actions, objects, text on screen, graphics.

2. AUDIO TRANSCRIPT:
   Transcribe all spoken words verbatim. Note speaker changes if multiple people. Include non-speech audio events in brackets like [music], [applause], [background noise].

3. KEY MOMENTS:
   List the 3-5 most important moments with timestamps.

4. SUMMARY:
   One paragraph overview of the entire video's content and purpose.

Be thorough — this analysis is the only way the AI system can "see" this video.`;

  const analyzeRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { file_data: { mime_type: mime, file_uri: uri } },
          { text: prompt },
        ]}],
        generationConfig: { maxOutputTokens: 16384 },
      }),
      signal: AbortSignal.timeout(180_000),
    },
  );

  // Cleanup (fire and forget)
  fetch(
    `https://generativelanguage.googleapis.com/v1beta/${name}?key=${geminiKey}`,
    { method: "DELETE" },
  ).catch(() => {});

  if (!analyzeRes.ok) {
    const err = await analyzeRes.text();
    throw new Error(`Gemini analysis failed ${analyzeRes.status}: ${err.slice(0, 300)}`);
  }
  const result = await analyzeRes.json();
  const parts: any[] = result.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("").trim();
  if (!text) throw new Error("Gemini returned empty analysis");
  return text.slice(0, 60000);
}

// Cascading multimodal description:
//   1. Gemini (inline base64 — handles images + PDFs natively)
//   2. Claude Haiku (images only — vision)
//   3. GPT-4o-mini (images only — vision)
async function describeWithAI(buf: ArrayBuffer, mime: string, fileName: string, prompt: string): Promise<string> {
  const b64 = base64Encode(buf);
  const isImage = mime.startsWith("image/");

  // ── Tier 1: Gemini direct (best for PDFs, good for images) ──
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mime, data: b64 } },
              ],
            }],
            generationConfig: { maxOutputTokens: 8192 },
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (res.ok) {
        const j = await res.json();
        const parts: any[] = j.candidates?.[0]?.content?.parts ?? [];
        const text = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("").trim();
        if (text.length > 10) return text.slice(0, 60000);
      } else {
        console.warn(`[gemini] ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e: any) {
      console.warn("[gemini] describe failed:", e.message);
    }
  }

  // ── Tier 2: Claude Haiku vision (images only) ───────────────
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (claudeKey && isImage) {
    try {
      const claudeMime = mime === "image/jpg" ? "image/jpeg" : mime;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": claudeKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2048,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: claudeMime, data: b64 } },
              { type: "text", text: prompt },
            ],
          }],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const j = await res.json();
        const text = (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
        if (text.length > 10) return text.slice(0, 60000);
      } else {
        console.warn(`[claude] ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e: any) {
      console.warn("[claude] describe failed:", e.message);
    }
  }

  // ── Tier 3: GPT-4o-mini vision (images only) ────────────────
  const openaiKey = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY");
  if (openaiKey && isImage) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
            ],
          }],
          max_tokens: 2048,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const j = await res.json();
        const text = String(j.choices?.[0]?.message?.content ?? "").trim();
        if (text.length > 10) return text.slice(0, 60000);
      } else {
        console.warn(`[openai] ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e: any) {
      console.warn("[openai] describe failed:", e.message);
    }
  }

  throw new Error(`No AI provider succeeded for ${fileName} (${mime})`);
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
      // Plain text, CSV, JSON, code — read directly, no AI needed
      extracted = (await blob.text()).slice(0, 60000);
    } else if (kind === "audio" || kind === "video") {
      const videoSizeLimit = 500 * 1024 * 1024; // 500MB for Gemini
      const audioSizeLimit = 100 * 1024 * 1024; // 100MB for Scribe

      if (kind === "video") {
        if (size > videoSizeLimit) {
          extracted = `[Video too large for analysis — ${(size / 1024 / 1024).toFixed(1)} MB. Max 500 MB.]`;
        } else {
          try {
            extracted = await analyzeVideoWithGemini(blob, attachment.file_name, attachment.mime_type);
          } catch (geminiErr: any) {
            console.warn("[video] Gemini analysis failed, falling back to Scribe:", geminiErr.message);
            try {
              extracted = await transcribeWithScribe(blob, attachment.file_name);
            } catch (scribeErr: any) {
              extracted = `[Video analysis failed: ${geminiErr.message}. Scribe fallback also failed: ${scribeErr.message}]`;
            }
          }
        }
      } else {
        // Audio — Scribe handles this well, no need for Gemini Files
        if (size > audioSizeLimit) {
          extracted = `[Audio too large for transcription — ${(size / 1024 / 1024).toFixed(1)} MB. Max 100 MB.]`;
        } else {
          extracted = await transcribeWithScribe(blob, attachment.file_name);
        }
      }
    } else if (kind === "image") {
      if (size > MAX_BYTES_FOR_INLINE) {
        extracted = `[Image too large — ${(size / 1024 / 1024).toFixed(1)} MB]`;
      } else {
        const buf = await blob.arrayBuffer();
        extracted = await describeWithAI(
          buf,
          attachment.mime_type,
          attachment.file_name,
          `Describe this image in detail. Note any text, people, objects, scene, mood, colors, style. Be thorough — this description will be the AI's only way to "see" the image. If you can read any text in the image, transcribe it exactly. File: ${attachment.file_name}`,
        );
      }
    } else if (kind === "pdf") {
      if (size > MAX_BYTES_FOR_INLINE) {
        extracted = `[PDF too large — ${(size / 1024 / 1024).toFixed(1)} MB]`;
      } else {
        const buf = await blob.arrayBuffer();
        extracted = await describeWithAI(
          buf,
          "application/pdf",
          attachment.file_name,
          `Extract all readable text and key visual information from this PDF. Include headings, body text, captions, table contents, and a brief description of any diagrams or images. Preserve the logical flow. File: ${attachment.file_name}`,
        );
      }
    } else {
      // Try reading as UTF-8 text for unknown types (handles .csv, .md, .ts, etc. served as octet-stream)
      try {
        const text = await blob.text();
        // Heuristic: if >70% of chars are printable, treat as text
        const sample = text.slice(0, 500);
        const printable = [...sample].filter(c => c.charCodeAt(0) >= 32 || c === "\n" || c === "\t").length;
        if (sample.length > 0 && printable / sample.length > 0.7) {
          extracted = text.slice(0, 60000);
        } else {
          extracted = `[Binary file — type ${attachment.mime_type}, size ${size} bytes. Cannot extract content.]`;
        }
      } catch {
        extracted = `[Binary file — type ${attachment.mime_type}, size ${size} bytes. Cannot extract content.]`;
      }
    }

    await sb
      .from("chat_attachments")
      .update({
        extracted_text: extracted,
        processing_status: "done",
      })
      .eq("id", attachmentId);

    // Auto-create Knowledge Graph note(s) for non-trivial extracted content.
    // Large documents are chunked so semantic search can recall specific sections.
    if (extracted.length > 100 && kind !== "other") {
      (async () => {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const baseTitle   = attachment.file_name.replace(/\.[^.]+$/, "").slice(0, 100);
          const tagMap: Record<string, string[]> = {
            image: ["attachment", "image"],
            audio: ["attachment", "audio", "transcript"],
            video: ["attachment", "video", "analysis"],
            pdf:   ["attachment", "document"],
            text:  ["attachment", "document"],
          };
          const tags = tagMap[kind] ?? ["attachment"];

          const CHUNK_SIZE    = 3500;
          const CHUNK_OVERLAP = 300;
          const sourceHeader  = `*Source: ${attachment.file_name} (${kind})*\n\n---\n\n`;

          let chunks: string[];
          if (kind === "image" || kind === "audio" || kind === "video" || extracted.length <= CHUNK_SIZE) {
            chunks = [extracted];
          } else {
            chunks = [];
            let pos = 0;
            while (pos < extracted.length) {
              chunks.push(extracted.slice(pos, pos + CHUNK_SIZE));
              pos += CHUNK_SIZE - CHUNK_OVERLAP;
              if (pos >= extracted.length) break;
            }
          }

          let firstNoteId: string | null = null;
          for (let i = 0; i < chunks.length; i++) {
            const title = chunks.length === 1
              ? baseTitle
              : `${baseTitle} [${i + 1}/${chunks.length}]`;

            const content = `# ${title}\n\n${sourceHeader}${chunks[i]}`;

            const noteRes = await fetch(`${supabaseUrl}/functions/v1/mavis-knowledge`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
              body: JSON.stringify({
                action:     "create_note",
                user_id:    userId,
                title,
                content:    content.slice(0, 8000),
                tags:       [...tags, ...(chunks.length > 1 ? ["chunked"] : [])],
                properties: {
                  source_attachment_id: attachmentId,
                  mime_type:  attachment.mime_type,
                  chunk:      i,
                  total_chunks: chunks.length,
                  skip_sr:    true,
                },
                aliases: [],
              }),
            });

            if (noteRes.ok && i === 0) {
              const nd = await noteRes.json();
              firstNoteId = nd?.note?.id ?? null;
            }
          }

          if (firstNoteId) {
            await sb.from("chat_attachments").update({ linked_note_id: firstNoteId }).eq("id", attachmentId).catch(() => {});
          }
        } catch { /* non-critical */ }
      })();
    }

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
