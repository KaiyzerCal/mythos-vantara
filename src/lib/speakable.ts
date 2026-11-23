// Turns written text (markdown, bullets, arrows, URLs, emoji...) into something a voice reads naturally. Speech engines
// read symbols literally — "- item" comes out as "dash item", "->" as "dash greater than" — so anything that is only
// formatting is removed or turned into a word or a pause before the text is spoken.
//
// KEEP IN SYNC with supabase/functions/_shared/speakable.ts (the same function for the edge side; they can't share a file).

export interface SpeakableOptions { /** Read database ids aloud (when the operator asked for them, or in an analytical mode). */ speakIds?: boolean }

// Database ids: full UUIDs, and the shortened "ce609c7d..." form models use. They mean nothing when spoken.
const UUID_RE = /\(?`?\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`?\)?/gi;
const SHORT_ID_RE = /\(?`?\b[0-9a-f]{8}(?:…|\.{2,3})`?\)?/gi;
const ID_LABEL_RE = /\b(?:quest|skill|task|entry|note|vault|record)?\s*\bid\s*[:#]?\s*$/gim;

/** Does the operator's request ask to hear ids / numbers? Then ids are spoken instead of dropped. */
export function asksForIds(userText: string): boolean {
  return /\b(read|say|tell|give|list|spell|what(?:'s| is| are)?)\b[^.?!]{0,40}\b(ids?|uuids?|identifiers?|id numbers?)\b/i.test(String(userText ?? ""));
}

export function toSpeakable(input: string, opts: SpeakableOptions = {}): string {
  let t = String(input ?? "");
  if (!opts.speakIds) t = t.replace(UUID_RE, " ").replace(SHORT_ID_RE, " ").replace(/\(\s*\)/g, " ");

  t = t
    // Things that are never spoken
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/:::ACTION[\s\S]*?:::/g, " ")
    .replace(/<[^>]+>/g, " ")
    // Inline code: say the words, drop the backticks
    .replace(/`([^`]*)`/g, "$1")
    // [label](url) -> label; a bare URL is not worth reading out
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    // Emoji / pictographs
    .replace(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    // Horizontal rules and table separator rows
    .replace(/^\s*(?:[-*_=]\s*){3,}$/gm, "")
    .replace(/^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*$/gm, "")
    // Headings, blockquotes, list bullets (-, *, +, •, ·, – and — followed by a space)
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/^\s*[-*+•·–—]\s+/gm, "")
    // Emphasis: keep the words, drop the markers (snake_case is left alone)
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, "$1$2")
    .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    // Arrows and relations -> words
    .replace(/\s*(?:->|→|=>|⇒|-->|⟶)\s*/g, " to ")
    .replace(/\s*(?:<-|←|<=|⇐)\s*/g, " from ")
    .replace(/\s+&\s+/g, " and ")
    .replace(/\s\+\s/g, " plus ")
    .replace(/\s=\s/g, " equals ")
    .replace(/#(\d+)/g, "number $1")
    // A dash used as a separator -> a comma pause
    .replace(/\s+[-–—]+\s+/g, ", ")
    .replace(/\s*[—–]\s*/g, ", ")
    // Table pipes and letter/letter slashes ("input/output") -> a pause or a space
    .replace(/\s*\|\s*/g, ", ")
    .replace(/([A-Za-z])\/([A-Za-z])/g, "$1 $2")
    .replace(/\bw\/o\b/gi, "without")
    .replace(/\bw\/\b/gi, "with")
    .replace(/\.{3,}/g, "…")
    // Whatever formatting characters are left over
    .replace(/[*_`~^\\{}[\]<>#|]/g, " ");

  // One line per list item: pause between lines, without doubling punctuation that's already there.
  const lines = t.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
  let out = "";
  for (const line of lines) {
    out += out === "" ? line : /[.!?:;,…]$/.test(out) ? ` ${line}` : `. ${line}`;
  }
  return out.replace(/\s+([,.!?;:])/g, "$1").replace(/,\s*,/g, ",").replace(/\s+/g, " ").trim();
}

/** Maps a character position in the spoken text back to the displayed text, so the word highlight stays roughly in step. */
export function mapSpokenIndex(spokenIndex: number, spokenLength: number, shownLength: number): number {
  if (spokenLength <= 0) return shownLength;
  return Math.min(shownLength, Math.round((spokenIndex / spokenLength) * shownLength));
}
