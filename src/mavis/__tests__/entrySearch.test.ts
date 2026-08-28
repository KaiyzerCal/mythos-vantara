// Cover for the fix to a confidently-wrong answer.
//
// Calvin asked a persona about his vault and journal and got an inaccurate
// reply. The cause was not that personas lack access — they read ~30 tables
// server-side and execute writes through the same mavis-actions endpoint
// MAVIS uses. It was that both surfaces were handed the 5 most recent
// entries out of 65 journal / 97 vault, under a bare "JOURNAL ENTRIES:"
// header with no count and no truncation marker. The model read a slice as
// the complete set and answered from it.
//
// Two halves, both tested here: label the truncation so the model knows what
// it cannot see, and give it a way to reach the rest.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STOPWORDS,
  extractTerms,
  buildTsQuery,
  scoreEntry,
  rankEntries,
  truncationLabel,
} from "../../../supabase/functions/_shared/entrySearch.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const ACTIONS = read("supabase/functions/mavis-actions/index.ts");
const ROUTER = read("supabase/functions/mavis-persona-router/index.ts");
const PROMPT = read("supabase/functions/mavis-chat/promptBuilder.ts");
const DISPATCH = read("supabase/functions/mavis-chat/toolDispatch.ts");

describe("extractTerms", () => {
  it("keeps the content words out of a conversational question", () => {
    expect(extractTerms("what did I write about my morning routine"))
      .toEqual(["write", "morning", "routine"]);
  });

  it("drops filler, short tokens and duplicates", () => {
    expect(extractTerms("the the and a to it vault vault")).toEqual(["vault"]);
  });

  it("is case insensitive and strips punctuation", () => {
    expect(extractTerms("Vantara's LAUNCH-plan!")).toEqual(["vantara", "launch", "plan"]);
  });

  it("returns nothing for a query with no signal", () => {
    // Must be distinguishable from a real query, or the caller would run a
    // match-everything search and pass the newest rows off as hits.
    expect(extractTerms("what about it?")).toEqual([]);
    expect(extractTerms("")).toEqual([]);
  });

  it("caps the term count so the query still discriminates", () => {
    const many = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo";
    expect(extractTerms(many)).toHaveLength(8);
  });

  it("keeps common content words that a bigger stopword list would eat", () => {
    // Over-trimming silently loses the entry the operator asked about, which
    // is worse than a slightly noisy query.
    for (const word of ["vault", "journal", "launch", "money", "health"]) {
      expect(STOPWORDS.has(word), `"${word}" must stay searchable`).toBe(false);
    }
  });
});

describe("buildTsQuery", () => {
  it("ORs the terms", () => {
    // websearch_to_tsquery ANDs by default, and a whole question ANDed
    // matches nothing — which reads to the operator as "you have no entries
    // about that", the exact wrong answer for someone with 97 of them.
    expect(buildTsQuery("morning routine notes")).toBe("morning OR routine OR notes");
  });

  it("returns empty string when there is nothing to search for", () => {
    expect(buildTsQuery("what about it?")).toBe("");
  });

  it("emits only alphanumerics and OR, whatever the input", () => {
    // This is the injection boundary: these tokens are the only thing that
    // reaches the tsquery, so no quote or operator from user input can change
    // the query's structure.
    const nasty = `'; DROP TABLE journal_entries; -- & | ! ( ) <-> "quoted"`;
    const q = buildTsQuery(nasty);
    expect(q).toMatch(/^$|^[a-z0-9]+( OR [a-z0-9]+)*$/);
    for (const ch of ["'", ";", "-", "&", "|", "!", "(", ")", "<", ">", '"']) {
      expect(q.includes(ch), `"${ch}" leaked into the query`).toBe(false);
    }
  });
});

describe("scoreEntry / rankEntries", () => {
  const terms = ["launch", "plan"];

  it("weighs a title hit above a body hit", () => {
    const titled = { title: "Launch plan", content: "nothing relevant" };
    const bodied = { title: "Misc", content: "the launch plan is here" };
    expect(scoreEntry(titled, terms)).toBeGreaterThan(scoreEntry(bodied, terms));
  });

  it("rewards covering more distinct terms over repeating one", () => {
    const broad = { title: "x", content: "launch plan" };
    const repetitive = { title: "x", content: "launch launch launch launch" };
    expect(scoreEntry(broad, terms)).toBeGreaterThan(scoreEntry(repetitive, terms));
  });

  it("scores nothing when there are no terms", () => {
    expect(scoreEntry({ title: "anything", content: "anything" }, [])).toBe(0);
  });

  it("drops non-matches instead of padding the list", () => {
    // Returning unrelated entries would recreate the original bug: the model
    // treating whatever it was handed as the answer.
    const ranked = rankEntries(
      [
        { id: "a", title: "Launch plan", content: "" },
        { id: "b", title: "Grocery list", content: "milk" },
      ],
      terms,
      10,
    );
    expect(ranked.map((r) => r.id)).toEqual(["a"]);
  });

  it("deduplicates by id, since title and content are queried separately", () => {
    const row = { id: "dup", title: "Launch plan", content: "launch plan" };
    expect(rankEntries([row, row, row], terms, 10)).toHaveLength(1);
  });

  it("breaks score ties toward the more recent entry", () => {
    const ranked = rankEntries(
      [
        { id: "old", title: "Launch plan", content: "", created_at: "2026-01-01" },
        { id: "new", title: "Launch plan", content: "", created_at: "2026-08-01" },
      ],
      terms,
      10,
    );
    expect(ranked[0].id).toBe("new");
  });

  it("respects the limit", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, title: "launch plan", content: "" }));
    expect(rankEntries(rows, terms, 6)).toHaveLength(6);
  });
});

