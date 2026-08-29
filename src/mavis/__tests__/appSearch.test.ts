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
import { readFileSync, readdirSync } from "node:fs";
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
  /**
   * A stand-in for the database that stems the way Postgres does.
   *
   * That detail is the whole point. The live config is pg_catalog.english, so
   * a tsquery for "squats" matches a row whose text only ever says "squat". A
   * stub that matched on raw substrings would agree with the old broken
   * scorer and every test here would pass while the feature stayed broken.
   */
  function fakeDb(rowsByTable: Record<string, Record<string, unknown>[]>, failing: string[] = []) {
    const probes: Array<{ table: string; col: string; q: string; cols: string; ordered: boolean; limit: number }> = [];
    const fetches: Array<{ table: string; cols: string; ids: string[] }> = [];

    const stemHit = (text: string, term: string) =>
      text.includes(term) || (term.length > 4 && text.includes(term.replace(/s$/, "")));

    const matches = (text: string, q: string) => {
      const t = String(text ?? "").toLowerCase();
      return q.includes(" OR ")
        ? q.split(" OR ").some((term) => stemHit(t, term))
        : q.split(" ").every((term) => stemHit(t, term));
    };

    const client = {
      from(table: string) {
        const rows = () => rowsByTable[table] ?? [];
        const reject = () => failing.includes(table);
        return {
          select(cols: string) {
            return {
              eq() {
                const search = (col: string, q: string) => {
                  const node = {
                    order: () => ({ ...node, _ordered: true, limit: (n: number) => finish(col, q, n, true) }),
                    limit: (n: number) => finish(col, q, n, false),
                  };
                  return node;
                };
                const finish = (col: string, q: string, n: number, ordered: boolean) => {
                  probes.push({ table, col, q, cols, ordered, limit: n });
                  if (reject()) return Promise.reject(new Error("boom"));
                  return Promise.resolve({
                    data: rows().filter((r) => matches(String(r[col] ?? ""), q)).slice(0, n),
                    error: null,
                  });
                };
                return {
                  textSearch: search,
                  in(_col: string, ids: string[]) {
                    fetches.push({ table, cols, ids });
                    if (reject()) return Promise.reject(new Error("boom"));
                    return Promise.resolve({
                      data: rows().filter((r) => ids.includes(String(r.id))),
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      },
    };
    return { client: client as never, probes, fetches };
  }

  const SQUAT = {
    id: "v1",
    title: "Bioneer 3D Squat Mechanics",
    content: "pilot production script",
    category: "business",
    created_at: "2026-08-14T00:00:00Z",
  };

  it("returns nothing when the message has no searchable terms", async () => {
    const { client, probes } = fakeDb({});
    expect(await searchAppData(client, "u1", "what about it?")).toEqual([]);
    // And must not query at all — a match-everything search would pass the
    // newest rows off as hits.
    expect(probes).toHaveLength(0);
  });

  it("keeps an entry Postgres matched by stemming", async () => {
    // The reported bug, reduced. Asking about "squats" matches an entry that
    // only says "Squat"; the old scorer tested `title.includes("squats")`,
    // scored it 0 and dropped it — so the search found the entry and threw it
    // away, and the persona said it could not see it. On the live vault one
    // such query matched 19 entries and kept 2.
    const { client } = fakeDb({ vault_entries: [SQUAT] });
    const hits = await searchAppData(client, "u1", "squats", { scope: "vault" });
    expect(hits.map((h) => h.title)).toEqual(["Bioneer 3D Squat Mechanics"]);
  });

  it("never drops a matched row for scoring badly", async () => {
    // Ranking is allowed to sort a weak match last. It is not allowed to
    // delete it: the database already ruled on relevance, and it stems while
    // the scorer does not, so the scorer is the less reliable judge.
    const odd = { id: "v9", title: "Untitled", content: "policies and coverage", created_at: "2026-01-01T00:00:00Z" };
    const { client } = fakeDb({ vault_entries: [odd] });
    const hits = await searchAppData(client, "u1", "policies", { scope: "vault" });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe("v9");
  });

  it("never asks for the body column while ranking", async () => {
    // Phase 1 searches the body but must not select it. A vault entry
    // averages 3.7 KB and reaches 28 KB on the live data, so selecting bodies
    // to rank them costs most of a megabyte per message to produce
    // 300-character excerpts.
    const { client, probes } = fakeDb({ vault_entries: [SQUAT] });
    await searchAppData(client, "u1", "squat mechanics", { scope: "vault" });
    expect(probes.length).toBeGreaterThan(0);
    for (const p of probes) {
      expect(p.cols.split(","), `phase 1 selected the body in ${p.table}`).not.toContain("content");
    }
  });

  it("fetches whole rows only for what survived ranking", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: `v${i}`, title: "launch plan", content: "x", created_at: `2026-08-${String(i % 28 + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const { client, fetches } = fakeDb({ vault_entries: rows });
    const hits = await searchAppData(client, "u1", "launch plan", { scope: "vault", limit: 5 });
    expect(hits).toHaveLength(5);
    expect(fetches).toHaveLength(1);
    expect(fetches[0].ids).toHaveLength(5);
    expect(fetches[0].cols.split(",")).toContain("content");
  });

  it("takes every candidate rather than an arbitrary slice", async () => {
    // The old code took whatever 20 rows came back, unordered, out of 41
    // matches on the live vault — so which entries the model could see was
    // decided by the query planner.
    const { client, probes } = fakeDb({ vault_entries: [SQUAT] });
    await searchAppData(client, "u1", "squat mechanics", { scope: "vault" });
    for (const p of probes) {
      expect(p.limit, "candidate cap must cover the whole table").toBeGreaterThanOrEqual(200);
      expect(p.ordered, "a cap that can bite must cut deterministically").toBe(true);
    }
  });

  it("lets the all-terms match win the last shortlist slot", async () => {
    // Isolates the all-terms signal: neither row matches in its title, both
    // match the ORed query in the body, and the loser is the more recent —
    // so with the signal removed, recency takes the slot and the row that
    // actually answers the question never gets fetched. An earlier version
    // of this test set it up so the title score decided the order, which
    // meant it passed with the signal deleted.
    const both = { id: "both", title: "Notes", content: "fitness video production", created_at: "2026-01-01T00:00:00Z" };
    const one = { id: "one", title: "Other notes", content: "production", created_at: "2026-08-01T00:00:00Z" };
    const { client } = fakeDb({ vault_entries: [both, one] });
    const hits = await searchAppData(client, "u1", "fitness video production", { scope: "vault", limit: 1 });
    expect(hits.map((h) => h.id)).toEqual(["both"]);
  });

  it("searches title and body, and asks which rows match every term", async () => {
    const { client, probes } = fakeDb({});
    await searchAppData(client, "u1", "launch plan", { scope: "vault" });
    expect(probes.map((p) => `${p.col}:${p.q}`)).toEqual([
      "title:launch OR plan",
      "content:launch OR plan",
      "content:launch plan",
    ]);
  });

  it("skips the all-terms probe when there is only one term", async () => {
    const { client, probes } = fakeDb({});
    await searchAppData(client, "u1", "launch", { scope: "vault" });
    expect(probes.map((p) => p.col)).toEqual(["title", "content"]);
  });

  it("searches only the title when a table has no body column", async () => {
    const { client, probes } = fakeDb({});
    await searchAppData(client, "u1", "ship the thing", { scope: "goals" });
    expect(probes.map((p) => `${p.table}.${p.col}`)).toEqual(["mavis_goals.objective"]);
  });

  it("tags each hit with the table it came from", async () => {
    const { client } = fakeDb({ vault_entries: [SQUAT] });
    const hits = await searchAppData(client, "u1", "squat", { scope: "vault" });
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("vault");
    expect(hits[0].id).toBe("v1");
    expect(hits[0].category).toBe("business");
  });

  it("keeps ids distinct across tables that share an id value", async () => {
    // Two tables can legitimately hold the same id; collapsing them drops a
    // real result.
    const { client } = fakeDb({
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
    const { client } = fakeDb(
      { vault_entries: [{ id: "v1", title: "Launch plan", content: "" }] },
      ["journal_entries"],
    );
    const hits = await searchAppData(client, "u1", "launch plan", { scope: "vault, journal" });
    expect(hits.map((h) => h.kind)).toEqual(["vault"]);
  });

  it("respects the result limit", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `v${i}`, title: "launch plan", content: "" }));
    const { client } = fakeDb({ vault_entries: rows });
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

describe("no conversational surface is left without it", () => {
  // The lesson of this round. Retrieval was added to mavis-chat,
  // mavis-persona-router and mavis-actions, and it looked complete — but the
  // council board builds its prompts in the browser, AGENT mode runs through
  // mavis-agent, and council sessions run through mavis-council-session. All
  // three assembled their own prompts and inherited nothing, so Calvin's
  // council members still could not see his entries. Nothing enumerated the
  // set of surfaces, so nothing caught it. This does.
  const FUNCTIONS = join(ROOT, "supabase/functions");

  /**
   * buildSharedTruth is the marker: it is the identity + time + app-snapshot
   * block that every operator-facing conversation assembles, and nothing else
   * has a reason to. A function that builds it is talking to Calvin, and a
   * function talking to Calvin has to be able to look things up.
   */
  const conversationalSurfaces = readdirSync(FUNCTIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => ({ name: e.name, path: join(FUNCTIONS, e.name, "index.ts") }))
    .filter((f) => {
      try { return readFileSync(f.path, "utf8").includes("buildSharedTruth"); }
      catch { return false; }
    });

  it("finds the surfaces at all", () => {
    // Guards the guard: if the marker stops matching, every assertion below
    // passes vacuously over an empty list.
    expect(conversationalSurfaces.map((f) => f.name).sort())
      .toEqual(["mavis-agent", "mavis-chat", "mavis-council-session", "mavis-persona-router"]);
  });

  it.each(
    // Computed at collection time so a new surface shows up as its own case.
    readdirSync(FUNCTIONS, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => e.name)
      .filter((name) => {
        try { return readFileSync(join(FUNCTIONS, name, "index.ts"), "utf8").includes("buildSharedTruth"); }
        catch { return false; }
      }),
  )("%s can search the operator's records", (name) => {
    const src = readFileSync(join(FUNCTIONS, name, "index.ts"), "utf8");
    expect(src, `${name} talks to the operator but cannot look anything up`)
      .toMatch(/searchAppData\(/);
  });

  it("the council board searches too, even though it builds its prompt client-side", () => {
    // It posts an already-assembled prompt to the edge functions, so no
    // server-side fix could ever have reached it.
    const svc = read("src/mavis/councilBoardService.ts");
    expect(svc).toMatch(/searchAppData\(supabase, uid, userMessage/);
    const compute = svc.indexOf("searchAppData(supabase, uid, userMessage");
    const use = svc.indexOf("contextSummary +=");
    expect(compute).toBeGreaterThan(-1);
    expect(use, "the block never reaches the prompt").toBeGreaterThan(compute);
  });

  it("a failed council search cannot cost the turn", () => {
    expect(read("src/mavis/councilBoardService.ts")).toMatch(/catch[\s\S]{0,160}Council record search failed/);
  });
});

describe("every surface is wired to it", () => {
  it("MAVIS and council both get retrieval in mavis-chat", () => {
    // One insertion point covers both: council routes through mavis-chat but
    // is excluded from the tool path, so this is the only thing that reaches
    // a council member.
    expect(CHAT).toMatch(/searchAppData\(\s*sb, user\.id, lastUserText/);
    expect(CHAT).toMatch(/relevantRecordsBlock/);
  });

  it("the retrieval block is actually assembled into the prompt", () => {
    // Computing it and forgetting to include it would be a silent no-op.
    const compute = /relevantRecordsBlock\b\s*=/.exec(CHAT)?.index ?? -1;
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
