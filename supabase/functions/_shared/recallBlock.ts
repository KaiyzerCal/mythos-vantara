// One implementation of "answer from the operator's own records", used by every surface that talks to the operator
// (mavis-chat, mavis-persona-router, the Telegram bot), so none of them can answer a lore question from memory while another
// answers it from the entries. The pure pieces (intent, subject words, passages, block text) live in recall.ts.
import { searchAppData } from "./appSearch.ts";
import { recallIntent, subjectTerms, selectPassages, formatSourceEntries, type SourceEntry } from "./recall.ts";

/**
 * The SOURCE ENTRIES block for this message, or "" when the message isn't a recall question or nothing matches.
 * Never throws: missing context is a worse answer, a failed search must not cost the reply.
 * `earlier` is the operator's previous messages, newest first, so a follow-up ("that's wrong, look again") keeps its subject.
 */
export async function buildRecallBlock(
  // deno-lint-ignore no-explicit-any
  sb: any,
  userId: string,
  message: string,
  earlier: string[] = [],
  embed?: (text: string) => Promise<number[] | null>,
  budget = 9000,
): Promise<string> {
  try {
    if (!recallIntent(message)) return "";
    const terms = subjectTerms(message, earlier);
    if (terms.length === 0) return "";
    // Written records only (never chat-derived memories, which would feed the assistant its own earlier wrong answers back).
    const hits = await searchAppData(sb, userId, terms.join(" "), { scope: "vault,journal,notes", limit: 4, embed, withContent: true });
    const entries: SourceEntry[] = hits.map((h) => ({
      kind: h.kind, title: h.title, category: h.category, created_at: h.created_at,
      length: h.length ?? String(h.content ?? "").length,
      // Short entries whole; long ones: their opening (what the document is) plus the passages that mention the subject.
      passages: selectPassages(String(h.content ?? ""), terms, { max: 3, size: 900, head: 700, wholeBelow: 3500 }),
    }));
    return formatSourceEntries(entries, budget);
  } catch (e) {
    console.warn("[recall] block failed:", (e as Error)?.message);
    return "";
  }
}
