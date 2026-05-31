import { describe, it, expect } from "vitest";
import { parseActions } from "../parseActions";

describe("parseActions", () => {
  it("returns empty actions and unchanged text when no tags present", () => {
    const result = parseActions("Hello world, no actions here.");
    expect(result.actions).toHaveLength(0);
    expect(result.cleanText).toBe("Hello world, no actions here.");
  });

  it("extracts a single action and strips the tag from cleanText", () => {
    const raw = `Sure thing. :::ACTION{"type":"create_quest","title":"Test Quest"}::: Done.`;
    const result = parseActions(raw);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe("create_quest");
    expect(result.actions[0].payload).toMatchObject({ type: "create_quest", title: "Test Quest" });
    expect(result.cleanText).not.toContain(":::ACTION");
    expect(result.cleanText).toContain("Sure thing.");
  });

  it("extracts multiple actions from one response", () => {
    const raw = [
      `First action :::ACTION{"type":"create_task","title":"Task A"}:::`,
      `Second action :::ACTION{"type":"award_xp","amount":100}:::`,
    ].join(" ");
    const result = parseActions(raw);
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].type).toBe("create_task");
    expect(result.actions[1].type).toBe("award_xp");
  });

  it("skips malformed JSON and continues parsing valid tags", () => {
    const raw = `:::ACTION{broken json}::: :::ACTION{"type":"create_skill","title":"Focus"}:::`;
    const result = parseActions(raw);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe("create_skill");
  });

  it("sets type to 'unknown' when type field is missing", () => {
    const raw = `:::ACTION{"title":"No type here"}:::`;
    const result = parseActions(raw);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe("unknown");
  });

  it("handles multi-line JSON inside action tags", () => {
    const raw = `:::ACTION{
  "type": "create_journal",
  "title": "Reflection",
  "content": "Deep thoughts"
}:::`;
    const result = parseActions(raw);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe("create_journal");
  });

  it("populates the raw field with the original tag string", () => {
    const tag = `:::ACTION{"type":"log_bpm","bpm":72}:::`;
    const result = parseActions(`Before ${tag} after`);
    expect(result.actions[0].raw).toBe(tag);
  });
});
