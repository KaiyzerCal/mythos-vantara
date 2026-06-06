// mavis-memory-embed
// Runs every 15 minutes via pg_cron.
// Picks up unembedded mavis_memory rows, generates embeddings using
// Supabase's built-in gte-small model (self-hosted, no external API),
// and stores them for semantic search.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH_SIZE    = 20; // rows per run

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fetch rows without embeddings yet (oldest first)
    const { data: rows, error } = await adminSb
      .from("mavis_memory")
      .select("id, content, user_id")
      .is("embedding", null)
      .not("content", "is", null)
      .order("timestamp", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return json({ embedded: 0, message: "Nothing to embed" });

    // Use Supabase's built-in gte-small model — fully self-hosted, no external API
    // @ts-ignore — Supabase.ai is available in Supabase edge runtime
    const session = new Supabase.ai.Session("gte-small");

    let embedded = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        // Clean text: strip markdown noise, cap at 512 chars for gte-small
        const text = row.content
          .replace(/```[\s\S]*?```/g, "")
          .replace(/[#*_~`]/g, "")
          .trim()
          .slice(0, 512);

        if (!text) continue;

        const output = await session.run(text, { mean_pool: true, normalize: true });
        const embedding: number[] = Array.from(output.data as Float32Array);

        const { error: updateErr } = await adminSb
          .from("mavis_memory")
          .update({ embedding: JSON.stringify(embedding) })
          .eq("id", row.id);

        if (updateErr) errors.push(`row ${row.id}: ${updateErr.message}`);
        else embedded++;

      } catch (e: any) {
        errors.push(`row ${row.id}: ${e.message}`);
      }
    }

    return json({ embedded, errors: errors.slice(0, 5), total_pending: rows.length - embedded });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("mavis-memory-embed error:", message);
    return json({ error: message }, 500);
  }
});
