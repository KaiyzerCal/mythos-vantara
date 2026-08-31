// Refresh one row's embedding right after it is written, for any table in
// EMBEDDABLE_TABLES — not just journal_entries/vault_entries, which is all
// the original version of this function (formerly local to
// mavis-actions/index.ts) knew how to handle.
//
// Fire-and-forget on purpose: the operator's create or update has already
// succeeded, and an embedding endpoint being slow must not hold up the reply
// or fail the action. A row that misses its embedding here is simply picked
// up by the next mavis-embed-backfill run, since that selects on
// embedding IS NULL.
//
// Without this, semantic search works on the day a table is backfilled and
// silently rots afterward — every entry written since is invisible to it.
// That is how mavis_memory ended up with 2632 rows and zero vectors, and
// (found while wiring this up) how 26 of the 28 curated-tier tables had no
// write-time path at all — only the backfill, which nothing schedules.

import { embedText, embeddableText } from "./embedding.ts";
import { EMBEDDABLE_TABLES, type Backfillable } from "./embeddableTables.ts";

// EMBEDDABLE_TABLES is keyed by scope name (journal, mavis_telos, ...), but
// every existing call site knows the table it just wrote to (journal_entries,
// mavis_telos, ...), not its scope key. Built once, not per call.
const BY_TABLE_NAME: Record<string, Backfillable> = {};
for (const cfg of Object.values(EMBEDDABLE_TABLES)) {
  BY_TABLE_NAME[cfg.table] = cfg;
}

/**
 * @param table The table name (e.g. "journal_entries", "mavis_telos") — not
 *   the appSearch.ts scope key, which differs for some tables (journal vs
 *   journal_entries). A table absent from EMBEDDABLE_TABLES is a no-op, not
 *   an error — most tables in this app don't carry an embedding column.
 */
// deno-lint-ignore no-explicit-any
export function reembedRow(sb: any, table: string, id: string, userId: string): void {
  const cfg = BY_TABLE_NAME[table];
  if (!cfg) return;
  const idCol = cfg.idCol ?? "id";

  (async () => {
    try {
      const cols = cfg.titleCol ? `${cfg.titleCol},${cfg.bodyCol}` : cfg.bodyCol;
      const { data } = await sb.from(cfg.table).select(cols).eq(idCol, id).eq("user_id", userId).maybeSingle();
      if (!data) return;

      // jsonb columns arrive parsed, not stringified — embeddableText's plain
      // concatenation would otherwise embed the literal text "[object Object]".
      const bodyVal = cfg.bodyIsJson ? JSON.stringify(data[cfg.bodyCol] ?? "") : data[cfg.bodyCol];
      const text = embeddableText(cfg.titleCol ? data[cfg.titleCol] : "", bodyVal);
      if (!text) return;

      const vec = await embedText(text, cfg.dims);
      if (!vec) return;
      await sb.from(cfg.table).update({ embedding: vec }).eq(idCol, id).eq("user_id", userId);
    } catch { /* non-critical: the backfill will catch it */ }
  })();
}
