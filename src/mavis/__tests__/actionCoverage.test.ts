// Can the agents actually WRITE to the pages they can read?
//
// Every surface got search first. This is the other half: MAVIS, personas and
// council members all execute through mavis-actions, so whether a page can be
// changed at all comes down to whether a case exists here — and three real
// routes had none.
//
// The failure mode this guards is not a crash. A create that inserts into the
// wrong table, or an update that stamps a column the table does not have,
// looks like working code and fails only against the live database.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
// Normalized to LF: types.ts is checked out CRLF on Windows, and columnsOf's
// regex below anchors on literal "\n" — against raw CRLF content its closing
// "\n        }\n" never matches, so every table silently comes back with zero
// columns and every assertion that depends on it fails, whether or not the
// registry entry is actually correct.
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const ACTIONS = read("supabase/functions/mavis-actions/index.ts");
const TYPES = read("src/integrations/supabase/types.ts");
const ROUTER = read("supabase/functions/mavis-persona-router/index.ts");
const COUNCIL = read("src/mavis/councilPersona.ts");

/**
 * The body of one `case "<name>":` in the executor's switch.
 *
 * Handles grouped labels: several action types share a block
 * (`case "goal": case "set_goal": ... {`), so the opening brace is not
 * necessarily on the label's own line. Requiring `": {"` silently returned
 * nothing for those, which made an assertion pass against an empty string.
 */
function caseBody(name: string): string {
  const start = ACTIONS.indexOf(`case "${name}":`);
  if (start === -1) return "";
  // Cases here are one brace-balanced block; walk it rather than guessing.
  let depth = 0;
  for (let i = ACTIONS.indexOf("{", start); i < ACTIONS.length; i++) {
    if (ACTIONS[i] === "{") depth++;
    else if (ACTIONS[i] === "}" && --depth === 0) return ACTIONS.slice(start, i + 1);
  }
  return "";
}

/** Column names a table really has, from the generated Supabase types. */
function columnsOf(table: string): string[] {
  const m = new RegExp(`\\n      ${table}: \\{\\n        Row: \\{\\n(.*?)\\n        \\}\\n`, "s").exec(TYPES);
  if (!m) return [];
  return m[1].split("\n").map((l) => l.trim().split(":")[0].trim()).filter(Boolean);
}

describe("pages that had no write path at all", () => {
  // /calendar, /meetings and /goals are real routes backed by real tables.
  // Every agent could search them; none could create, change or remove a row.
  const trios = [
    { page: "/calendar", table: "calendar_events", create: "create_calendar_event", update: "update_calendar_event", del: "delete_calendar_event" },
    { page: "/meetings", table: "meeting_notes",   create: "create_meeting_note",   update: "update_meeting_note",   del: "delete_meeting_note" },
    { page: "/goals",    table: "mavis_goals",     create: "create_goal",           update: "update_goal",           del: "delete_goal" },
  ];

  it.each(trios)("$page has create, update and delete", ({ create, update, del }) => {
    for (const name of [create, update, del]) {
      expect(caseBody(name), `${name} is missing from the executor`).not.toBe("");
    }
  });

  it.each(trios)("$page writes to $table and nowhere else", ({ table, create, update, del }) => {
    // create_task is the cautionary tale: it reads as a task creator and
    // inserts into quests. A write aimed at the wrong table is invisible
    // until someone checks the database.
    for (const name of [create, update, del]) {
      const tables = [...caseBody(name).matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
      expect(tables.length, `${name} touches no table`).toBeGreaterThan(0);
      for (const t of tables) {
        expect(t, `${name} writes to ${t}, not ${table}`).toBe(table);
      }
    }
  });

  it.each(trios)("$page only ever sets columns $table actually has", ({ table, create, update }) => {
    const cols = columnsOf(table);
    expect(cols.length, `no generated type for ${table}`).toBeGreaterThan(0);
    for (const name of [create, update]) {
      const body = caseBody(name);
      // Object keys assigned in the insert/update payloads.
      const assigned = [...body.matchAll(/^\s{6,}([a-z_]+):\s/gm)].map((m) => m[1]);
      for (const key of assigned) {
        expect(cols, `${name} sets "${key}", which ${table} does not have`).toContain(key);
      }
      // The specific trap: two of these tables have no updated_at, so
      // stamping one fails the whole write.
      if (!cols.includes("updated_at")) {
        expect(body, `${name} stamps updated_at but ${table} has no such column`)
          .not.toMatch(/updated_at/);
      }
    }
  });

  it("does not confuse the goals page with the autonomy objective queue", () => {
    // set_goal writes an autonomy objective to mavis_tasks. create_goal is the
    // /goals page. Same word, different tables — worth keeping distinct.
    // Assert on the tables it queries, not on prose: the case comment names
    // mavis_tasks to explain the distinction, and a plain text match flagged
    // that comment as if it were a write.
    const goalTables = [...caseBody("create_goal").matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(goalTables).toContain("mavis_goals");
    expect(goalTables).not.toContain("mavis_tasks");
    expect([...caseBody("set_goal").matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]))
      .toContain("mavis_tasks");
  });

  it("tells personas and council members the new actions exist", () => {
    // An action nothing is told about is an action that never fires.
    for (const name of ["create_calendar_event", "create_meeting_note", "create_goal"]) {
      expect(ROUTER, `persona catalog is missing ${name}`).toMatch(new RegExp(name));
      expect(COUNCIL, `council catalog is missing ${name}`).toMatch(new RegExp(name));
    }
  });
});

describe("the disabled tasks system stays disabled", () => {
  it("keeps create_task redirecting to quests rather than reviving a dead page", () => {
    // buildSystemPrompt is explicit: "There is no tasks system. The app has no
    // task tab." There is no /tasks route either. The redirect is deliberate,
    // so this records it as intent rather than leaving it to look like a bug
    // the next person should "fix".
    const body = caseBody("create_task");
    expect(body).not.toBe("");
    expect(body).toMatch(/\.from\("quests"\)/);
    expect(read("src/mavis/buildSystemPrompt.ts")).toMatch(/There is no tasks system/);
  });
});
