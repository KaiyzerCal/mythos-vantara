// Relevance trimming for the client-built system prompt.
//
// buildSystemPrompt used to list EVERY quest (all 265, completed included, full descriptions), every
// skill (the whole 1,451-row Beyonder tree) and 500 characters of every journal and vault entry. The
// agent appends that prompt to its own, so each agent call carried ~158,000 tokens (measured in
// mavis_ai_usage) — slow, expensive, and far past Groq's daily budget in a single message.
//
// Same idea as the server's LIVE BACKEND STATE (mavis-chat): show what relates to the operator's
// latest message in full, the rest compactly, and say so, so the model looks things up instead of
// inventing them. Keyword overlap only: no network call, no added latency.

const WORD = /[a-z0-9']{4,}/g;

export interface Relevance {
  /** How many distinct 4+ letter words of the focus text appear in `text`. */
  overlap: (text: string) => number;
  /** The focus text, lower-cased. */
  focus: string;
}

export function makeRelevance(focusText: string | undefined | null): Relevance {
  const focus = String(focusText ?? "").toLowerCase();
  const words = new Set<string>(focus.match(WORD) ?? []);
  return {
    focus,
    overlap: (text: string) => {
      if (words.size === 0) return 0;
      let n = 0;
      for (const w of new Set<string>(String(text ?? "").toLowerCase().match(WORD) ?? [])) if (words.has(w)) n++;
      return n;
    },
  };
}

/**
 * The `max` most relevant items: by keyword overlap with the focus text, then by `boost` (e.g. active
 * before completed), then by recency. With no focus text this is simply the most recent ones.
 */
export function pickRelevant<T>(
  items: T[],
  rel: Relevance,
  max: number,
  text: (item: T) => string,
  recency: (item: T) => number = () => 0,
  boost: (item: T) => number = () => 0,
): Set<T> {
  return new Set(
    [...items]
      .map((item) => ({ item, score: rel.overlap(text(item)), b: boost(item), t: recency(item) }))
      .sort((a, b) => b.score - a.score || b.b - a.b || b.t - a.t)
      .slice(0, max)
      .map((x) => x.item),
  );
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Beyonder rows worth showing: every pathway root, the full subtree of up to 3 pathways named in the
 * focus text, and the 6 sequences (with their abilities) whose own text best matches it.
 */
export function selectBeyonder(beyonder: any[], rel: Relevance): any[] {
  const roots = beyonder.filter((s) => !s.parent_skill_id);
  const rootIds = new Set(roots.map((r) => r.id));
  const sequences = beyonder.filter((s) => s.parent_skill_id && rootIds.has(s.parent_skill_id));
  // Longest names first, and a matched name is blanked out of the text, so "black sun" selects the
  // Black Sun pathway without also dragging in the separate Sun pathway.
  let remaining = rel.focus;
  const named = new Set<string>();
  for (const r of [...roots].sort((a, b) => String(b.name ?? "").length - String(a.name ?? "").length)) {
    if (named.size >= 3 || !r.name || !remaining) continue;
    const re = new RegExp(`\\b${escapeRe(String(r.name).toLowerCase())}\\b`);
    if (re.test(remaining)) { named.add(r.id); remaining = remaining.replace(re, " "); }
  }
  const score = (sq: any) => rel.overlap(`${sq.name} ${sq.description ?? ""}`);
  const matched = new Set(
    sequences
      .filter((sq) => !named.has(sq.parent_skill_id) && score(sq) >= 2)
      .sort((a, b) => score(b) - score(a))
      .slice(0, 6)
      .map((sq) => sq.id),
  );
  const seqById = new Map(sequences.map((sq) => [sq.id, sq]));
  return beyonder.filter((s) => {
    if (!s.parent_skill_id) return true;
    if (named.has(s.parent_skill_id) || matched.has(s.id) || matched.has(s.parent_skill_id)) return true;
    const parentSeq = seqById.get(s.parent_skill_id);
    return !!parentSeq && named.has(parentSeq.parent_skill_id);
  });
}

export const ts = (v: unknown): number => {
  const n = new Date(String(v ?? 0)).getTime();
  return Number.isFinite(n) ? n : 0;
};
