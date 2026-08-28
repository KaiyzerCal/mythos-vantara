// Cover for search across the whole app, on every surface that talks to the
// operator.
//
// The three surfaces are blocked in different ways, and the difference is the
// reason this is prompt retrieval rather than only a tool:
//
//   MAVIS     multi-turn with tools — a tool works.
//   personas  mavis-persona-router is single-turn; actions run AFTER the reply,
//             so a tool it calls can never inform the answer being given.
//   council   routed through mavis-chat but excluded from the tool path by
//             (!isCouncilMode || !!personaId) — a tool would never fire at all.
//
// So retrieval into the prompt is the mechanism that reaches all three, and
// the tool is the extra for surfaces that can loop.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SEARCHABLE,
  SEARCHABLE_KEYS,
  selectFor,
  resolveScope,
  formatSearchBlock,
  searchAppData,
  type AppSearchHit,
} from "../../../supabase/functions/_shared/appSearch.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const ACTIONS = read("supabase/functions/mavis-actions/index.ts");
const CHAT = read("supabase/functions/mavis-chat/index.ts");
const ROUTER = read("supabase/functions/mavis-persona-router/index.ts");
const DISPATCH = read("supabase/functions/mavis-chat/toolDispatch.ts");

describe("the registry", () => {
  it("has unique keys and tables", () => {
    expect(new Set(SEARCHABLE_KEYS).size).toBe(SEARCHABLE.length);
    expect(new Set(SEARCHABLE.map((t) => t.table)).size).toBe(SEARCHABLE.length);
  });

  it("covers the operator's written records automatically", () => {
    const auto = SEARCHABLE.filter((t) => t.auto).map((t) => t.key);
    // These are where prose the operator writes actually lives. Losing one
    // silently narrows what every surface can reference on every turn.
    expect(auto).toEqual(
      expect.arrayContaining(["journal", "vault", "meeting_notes", "quests", "tasks", "goals"]),
    );
  });

  it("keeps the automatic scope bounded", () => {
    // This runs on every message of every conversation and costs two queries
    // per table. Searching all seventeen by default would tax every turn.
    const auto = SEARCHABLE.filter((t) => t.auto);
    expect(auto.length).toBeLessThanOrEqual(8);
    expect(auto.length).toBeLessThan(SEARCHABLE.length);
  });

  it("only ever selects columns it declares", () => {
    // Column names across these tables are genuinely inconsistent (title vs
    // name vs objective, content vs description vs notes vs summary). A name
    // that does not exist is a silent empty result, not an error — so the
    // select must be derived from the declaration, never hardcoded.
    for (const t of SEARCHABLE) {
      const cols = selectFor(t).split(",");
      expect(cols, `${t.key} must select its id`).toContain("id");
      expect(cols, `${t.key} must select its title column`).toContain(t.titleCol);
      if (t.bodyCol) expect(cols).toContain(t.bodyCol);
      // created_at is NOT universal — inventory and calendar_events lack it,
      // and requesting it there would break those searches.
      expect(cols.includes("created_at")).toBe(!!t.hasCreatedAt);
    }
  });

  it("does not claim created_at on the tables that lack it", () => {
    // Verified against information_schema on the live database.
    for (const key of ["inventory", "calendar"]) {
      const t = SEARCHABLE.find((x) => x.key === key)!;
      expect(t.hasCreatedAt, `${key} has no created_at column`).toBeFalsy();
    }
  });
});

