// Search anything in the app, for every surface that talks to the operator.
//
// MAVIS, council members and personas all needed to reach the operator's real
// data, and each was blocked differently:
//
//   MAVIS     multi-turn, has tools — but its prompt only carried the 5 most
//             recent journal/vault entries, and it had no way to reach past
//             that until search_journal/search_vault existed.
//   personas  mavis-persona-router is SINGLE-TURN: actions are parsed and run
//             after the model has already replied, so a tool it calls can
//             never inform the answer it is giving. Anything the reply depends
//             on must be in the prompt before the LLM runs.
//   council   routes through mavis-chat but is excluded from the tool path
//             entirely — the native pre-pass is gated on
//             (!isCouncilMode || !!personaId), which is false for a council
//             member. A tool alone would never have reached them.
//
// So the mechanism that actually serves all three is retrieval into the
// prompt, not a tool. The tool is the extra that multi-turn surfaces can use
// to dig further. Both run off this one registry.
//
// The registry's column names are not guesses — they were read out of
// information_schema against the live database, because they are genuinely
// inconsistent (title vs name vs objective; content vs description vs notes
// vs summary) and a wrong name is a silent empty result, not an error.

import { buildTsQuery, extractTerms, rankEntries } from "./entrySearch.ts";

export interface SearchableTable {
  /** Scope name the model uses, and the label shown on a hit. */
  key: string;
  table: string;
  /** The name-ish column. Every table has one; it is what a hit is called. */
  titleCol: string;
  /** The prose column, when the table has one distinct from the title. */
  bodyCol?: string;
  /** Extra columns worth returning for context. Verified to exist. */
  extraCols?: string[];
  /** Not universal — inventory and calendar_events have no created_at. */
  hasCreatedAt?: boolean;
  /**
   * Searched on every message without being asked. Kept to the tables that
   * actually hold prose the operator writes, because this runs on every turn
   * of every conversation and each table costs two queries.
   */
  auto?: boolean;
}

export const SEARCHABLE: SearchableTable[] = [
  { key: "journal",       table: "journal_entries", titleCol: "title",     bodyCol: "content",     extraCols: ["category", "importance"], hasCreatedAt: true, auto: true },
  { key: "vault",         table: "vault_entries",   titleCol: "title",     bodyCol: "content",     extraCols: ["category", "importance"], hasCreatedAt: true, auto: true },
  { key: "meeting_notes", table: "meeting_notes",   titleCol: "title",     bodyCol: "summary",                                            hasCreatedAt: true, auto: true },
  { key: "quests",        table: "quests",          titleCol: "title",     bodyCol: "description", extraCols: ["category"],               hasCreatedAt: true, auto: true },
  { key: "tasks",         table: "tasks",           titleCol: "title",     bodyCol: "description",                                        hasCreatedAt: true, auto: true },
  { key: "goals",         table: "mavis_goals",     titleCol: "objective",                                                                hasCreatedAt: true, auto: true },

  // Reachable by explicit search. Not automatic: these are mostly short
  // labels, so they add query cost on every turn for little prose to match.
  { key: "skills",         table: "skills",          titleCol: "name",  bodyCol: "description", extraCols: ["category"], hasCreatedAt: true },
  { key: "contacts",       table: "contacts",        titleCol: "name",  bodyCol: "notes",                                hasCreatedAt: true },
  { key: "council",        table: "councils",        titleCol: "name",  bodyCol: "notes",       extraCols: ["role", "specialty"], hasCreatedAt: true },
  { key: "allies",         table: "allies",          titleCol: "name",  bodyCol: "notes",       extraCols: ["specialty"], hasCreatedAt: true },
  { key: "transformations",table: "transformations", titleCol: "name",  bodyCol: "description", extraCols: ["category"], hasCreatedAt: true },
  { key: "rituals",        table: "rituals",         titleCol: "name",  bodyCol: "description", extraCols: ["category"], hasCreatedAt: true },
  { key: "store",          table: "store_items",     titleCol: "name",  bodyCol: "description", extraCols: ["category"], hasCreatedAt: true },
  { key: "inventory",      table: "inventory",       titleCol: "name",  bodyCol: "description", extraCols: ["effect"] },
  { key: "calendar",       table: "calendar_events", titleCol: "title", bodyCol: "description" },
  { key: "expenses",       table: "mavis_expenses",  titleCol: "description",                   extraCols: ["category"], hasCreatedAt: true },
  { key: "personas",       table: "personas",        titleCol: "name",  bodyCol: "role",                                 hasCreatedAt: true },
];

export const SEARCHABLE_KEYS = SEARCHABLE.map((t) => t.key);

/** Columns to request. Only ever names verified to exist on that table. */
export function selectFor(t: SearchableTable): string {
  const cols = ["id", t.titleCol];
  if (t.bodyCol) cols.push(t.bodyCol);
  if (t.extraCols) cols.push(...t.extraCols);
  if (t.hasCreatedAt) cols.push("created_at");
  return [...new Set(cols)].join(",");
}

/**
 * Which tables a scope refers to.
 *
 * An unrecognised scope resolves to the automatic set rather than to nothing:
 * a model inventing a scope name should get a slightly-too-broad answer, not
 * a confident "you have nothing about that".
 */
