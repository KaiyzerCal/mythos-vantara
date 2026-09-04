// The study quiz has one property that matters more than the rest: it must
// only ask about what the operator actually wrote.
//
// /study reviews the operator's own notes. A model that answers from its own
// knowledge of the topic would produce questions that look right, grade the
// operator against material they never wrote, and teach them something their
// notes do not say — which is worse than asking nothing, and invisible unless
// you read the generated question against the source.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { suggestRating } from "@/pages/StudyPage";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const FN = readFileSync(join(ROOT, "supabase/functions/mavis-study-quiz/index.ts"), "utf8");

describe("the study quiz stays source-grounded", () => {
  it("tells the model to use only the note, in the system prompt and the task", () => {
    // Both halves matter: a system prompt alone is easy for a long task prompt
    // to talk over, and a task instruction alone gets lost across retries.
    expect(FN).toMatch(/strictly source-grounded/i);
    expect(FN).toMatch(/answerable from the note content above and nothing else/i);
  });

  it("prefers returning fewer questions over inventing one", () => {
    // The failure mode is a model padding to three questions because it was
    // asked for three. This is the sentence that licenses it to stop.
    expect(FN).toMatch(/Returning fewer is correct; inventing one is not/i);
  });

  it("refuses to quiz a note too thin to support a fair question", () => {
    expect(FN).toMatch(/content\.length < 80/);
    expect(FN).toMatch(/too short to ask a fair question/i);
  });

  it("sends the note's own text as the source", () => {
    expect(FN).toMatch(/NOTE CONTENT:/);
    expect(FN).toMatch(/content\.slice\(0, ?6000\)/);
  });

  it("never widens beyond the operator's own notes", () => {
    // The row is fetched scoped to the caller. Losing the user_id filter would
    // hand one operator another's notes through a service-role client.
    expect(FN).toMatch(/\.eq\("user_id", userId\)/);
    expect(FN).toMatch(/from\("mavis_notes"\)/);
  });
});

describe("generated questions are validated before they reach the UI", () => {
  it("requires exactly four distinct options and an in-range answer", () => {
    // A three-option question or a correctIndex of 7 renders as a broken quiz
    // that cannot be answered correctly.
    expect(FN).toMatch(/options\.length !== 4 \|\| new Set\(options\)\.size !== 4/);
    expect(FN).toMatch(/idx < 0 \|\| idx > 3/);
  });

  it("survives a model that wraps its JSON in prose", () => {
    expect(FN).toMatch(/function extractJson/);
    expect(FN).toMatch(/lastIndexOf\("\}"\)/);
  });
});

describe("competency level is derived, not stored", () => {
  it("reads the level from the existing review interval", () => {
    // A separate level column would be a second source of truth about how well
    // a note is known, free to disagree with the scheduler, and would need a
    // migration against live data to add.
    expect(FN).toMatch(/export function levelForInterval/);
    expect(FN).toMatch(/review_interval_days/);
  });

  it("carries eight distinct registers, not one register with eight labels", () => {
    const block = /const REGISTER = \[([\s\S]*?)\];/.exec(FN)?.[1] ?? "";
    const entries = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(entries).toHaveLength(8);
    expect(new Set(entries).size).toBe(8);
    // The point of the ladder is a change of kind, not of adjective.
    expect(entries[0]).toMatch(/first principles/i);
    expect(entries[7]).toMatch(/teaching it to others/i);
  });
});

describe("suggestRating", () => {
  it("maps a clean sweep to the top rating and a blank to the bottom", () => {
    expect(suggestRating(3, 3)).toBe(5);
    expect(suggestRating(0, 3)).toBe(1);
  });

  it("spreads partial recall across the middle of the scale", () => {
    expect(suggestRating(2, 3)).toBe(4);
    expect(suggestRating(1, 3)).toBe(3);
    expect(suggestRating(1, 4)).toBe(2);
  });

  it("does not divide by zero when there were no questions", () => {
    // Reachable: a note too thin to quiz falls through to the card, and the
    // rating step still renders.
    expect(suggestRating(0, 0)).toBe(3);
  });

  it("only ever returns a rating the UI actually offers", () => {
    for (let total = 0; total <= 3; total++) {
      for (let correct = 0; correct <= total; correct++) {
        const r = suggestRating(correct, total);
        expect(Number.isInteger(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(5);
      }
    }
  });
});
