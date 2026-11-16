// Answering from the operator's own records instead of from memory.
//
// Live 2026-11-16: asked what the Paradox Engine story says, MAVIS replied "let me pull the relevant entries" and then
// described characters from a different part of the operator's world (Dante Greyson, the Black Sun Monarch) while the
// stored entries are about brothers Calvin and Bishop, the AI Atlas/MEW, Lyra and the Distortion. Three causes together:
//   1. nothing in the message tripped the tool pre-pass, so no lookup ran;
//   2. the automatic search handed over only the FIRST 300 characters of each entry (a generic directive, not the story);
//   3. no rule said to stop at what was actually read.
// This module is the deterministic half of the fix: recognise a recall question, find its real subject words, and pull
// the passages that mention them out of long entries so the model reads source text rather than inventing it.

const STOP = new Set((
  "the and for with that this from your you are was were what who how why when where which does did have has had can could " +
  "would should will about into onto over under then than them they their there here been being just also very more most some " +
  "any all not but out its our his her him she let get got tell told say said show give make look looked looking pull find " +
  "check read know aware please want need like lets let's isn doesn didn don wasn won aren wouldn couldn shouldn hasn haven"
).split(/\s+/));

// Words that describe the REQUEST rather than its subject ("in my vault", "the characters", "saved entries").
const REQUEST_FILLER = new Set((
  "vault journal notes note entry entries saved stored written record records knowledge graph story storyline stories lore " +
  "character characters summary overview details detail information info correct incorrect wrong right again lookup up"
).split(/\s+/));

const CREATE_INTENT = /^\s*(?:please\s+)?(?:save|create|add|put|store|log|record|write|remember|make)\b/i;

const RECALL = new RegExp([
  String.raw`\b(?:in|from|on|inside)\s+(?:my|the|our)\s+(?:vault|journal|notes?|knowledge\s*(?:graph|base))\b`,
  String.raw`\b(?:my|the)\s+(?:vault|journal)\s+(?:entr|notes?|says?|has|have|contains?)`,
  String.raw`\b(?:saved|stored|written)\b[^.?!]{0,50}\b(?:entr|notes?|lore|stor|doc)`,
  String.raw`\blook\s*(?:it\s*|that\s*|this\s*)?up\b`,
  String.raw`\bwhat\s+(?:did|do|have)\s+i\s+(?:write|wrote|say|said|save|saved|have|written)\b`,
  String.raw`\b(?:lore|storyline|canon)\b`,
].join("|"), "i");

/** True when the message asks about something that should already be in the operator's records. */
export function recallIntent(text: string): boolean {
  const t = String(text ?? "");
  if (!t.trim() || CREATE_INTENT.test(t)) return false;
  return RECALL.test(t);
}

function tokens(text: string): string[] {
  const out: string[] = [];
  for (const w of (String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [])) {
    if (w.length < 3 || STOP.has(w) || REQUEST_FILLER.has(w) || out.includes(w)) continue;
    out.push(w);
  }
  return out;
}

/**
 * The words that name the SUBJECT of the question ("paradox engine"), not the request around it. A follow-up with no subject
 * ("that's wrong, look it up again") borrows the subject from the most recent earlier message that has one.
 * `previous` is newest-first.
 */
export function subjectTerms(text: string, previous: string[] = [], max = 4): string[] {
  const own = tokens(text);
  if (own.length > 0) return own.slice(0, max);
  for (const p of previous) {
    const t = tokens(p);
    if (t.length > 0) return t.slice(0, max);
  }
  return [];
}

/** A window that starts mid-text begins mid-word; drop that partial first word. (The document's own opening is left alone.) */
function trimToWords(s: string, midText: boolean): string {
  const t = midText ? s.replace(/^\S+\s+/, "") : s;
  return t.trim();
}

/**
 * Up to `max` passages of ~`size` characters, centred where the terms actually occur (windows that cover more distinct
 * terms win), in document order. Short documents come back whole. A long document with no term hits yields its opening.
 * `head` adds the opening of a long entry as well (its framing: what the document is, who is in it).
 */
