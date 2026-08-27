// Unit cover for the storyboard planner that every video production runs
// through. The module is deliberately pure (no Deno APIs) so it can be tested
// here even though it executes inside an edge function — same constraint the
// actionBackendFieldSync test works around, solved by keeping the logic
// importable rather than by scraping source text.
//
// What matters is that an LLM's plausible-but-wrong storyboard cannot reach the
// asset generator: missing fields, absurd durations, empty beats, and runtimes
// nowhere near what was asked for all get resolved here or reported.
import { describe, it, expect } from "vitest";
import {
  normalizeStoryboard,
  estimateSeconds,
  suggestBeatCount,
  clampTargetSeconds,
  coerceProductionType,
  coerceFormat,
  coerceVisualMode,
  visualRequiredFor,
  FORMAT_DIMENSIONS,
  MAX_BEATS,
  MIN_BEAT_SECONDS,
  MAX_BEAT_SECONDS,
} from "../../../supabase/functions/_shared/storyboard";

const faceless = { target_seconds: 30, production_type: "faceless" as const };

describe("normalizeStoryboard — shape", () => {
  it("accepts the documented {beats:[...]} envelope", () => {
    const plan = normalizeStoryboard(
      { beats: [{ narration: "One", visual_prompt: "a", seconds: 3 }] },
      faceless,
    );
    expect(plan.beats).toHaveLength(1);
  });

  it("also accepts a bare array, which models return constantly", () => {
    const plan = normalizeStoryboard(
      [{ narration: "One", visual_prompt: "a", seconds: 3 }],
      faceless,
    );
    expect(plan.beats).toHaveLength(1);
  });

  it("reindexes beats contiguously from zero after drops", () => {
    const plan = normalizeStoryboard(
      [
        { narration: "keep", visual_prompt: "a", seconds: 3 },
        {},                                   // empty — dropped
        { narration: "keep too", visual_prompt: "b", seconds: 3 },
      ],
      faceless,
    );
    expect(plan.beats.map((b) => b.idx)).toEqual([0, 1]);
  });

  it("never throws on junk input, it reports", () => {
    for (const junk of [null, undefined, 42, "nope", {}, { beats: "no" }]) {
      const plan = normalizeStoryboard(junk, faceless);
      expect(plan.beats).toEqual([]);
      expect(plan.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeStoryboard — beat integrity", () => {
  it("drops a beat with neither narration nor visual", () => {
    const plan = normalizeStoryboard(
      [{ narration: "real", visual_prompt: "x" }, { on_screen_text: "orphan" }],
      faceless,
    );
    expect(plan.beats).toHaveLength(1);
    expect(plan.warnings.join(" ")).toMatch(/empty beat/i);
  });

  it("derives a visual for a faceless beat that has none", () => {
    const plan = normalizeStoryboard([{ narration: "The kidney filters blood" }], faceless);
    expect(plan.beats[0].visual_prompt).toContain("The kidney filters blood");
  });

  it("leaves the visual empty for avatar work — the performer is the picture", () => {
    const plan = normalizeStoryboard(
      [{ narration: "Hey, quick tip for you" }],
      { target_seconds: 30, production_type: "avatar" },
    );
    expect(plan.beats[0].visual_prompt).toBe("");
    expect(plan.beats[0].narration).toBe("Hey, quick tip for you");
  });

  it("keeps a visual-only beat, since silent B-roll is legitimate", () => {
    const plan = normalizeStoryboard([{ visual_prompt: "slow pan over city" }], faceless);
    expect(plan.beats).toHaveLength(1);
    expect(plan.beats[0].narration).toBe("");
  });

  it("caps the beat list rather than accepting an unbounded one", () => {
    const many = Array.from({ length: MAX_BEATS + 9 }, (_, i) => ({
      narration: `beat ${i}`, visual_prompt: "x", seconds: 3,
    }));
    const plan = normalizeStoryboard(many, { target_seconds: 120, production_type: "faceless" });
    expect(plan.beats).toHaveLength(MAX_BEATS);
    expect(plan.warnings.join(" ")).toMatch(new RegExp(`limit is ${MAX_BEATS}`));
  });
});

describe("normalizeStoryboard — durations", () => {
  it("clamps absurd per-beat durations from both directions", () => {
    const plan = normalizeStoryboard(
      [
        { narration: "a", visual_prompt: "x", seconds: 900 },
        { narration: "b", visual_prompt: "y", seconds: 0.01 },
        { narration: "c", visual_prompt: "z", seconds: -5 },
      ],
      { target_seconds: 60, production_type: "faceless" },
    );
    for (const b of plan.beats) {
      expect(b.seconds).toBeGreaterThanOrEqual(MIN_BEAT_SECONDS);
      expect(b.seconds).toBeLessThanOrEqual(MAX_BEAT_SECONDS);
    }
  });

  it("estimates a duration from narration length when seconds is missing", () => {
    // Target is set near the beats' natural total so the fit stage stays out of
    // the way — otherwise proportional scaling pins both beats to the ceiling
    // and the estimate under test is invisible.
    const plan = normalizeStoryboard(
      [
        { narration: "Two words", visual_prompt: "x" },
        { narration: Array.from({ length: 25 }, () => "word").join(" "), visual_prompt: "y" },
      ],
      { target_seconds: 12, production_type: "faceless" },
    );
    const [short, long] = plan.beats;
    expect(long.seconds).toBeGreaterThan(short.seconds);
    expect(short.seconds).toBe(MIN_BEAT_SECONDS);
  });

  it("keeps longer narration proportionally longer after fitting", () => {
    const plan = normalizeStoryboard(
      [
        { narration: Array.from({ length: 8 }, () => "word").join(" "), visual_prompt: "x" },
        { narration: Array.from({ length: 16 }, () => "word").join(" "), visual_prompt: "y" },
      ],
      { target_seconds: 30, production_type: "faceless" },
    );
    const [a, b] = plan.beats;
    expect(b.seconds).toBeGreaterThan(a.seconds);
  });

  it("ignores a non-numeric seconds value instead of producing NaN", () => {
    const plan = normalizeStoryboard(
      [{ narration: "hello there friend", visual_prompt: "x", seconds: "soon" }],
      faceless,
    );
    expect(Number.isFinite(plan.beats[0].seconds)).toBe(true);
    expect(Number.isFinite(plan.total_seconds)).toBe(true);
  });

  it("scales a too-long storyboard down toward the requested runtime", () => {
    const beats = Array.from({ length: 6 }, (_, i) => ({
      narration: `beat ${i}`, visual_prompt: "x", seconds: 10,
    }));
    const plan = normalizeStoryboard(beats, { target_seconds: 30, production_type: "faceless" });
    expect(plan.total_seconds).toBeGreaterThan(25);
    expect(plan.total_seconds).toBeLessThan(35);
  });

  it("scales a too-short storyboard up toward the requested runtime", () => {
    const beats = Array.from({ length: 5 }, (_, i) => ({
      narration: `beat ${i}`, visual_prompt: "x", seconds: 2,
    }));
    const plan = normalizeStoryboard(beats, { target_seconds: 45, production_type: "faceless" });
    expect(plan.total_seconds).toBeGreaterThan(38);
  });

  it("leaves a storyboard already near target untouched", () => {
    const beats = Array.from({ length: 6 }, () => ({
      narration: "x", visual_prompt: "y", seconds: 5,
    }));
    const plan = normalizeStoryboard(beats, { target_seconds: 30, production_type: "faceless" });
    expect(plan.beats.every((b) => b.seconds === 5)).toBe(true);
  });

  it("warns when per-beat floors make the target unreachable", () => {
    // 12 beats can never total 10s at a 1.5s floor — 18s is the true minimum.
    const beats = Array.from({ length: 12 }, () => ({
      narration: "x", visual_prompt: "y", seconds: 5,
    }));
    const plan = normalizeStoryboard(beats, { target_seconds: 10, production_type: "faceless" });
    expect(plan.warnings.join(" ")).toMatch(/can't be stretched or compressed/i);
    expect(plan.total_seconds).toBeCloseTo(18, 0);
  });

  it("reports total_seconds as the true sum of its beats", () => {
    const plan = normalizeStoryboard(
      [
        { narration: "a", visual_prompt: "x", seconds: 4 },
        { narration: "b", visual_prompt: "y", seconds: 6 },
        { narration: "c", visual_prompt: "z", seconds: 5 },
      ],
      { target_seconds: 15, production_type: "faceless" },
    );
    const sum = plan.beats.reduce((s, b) => s + b.seconds, 0);
    expect(plan.total_seconds).toBeCloseTo(sum, 5);
  });
});

describe("input coercion", () => {
  it("clamps the requested runtime into a producible range", () => {
    expect(clampTargetSeconds(0)).toBeGreaterThanOrEqual(5);
    expect(clampTargetSeconds(99999)).toBeLessThanOrEqual(600);
    expect(clampTargetSeconds("nonsense")).toBe(45);
    expect(clampTargetSeconds(undefined)).toBe(45);
    expect(clampTargetSeconds(30)).toBe(30);
  });

  it("normalizes production type spellings and rejects unknowns", () => {
    expect(coerceProductionType("persona ugc")).toBe("persona_ugc");
    expect(coerceProductionType("persona-ugc")).toBe("persona_ugc");
    expect(coerceProductionType("AVATAR")).toBe("avatar");
    expect(coerceProductionType("interpretive dance")).toBe("faceless");
  });

  it("defaults format to vertical and only accepts known ratios", () => {
    expect(coerceFormat(undefined)).toBe("9:16");
    expect(coerceFormat("16:9")).toBe("16:9");
    expect(coerceFormat("4:3")).toBe("9:16");
  });

  it("defaults visual mode to the cheaper stills path", () => {
    expect(coerceVisualMode(undefined)).toBe("stills");
    expect(coerceVisualMode("video")).toBe("video");
    expect(coerceVisualMode("claymation")).toBe("stills");
  });

  it("only faceless productions require a visual per beat", () => {
    expect(visualRequiredFor("faceless")).toBe(true);
    expect(visualRequiredFor("avatar")).toBe(false);
    expect(visualRequiredFor("persona_ugc")).toBe(false);
  });

  it("maps every format to real render dimensions", () => {
    for (const [fmt, dim] of Object.entries(FORMAT_DIMENSIONS)) {
      expect(dim.width).toBeGreaterThan(0);
      expect(dim.height).toBeGreaterThan(0);
      const ratio = fmt.split(":").map(Number);
      expect(dim.width / dim.height).toBeCloseTo(ratio[0] / ratio[1], 2);
    }
  });
});

describe("estimateSeconds / suggestBeatCount", () => {
  it("gives an empty line the floor rather than zero", () => {
    expect(estimateSeconds("")).toBe(MIN_BEAT_SECONDS);
  });

  it("never exceeds the per-beat ceiling for a very long line", () => {
    const wall = Array.from({ length: 500 }, () => "word").join(" ");
    expect(estimateSeconds(wall)).toBeLessThanOrEqual(MAX_BEAT_SECONDS);
  });

  it("asks for more beats as runtime grows, but sublinearly", () => {
    const short = suggestBeatCount(15);
    const mid = suggestBeatCount(60);
    const long = suggestBeatCount(300);
    expect(mid).toBeGreaterThan(short);
    expect(long).toBeGreaterThan(mid);
    expect(long).toBeLessThanOrEqual(MAX_BEATS);
    // A 5-minute video must not become 100 two-second cuts.
    expect(300 / long).toBeGreaterThan(60 / mid);
  });
});
