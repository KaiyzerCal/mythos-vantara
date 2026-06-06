import type { ParsedAction, ParseResult } from "./types";

const ACTION_TAG_REGEX = /:::ACTION(\{[\s\S]*?\}):::/g;

export function parseActions(raw: string): ParseResult {
  const actions: ParsedAction[] = [];
  let cleanText = raw;
  const matches = [...raw.matchAll(ACTION_TAG_REGEX)];

  for (const match of matches) {
    const fullTag = match[0];
    const jsonStr = match[1];
    try {
      const payload = JSON.parse(jsonStr) as Record<string, unknown>;
      const type = typeof payload.type === "string" ? payload.type : "unknown";
      actions.push({ type, payload, raw: fullTag });
    } catch {
      console.warn("[MAVIS] Failed to parse action tag:", jsonStr);
    }
    cleanText = cleanText.replace(fullTag, "").trim();
  }

  return { cleanText, actions };
}