export function selectPassages(
  content: string,
  terms: string[],
  opts: { max?: number; size?: number; head?: number; wholeBelow?: number } = {},
): string[] {
  const text = String(content ?? "").replace(/\r/g, "");
  const max = opts.max ?? 3;
  const size = opts.size ?? 700;
  const head = opts.head ?? 0;
  const wholeBelow = opts.wholeBelow ?? 0;
  if (!text.trim()) return [];
  if (text.length <= Math.max(wholeBelow, size)) return [text.trim()];

  const lower = text.toLowerCase();
  const hits: Array<{ at: number; term: string }> = [];
  for (const term of terms) {
    let from = 0;
    for (let n = 0; n < 12; n++) {
      const at = lower.indexOf(term, from);
      if (at < 0) break;
      hits.push({ at, term });
      from = at + term.length;
    }
  }

  const windows: Array<{ start: number; end: number; cover: number }> = [];
  for (const h of hits) {
    const start = Math.max(0, h.at - Math.floor(size / 4));
    const end = Math.min(text.length, start + size);
    const covered = new Set(hits.filter((x) => x.at >= start && x.at < end).map((x) => x.term));
    windows.push({ start, end, cover: covered.size });
  }
  windows.sort((a, b) => b.cover - a.cover || a.start - b.start);

  const chosen: Array<{ start: number; end: number }> = [];
  if (head > 0) chosen.push({ start: 0, end: Math.min(head, text.length) });
  for (const w of windows) {
    if (chosen.length >= max + (head > 0 ? 1 : 0)) break;
    if (chosen.some((c) => w.start < c.end && w.end > c.start)) continue; // overlaps one already taken
    chosen.push({ start: w.start, end: w.end });
  }
  if (chosen.length === 0) chosen.push({ start: 0, end: Math.min(size * 2, text.length) });

  chosen.sort((a, b) => a.start - b.start);
  return chosen.map((c) => {
    const piece = trimToWords(text.slice(c.start, c.end), c.start > 0);
    return `${c.start > 0 ? "…" : ""}${piece}${c.end < text.length ? "…" : ""}`;
  });
}

export interface SourceEntry {
  kind: string;
  title: string;
  category?: string;
  created_at?: string;
  length: number;
  passages: string[];
}

/** The block handed to the model: verbatim source text, plus the rule that it may not go beyond it. */
export function formatSourceEntries(entries: SourceEntry[], budget = 9000): string {
  if (entries.length === 0) return "";
  const parts: string[] = [];
  let used = 0;
  for (const e of entries) {
    const header = `[${e.kind}] "${e.title}"${e.category ? ` [${e.category}]` : ""}${e.created_at ? ` (${e.created_at.slice(0, 10)})` : ""} — ${e.length.toLocaleString("en-US")} characters in the full entry`;
    const body = e.passages.map((p) => p.trim()).filter(Boolean).join("\n   ---\n");
    const room = budget - used - header.length - 8;
    if (room < 300 && parts.length > 0) break;
    const clipped = body.length > room ? `${body.slice(0, Math.max(0, room))}…` : body;
    parts.push(`${header}\n${clipped}`);
    used += header.length + clipped.length + 8;
  }
  return (
    "\n═══ SOURCE ENTRIES — verbatim passages from the operator's own records (searched for this question) ═══\n" +
    parts.join("\n\n") +
    "\n═══ END SOURCE ENTRIES ═══\n" +
    "RECORDS RULE: the operator asked about something stored in their own records. Answer ONLY from the passages above and " +
    "any tool results. Use names, places and events exactly as written there. Start by naming which entries you used. If " +
    "the passages do not contain what was asked, say plainly that you cannot see it in the entries you read and offer to " +
    "read more (read_vault / read_journal / read_note with the entry title). Do NOT fill gaps from memory, from other parts " +
    "of the operator's world, or from what a story \"probably\" contains.\n"
  );
}
