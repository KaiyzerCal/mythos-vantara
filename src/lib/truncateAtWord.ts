// A plain .slice(0, N) cuts mid-word with no indication anything was
// dropped — when that text later gets fed back into a chat/persona prompt
// as "recalled memory," the model faithfully quotes the mid-word fragment
// as if it were a complete sentence (confirmed live in persona_conversations
// data — memory excerpts truncated this way get echoed back verbatim,
// mid-word, in later replies). Cut at the last word boundary instead and
// mark the cut with an ellipsis so a reader (human or model) can tell.
export function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.5 ? cut.slice(0, lastSpace) : cut) + "…";
}