describe("resolveScope", () => {
  // Every assertion below checks non-emptiness too: [].every() is true, so a
  // resolveScope that returned nothing would have satisfied the naive form of
  // these tests while leaving every surface with no data to search.
  it("defaults to the automatic set", () => {
    for (const scope of [undefined, ""]) {
      const resolved = resolveScope(scope);
      expect(resolved.length, `scope ${JSON.stringify(scope)} resolved to nothing`).toBeGreaterThan(0);
      expect(resolved.every((t) => t.auto)).toBe(true);
    }
  });

  it("opens up everything on 'all'", () => {
    expect(resolveScope("all")).toHaveLength(SEARCHABLE.length);
    expect(resolveScope("*")).toHaveLength(SEARCHABLE.length);
  });

  it("accepts a scope by key or by table name", () => {
    expect(resolveScope("vault").map((t) => t.table)).toEqual(["vault_entries"]);
    expect(resolveScope("vault_entries").map((t) => t.key)).toEqual(["vault"]);
  });

  it("accepts several scopes at once", () => {
    expect(resolveScope("vault, contacts").map((t) => t.key).sort()).toEqual(["contacts", "vault"]);
  });

  it("falls back to the default set for a scope it does not know", () => {
    // A model inventing a scope name should get a slightly-too-broad answer,
    // never a confident "you have nothing about that".
    const resolved = resolveScope("nonsense_table");
    expect(resolved.length, "an unknown scope must not resolve to nothing").toBeGreaterThan(0);
    expect(resolved.every((t) => t.auto)).toBe(true);
  });
});

