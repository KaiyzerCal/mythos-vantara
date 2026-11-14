import { describe, it, expect } from "vitest";
import { toSpeakable, mapSpokenIndex } from "./speakable";

describe("toSpeakable", () => {
  it("drops list bullets instead of saying 'dash'", () => {
    expect(toSpeakable("Here's the plan:\n- Call Dana\n- Send the invoice\n- Book travel"))
      .toBe("Here's the plan: Call Dana. Send the invoice. Book travel");
  });
  it("handles * + • bullets and numbered lists", () => {
    expect(toSpeakable("* one\n+ two\n• three")).toBe("one. two. three");
    expect(toSpeakable("1. First\n2. Second")).toBe("1. First. 2. Second");
  });
  it("unwraps emphasis and headings, keeps the words", () => {
    expect(toSpeakable("## Today\n**Important:** do _this_ now")).toBe("Today. Important: do this now");
  });
  it("turns arrows and separators into words or pauses", () => {
    expect(toSpeakable("Draft -> Review → Ship")).toBe("Draft to Review to Ship");
    expect(toSpeakable("Revenue - up 12% - this week")).toBe("Revenue, up 12%, this week");
    expect(toSpeakable("A & B, 2 + 2 = 4")).toBe("A and B, 2 plus 2 equals 4");
  });
  it("reads snake_case as words and leaves hyphenated words alone", () => {
    expect(toSpeakable("run update_quest on a well-known skill")).toBe("run update quest on a well-known skill"); // no "underscore" read aloud
  });
  it("does not read URLs, code fences, tags, or emoji", () => {
    expect(toSpeakable("See https://example.com/a?b=1 now 🎉")).toBe("See link now");
    expect(toSpeakable("Before\n```js\nconst a = 1;\n```\nAfter")).toBe("Before. After");
    expect(toSpeakable("Done :::ACTION{\"type\":\"x\"}::: ok")).toBe("Done ok");
  });
  it("handles table pipes, slashes between words, and #1", () => {
    expect(toSpeakable("Name | Status")).toBe("Name, Status");
    expect(toSpeakable("input/output and 24/7, #1 priority")).toBe("input output and 24/7, number 1 priority");
  });
  it("is safe on empty input", () => {
    expect(toSpeakable("")).toBe("");
    expect(toSpeakable("---")).toBe("");
  });
});

describe("mapSpokenIndex", () => {
  it("scales a position and clamps it", () => {
    expect(mapSpokenIndex(50, 100, 200)).toBe(100);
    expect(mapSpokenIndex(999, 100, 200)).toBe(200);
    expect(mapSpokenIndex(5, 0, 200)).toBe(200);
  });
});
