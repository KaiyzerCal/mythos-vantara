// Fire-and-forget: after a write that bypasses an edge function (the UI
// writes some rows straight to Supabase), tell mavis-embed-backfill about
// just this user+scope so the new row gets a vector before the operator's
// next semantic search, instead of sitting NULL until whatever future cron
// runs a full backfill. mavis-actions/index.ts already does the equivalent
// for AI-driven writes via reembedRow(); this is the client-side path for
// the writes that never go through it.
//
// Reuses mavis-embed-backfill rather than a dedicated endpoint — it already
// takes a user_id + scope and only touches rows WHERE embedding IS NULL, so
// scoping it to one user is just a small, harmless batch, not a full re-run.
// A missed call here still self-heals on the next manual or scheduled
// backfill; nothing here is load-bearing for correctness, only for how soon
// a new entry becomes findable by meaning.
import { supabase } from "@/integrations/supabase/client";

// Keys of EMBEDDABLE_TABLES (supabase/functions/_shared/embeddableTables.ts)
// that the client actually writes to directly. Kept narrow rather than
// importing the full 30-entry map client-side.
export type EmbedScope = "journal" | "quests" | "notebooks";

export async function triggerEmbed(userId: string, scope: EmbedScope): Promise<void> {
  if (!userId) return;
  try {
    await supabase.functions.invoke("mavis-embed-backfill", {
      body: { user_id: userId, scope, batch: 5 },
    });
  } catch {
    // Best-effort. The next backfill pass still finds and embeds the row.
  }
}