describe("searchAppData", () => {
  /** Minimal stub of the query-builder chain the helper uses. */
  function clientFor(rowsByTable: Record<string, Record<string, unknown>[]>, failing: string[] = []) {
    const calls: Array<{ table: string; col: string }> = [];
    const client = {
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                return {
                  textSearch(col: string) {
                    calls.push({ table, col });
                    return {
                      limit() {
                        if (failing.includes(table)) return Promise.reject(new Error("boom"));
                        return Promise.resolve({ data: rowsByTable[table] ?? [], error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    return { client: client as never, calls };
  }

  it("returns nothing when the message has no searchable terms", async () => {
    const { client, calls } = clientFor({});
    expect(await searchAppData(client, "u1", "what about it?")).toEqual([]);
    // And must not have queried at all — a match-everything search would pass
    // the newest rows off as hits.
    expect(calls).toHaveLength(0);
  });

  it("searches title and body of each table in scope", async () => {
    const { client, calls } = clientFor({});
    await searchAppData(client, "u1", "launch plan", { scope: "vault" });
    expect(calls).toEqual([
      { table: "vault_entries", col: "title" },
      { table: "vault_entries", col: "content" },
    ]);
  });

  it("searches only the title when a table has no body column", async () => {
    const { client, calls } = clientFor({});
    await searchAppData(client, "u1", "ship the thing", { scope: "goals" });
    expect(calls).toEqual([{ table: "mavis_goals", col: "objective" }]);
  });

  it("tags each hit with the table it came from", async () => {
    const { client } = clientFor({
      vault_entries: [{ id: "v1", title: "Launch plan", content: "the launch plan", category: "business" }],
    });
    const hits = await searchAppData(client, "u1", "launch plan", { scope: "vault" });
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("vault");
    expect(hits[0].id).toBe("v1");
    expect(hits[0].category).toBe("business");
  });

  it("keeps ids distinct across tables that share an id value", async () => {
    // Two tables can legitimately hold the same id; collapsing them would drop
    // a real result.
    const { client } = clientFor({
      vault_entries: [{ id: "same", title: "Launch plan", content: "" }],
      journal_entries: [{ id: "same", title: "Launch plan", content: "" }],
    });
    const hits = await searchAppData(client, "u1", "launch plan", { scope: "vault, journal" });
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.kind).sort()).toEqual(["journal", "vault"]);
    expect(hits.every((h) => h.id === "same")).toBe(true);
  });

  it("survives one table failing", async () => {
    // A missing column or a permissions edge on one obscure table must cost
    // that table's results, not the whole answer.
    const { client } = clientFor(
      { vault_entries: [{ id: "v1", title: "Launch plan", content: "" }] },
      ["journal_entries"],
    );
    const hits = await searchAppData(client, "u1", "launch plan", { scope: "vault, journal" });
    expect(hits.map((h) => h.kind)).toEqual(["vault"]);
  });

  it("respects the result limit", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `v${i}`, title: "launch plan", content: "" }));
    const { client } = clientFor({ vault_entries: rows });
    expect(await searchAppData(client, "u1", "launch plan", { scope: "vault", limit: 4 })).toHaveLength(4);
  });
});

describe("formatSearchBlock", () => {
  const hit: AppSearchHit = {
    kind: "vault", id: "v1", title: "Launch plan",
    excerpt: "ship in Q4", category: "business", created_at: "2026-08-01T10:00:00Z",
  };

  it("labels where each hit came from and that the search was full", () => {
    const block = formatSearchBlock([hit], true);
    expect(block).toContain("[vault]");
    expect(block).toContain("Launch plan");
    expect(block).toContain("2026-08-01");
    expect(block).toMatch(/FULL data/);
  });

  it("says plainly when nothing matched", () => {
    // Silence would leave the model to fall back on the partial recent lists
    // and answer as if it had looked — the original bug.
    expect(formatSearchBlock([], true)).toMatch(/nothing in the operator's data matches/i);
  });

  it("adds nothing at all when there was no query to run", () => {
    expect(formatSearchBlock([], false)).toBe("");
  });
});

describe("every surface is wired to it", () => {
  it("MAVIS and council both get retrieval in mavis-chat", () => {
    // One insertion point covers both: council routes through mavis-chat but
    // is excluded from the tool path, so this is the only thing that reaches
    // a council member.
    expect(CHAT).toMatch(/searchAppData\(sb, user\.id, lastUserText/);
    expect(CHAT).toMatch(/relevantRecordsBlock/);
  });

  it("the retrieval block is actually assembled into the prompt", () => {
    // Computing it and forgetting to include it would be a silent no-op.
    const compute = /let relevantRecordsBlock/.exec(CHAT)?.index ?? -1;
    const assembled = CHAT.indexOf("\n      relevantRecordsBlock,");
    expect(compute).toBeGreaterThan(-1);
    expect(assembled, "relevantRecordsBlock never reaches fullPrompt").toBeGreaterThan(compute);
  });

  it("council is not excluded from the retrieval block", () => {
    // The tool path is gated on isCouncilMode; retrieval must not be, or
    // council members are back to having no reach into app data.
    const idx = CHAT.indexOf("relevantRecordsBlock,");
    const line = CHAT.slice(CHAT.lastIndexOf("\n", idx), idx + 40);
    expect(line).not.toMatch(/isCouncilMode/);
  });

  it("a search failure cannot cost the reply", () => {
    expect(CHAT).toMatch(/catch[\s\S]{0,140}relevant-records search failed/);
  });

  it("personas use the same helper, before the model answers", () => {
    expect(ROUTER).toMatch(/searchAppData\(supabase, user_id/);
    const declaration = /const relevantEntries\b\s*=/.exec(ROUTER);
    const compute = declaration?.index ?? -1;
    const promptUse = ROUTER.indexOf("formatSearchBlock(relevantEntries");
    expect(compute).toBeGreaterThan(-1);
    expect(compute, "must be computed before the prompt uses it").toBeLessThan(promptUse);
  });

  it("the shared executor exposes search_app, with the old names as aliases", () => {
    expect(ACTIONS).toMatch(/case "search_app":/);
    expect(ACTIONS).toMatch(/case "search_journal":/);
    expect(ACTIONS).toMatch(/case "search_vault":/);
    expect(ACTIONS).toMatch(/searchAppData\(sb, userId/);
  });

  it("MAVIS is told search_app exists and what it can reach", () => {
    expect(DISPATCH).toMatch(/name: "search_app"/);
    expect(DISPATCH).toMatch(/Search ANYTHING/);
  });

  it("personas are told search_app exists", () => {
    expect(ROUTER).toMatch(/search_app/);
  });

  it("the persona's instructions name the block the code actually emits", () => {
    // The instructions tell the persona where to look for retrieved records.
    // Renaming the block without updating them pointed the persona at a
    // heading that was no longer anywhere in its own prompt — it reads as
    // "you have no such block", which is the confident-wrong answer again.
    const label = formatSearchBlock([], true).split(":")[0];
    const guidance = ROUTER.slice(ROUTER.indexOf("Reading beyond what is in this prompt"));
    expect(label).toBeTruthy();
    expect(guidance.slice(0, 500), `instructions must name "${label}"`).toContain(label);
  });
});
