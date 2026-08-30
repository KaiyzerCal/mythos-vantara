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
//   council   routes through mavis-chat. It used to be excluded from the tool
//             path entirely, so retrieval was the only thing that reached it;
//             council members are now in the pre-pass on the same terms as
//             everyone else, and retrieval still runs for them regardless.
//
// So the mechanism that actually serves all three is retrieval into the
// prompt, not a tool. The tool is the extra that multi-turn surfaces can use
// to dig further. Both run off this one registry.
//
// The registry's column names are not guesses — they were read out of
// information_schema against the live database, because they are genuinely
// inconsistent (title vs name vs objective; content vs description vs notes
// vs summary) and a wrong name is a silent empty result, not an error.

import {
  buildTsQuery,
  buildTsQueryAll,
  extractTerms,
  rankEntries,
  termOccurs,
} from "./entrySearch.ts";

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
  // NOT auto, deliberately. There is no /tasks route and buildSystemPrompt
  // tells every agent "there is no tasks system... create_task/update_task/
  // delete_task are DISABLED". The rows are real operator data so they stay
  // reachable by an explicit search, but injecting them on every message
  // would have agents citing records from a page the app does not have.
  { key: "tasks",         table: "tasks",           titleCol: "title",     bodyCol: "description",                                        hasCreatedAt: true },
  { key: "goals",         table: "mavis_goals",     titleCol: "objective",                                                                hasCreatedAt: true, auto: true },

  // Reachable by explicit search. Not automatic: these are mostly short
  // labels, so they add query cost on every turn for little prose to match.
  { key: "skills",         table: "skills",          titleCol: "name",  bodyCol: "description", extraCols: ["category"], hasCreatedAt: true, auto: true },
  { key: "contacts",       table: "contacts",        titleCol: "name",  bodyCol: "notes",                                hasCreatedAt: true, auto: true },
  { key: "council",        table: "councils",        titleCol: "name",  bodyCol: "notes",       extraCols: ["role", "specialty"], hasCreatedAt: true },
  { key: "allies",         table: "allies",          titleCol: "name",  bodyCol: "notes",       extraCols: ["specialty"], hasCreatedAt: true },
  { key: "transformations",table: "transformations", titleCol: "name",  bodyCol: "description", extraCols: ["category"], hasCreatedAt: true },
  { key: "rituals",        table: "rituals",         titleCol: "name",  bodyCol: "description", extraCols: ["category"], hasCreatedAt: true },
  { key: "store",          table: "store_items",     titleCol: "name",  bodyCol: "description", extraCols: ["category"], hasCreatedAt: true },
  { key: "inventory",      table: "inventory",       titleCol: "name",  bodyCol: "description", extraCols: ["effect"] },
  { key: "calendar",       table: "calendar_events", titleCol: "title", bodyCol: "description" },
  { key: "expenses",       table: "mavis_expenses",  titleCol: "description",                   extraCols: ["category"], hasCreatedAt: true },
  { key: "personas",       table: "personas",        titleCol: "name",  bodyCol: "role",                                 hasCreatedAt: true },

  // Pages that were invisible to every agent until now. Column names and the
  // presence of created_at are taken from the generated Supabase types, not
  // assumed: energy_systems and achievements have no created_at, and asking
  // for one returns nothing rather than erroring.
  //
  // notebook_messages is deliberately absent: it has no user_id column —
  // ownership runs through notebooks.chat_id — so the .eq("user_id", ...)
  // every search applies would match zero rows and look like an empty
  // notebook. The notebook itself is indexed instead.
  { key: "rankings",     table: "rankings_profiles", titleCol: "display_name", bodyCol: "notes",       extraCols: ["rank", "role"], hasCreatedAt: true },
  { key: "energy",       table: "energy_systems",    titleCol: "type",         bodyCol: "description", extraCols: ["status"] },
  { key: "tower",        table: "tower_floors",      titleCol: "name",         bodyCol: "function",    extraCols: ["law"],          hasCreatedAt: true },
  { key: "notebooks",    table: "notebooks",         titleCol: "title",        bodyCol: "description",                              hasCreatedAt: true, auto: true },
  { key: "achievements", table: "achievements",      titleCol: "title",        bodyCol: "description", extraCols: ["category"] },
  { key: "bpm",          table: "bpm_sessions",      titleCol: "form",         bodyCol: "notes",       extraCols: ["mood"],         hasCreatedAt: true },
  { key: "time",         table: "time_logs",         titleCol: "project",      bodyCol: "description",                              hasCreatedAt: true },
  { key: "finance",      table: "plaid_transactions", titleCol: "name",        bodyCol: "merchant_name", extraCols: ["category"],   hasCreatedAt: true },

  // Conversation history — by row count the largest thing the operator has,
  // and until now reachable by nothing. Not automatic: 2600+ chat turns would
  // crowd out authored entries on every message, and a passing remark in an
  // old conversation is rarely the answer when a journal entry exists. It is
  // there when asked for, and semantic search reaches it either way.
  //
  // titleCol is the content itself: the table has no name column, so the
  // keyword pass searches the same text it displays.
  { key: "memory",       table: "mavis_memory",      titleCol: "content",                                                            hasCreatedAt: true },
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
 * The supabase client, as much of it as this needs.
 *
 * Typed loosely on purpose. A hand-written interface spelling the builder
 * chain out was the honest version and it did not survive contact with the
 * real client: PostgREST's builders are deeply generic and self-referential,
 * so structural checking against them made the compiler unfold types until it
 * gave up (TS2589 "type instantiation is excessively deep"), and the client
 * failed to match the interface anyway (TS2345). Callers pass clients typed
 * different ways — `any` in mavis-actions, a full SupabaseClient in
 * mavis-chat — and none should need a cast at the call site to run a search.
 */
