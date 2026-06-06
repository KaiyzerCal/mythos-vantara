// mavis-archivist
// Weekly memory archivist for mavis_memory (MAVIS conversation log).
// Strategy:
//   1. Delete entries older than 90 days with importance_score < 4
//   2. Cap each user at 2000 rows — keep highest importance_score, drop oldest excess
//   3. AI deduplication: find near-identical content in same session, keep best version
//   4. Prune expired notification_stages dedupe rows
// Runs Sunday 4am UTC via mavis_cron_config. verify_jwt = false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_KEY   = Deno.env.get("LOVABLE_API_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY    = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

const MAX_ROWS_PER_USER = 2000;
const MAX_AGE_DAYS      = 90;
const MIN_IMPORTANCE    = 4;

async function callAI(prompt: string): Promise<string> {
  if (LOVABLE_KEY) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 600,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        const t = d.choices?.[0]?.message?.content ?? "";
        if (t.trim()) return t;
      }
    } catch { /* fall through */ }
  }
  if (ANTHROPIC_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (res.ok) {
        const d = await res.json();
        return d.content?.[0]?.text ?? "";
      }
    } catch { /* fall through */ }
  }
  if (OPENAI_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (res.ok) {
        const d = await res.json();
        return d.choices?.[0]?.message?.content ?? "";
      }
    } catch { /* fall through */ }
  }
  return "";
}

interface ArchiveResult {
  pruned_stale: number;
  pruned_overflow: number;
  deduped: number;
}

async function archiveFor(
  userId: string,
  sb: ReturnType<typeof createClient>,
): Promise<ArchiveResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * 86400000).toISOString();

  // Step 1: Delete stale low-importance rows
  const { count: staleCount } = await sb
    .from("mavis_memory")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .lt("created_at", cutoff)
    .lt("importance_score", MIN_IMPORTANCE);

  const pruned_stale = staleCount ?? 0;

  // Step 2: Overflow cap
  const { count: total } = await sb
    .from("mavis_memory")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  let pruned_overflow = 0;
  if ((total ?? 0) > MAX_ROWS_PER_USER) {
    const overflow = (total ?? 0) - MAX_ROWS_PER_USER;
    const { data: oldest } = await sb
      .from("mavis_memory")
      .select("id")
      .eq("user_id", userId)
      .order("importance_score", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(overflow);

    if (oldest?.length) {
      const ids = (oldest as any[]).map((r: any) => r.id);
      const { count } = await sb
        .from("mavis_memory")
        .delete({ count: "exact" })
        .eq("user_id", userId)
        .in("id", ids);
      pruned_overflow = count ?? 0;
    }
  }

  // Step 3: AI deduplication of last 7 days of memory
  let deduped = 0;
  try {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const { data: recent } = await sb
      .from("mavis_memory")
      .select("id,content,session_id,role")
      .eq("user_id", userId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(80);

    if (recent && recent.length > 5) {
      const snippet = (recent as any[])
        .map((r: any, i: number) => `[${i}] id:${r.id} role:${r.role} | ${String(r.content ?? "").slice(0, 100)}`)
        .join("\n");

      const aiRes = await callAI(
        `Review these recent MAVIS conversation memory entries. Identify near-identical entries (same content, possibly rephrased or duplicated across turns). For each duplicate group, pick the best entry to keep and return the IDs of entries to DELETE.

Entries:
${snippet}

Respond with ONLY a JSON array of IDs to delete (may be empty):
["id-to-delete-1","id-to-delete-2"]`,
      );

      const match = aiRes.match(/\[[\s\S]*?\]/);
      if (match) {
        const ids: string[] = JSON.parse(match[0]).filter((x: any) => typeof x === "string");
        if (ids.length > 0) {
          const { count } = await sb
            .from("mavis_memory")
            .delete({ count: "exact" })
            .eq("user_id", userId)
            .in("id", ids);
          deduped = count ?? 0;
        }
      }
    }
  } catch { /* non-critical */ }

  return { pruned_stale, pruned_overflow, deduped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));

    // Step A: Prune expired notification_stages rows (all users, housekeeping)
    await sb
      .from("notification_stages")
      .delete()
      .lt("expires_at", new Date().toISOString())
      .catch(() => {});

    if (body?.user_id) {
      const result = await archiveFor(body.user_id, sb);
      return new Response(
        JSON.stringify({ ok: true, user_id: body.user_id, ...result }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cron mode: find users with significant memory volume
    const { data: userRows } = await sb
      .from("mavis_memory")
      .select("user_id")
      .order("user_id")
      .limit(2000);

    const uniqueUsers = [
      ...new Set((userRows ?? []).map((r: any) => r.user_id as string)),
    ];

    const results: any[] = [];
    for (const uid of uniqueUsers) {
      try {
        const r = await archiveFor(uid, sb);
        if (r.pruned_stale + r.pruned_overflow + r.deduped > 0) {
          results.push({ user_id: uid, ...r });
        }
      } catch (e: any) {
        results.push({ user_id: uid, error: e.message });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed: uniqueUsers.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("mavis-archivist error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
