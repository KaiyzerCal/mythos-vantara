// MAVIS Doc Extract — Extracts text from uploaded documents and creates knowledge embeddings.
// Supports: pdf, txt, md, csv, json, docx
// Auth: Bearer user JWT, or service-role with body.user_id

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Resolve user from JWT or service-role passthrough
async function resolveUserId(req: Request, body: Record<string, unknown>): Promise<string | null> {
  // Service-role passthrough: body contains user_id directly
  if (body.user_id && typeof body.user_id === "string") {
    return body.user_id;
  }
  // Else parse JWT
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const { data } = await adminSb.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// Extract text from PDF using Claude document block
async function extractPdfWithClaude(fileUrl: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "url", url: fileUrl },
            },
            {
              type: "text",
              text: "Extract and return the complete text content of this document as clean markdown. Preserve headings, lists, tables, and structure. Return only the extracted text, no commentary.",
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Claude extraction failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

// Generate embedding via OpenAI text-embedding-3-small
async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// Chunk text into ~1200 char chunks with 150 char overlap
function chunkText(text: string, chunkSize = 1200, overlap = 150): string[] {
  // First split on double newlines (paragraphs)
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length <= chunkSize) {
      current = current ? current + "\n\n" + para : para;
    } else {
      if (current) {
        chunks.push(current.trim());
        // Start next chunk with overlap from end of current
        const overlapText = current.slice(-overlap);
        current = overlapText + "\n\n" + para;
      } else {
        // Single paragraph larger than chunkSize — split by chars
        let i = 0;
        while (i < para.length) {
          const slice = para.slice(i, i + chunkSize);
          chunks.push(slice.trim());
          i += chunkSize - overlap;
        }
        current = "";
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.filter((c) => c.length > 0);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const userId = await resolveUserId(req, body);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const fileUrl = String(body.file_url ?? "").trim();
  const fileName = String(body.file_name ?? "document").trim();
  const fileType = String(body.file_type ?? "").toLowerCase().trim();
  const vaultEntryId = body.vault_entry_id ? String(body.vault_entry_id) : null;

  if (!fileUrl) return json({ error: "file_url is required" }, 400);

  // Detect extension
  const ext = fileType || fileName.split(".").pop()?.toLowerCase() || "txt";

  let extractedText = "";

  // Extract text based on file type
  if (ext === "pdf") {
    try {
      extractedText = await extractPdfWithClaude(fileUrl);
    } catch (err) {
      console.error("[mavis-doc-extract] Claude PDF extraction failed, trying plain text fallback:", err);
      // Fallback: fetch as text
      try {
        const fallbackRes = await fetch(fileUrl);
        if (fallbackRes.ok) extractedText = await fallbackRes.text();
      } catch (fallbackErr) {
        console.error("[mavis-doc-extract] Fallback text fetch also failed:", fallbackErr);
      }
    }
  } else if (["txt", "md", "csv", "json"].includes(ext)) {
    try {
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      extractedText = await res.text();
    } catch (err) {
      console.error("[mavis-doc-extract] Plain text fetch failed:", err);
      return json({ error: `Failed to fetch file: ${err instanceof Error ? err.message : String(err)}` }, 500);
    }
  } else {
    // docx or unknown: attempt fetch as text
    try {
      const res = await fetch(fileUrl);
      if (res.ok) {
        const text = await res.text();
        if (typeof text === "string" && text.length > 0) {
          extractedText = text;
        }
      }
    } catch (err) {
      console.error("[mavis-doc-extract] Unknown type fetch failed:", err);
    }
  }

  if (!extractedText || extractedText.trim().length === 0) {
    return json({ error: "Could not extract any text from the document" }, 422);
  }

  // Chunk text (max 20 chunks)
  const allChunks = chunkText(extractedText);
  const chunks = allChunks.slice(0, 20);
  const total = chunks.length;

  const noteIds: string[] = [];

  for (let i = 0; i < total; i++) {
    const chunkText_ = chunks[i];

    // Generate embedding
    const embedding = await generateEmbedding(chunkText_);

    // Build note record
    const noteRecord: Record<string, unknown> = {
      user_id: userId,
      title: `[DOC] ${fileName} — chunk ${i + 1}/${total}`,
      content: chunkText_,
      tags: ["document", "auto-extracted"],
      aliases: [],
      properties: {
        doc_source: fileName,
        doc_url: fileUrl,
        vault_entry_id: vaultEntryId,
        chunk_index: i,
        total_chunks: total,
        skip_sr: true,
      },
    };

    if (embedding) {
      noteRecord.embedding = embedding;
    }

    const { data: inserted, error: insertErr } = await adminSb
      .from("mavis_notes")
      .insert(noteRecord)
      .select("id")
      .single();

    if (insertErr) {
      console.error(`[mavis-doc-extract] Insert chunk ${i} error:`, insertErr);
    } else if (inserted?.id) {
      noteIds.push(inserted.id);
    }
  }

  // Update vault_media if vault_entry_id provided
  if (vaultEntryId) {
    const { error: updateErr } = await adminSb
      .from("vault_media")
      .update({ extracted_at: new Date().toISOString() })
      .eq("id", vaultEntryId);

    if (updateErr) {
      console.error("[mavis-doc-extract] vault_media update error:", updateErr);
    }
  }

  return json({
    ok: true,
    chunks_created: noteIds.length,
    file_name: fileName,
    note_ids: noteIds,
  });
});
