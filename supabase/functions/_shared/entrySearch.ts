// Finding the right journal or vault entry out of hundreds.
//
// Why this exists: both MAVIS and every persona were only ever shown the 5
// most recent journal entries and the 5 most recent vault entries, out of 65
// and 97 respectively. Worse, the prompt labelled them "JOURNAL ENTRIES:"
// with no count and no truncation marker, so the model had no way to know it
// was looking at a slice — it answered questions about the vault confidently
// and wrongly. Labelling fixes the confidence; this fixes the reach.
//
// Why full-text search and not embeddings: neither table has an embedding
// column, so a semantic index would mean new schema, a backfill of every
// existing row through an embedding API, and keeping that in sync on every
// write. Postgres full-text search is native, always current, needs no
// backfill, and stems ("running" finds "run"). At the current row counts it
// is instant without an index; add a GIN index on
// to_tsvector('english', title || ' ' || content) if these tables reach the
// tens of thousands.
//
// Everything here is pure — no network, no Deno APIs, no database. The
// action executor and the persona router both need this logic, and neither
// runtime can be integration-tested from the dev container, so it lives
// somewhere a plain vitest run can reach it. Same reasoning as
// storyboard.ts and avatarProfile.ts.

/**
 * Words that carry no search signal. Kept deliberately small: this exists to
 * stop a conversational question ("what did I write about my morning
 * routine") from being dominated by its filler, not to be a linguistics
 * project. Over-trimming is worse than under-trimming, because a dropped
 * content word silently loses the entry the operator was asking about.
 */
export const STOPWORDS = new Set([
  "the", "and", "for", "was", "were", "are", "you", "your", "yours", "our",
  "ours", "who", "whom", "what", "when", "where", "why", "how", "did", "does",
  "done", "doing", "have", "has", "had", "having", "with", "from", "this",
  "that", "these", "those", "there", "their", "them", "they", "been", "being",
  "can", "could", "would", "should", "will", "shall", "may", "might", "must",
  "about", "into", "onto", "over", "under", "than", "then", "just", "some",
  "any", "all", "not", "but", "and", "its", "it's", "i'm", "i've", "let",
  "tell", "show", "give", "get", "got", "say", "said", "know", "think",
  "want", "need", "make", "made", "take", "look", "see", "find", "anything",
  "something", "everything", "please", "thanks", "okay",
]);

/** Longest a token can be before it is almost certainly not a search term. */
const MAX_TOKEN_LENGTH = 40;
/** More terms than this and the query stops discriminating. */
const MAX_TERMS = 8;

/**
 * Meaningful search tokens from arbitrary user text.
 *
 * Tokenising to `[a-z0-9]+` is also the security boundary: these tokens are
 * the only thing that ever reaches the tsquery, so no punctuation, quote, or
 * operator from user input can alter the query's structure. Do not relax this
 * to preserve characters without revisiting how buildTsQuery is consumed.
 */
