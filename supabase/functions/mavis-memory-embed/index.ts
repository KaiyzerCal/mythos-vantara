// mavis-memory-embed
// Runs every 15 minutes via pg_cron.
// Embeds both mavis_memory (conversation history) and mavis_persona_memory
// (structured key/value store) using Supabase's built-in gte-small model.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH_SIZE   = 20;

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function embedRows(
  adminSb: ReturnType<typeof createClient>,
  // @ts-ignore — Supabase.ai available in edge runtime
  session: Supabase.ai.Session,
  table: string,
  textCol: string,
  rows: Array<{ id: string; [key: string]: unknown }>,
): Promise<{ embedded: number; errors: string[] }> {
  let embedded = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const raw = String(row[textCol] ?? "");
      const text = raw
        .replace(/```[\s\S]*?```/g, "")
        .replace(/[#*_~`]/g, "")
        .trim()
        .slice(0, 512);

      if (!text) continue;

      const output = await session.run(text, { mean_pool: true, normalize: true });
      const embedding: number[] = Array.from(output.data as Float32Array);

      const { error: updateErr } = await adminSb
        .from(table)
        .update({ embedding: JSON.stringify(embedding) })
        .eq("id", row.id);

      if (updateErr) errors.push(`${table}[${row.id}]: ${updateErr.message}`);
      else embedded++;
    } catch (e: unknown) {
      errors.push(`${table}[${row.id}]: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { embedded, errors };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

    // @ts-ignore
    const session = new Supabase.ai.Session("gte-small");

    // ── Embed mavis_memory (conversation history) ────────────────────────────
    const { data: memRows, error: memErr } = await adminSb
      .from("mavis_memory")
      .select("id, content")
      .is("embedding", null)
      .not("content", "is", null)
      .order("timestamp", { ascending: true })
      .limit(BATCH_SIZE);

    if (memErr) throw new Error(memErr.message);

    const memResult = await embedRows(adminSb, session, "mavis_memory", "content", memRows ?? []);

    // ── Embed mavis_persona_memory (structured key/value notes) ─────────────
    const { data: pRows, error: pErr } = await adminSb
      .from("mavis_persona_memory")
      .select("id, value")
      .is("embedding", null)
      .not("value", "is", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (pErr) throw new Error(pErr.message);

    const pResult = await embedRows(adminSb, session, "mavis_persona_memory", "value", pRows ?? []);

    return jsonRes({
      ok: true,
      mavis_memory:         { embedded: memResult.embedded, errors: memResult.errors.slice(0, 3) },
      mavis_persona_memory: { embedded: pResult.embedded,   errors: pResult.errors.slice(0, 3) },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("mavis-memory-embed error:", message);
    return jsonRes({ ok: false, error: message }, 500);
  }
});