// deno-lint-ignore no-explicit-any
type QueryClient = { from(table: string): any; rpc?: (fn: string, args: Record<string, unknown>) => any };

/** Columns worth having before a row is known to be worth fetching. */
function selectForCandidates(t: SearchableTable): string {
  const cols = ["id", t.titleCol];
  if (t.extraCols?.length) cols.push(t.extraCols[0]);
  if (t.hasCreatedAt) cols.push("created_at");
  return [...new Set(cols)].join(",");
}

/** A row the database matched, before its body has been fetched. */
interface Candidate {
  t: SearchableTable;
  id: string;
  title: string;
  category?: string;
  created_at?: string;
  /** The query terms hit the title. The strongest signal available here. */
  titleHits: number;
  /** The body matched the ORed terms — relevant, but weakly. */
  bodyHit: boolean;
  /** Every term matched at once. Almost always the row being asked about. */
  allHit: boolean;
}

const SCORE_TITLE_TERM = 3;
const SCORE_ALL_TERMS = 5;
const SCORE_BODY = 1;

function scoreCandidate(c: Candidate): number {
  return c.titleHits * SCORE_TITLE_TERM +
    (c.allHit ? SCORE_ALL_TERMS : 0) +
    (c.bodyHit ? SCORE_BODY : 0);
}

/**
 * Full-text search across the operator's own rows.
 *
 * Two phases, and the split is what makes complete coverage affordable.
 *
 * Phase 1 asks which rows match and selects only id, title and a date — the
 * body column is searched but never returned. One vault entry averages 3.7 KB
 * and reaches 28 KB, so fetching bodies just to rank them costs most of a
 * megabyte on every message to produce 300-character excerpts. Without the
 * body in the payload the cap can be high enough to take every match there
 * is, which removes the arbitrary truncation that used to decide the answer:
 * the old code took whatever twenty rows Postgres happened to return, out of
 * forty-one matches, with no ORDER BY.
 *
 * Phase 2 fetches whole rows for the handful that survived ranking.
 *
 * Two queries per table for retrieval (title and body) because PostgREST's
 * .textSearch() targets one column, and building an .or() filter from user
 * text would mean hand-escaping PostgREST's filter grammar. A third asks
 * which rows match every term at once, which is the sharpest ranking signal
 * available without ts_rank (unreachable through PostgREST).
 *
 * A failure on one table never fails the search — a missing column or a
 * permissions edge on some obscure table costs that table's results, not the
 * answer.
 */
