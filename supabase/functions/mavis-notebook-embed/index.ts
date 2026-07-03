// mavis-notebook-embed
// Embeds notebook source content using Supabase gte-small (384-dim).
// Also handles semantic search against embedded sources.
//
// POST { action: "embed_source", source_id: string }
//   → embeds content, stores in notebook_sources.embedding
//
// POST { action: "search", notebook_id: string, query: string, threshold?: number, count?: number }
//   → embeds query, returns matching sources via match_notebook_sources RPC

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

// @ts-ignore — Supabase.ai available in edge runtime
async function getEmbedding(text: string): Promise<number[]> {
  // @ts-ignore
  const session = new Supabase.ai.Session("gte-small");
  const clean = text.replace(/```[\s\S]*?```/g, "").replace(/[#*_~`]/g, "").trim().slice(0, 2048);
  const output = await session.run(clean, { mean_pool: true, normalize: true });
  return Array.from(output.data as Float32Array);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await verifyAuth(req))) return err("Unauthorized", 401);

  let body: any = {};
  try { body = await req.json(); } catch { return err("Invalid JSON", 400); }

  const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { action = "embed_source" } = body;

  if (action === "embed_source") {
    const { source_id } = body;
    if (!source_id) return err("source_id required");

    const { data: source, error: fetchErr } = await adminSb
      .from("notebook_sources")
      .select("id, title, content")
      .eq("id", source_id)
      .single();
    if (fetchErr || !source) return err(fetchErr?.message ?? "Source not found", 404);

    const text = `${source.title}\n\n${source.content ?? ""}`.trim();
    if (!text) return ok({ embedded: false, reason: "no content" });

    try {
      const embedding = await getEmbedding(text);
      const { error: updateErr } = await adminSb
        .from("notebook_sources")
        .update({ embedding: JSON.stringify(embedding) })
        .eq("id", source_id);
      if (updateErr) return err(updateErr.message, 500);
      return ok({ embedded: true, source_id, dims: embedding.length });
    } catch (e: any) {
      return err(e?.message ?? "Embedding failed", 500);
    }
  }

  if (action === "search") {
    const { notebook_id, query, threshold = 0.35, count = 6 } = body;
    if (!notebook_id || !query) return err("notebook_id and query required");

    try {
      const queryEmbedding = await getEmbedding(query);
      const { data: matches, error: searchErr } = await adminSb.rpc("match_notebook_sources", {
        query_embedding: JSON.stringify(queryEmbedding),
        match_notebook_id: notebook_id,
        match_threshold: threshold,
        match_count: count,
      });
      if (searchErr) return err(searchErr.message, 500);
      return ok({ sources: matches ?? [], query, count: (matches ?? []).length });
    } catch (e: any) {
      return err(e?.message ?? "Search failed", 500);
    }
  }

  return err(`Unknown action: ${action}`);
});