export function resolveScope(scope?: string | null): SearchableTable[] {
  const raw = String(scope ?? "").trim().toLowerCase();
  if (!raw || raw === "auto" || raw === "default") return SEARCHABLE.filter((t) => t.auto);
  if (raw === "all" || raw === "everything" || raw === "*") return SEARCHABLE;

  const wanted = raw.split(/[,\s]+/).filter(Boolean);
  const picked = SEARCHABLE.filter((t) => wanted.includes(t.key) || wanted.includes(t.table));
  return picked.length > 0 ? picked : SEARCHABLE.filter((t) => t.auto);
}

export interface AppSearchHit {
  kind: string;
  id: string;
  title: string;
  excerpt: string;
  category?: string;
  created_at?: string;
}

/**
 * The supabase client, as much of it as this needs:
 *   sb.from(table).select(cols).eq(col, val).textSearch(col, q, opts).limit(n)
 *
 * Typed loosely on purpose. A hand-written interface spelling that chain out
 * was the honest version and it did not survive contact with the real client:
 * PostgREST's builders are deeply generic and self-referential, so structural
 * checking against them made the compiler unfold types until it gave up
 * (TS2589 "type instantiation is excessively deep"), and the client failed to
 * match the interface anyway (TS2345). Callers pass clients typed three
 * different ways — `any` in mavis-actions, a full SupabaseClient in mavis-chat
 * — and none of them should need a cast at the call site to use a search.
 */
// deno-lint-ignore no-explicit-any
type QueryClient = { from(table: string): any };

/**
 * Full-text search across the operator's own rows.
 *
 * Two queries per table (title and body) because PostgREST's .textSearch()
 * targets one column, and building an .or() filter string from user text
 * would mean hand-escaping PostgREST's filter grammar. Two safe queries beat
 * one clever one.
 *
 * A failure on one table never fails the search — a missing column or a
 * permissions edge on some obscure table should cost that table's results,
 * not the answer.
 */
export async function searchAppData(
  sb: QueryClient,
  userId: string,
  query: string,
  opts: { scope?: string | null; limit?: number; perTable?: number } = {},
): Promise<AppSearchHit[]> {
  const terms = extractTerms(query);
  const tsQuery = buildTsQuery(query);
  if (!tsQuery) return [];

  const tables = resolveScope(opts.scope);
  const perTable = opts.perTable ?? 20;

  const runs: Promise<{ t: SearchableTable; rows: Record<string, unknown>[] }>[] = [];
  for (const t of tables) {
    const cols = selectFor(t);
    const columnsToSearch = t.bodyCol ? [t.titleCol, t.bodyCol] : [t.titleCol];
    for (const col of columnsToSearch) {
      runs.push(
        Promise.resolve(
          sb.from(t.table).select(cols).eq("user_id", userId)
            .textSearch(col, tsQuery, { type: "websearch" }).limit(perTable),
        )
          .then((r) => ({ t, rows: ((r as { data?: unknown[] }).data ?? []) as Record<string, unknown>[] }))
          .catch(() => ({ t, rows: [] as Record<string, unknown>[] })),
      );
    }
  }

  const settled = await Promise.all(runs);

  // Normalise to the shape rankEntries scores, keeping the source table so a
  // hit can say where it came from.
  const normalised = settled.flatMap(({ t, rows }) =>
    rows.map((row) => ({
      id: String(row.id ?? ""),
      kind: t.key,
      title: String(row[t.titleCol] ?? "") || "(untitled)",
      content: t.bodyCol ? String(row[t.bodyCol] ?? "") : "",
      category: t.extraCols?.length ? String(row[t.extraCols[0]] ?? "") || undefined : undefined,
      created_at: t.hasCreatedAt ? String(row.created_at ?? "") || undefined : undefined,
    })),
  );

  // Dedupe across tables by kind+id — the same row arrives from the title and
  // body queries, and two tables can legitimately share an id value.
  const ranked = rankEntries(
    normalised.map((n) => ({ ...n, id: `${n.kind}:${n.id}` })),
    terms,
    opts.limit ?? 8,
  );

  return ranked.map((r) => ({
    kind: r.kind,
    id: String(r.id).slice(String(r.kind).length + 1),
    title: r.title,
    excerpt: String(r.content ?? "").slice(0, 300),
    category: r.category,
    created_at: r.created_at,
  }));
}

/** The prompt block. Empty string when there is nothing worth adding. */
export function formatSearchBlock(hits: AppSearchHit[], hadQuery: boolean): string {
  if (!hadQuery) return "";
  if (hits.length === 0) {
    return "RELEVANT RECORDS: nothing in the operator's data matches this message.\n";
  }
  const lines = hits.map((h) =>
    `  • [${h.kind}] "${h.title}"${h.category ? ` [${h.category}]` : ""}` +
    `${h.created_at ? ` (${h.created_at.slice(0, 10)})` : ""}` +
    `${h.excerpt ? ` — ${h.excerpt}` : ""}`,
  );
  return (
    "RELEVANT RECORDS (matched against what the operator just said, searched across their FULL data — " +
    "not only the recent items listed elsewhere in this prompt):\n" +
    lines.join("\n") + "\n"
  );
}