export async function searchAppData(
  sb: QueryClient,
  userId: string,
  query: string,
  opts: {
    scope?: string | null;
    limit?: number;
    candidateCap?: number;
    /**
     * Turns on the semantic half of the search.
     *
     * Passed in rather than imported so this module stays runnable in the
     * browser, where there is no embedding key: the council board calls the
     * same function and simply gets keyword results. Server callers hand in
     * embedText from _shared/embedding.ts.
     */
    embed?: (text: string) => Promise<number[] | null>;
  } = {},
): Promise<AppSearchHit[]> {
  const terms = extractTerms(query);
  const orQuery = buildTsQuery(query);
  if (!orQuery) return [];
  const andQuery = buildTsQueryAll(query);

  const tables = resolveScope(opts.scope);
  const limit = opts.limit ?? 8;
  // High enough to cover every row of every table at present sizes, so
  // truncation is not what decides whether the operator's entry is seen.
  const candidateCap = opts.candidateCap ?? 200;

  type Probe = { t: SearchableTable; kind: "title" | "body" | "all"; rows: Record<string, unknown>[] };

  const probes: Promise<Probe>[] = [];
  for (const t of tables) {
    const cols = selectForCandidates(t);
    const run = (kind: "title" | "body" | "all", col: string, q: string) => {
      let builder = sb.from(t.table).select(cols).eq("user_id", userId)
        .textSearch(col, q, { type: "websearch" });
      // Deterministic, so a cap that is ever reached cuts the oldest rather
      // than whatever the planner happened to emit.
      if (t.hasCreatedAt) builder = builder.order("created_at", { ascending: false });
      probes.push(
        Promise.resolve(builder.limit(candidateCap))
          .then((r: { data?: unknown[] }) => ({
            t, kind, rows: (r.data ?? []) as Record<string, unknown>[],
          }))
          .catch(() => ({ t, kind, rows: [] as Record<string, unknown>[] })),
      );
    };
    run("title", t.titleCol, orQuery);
    if (t.bodyCol) {
      run("body", t.bodyCol, orQuery);
      // Only worth asking when there is more than one term to require.
      if (terms.length > 1) run("all", t.bodyCol, andQuery);
    }
  }

  // Started here, beside the keyword probes. It used to run after the
  // shortlist was built, behind an early return taken when keyword search
  // found nothing — which is precisely when semantic search is the only thing
  // that can answer. A question sharing no words with the entry got no
  // results at all, the one case the feature exists for.
  const semanticP = semanticHits(sb, userId, query, opts);

  const settled = await Promise.all(probes);

  const byKey = new Map<string, Candidate>();
  for (const { t, kind, rows } of settled) {
    for (const row of rows) {
      // kind+id, not id: two tables can legitimately hold the same id value.
      const key = `${t.key}:${String(row.id ?? "")}`;
      let c = byKey.get(key);
      if (!c) {
        const title = String(row[t.titleCol] ?? "") || "(untitled)";
        c = {
          t,
          id: String(row.id ?? ""),
          title,
          category: t.extraCols?.length ? String(row[t.extraCols[0]] ?? "") || undefined : undefined,
          created_at: t.hasCreatedAt ? String(row.created_at ?? "") || undefined : undefined,
          titleHits: terms.filter((term) => termOccurs(term, title.toLowerCase())).length,
          bodyHit: false,
          allHit: false,
        };
        byKey.set(key, c);
      }
      if (kind === "body") c.bodyHit = true;
      if (kind === "all") c.allHit = true;
    }
  }

  const shortlist = [...byKey.values()]
    .sort((a, b) => {
      const d = scoreCandidate(b) - scoreCandidate(a);
      if (d !== 0) return d;
      return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    })
    .slice(0, Math.max(0, limit));

  const semantic = await semanticP;
  if (shortlist.length === 0 && semantic.length === 0) return [];

  // Phase 2 — whole rows, only for what survived.
  // May be empty when only the semantic half matched; the loops below simply
  // do nothing and `full` starts from the semantic hits alone.
  const wanted = new Map<string, { t: SearchableTable; ids: string[] }>();
  for (const c of shortlist) {
    const e = wanted.get(c.t.key) ?? { t: c.t, ids: [] };
    e.ids.push(c.id);
    wanted.set(c.t.key, e);
  }

  const fetched = await Promise.all(
    [...wanted.values()].map(({ t, ids }) =>
      Promise.resolve(sb.from(t.table).select(selectFor(t)).eq("user_id", userId).in("id", ids))
        .then((r: { data?: unknown[] }) => ({ t, rows: (r.data ?? []) as Record<string, unknown>[] }))
        .catch(() => ({ t, rows: [] as Record<string, unknown>[] })),
    ),
  );

  const full = fetched.flatMap(({ t, rows }) =>
    rows.map((row) => ({
      id: `${t.key}:${String(row.id ?? "")}`,
      kind: t.key,
      title: String(row[t.titleCol] ?? "") || "(untitled)",
      content: t.bodyCol ? String(row[t.bodyCol] ?? "") : "",
      category: t.extraCols?.length ? String(row[t.extraCols[0]] ?? "") || undefined : undefined,
      created_at: t.hasCreatedAt ? String(row.created_at ?? "") || undefined : undefined,
    })),
  );

  // Semantic hits, merged in. Keyword search finds entries that share words
  // with the question; this finds the ones that share meaning — "my custody
  // case" reaching an entry titled "Joanna's Timesharing Violation", which no
  // amount of stemming will do. The two are complementary, so both run and
  // the union is ranked, rather than one replacing the other.
  //
  // Only journal and vault are embedded today, so this widens what those two
  // can match rather than covering every table.
  for (const hit of semantic) {
    const key = `${hit.kind}:${hit.id}`;
    if (!full.some((f) => f.id === key)) {
      full.push({
        id: key,
        kind: hit.kind,
        title: hit.title,
        content: hit.content,
        category: hit.category,
        created_at: hit.created_at,
      });
    }
  }

  // Final order is body-aware now that the bodies are actually here.
  return rankEntries(full, terms, limit).map((r) => ({
    kind: r.kind,
    id: String(r.id).slice(String(r.kind).length + 1),
    title: r.title,
    excerpt: String(r.content ?? "").slice(0, 300),
    category: r.category,
    created_at: r.created_at,
  }));
}

