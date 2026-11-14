import { describe, it, expect } from "vitest";
import { resolveSkillRefs } from "../../../supabase/functions/_shared/skillRefs";

type Row = { id: string; name: string; unlocked: boolean; user_id: string };
const U = "user-1";
const ROWS: Row[] = [
  { id: "ca71beb4-8e9c-4d94-9804-5e848d8be9ef", name: "Emotional Alchemy", unlocked: true, user_id: U },
  { id: "71689566-dd21-41c6-a07f-0d564a7d317a", name: "Decision Making", unlocked: true, user_id: U },
  { id: "1e439c4c-3ecb-46df-a218-62a17b106949", name: "Speed Reading", unlocked: true, user_id: U },
  // Beyonder pathways reuse names: a locked sequence and an unlocked one both called "Error"
  { id: "0d86c075-5b56-46e5-84ac-3e1954400c84", name: "Error", unlocked: false, user_id: U },
  { id: "c1454750-9181-42fe-b008-b0d4b2beaaeb", name: "Error", unlocked: true, user_id: U },
  { id: "99999999-9999-4999-8999-999999999999", name: "Someone Else's", unlocked: true, user_id: "other" },
];

// Minimal stand-in for the supabase query builder the resolver uses: select / eq / in / ilike / limit.
function fakeSb() {
  return {
    from(_table: string) {
      let rows = [...ROWS];
      const q: any = {
        select: () => q,
        eq: (col: string, v: string) => { rows = rows.filter((r) => (r as any)[col] === v); return q; },
        in: (col: string, vals: string[]) => { rows = rows.filter((r) => vals.includes((r as any)[col])); return q; },
        ilike: (col: string, pat: string) => {
          const want = pat.replace(/\\(.)/g, "$1").toLowerCase();
          rows = rows.filter((r) => String((r as any)[col]).toLowerCase() === want); return q;
        },
        limit: () => q,
        then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
      };
      return q;
    },
  };
}

describe("resolveSkillRefs", () => {
  it("2026-11-14: two invented ids are dropped and reported, the real one is kept", async () => {
    const r = await resolveSkillRefs(fakeSb(), U, [
      "9d50e831-0e94-4a6e-a9de-45c91cf20b71", "85b9030b-bb62-474e-b3a3-9e2e5a1eed70", "1e439c4c-3ecb-46df-a218-62a17b106949",
    ]);
    expect(r.valid).toEqual(["1e439c4c-3ecb-46df-a218-62a17b106949"]);
    expect(r.dropped).toEqual(["9d50e831-0e94-4a6e-a9de-45c91cf20b71", "85b9030b-bb62-474e-b3a3-9e2e5a1eed70"]);
  });
  it("resolves exact names (any case) to real skills and reports names that don't exist", async () => {
    const r = await resolveSkillRefs(fakeSb(), U, ["emotional alchemy", "Decision Making", "Communication Mastery", "Problem-Solving"]);
    expect(r.valid).toEqual(["ca71beb4-8e9c-4d94-9804-5e848d8be9ef", "71689566-dd21-41c6-a07f-0d564a7d317a"]);
    expect(r.dropped).toEqual(["Communication Mastery", "Problem-Solving"]);
  });
  it("prefers the unlocked skill when a name repeats", async () => {
    const r = await resolveSkillRefs(fakeSb(), U, ["Error"]);
    expect(r.valid).toEqual(["c1454750-9181-42fe-b008-b0d4b2beaaeb"]);
  });
  it("never resolves another user's skill", async () => {
    const r = await resolveSkillRefs(fakeSb(), U, ["99999999-9999-4999-8999-999999999999", "Someone Else's"]);
    expect(r.valid).toEqual([]);
    expect(r.dropped).toHaveLength(2);
  });
  it("mixes ids and names, de-duplicates, and handles empty input", async () => {
    const r = await resolveSkillRefs(fakeSb(), U, ["ca71beb4-8e9c-4d94-9804-5e848d8be9ef", "Emotional Alchemy", "  "]);
    expect(r.valid).toEqual(["ca71beb4-8e9c-4d94-9804-5e848d8be9ef"]);
    expect((await resolveSkillRefs(fakeSb(), U, [])).valid).toEqual([]);
  });
});
