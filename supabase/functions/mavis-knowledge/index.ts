// MAVIS Knowledge Graph Edge Function
// Bypasses PostgREST schema cache by using the service-role admin client directly.
// All reads/writes go through Postgres, not the REST layer.
// Embedding generation uses OpenAI text-embedding-3-small (1536 dims).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Verify JWT locally using SUPABASE_JWT_SECRET — avoids a network round-trip to
// the auth service, which can fail transiently inside edge functions.
async function getUserId(req: Request): Promise<string | null> {
  try {
    const auth = req.headers.get("Authorization") ?? "";
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
      const b64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const sig = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));

      const valid = await crypto.subtle.verify("HMAC", key, sig, signedPart);
      if (!valid) return null;

      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4)));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload.sub ?? null;
    }

    // Fallback: validate via auth API
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Embedding generation ───────────────────────────────────────
async function generateEmbedding(text: string): Promise<number[] | null> {
  const openaiKey = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

function noteEmbedText(title: string, content: string, tags: string[] = []): string {
  const tagStr = tags.length > 0 ? `\nTags: ${tags.join(", ")}` : "";
  return `${title}\n\n${content}${tagStr}`.slice(0, 8000);
}

async function embedNote(noteId: string, title: string, content: string, tags: string[] = []): Promise<void> {
  const embedding = await generateEmbedding(noteEmbedText(title, content, tags));
  if (!embedding) return;
  await supabase.from("mavis_notes").update({ embedding }).eq("id", noteId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const userId = await getUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body on GET-style calls */ }

  const action = String(body.action ?? "");

  try {
    // ── LIST NOTES ─────────────────────────────────────────
    if (action === "list_notes") {
      const { data, error } = await supabase
        .from("mavis_notes")
        .select("id, title, content, tags, aliases, properties, created_at, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return json({ notes: data ?? [] });
    }

    // ── SEMANTIC SEARCH ────────────────────────────────────
    if (action === "semantic_search") {
      const query = String(body.query ?? "");
      if (!query) return json({ error: "query required" }, 400);
      const embedding = await generateEmbedding(query);
      if (!embedding) return json({ notes: [], fallback: true });
      const { data, error } = await supabase.rpc("match_mavis_notes", {
        query_embedding: embedding,
        match_user_id: userId,
        match_threshold: Number(body.threshold ?? 0.45),
        match_count: Number(body.limit ?? 5),
      });
      if (error) throw error;
      return json({ notes: data ?? [] });
    }

    // ── BACKFILL EMBEDDINGS ────────────────────────────────
    // Generates embeddings for all notes that don't have one yet.
    // Call once after enabling pgvector to embed existing notes.
    if (action === "backfill_embeddings") {
      const { data: notes, error } = await supabase
        .from("mavis_notes")
        .select("id, title, content, tags")
        .eq("user_id", userId)
        .is("embedding", null)
        .limit(50);
      if (error) throw error;
      if (!notes?.length) return json({ backfilled: 0, message: "All notes already embedded" });

      let backfilled = 0;
      for (const note of notes as any[]) {
        const embedding = await generateEmbedding(
          noteEmbedText(note.title, note.content, note.tags ?? [])
        );
        if (embedding) {
          await supabase.from("mavis_notes").update({ embedding }).eq("id", note.id);
          backfilled++;
        }
      }
      const remaining = (notes.length) - backfilled;
      return json({ backfilled, remaining, message: remaining > 0 ? "Call again to continue" : "Done" });
    }

    // ── CREATE NOTE ────────────────────────────────────────
    if (action === "create_note") {
      const now = new Date().toISOString();
      const title   = String(body.title ?? "Untitled Note");
      const content = String(body.content ?? "");
      const tags    = Array.isArray(body.tags) ? body.tags : [];

      const { data, error } = await supabase
        .from("mavis_notes")
        .insert({
          user_id:    userId,
          title,
          content,
          tags,
          aliases:    Array.isArray(body.aliases) ? body.aliases : [],
          properties: (body.properties && typeof body.properties === "object") ? body.properties : {},
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();
      if (error) throw error;

      // Generate embedding in background (non-blocking)
      embedNote(data.id, title, content, tags).catch(() => {});
      return json({ note: data });
    }

    // ── UPDATE NOTE ────────────────────────────────────────
    if (action === "update_note") {
      const noteId = String(body.note_id ?? "");
      if (!noteId) return json({ error: "note_id required" }, 400);

      // Snapshot current version before overwriting
      const { data: current } = await supabase
        .from("mavis_notes")
        .select("title, content")
        .eq("id", noteId)
        .eq("user_id", userId)
        .single();

      if (current) {
        const { data: lastVer } = await supabase
          .from("mavis_note_versions")
          .select("version_number")
          .eq("note_id", noteId)
          .order("version_number", { ascending: false })
          .limit(1)
          .single();
        await supabase.from("mavis_note_versions").insert({
          note_id:        noteId,
          title:          current.title,
          content:        current.content,
          version_number: ((lastVer?.version_number as number) ?? 0) + 1,
        });
      }

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.title   !== undefined) updates.title   = String(body.title);
      if (body.content !== undefined) updates.content = String(body.content);
      if (Array.isArray(body.tags))   updates.tags    = body.tags;

      const { data, error } = await supabase
        .from("mavis_notes")
        .update(updates)
        .eq("id", noteId)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw error;

      // Re-embed if content changed
      if (body.title !== undefined || body.content !== undefined) {
        embedNote(
          noteId,
          String(updates.title ?? current?.title ?? ""),
          String(updates.content ?? current?.content ?? ""),
          Array.isArray(updates.tags) ? updates.tags as string[] : [],
        ).catch(() => {});
      }
      return json({ note: data });
    }

    // ── DELETE NOTE ────────────────────────────────────────
    if (action === "delete_note") {
      const noteId = String(body.note_id ?? "");
      if (!noteId) return json({ error: "note_id required" }, 400);
      await supabase.from("mavis_note_links").delete()
        .or(`source_note_id.eq.${noteId},target_note_id.eq.${noteId}`);
      await supabase.from("mavis_note_versions").delete().eq("note_id", noteId);
      const { error } = await supabase.from("mavis_notes").delete()
        .eq("id", noteId).eq("user_id", userId);
      if (error) throw error;
      return json({ ok: true });
    }

    // ── LIST LINKS (all for this user, for graph view) ────
    if (action === "list_links") {
      const { data: noteIds } = await supabase
        .from("mavis_notes")
        .select("id")
        .eq("user_id", userId);
      if (!noteIds?.length) return json({ links: [] });
      const ids = (noteIds as any[]).map(n => n.id);
      const { data, error } = await supabase
        .from("mavis_note_links")
        .select("*")
        .in("source_note_id", ids);
      if (error) throw error;
      return json({ links: data ?? [] });
    }

    // ── GET LINKS ──────────────────────────────────────────
    if (action === "get_links") {
      const noteId = String(body.note_id ?? "");
      if (!noteId) return json({ error: "note_id required" }, 400);
      const { data, error } = await supabase
        .from("mavis_note_links")
        .select("*")
        .or(`source_note_id.eq.${noteId},target_note_id.eq.${noteId}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json({ links: data ?? [] });
    }

    // ── CREATE LINK ────────────────────────────────────────
    if (action === "create_link") {
      const { data, error } = await supabase
        .from("mavis_note_links")
        .insert({
          source_note_id: String(body.source_note_id ?? ""),
          target_note_id: String(body.target_note_id ?? ""),
          type:           String(body.type ?? "relates_to"),
          description:    body.description ? String(body.description) : null,
        })
        .select()
        .single();
      if (error) throw error;
      return json({ link: data });
    }

    // ── DELETE LINK ────────────────────────────────────────
    if (action === "delete_link") {
      const linkId = String(body.link_id ?? "");
      if (!linkId) return json({ error: "link_id required" }, 400);
      const { error } = await supabase.from("mavis_note_links").delete().eq("id", linkId);
      if (error) throw error;
      return json({ ok: true });
    }

    // ── GET VERSIONS ───────────────────────────────────────
    if (action === "get_versions") {
      const noteId = String(body.note_id ?? "");
      if (!noteId) return json({ error: "note_id required" }, 400);
      const { data, error } = await supabase
        .from("mavis_note_versions")
        .select("*")
        .eq("note_id", noteId)
        .order("version_number", { ascending: false })
        .limit(10);
      if (error) throw error;
      return json({ versions: data ?? [] });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    console.error("[mavis-knowledge]", err);
    const msg = err instanceof Error ? err.message : typeof err === "object" && err !== null ? JSON.stringify(err) : String(err);
    return json({ error: msg }, 500);
  }
});