/**
 * Nearest neighbours for the question, via the match_operator_entries RPC.
 *
 * Returns [] for every failure mode — no embed function, no key, an RPC that
 * does not exist yet, a row whose embedding was never backfilled. Semantic
 * search is an addition to keyword search, never a replacement, so nothing
 * here may cost the caller its keyword results.
 */
async function semanticHits(
  sb: QueryClient,
  userId: string,
  query: string,
  opts: { scope?: string | null; limit?: number; embed?: (t: string) => Promise<number[] | null> },
): Promise<Array<{ kind: string; id: string; title: string; content: string; category?: string; created_at?: string }>> {
  if (!opts.embed) return [];
  try {
    const vec = await opts.embed(query);
    if (!vec) return [];

    // Which scopes actually carry vectors. Anything else has nothing embedded,
    // so asking would spend a round trip to be told nothing. Kept in step with
    // match_operator_entries and the backfill's table map — a scope named here
    // but absent there returns empty, and one embedded but missing here is
    // simply never searched.
    const EMBEDDED_SCOPES = ["journal", "vault", "quests", "meeting_notes", "notebooks", "memory"];
    const ANY_SCOPE = ["all", "everything", "*", "auto", "default"];
    const raw = String(opts.scope ?? "").trim().toLowerCase();
    const rpcScope = EMBEDDED_SCOPES.includes(raw) ? raw : "all";
    if (raw && !ANY_SCOPE.includes(raw) && !EMBEDDED_SCOPES.includes(raw)) return [];

    // Guarded rather than assumed: rpc is optional on the minimal client shape
    // this module accepts, and the test stubs do not provide it.
    if (typeof sb.rpc !== "function") return [];

    const { data } = await sb.rpc("match_operator_entries", {
      p_user_id: userId,
      p_query: vec,
      p_count: (opts.limit ?? 8) * 2,
      p_scope: rpcScope,
    });
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      kind: String(r.kind ?? ""),
      id: String(r.id ?? ""),
      title: String(r.title ?? "") || "(untitled)",
      content: String(r.content ?? ""),
      category: String(r.category ?? "") || undefined,
      created_at: String(r.created_at ?? "") || undefined,
    }));
  } catch {
    return [];
  }
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