describe("truncationLabel", () => {
  it("says how much is hidden and how to reach it", () => {
    // The whole point: a bare header read as the complete set.
    expect(truncationLabel("JOURNAL ENTRIES", 5, 97, "search_journal"))
      .toBe("JOURNAL ENTRIES (showing 5 of 97 — most recent first; use search_journal to search the rest)");
  });

  it("just states the count when nothing is hidden", () => {
    expect(truncationLabel("JOURNAL ENTRIES", 5, 5)).toBe("JOURNAL ENTRIES (5)");
    expect(truncationLabel("VAULT", 0, 0)).toBe("VAULT (0)");
  });

  it("omits the search hint when there is no search action", () => {
    expect(truncationLabel("QUESTS", 10, 158)).toBe("QUESTS (showing 10 of 158)");
  });
});

describe("the fix is actually wired in", () => {
  it("both search actions exist in the shared executor", () => {
    // mavis-actions is what MAVIS and every persona both call, so adding the
    // cases here is what makes the tools real for both.
    expect(ACTIONS).toMatch(/case "search_journal":/);
    expect(ACTIONS).toMatch(/case "search_vault":/);
  });

  it("the search refuses a query with no real terms", () => {
    // Otherwise it would run a match-everything query and present the newest
    // rows as if they were hits — the original bug, one layer down.
    expect(ACTIONS).toMatch(/if \(!tsQuery\)/);
  });

  it("MAVIS is told the tools exist and that its prompt list is partial", () => {
    expect(DISPATCH).toMatch(/name: "search_journal"/);
    expect(DISPATCH).toMatch(/name: "search_vault"/);
    expect(DISPATCH).toMatch(/only carries the 5 most recent/);
  });

  it("search results get a real result budget in the native tool path", () => {
    // 200 chars would cut a search to a fragment of its first hit.
    expect(DISPATCH).toMatch(/call\.name\.startsWith\("search_"\) \? 2000 : 200/);
  });

  it("both prompt builders label their truncated blocks", () => {
    for (const [name, src] of [["persona router", ROUTER], ["MAVIS prompt", PROMPT]] as const) {
      expect(src, `${name} still has an unlabelled list`).toMatch(/truncationLabel\(/);
    }
    // The bare headers that caused this must not come back.
    expect(ROUTER).not.toMatch(/\nJOURNAL ENTRIES:\n/);
    expect(ROUTER).not.toMatch(/\nVAULT ENTRIES:\n/);
    expect(PROMPT).not.toMatch(/\nJOURNAL:\n/);
    expect(PROMPT).not.toMatch(/\nVAULT:\n/);
  });

  it("the persona router retrieves matching entries before the model answers", () => {
    // It is single-turn — actions run after the reply — so a tool call could
    // never inform the answer. The entries have to be in the prompt already.
    expect(ROUTER).toMatch(/relevantEntries/);
    expect(ROUTER).toMatch(/RELEVANT RECORDS/);
    // Anchor on the actual interpolation, not the words "RELEVANT ENTRIES" —
    // those also appear earlier, in the instructions telling the persona what
    // that block is. Matching the prose instead of the code made this assert
    // a false failure against correct ordering.
    // \b matters: a prefix match ("const relevantEntriesUNUSED") satisfied
    // indexOf while leaving the prompt referencing an undefined binding — a
    // mutation that would throw at runtime passed this test until the word
    // boundary was added.
    const declaration = /const relevantEntries\b\s*=/.exec(ROUTER);
    const compute = declaration?.index ?? -1;
    const promptUse = ROUTER.indexOf("formatSearchBlock(relevantEntries");
    expect(compute, "relevantEntries is never computed").toBeGreaterThan(-1);
    expect(promptUse, "relevantEntries never reaches the prompt").toBeGreaterThan(-1);
    expect(compute, "relevantEntries must be computed before the prompt uses it")
      .toBeLessThan(promptUse);
  });

  it("the persona is told search results arrive too late to answer with", () => {
    // Without this it would say "let me look that up" and then never follow
    // through, which is a worse failure than admitting it cannot see.
    expect(ROUTER).toMatch(/AFTER this reply/);
  });
});
