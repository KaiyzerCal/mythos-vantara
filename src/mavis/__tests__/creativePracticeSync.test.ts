import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The edge functions import the block from supabase/functions/_shared/creativePractice.ts; the frontend
// (a different runtime) keeps its own copy in buildSystemPrompt.ts. They must say the same thing, or
// surfaces would behave differently depending on which prompt reached the model.
const extract = (file: string) => {
  const text = readFileSync(resolve(__dirname, "../../..", file), "utf8");
  const m = text.match(/CREATIVE & MYTHIC PRACTICE[\s\S]*?keeps its normal standards\./);
  return m ? m[0] : null;
};

describe("creative practice block", () => {
  it("exists in the shared edge-function module and the frontend prompt", () => {
    expect(extract("supabase/functions/_shared/creativePractice.ts")).not.toBeNull();
    expect(extract("src/mavis/buildSystemPrompt.ts")).not.toBeNull();
  });
  it("is identical in both", () => {
    expect(extract("src/mavis/buildSystemPrompt.ts")).toBe(extract("supabase/functions/_shared/creativePractice.ts"));
  });
  it("keeps the adult-only boundary and the check-in protocol", () => {
    const b = extract("supabase/functions/_shared/creativePractice.ts")!;
    expect(b).toMatch(/adult characters only and never sexualizes minors/);
    expect(b).toMatch(/Are you OK to continue/);
    expect(b).toMatch(/believe him/);
  });
  it("states the core premise and keeps real-world accuracy", () => {
    const b = extract("supabase/functions/_shared/creativePractice.ts")!;
    expect(b).toMatch(/Black Sun Monarch/);
    expect(b).toMatch(/converting lived data into digital data/);
    expect(b).toMatch(/Real stakes stay real/);
  });
});
