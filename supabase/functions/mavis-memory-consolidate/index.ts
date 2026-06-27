// mavis-memory-consolidate — Hermes-style memory compression
// Runs weekly. Reads memories older than 14 days, groups them by memory_type,
// synthesizes each group into a dense summary using Claude, then inserts the
// condensed memory and marks the originals as consolidated so they're skipped
// in future context assembly but preserved for audit.

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.3";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const supabase  = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const OP_UID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    let body: { user_id?: string; dry_run?: boolean } = {};
    try { body = await req.json(); } catch { /* cron with no body */ }
    const user_id = body.user_id ?? OP_UID;
    const dry_run = body.dry_run ?? false;
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: CORS });
    }

    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();

    // Fetch memories older than 14 days that haven't been consolidated yet
    const { data: oldMemories, error } = await supabase
      .from("memories")
      .select("id, title, content, memory_type, tags, created_at")
      .eq("user_id", user_id)
      .lt("created_at", cutoff)
      .not("memory_type", "eq", "consolidated")
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) throw new Error(error.message);
    if (!oldMemories?.length) {
      return new Response(JSON.stringify({ ok: true, consolidated: 0, message: "Nothing to consolidate" }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Group by memory_type
    const groups = new Map<string, typeof oldMemories>();
    for (const m of oldMemories) {
      const key = m.memory_type ?? "auto";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }

    const consolidated: { type: string; count: number; summary_id?: string }[] = [];

    for (const [memType, mems] of groups.entries()) {
      if (mems.length < 3) continue; // not worth compressing tiny batches

      const rawText = mems.map(m =>
        `[${new Date(m.created_at).toISOString().slice(0, 10)}] ${m.title}: ${m.content?.slice(0, 300) ?? ""}`
      ).join("\n");

      const res = await anthropic.messages.create({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system: `You are a memory consolidation engine for a personal AI operating system.
Distill the following ${mems.length} memories of type "${memType}" into a single dense summary.
Preserve specific facts, names, preferences, and decisions. Drop filler and redundancy.
Write in third person ("The user..."). Max 400 words. Return plain text, no headers.`,
        messages: [{ role: "user", content: `Consolidate these ${memType} memories:\n\n${rawText}` }],
      });

      const summary = ((res.content[0] as { text: string }).text ?? "").trim();
      if (!summary) continue;

      if (!dry_run) {
        // Insert consolidated summary
        const { data: inserted } = await supabase.from("memories").insert({
          user_id,
          title:       `[Consolidated] ${memType} memories (${mems.length} entries, up to ${new Date(cutoff).toISOString().slice(0, 10)})`,
          content:     summary,
          memory_type: "consolidated",
          tags:        ["consolidated", memType, `batch:${mems.length}`],
        }).select("id").single();

        // Mark originals as consolidated so context-scout skips them
        await supabase.from("memories")
          .update({ memory_type: "consolidated_source" })
          .in("id", mems.map(m => m.id));

        consolidated.push({ type: memType, count: mems.length, summary_id: inserted?.id });
      } else {
        consolidated.push({ type: memType, count: mems.length });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, dry_run, consolidated, total_compressed: oldMemories.length }),
      { headers: { "Content-Type": "application/json", ...CORS } },
    );
  } catch (err) {
    console.error("[mavis-memory-consolidate]", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
