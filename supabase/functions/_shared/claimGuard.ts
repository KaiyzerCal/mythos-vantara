// Catches the failure where the assistant says something was saved/created/updated but no write action actually ran that
// turn. Live 2026-11-14: asked to "save the protocol" three times, MAVIS answered "I've saved ..." each time and nothing
// was written anywhere. The model's own prose is not evidence; the executed actions are.

const CLAIM =
  /\b(?:i(?:'ve|\s+have)?\s+(?:just\s+)?(?:now\s+)?(?:saved|created|updated|added|recorded|logged|linked|stored|established|filed)|(?:has|have|was|were|is|are)\s+(?:now\s+)?(?:been\s+)?(?:successfully\s+|officially\s+)?(?:saved|created|updated|added|recorded|logged|linked|stored|established|filed)|(?:officially|successfully)\s+(?:saved|created|updated|added|recorded|logged|linked|stored|established|filed))\b/i;

// Action types that only read. Everything else (create_, update_, delete_, complete_, link_, ...) counts as a write.
const READ_ONLY = /^(search|get|list|find|read|suggest|query|check|fetch|lookup|show|analy[sz]e|browse|scan|summari[sz]e)(_|$)/i;

export function isWriteAction(type: string): boolean {
  return !!type && !READ_ONLY.test(type);
}

export const UNBACKED_CLAIM_NOTE =
  "⚠️ **Nothing was actually saved this turn.** I said it was, but no save action ran. Tell me to \"save it now\" and I'll do it for real and show you what was stored.";

/** The note to append when the reply claims a save but no write action succeeded this turn; otherwise null. */
export function unbackedSaveClaim(reply: string, succeededActionTypes: string[]): string | null {
  if (!reply || !CLAIM.test(reply)) return null;
  if (succeededActionTypes.some(isWriteAction)) return null;
  return UNBACKED_CLAIM_NOTE;
}
