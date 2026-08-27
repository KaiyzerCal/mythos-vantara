// Guards on the targeted-refresh map.
//
// The map's safety property is one-directional: an action it does not mention
// falls back to a full refetchAll, which is what every refresh site did before
// it existed. So omissions are harmless by construction and there is nothing
// to test there. The failure mode that matters is a WRONG entry — a section
// that isn't real, a key the alias table rewrites before lookup, or a mapping
// that points at a table the action never writes.
//
// The last of those is not hypothetical. This suite was written after
// create_task/update_task/delete_task were mapped to ["tasks"]: both alias
// tables rewrite them to their quest equivalents, and mavis-actions'
// surviving `case "create_task"` inserts into the QUESTS table. The entries
// were unreachable, and would have refreshed the wrong section if reached.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SECTIONS, SECTION_FOR, ROUTE_FOR, ALL,
  sectionsForActions, routeForActions,
  type Section,
} from "../refreshContract";
import { normalizeActionType } from "../actionExecutor";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the map is internally consistent", () => {
  it("every mapped section is a real section", () => {
    const valid = new Set<string>(SECTIONS);
    for (const [action, sections] of Object.entries(SECTION_FOR)) {
      for (const s of sections) {
        expect(valid, `"${action}" maps to unknown section "${s}"`).toContain(s);
      }
    }
  });

  it("every key is already canonical", () => {
    // A key the alias table rewrites can never be found: sectionsForActions
    // normalizes before it looks up, so such an entry is dead code that reads
    // as coverage. This is the assertion that caught the task-action bug.
    for (const key of Object.keys(SECTION_FOR)) {
      expect(
        normalizeActionType(key),
        `SECTION_FOR key "${key}" is an alias for "${normalizeActionType(key)}" — ` +
        `it is normalized away before lookup and can never match`,
      ).toBe(key);
    }
    for (const key of Object.keys(ROUTE_FOR)) {
      expect(normalizeActionType(key), `ROUTE_FOR key "${key}" is an alias`).toBe(key);
    }
  });

  it("maps no task action, because task writes land in quests", () => {
    // Regression pin for the bug above, stated as intent rather than as an
    // incidental absence.
    for (const key of Object.keys(SECTION_FOR)) {
      expect(key).not.toMatch(/_task$/);
    }
    expect(Object.values(SECTION_FOR).flat()).not.toContain("tasks");
  });
});

describe("the map agrees with the backend", () => {
  const ACTIONS_FN = read("supabase/functions/mavis-actions/index.ts");

  it("every mapped action exists as a backend case or alias", () => {
    // Catches a typo'd action name, which would otherwise sit in the map
    // looking like coverage while every real call fell through to ALL.
    for (const action of Object.keys(SECTION_FOR)) {
      const handled =
        ACTIONS_FN.includes(`case "${action}"`) || ACTIONS_FN.includes(`"${action}":`);
      expect(handled, `"${action}" is mapped but mavis-actions never handles it`).toBe(true);
    }
  });

  it("no action mapped as read-only writes to a section table", () => {
    // The claim behind an empty array is "this succeeded and wrote nothing",
    // which is what lets it skip the refresh entirely. If one of these ever
    // gains a write, the skip becomes a stale screen with no error.
    const SECTION_TABLES = [
      "profiles", "quests", "tasks", "journal_entries", "vault_entries", "councils",
      "skills", "energy_systems", "inventory", "allies", "bpm_sessions", "store_items",
      "currencies", "transformations", "rankings_profiles", "rituals", "mavis_domain_effects",
    ];
    const readOnly = Object.entries(SECTION_FOR)
      .filter(([, s]) => s.length === 0)
      .map(([a]) => a);
    expect(readOnly.length, "expected some read-only actions").toBeGreaterThan(10);

    // Bound each body at the real case boundary. A fixed-size window is not
    // good enough: search_web's body is ~1900 chars, so a 4000-char slice
    // reaches into two later cases and reports their writes as its own. Start
    // at the case's opening brace rather than its label, which also gives a
    // grouped case (`case "a": case "b": { ... }`) its shared body instead of
    // an empty one that would pass vacuously.
    const nextCaseAfter = (from: number) => {
      const i = ACTIONS_FN.indexOf('\n    case "', from);
      return i === -1 ? ACTIONS_FN.length : i;
    };

    for (const action of readOnly) {
      const label = ACTIONS_FN.indexOf(`case "${action}"`);
      if (label === -1) continue; // proxied to another edge function entirely
      const brace = ACTIONS_FN.indexOf("{", label);
      if (brace === -1) continue;
      const body = ACTIONS_FN.slice(brace, nextCaseAfter(brace));
      for (const t of SECTION_TABLES) {
        const writes = new RegExp(`\\.from\\("${t}"\\)\\s*\\.\\s*(insert|update|delete|upsert)`);
        expect(
          writes.test(body),
          `"${action}" is mapped read-only but writes to ${t}`,
        ).toBe(false);
      }
    }
  });
});

