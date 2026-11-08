import { describe, it, expect } from "vitest";
import { ActionSchema } from "../actionSchemas";

const seq = (n: number) => ({ name: `Rank ${n}`, description: "d", abilities: [{ description: "a" }, { description: "b" }, { description: "c" }] });
const pathway = (sequences: unknown[]) => ({ type: "create_beyonder_pathway", name: "Black Sun", sequences });

describe("create_beyonder_pathway schema", () => {
  it("accepts 10 sequences with 3 abilities each", () => {
    expect(ActionSchema.safeParse(pathway(Array.from({ length: 10 }, (_, i) => seq(i)))).success).toBe(true);
  });
  it("rejects the wrong number of sequences or abilities (the server builds all-or-nothing)", () => {
    expect(ActionSchema.safeParse(pathway(Array.from({ length: 9 }, (_, i) => seq(i)))).success).toBe(false);
    const short = Array.from({ length: 10 }, (_, i) => seq(i));
    short[4] = { ...short[4], abilities: short[4].abilities.slice(1) };
    expect(ActionSchema.safeParse(pathway(short)).success).toBe(false);
  });
});
