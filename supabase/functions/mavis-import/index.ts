import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

const MAX_NOTES_PER_BATCH = 200;
const MAX_CONTENT_LENGTH = 8000;
const EMBEDDING_CHUNK_SIZE = 10;
const EMBEDDING_MODEL = "text-embedding-3-small";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cleanContent(content: string, source: string): string {
  let cleaned = content;
  if (source === "notion") {
    cleaned = stripHtml(cleaned);
  }
  cleaned = normalizeWhitespace(cleaned);
  if (cleaned.length > MAX_CONTENT_LENGTH) {
    cleaned = cleaned.slice(0, MAX_CONTENT_LENGTH);
  }
  return cleaned;
}

async function generateEmbedding(text: string, openaiApiKey: string): Promise<number[] | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.slice(0, 8191), // OpenAI token limit guard
      }),
    });

    if (!response.ok) {
      console.error("OpenAI embedding error:", response.status, await response.text());
      return null;
    }

    const result = await response.json();
    return result?.data?.[0]?.embedding ?? null;
  } catch (err) {
    console.error("Embedding fetch failed:", err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      user_id,
      source,
      notes,
      generate_embeddings = true,
    } = body;

    // Validate inputs
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validSources = ["notion", "obsidian", "markdown"];
    if (!source || !validSources.includes(source)) {
      return new Response(
        JSON.stringify({ error: `source must be one of: ${validSources.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!Array.isArray(notes) || notes.length === 0) {
      return new Response(JSON.stringify({ error: "notes must be a non-empty array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const notesToProcess = notes.slice(0, MAX_NOTES_PER_BATCH);
    const skippedDueToLimit = notes.length > MAX_NOTES_PER_BATCH ? notes.length - MAX_NOTES_PER_BATCH : 0;

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const openaiApiKey = (Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY")) ?? "";
    const canEmbed = generate_embeddings && Boolean(openaiApiKey);

    // Prepare all note records
    const preparedNotes: any[] = notesToProcess.map((note: any) => {
      const cleaned = cleanContent(note.content ?? "", source);
      return {
        user_id,
        title: note.title?.trim() || "Untitled",
        content: cleaned,
        tags: [...(note.tags ?? []), source, "imported"],
        embedding: null as number[] | null,
        created_at: note.created_at ?? new Date().toISOString(),
      };
    });

    // Generate embeddings in batches of 10 with 200ms delay between batches
    if (canEmbed) {
      for (let i = 0; i < preparedNotes.length; i += EMBEDDING_CHUNK_SIZE) {
        const batch = preparedNotes.slice(i, i + EMBEDDING_CHUNK_SIZE);
        await Promise.all(
          batch.map(async (note) => {
            const embeddingInput = `${note.title}\n\n${note.content}`;
            note.embedding = await generateEmbedding(embeddingInput, openaiApiKey);
          })
        );
        // Rate limit guard between batches (skip sleep after the last batch)
        if (i + EMBEDDING_CHUNK_SIZE < preparedNotes.length) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }

    // Batch insert in chunks of 10
    let importedCount = 0;
    let skippedCount = skippedDueToLimit;
    const errors: string[] = [];

    for (let i = 0; i < preparedNotes.length; i += EMBEDDING_CHUNK_SIZE) {
      const chunk = preparedNotes.slice(i, i + EMBEDDING_CHUNK_SIZE);
      const { error: insertError, data: inserted } = await sb
        .from("mavis_notes")
        .upsert(chunk, { onConflict: "user_id,title" })
        .select("id");

      if (insertError) {
        console.error(`Chunk insert error at index ${i}:`, insertError);
        errors.push(`Chunk at index ${i}: ${insertError.message}`);
        skippedCount += chunk.length;
      } else {
        importedCount += inserted?.length ?? chunk.length;
      }
    }

    return new Response(
      JSON.stringify({ imported: importedCount, skipped: skippedCount, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