export function extractTerms(text: string): string[] {
  const raw = (text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const out: string[] = [];
  for (const token of raw) {
    if (token.length < 3 || token.length > MAX_TOKEN_LENGTH) continue;
    if (STOPWORDS.has(token)) continue;
    if (out.includes(token)) continue;
    out.push(token);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

/**
 * A websearch_to_tsquery string that ORs the terms.
 *
 * OR rather than AND because websearch_to_tsquery ANDs by default, and a
 * whole conversational question ANDed together matches nothing — the failure
 * would look identical to "you have no entries about that", which is exactly
 * the wrong answer to give someone with 97 vault entries.
 *
 * Returns "" when there is nothing worth searching for; callers must treat
 * that as "do not search" rather than "search for everything".
 */
export function buildTsQuery(text: string): string {
  return extractTerms(text).join(" OR ");
}

/**
 * The same terms ANDed rather than ORed.
 *
 * A row matching every term is almost always the row being asked about: on
 * the live data, "content production fitness videos" ORed matches 41 vault
 * entries and ANDed matches exactly 1. Too strict to retrieve with — one
 * filler word the entry happens not to contain and it matches nothing — so
 * it is used as a ranking signal alongside the OR query, not instead of it.
 */
export function buildTsQueryAll(text: string): string {
  return extractTerms(text).join(" ");
}

/** Longest suffix termOccurs will strip looking for a stem. */
const MAX_SUFFIX_TRIM = 3;
/** Below this many characters a prefix stops discriminating. */
const MIN_STEM_LENGTH = 4;

/**
 * Whether `term` occurs in `text`, allowing for the stemming Postgres has
 * already done.
 *
 * This is the fix for a bug that made the whole search look broken. The rows
 * being scored here came back from a tsquery under the english config, which
 * stems: asking about "squats" matches an entry that only ever says "squat".
 * A raw `text.includes(term)` then says no, the entry scored 0, and it was
 * dropped — so the search found the entry and threw it away, and the model
 * said it could not see it. Measured against the live vault: one query
 * matched 19 entries and the raw-substring scorer kept 2.
 *
 * Trying the term's shorter prefixes recovers the ordinary English cases
 * (plurals, -ed, -ing) without reimplementing Postgres's stemmer, which we
 * would only get subtly wrong. It is a ranking aid, not a gate — nothing is
 * dropped for failing it.
 */
export function termOccurs(term: string, text: string): boolean {
  if (!term || !text) return false;
  if (text.includes(term)) return true;
  for (let trim = 1; trim <= MAX_SUFFIX_TRIM; trim++) {
    const stem = term.slice(0, term.length - trim);
    if (stem.length < MIN_STEM_LENGTH) break;
    if (text.includes(stem)) return true;
  }
  return false;
}

export interface SearchableEntry {
  id?: string;
  title?: string | null;
  content?: string | null;
  category?: string | null;
  importance?: string | null;
  created_at?: string | null;
}

/**
 * How well one entry answers the terms.
 *
 * A title hit outweighs a body hit — someone asking about "the Vantara launch
 * plan" means the entry called that, not every entry that mentions it in
 * passing. Distinct terms matched matters more than raw repetition, so a
 * single term repeated twenty times cannot outrank an entry that covers the
 * whole question.
 */
export function scoreEntry(entry: SearchableEntry, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const title = (entry.title ?? "").toLowerCase();
  const body = (entry.content ?? "").toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (termOccurs(term, title)) score += 3;
    else if (termOccurs(term, body)) score += 1;
  }
  return score;
}

/**
 * Best entries first.
 *
 * Ranks; it does not filter. Every row handed to this came back from a
 * tsquery, so the database has already ruled on relevance — and it is the
 * better judge, because it stems and this does not. Re-deciding here is what
 * broke the search: rows Postgres had matched scored 0 on a raw substring
 * test and were discarded, so an entry could be found and then thrown away
 * before it ever reached the prompt. A weak score now sorts a row last
 * instead of deleting it.
 *
 * Deduplicates by id: the caller runs one query per searched column, so the
 * same row legitimately arrives more than once.
 */
export function rankEntries<T extends SearchableEntry>(
  entries: readonly T[],
  terms: readonly string[],
  limit: number,
): T[] {
  const byId = new Map<string, T>();
  for (const entry of entries) {
    const key = entry.id ?? JSON.stringify([entry.title, entry.created_at]);
    if (!byId.has(key)) byId.set(key, entry);
  }

  return [...byId.values()]
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Recency breaks ties so the answer skews to what is current.
      return String(b.entry.created_at ?? "").localeCompare(String(a.entry.created_at ?? ""));
    })
    .slice(0, Math.max(0, limit))
    .map((row) => row.entry);
}

/**
 * The header for a list the model is only seeing part of.
 *
 * This is the whole fix for the confident-wrong-answer problem: a bare
 * "JOURNAL ENTRIES:" reads as the complete set. "JOURNAL ENTRIES (showing 5
 * of 97 — most recent first; search_journal for the rest)" tells the model
 * both that it is incomplete and how to get the rest.
 */
export function truncationLabel(
  name: string,
  shown: number,
  total: number,
  searchAction?: string,
): string {
  if (total <= shown) return `${name} (${total})`;
  const hint = searchAction ? ` — most recent first; use ${searchAction} to search the rest` : "";
  return `${name} (showing ${shown} of ${total}${hint})`;
}