describe("routes are real", () => {
  const APP = read("src/App.tsx");

  it("every offered route is registered in App.tsx", () => {
    for (const [action, route] of Object.entries(ROUTE_FOR)) {
      expect(
        APP.includes(`path="${route}"`),
        `"${action}" offers route "${route}", which App.tsx does not define`,
      ).toBe(true);
    }
  });

  it("offers a route only for actions it also knows how to refresh", () => {
    // A "View →" link pointing at a page this turn did not refresh would show
    // the operator stale data at the exact moment they went looking for the
    // thing MAVIS just made.
    for (const action of Object.keys(ROUTE_FOR)) {
      if (!(action in SECTION_FOR)) continue; // unmapped ⇒ refreshes everything
      expect(
        SECTION_FOR[action].length,
        `"${action}" offers a route but is mapped as writing nothing`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("sectionsForActions", () => {
  it("returns nothing for an empty batch", () => {
    expect(sectionsForActions([])).toEqual([]);
  });

  it("scopes a known write to its own section", () => {
    expect(sectionsForActions(["create_quest"]).sort()).toEqual(["profile", "quests"]);
  });

  it("includes profile on every write", () => {
    // XP, level and streak move as a side effect of most writes; attributing
    // that per action across 155 handlers would be guesswork.
    for (const action of ["create_skill", "create_journal", "log_bpm_session"]) {
      expect(sectionsForActions([action]), action).toContain("profile");
    }
  });

  it("skips the refresh entirely for a read", () => {
    expect(sectionsForActions(["search_web"])).toEqual([]);
    expect(sectionsForActions(["search_web", "browse_url"])).toEqual([]);
  });

  it("resolves aliases before looking up", () => {
    // "remove_quest" is never a key in the map; it has to normalize first.
    expect(sectionsForActions(["remove_quest"]).sort()).toEqual(["profile", "quests"]);
    expect(sectionsForActions(["add_journal"]).sort()).toEqual(["journal", "profile"]);
  });

  it("falls back to everything for an unmapped action", () => {
    expect(sectionsForActions(["run_code"])).toBe(ALL);
    expect(sectionsForActions(["some_action_invented_next_month"])).toBe(ALL);
  });

  it("lets one unknown action poison the whole batch", () => {
    // A batch refreshed narrowly around its known members would silently miss
    // whatever the unknown one wrote. Breadth is the safe direction.
    expect(sectionsForActions(["create_quest", "notion_agent"])).toBe(ALL);
  });

  it("unions a mixed batch without duplicating", () => {
    const out = sectionsForActions(["create_quest", "complete_quest", "create_skill"]);
    expect(out).not.toBe(ALL);
    expect((out as Section[]).sort()).toEqual(["profile", "quests", "skills"]);
  });

  it("does not let a read widen a write's scope", () => {
    const out = sectionsForActions(["search_web", "create_skill"]);
    expect((out as Section[]).sort()).toEqual(["profile", "skills"]);
  });
});

describe("routeForActions", () => {
  it("offers the first route in the batch", () => {
    expect(routeForActions(["create_quest", "create_skill"])).toBe("/quests");
  });

  it("skips actions with no route", () => {
    expect(routeForActions(["search_web", "create_skill"])).toBe("/skills");
  });

  it("returns null when nothing offers one", () => {
    expect(routeForActions(["search_web"])).toBeNull();
    expect(routeForActions([])).toBeNull();
  });

  it("resolves aliases", () => {
    expect(routeForActions(["add_quest"])).toBe("/quests");
  });
});

describe("the call sites use the contract", () => {
  const CHAT = read("src/pages/MavisChat.tsx");
  const DEMO = read("src/pages/MavisDemo.tsx");

  it("MavisChat scopes every action-driven refresh", () => {
    // One refetchAll survives on purpose: the ReAct fallback for a batch whose
    // per-action events were missed, where actionsRan proves something ran but
    // not what. Any other bare refetchAll here is an unscoped shotgun.
    const calls = [...CHAT.matchAll(/await refetchAll\(\)|refetchAll\?\.\(\)/g)];
    expect(calls.length, "expected exactly the actionsRan fallback").toBe(1);
    expect(CHAT).toMatch(/actionsRan[\s\S]{0,200}await refetchAll\(\)/);
  });

  it("the ReAct path keeps action types rather than a boolean", () => {
    // Collapsing the batch to a boolean is what forced this path to shotgun.
    expect(CHAT).not.toMatch(/reactActionsSucceeded/);
    expect(CHAT).toMatch(/reactActionTypes\.push\(stepEvent\.type\)/);
  });

  it("MavisDemo no longer sleeps before refreshing", () => {
    // Phase 2 removed this from MavisChat and missed MavisDemo.
    expect(DEMO).not.toMatch(/setTimeout\(r,\s*500\)[\s\S]{0,80}refetchAll/);
    expect(DEMO).toMatch(/refreshSections\(sectionsForActions\(/);
  });

  it("navigates only after the reply is committed", () => {
    // Navigating mid-stream would swap the page out from under a reply the
    // operator is still reading. Both call sites must sit after their
    // setChatMessages commit.
    const commit = CHAT.indexOf("Replace streaming placeholder with the final");
    const nav = CHAT.indexOf("goToActionResult(navigateTarget)");
    expect(commit, "message commit not found").toBeGreaterThan(-1);
    expect(nav, "tail navigation not found").toBeGreaterThan(commit);

    const agentCommit = CHAT.indexOf("concat(agentMsg)");
    const agentNav = CHAT.indexOf("goToActionResult(routeForActions(agentExecConfirmed");
    expect(agentNav, "agent-path navigation not found").toBeGreaterThan(agentCommit);
  });

  it("does not navigate to the page already open", () => {
    // Otherwise every quest MAVIS creates while the operator sits on /quests
    // pushes a redundant history entry they then have to back out of.
    expect(CHAT).toMatch(/window\.location\.pathname === route/);
  });

  it("does not navigate after a cancelled turn", () => {
    expect(CHAT).toMatch(/if \(!route \|\| cancelledRef\.current\) return;/);
  });

  it("lets the ReAct route win over the trailing one", () => {
    // ReAct actions run first, so they are what the operator actually asked
    // for; ??= is what keeps the later assignment from overwriting them.
    expect(CHAT).toMatch(/navigateTarget \?\?= routeForActions/);
  });

  it("both pages route through sectionsForActions", () => {
    for (const [name, src] of [["MavisChat", CHAT], ["MavisDemo", DEMO]] as const) {
      expect(src, name).toMatch(/sectionsForActions/);
    }
  });
});
