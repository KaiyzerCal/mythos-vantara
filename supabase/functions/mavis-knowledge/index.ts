// MAVIS Knowledge Graph Edge Function
// Bypasses PostgREST schema cache by using the service-role admin client directly.
// All reads/writes go through Postgres, not the REST layer.

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

    // Fallback: validate via auth API (slower but safe)
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
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
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return json({ notes: data ?? [] });
    }

    // ── CREATE NOTE ────────────────────────────────────────
    if (action === "create_note") {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("mavis_notes")
        .insert({
          user_id:    userId,
          title:      String(body.title ?? "Untitled Note"),
          content:    String(body.content ?? ""),
          tags:       Array.isArray(body.tags) ? body.tags : [],
          aliases:    Array.isArray(body.aliases) ? body.aliases : [],
          properties: (body.properties && typeof body.properties === "object") ? body.properties : {},
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();
      if (error) throw error;
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
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
