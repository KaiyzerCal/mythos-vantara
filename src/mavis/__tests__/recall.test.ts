import { describe, it, expect } from "vitest";
import { recallIntent, subjectTerms, selectPassages, formatSourceEntries } from "../../../supabase/functions/_shared/recall";

describe("recallIntent: the real messages from 2026-11-16", () => {
  it.each([
    "Are you aware of the Paradox Engine storyline that is in my vault?",
    "Who are the character of the Paradox Engine that is in my vault saved entries?",
    "That isn't correct. Look up the Paradox Engine in my vault and journal entries",
    "That's not correct. Look up the story of the Paradox Engine",
    "what did I write about the RV situation",
  ])("%s", (m) => expect(recallIntent(m)).toBe(true));

  it("does not fire for ordinary chat or for save/create requests", () => {
    expect(recallIntent("how's my day looking?")).toBe(false);
    expect(recallIntent("Save this to my vault")).toBe(false);
    expect(recallIntent("create a quest for the gym")).toBe(false);
    expect(recallIntent("")).toBe(false);
  });
});

describe("subjectTerms", () => {
  it("keeps the subject and drops the request wording", () => {
    expect(subjectTerms("Who are the character of the Paradox Engine that is in my vault saved entries?")).toEqual(["paradox", "engine"]);
    expect(subjectTerms("That isn't correct. Look up the Paradox Engine in my vault and journal entries")).toEqual(["paradox", "engine"]);
  });
  it("borrows the subject from an earlier message when a follow-up has none (newest first)", () => {
    expect(subjectTerms("that's wrong, look it up again", ["Look up the Paradox Engine in my vault", "hello"])).toEqual(["paradox", "engine"]);
  });
  it("returns nothing when there is no subject anywhere", () => {
    expect(subjectTerms("look it up", ["hi", "ok"])).toEqual([]);
  });
});

describe("selectPassages", () => {
  const filler = (n: number) => "lorem ipsum dolor sit amet ".repeat(n);
  const doc = `OPENING FRAMING of the guide. ${filler(80)} Ep4 the Bishop appears on camera twice. ${filler(80)} Ep5 Lyra appears, terrified. ${filler(80)} the paradox engine hums. ${filler(40)}`;

  it("returns short documents whole", () => {
    expect(selectPassages("A short entry about the engine.", ["engine"])).toEqual(["A short entry about the engine."]);
  });
  it("centres passages on where the terms occur, in document order", () => {
    const out = selectPassages(doc, ["lyra", "bishop"], { max: 2, size: 300 });
    expect(out.length).toBe(2);
    expect(out[0]).toContain("Bishop");
    expect(out[1]).toContain("Lyra");
  });
  it("adds the opening of a long entry when asked", () => {
    const out = selectPassages(doc, ["lyra"], { max: 1, size: 300, head: 120 });
    expect(out[0]).toContain("OPENING FRAMING");
    expect(out.some((p) => p.includes("Lyra"))).toBe(true);
  });
  it("falls back to the opening when no term occurs", () => {
    const out = selectPassages(doc, ["zzzz"], { size: 300 });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("OPENING FRAMING");
  });
});

describe("formatSourceEntries", () => {
  it("states the records rule and respects the budget", () => {
    const big = "x".repeat(20000);
    const block = formatSourceEntries(
      [{ kind: "vault", title: "The Paradox Engine (series)", length: 28611, passages: [big] }], 4000);
    expect(block).toContain("RECORDS RULE");
    expect(block).toContain("28,611 characters");
    expect(block.length).toBeLessThan(5200);
  });
  it("is empty with no entries", () => {
    expect(formatSourceEntries([])).toBe("");
  });
});
