// MAVIS Tacit Memory Pruner
// Runs weekly (Sunday 03:00 UTC via pg_cron).
// Prevents mavis_tacit from bloating with stale or duplicate entries.
//
// Strategy:
//   1. Delete entries older than 90 days (low confidence or no confidence set)
//   2. Cap each category at 60 entries — keep highest confidence, drop oldest excess
//   3. AI deduplication: find near-duplicate keys within each category, keep the richer value
//
// All changes are non-destructive if AI is unavailable — fallback is pure age/count pruning.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
const LOVABLE_KEY      = Deno.env.get("LOVABLE_API_KEY") ?? "";
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY       = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

const MAX_PER_CATEGORY  = 60;
const MAX_AGE_DAYS      = 90;
const KEEP_CATEGORIES   = ["hard_rule", "preference", "lesson_learned", "workflow_habit"];

async function callAI(prompt: string): Promise<string> {
  if (LOVABLE_KEY) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 500,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        const t = d.choices?.[0]?.message?.content ?? "";
        if (t) return t;
      }
    } catch { /* fall through */ }
  }
  if (ANTHROPIC_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500,
          messages: [{ role: "user", content: prompt }] }),
      });
      if (res.ok) { const d = await res.json(); return d.content?.[0]?.text ?? ""; }
    } catch { /* fall through */ }
  }
  if (OPENAI_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 500,
          messages: [{ role: "user", content: prompt }] }),
      });
      if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content ?? ""; }
    } catch { /* fall through */ }
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });
  }

  try {
    if (!OPERATOR_USER_ID) throw new Error("TELEGRAM_OPERATOR_USER_ID not set");
    const uid = OPERATOR_USER_ID;

    let totalDeleted  = 0;
    let totalMerged   = 0;

    // ── Step 1: Delete old low-confidence entries ─────────────
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86400000).toISOString();
    const { data: oldEntries } = await supabase
      .from("mavis_tacit")
      .select("id, category, confidence")
      .eq("user_id", uid)
      .lt("updated_at", cutoff)
      .not("category", "eq", "hard_rule"); // never auto-delete hard rules

    if (oldEntries?.length) {
      // Only delete entries with confidence < 7 (or no confidence) that are stale
      const toDelete = (oldEntries as any[])
        .filter((e: any) => !e.confidence || e.confidence < 7)
        .map((e: any) => e.id);

      if (toDelete.length > 0) {
        await supabase.from("mavis_tacit").delete().in("id", toDelete).eq("user_id", uid);
        totalDeleted += toDelete.length;
      }
    }

    // ── Step 2: Cap each category at MAX_PER_CATEGORY ────────
    for (const cat of KEEP_CATEGORIES) {
      const { data: all } = await supabase
        .from("mavis_tacit")
        .select("id, confidence, updated_at")
        .eq("user_id", uid)
        .eq("category", cat)
        .order("confidence", { ascending: false })
        .order("updated_at", { ascending: false });

      if (!all || all.length <= MAX_PER_CATEGORY) continue;

      // Keep the top MAX_PER_CATEGORY by confidence, delete the rest
      const toRemove = (all as any[]).slice(MAX_PER_CATEGORY).map((e: any) => e.id);
      if (toRemove.length > 0) {
        await supabase.from("mavis_tacit").delete().in("id", toRemove).eq("user_id", uid);
        totalDeleted += toRemove.length;
      }
    }

    // ── Step 3: AI deduplication (non-blocking, best-effort) ──
    for (const cat of ["lesson_learned", "workflow_habit", "preference"]) {
      const { data: entries } = await supabase
        .from("mavis_tacit")
        .select("id, key, value, confidence")
        .eq("user_id", uid)
        .eq("category", cat)
        .order("confidence", { ascending: false })
        .limit(40);

      if (!entries || entries.length < 5) continue;

      const listText = (entries as any[]).map((e: any, i: number) =>
        `${i}: [${e.id.slice(0, 8)}] key="${e.key}" value="${String(e.value).slice(0, 120)}"`
      ).join("\n");

      const prompt = `You are reviewing a list of tacit memory entries for an AI system.
Find pairs that express the SAME underlying insight or preference (similar meaning, not just similar words).
For each duplicate pair, identify which entry to KEEP (the richer/more specific one) and which to REMOVE.

Category: ${cat}
Entries:
${listText}

Respond with ONLY a JSON array of IDs to remove (8-char prefixes):
["id1","id2"]
If no duplicates, respond with: []`;

      const raw = await callAI(prompt);
      const match = raw.match(/\[[\s\S]*?\]/);
      if (!match) continue;

      try {
        const toRemovePrefixes = JSON.parse(match[0]) as string[];
        if (!Array.isArray(toRemovePrefixes) || toRemovePrefixes.length === 0) continue;

        // Match prefixes back to full IDs
        const allIds = (entries as any[]).map((e: any) => e.id);
        const idsToDelete: string[] = [];
        for (const prefix of toRemovePrefixes) {
          const full = allIds.find((id: string) => id.startsWith(prefix));
          if (full) idsToDelete.push(full);
        }

        if (idsToDelete.length > 0) {
          await supabase.from("mavis_tacit").delete().in("id", idsToDelete).eq("user_id", uid);
          totalMerged += idsToDelete.length;
        }
      } catch { /* non-fatal */ }
    }

    console.log(`[mavis-tacit-prune] deleted=${totalDeleted} deduped=${totalMerged}`);

    return new Response(
      JSON.stringify({ ok: true, deleted: totalDeleted, deduped: totalMerged }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[mavis-tacit-prune]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
