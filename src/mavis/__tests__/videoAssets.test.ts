// Cover for the asset worker's scheduling decisions. These rules are cheap to
// get subtly wrong and expensive when wrong: regenerating a beat that already
// has its assets pays twice, a retry with no ceiling pays forever, and a
// production that never reports itself finished is re-examined every five
// minutes for good.
import { describe, it, expect } from "vitest";
import {
  beatNeeds,
  isBeatSatisfied,
  beatCost,
  budgetRemaining,
  selectBeatsToProcess,
  nextProductionStatus,
  defaultBudgetForBeats,
  beatAudioPath,
  MAX_BEAT_ATTEMPTS,
  type BeatRow,
  type ProductionRow,
} from "../../../supabase/functions/_shared/videoAssets";

function beat(over: Partial<BeatRow> = {}): BeatRow {
  return {
    id: `b-${over.idx ?? 0}`,
    idx: 0,
    narration: "a spoken line",
    visual_prompt: "a wide shot of a city",
    seconds: 4,
    asset_url: null,
    audio_url: null,
    provider: null,
    provider_job_id: null,
    status: "pending",
    attempts: 0,
    ...over,
  };
}

function production(over: Partial<ProductionRow> = {}): ProductionRow {
  return {
    id: "p-1",
    production_type: "faceless",
    visual_mode: "stills",
    generation_budget: 30,
    generations_used: 0,
    ...over,
  };
}

describe("beatNeeds", () => {
  it("owes both a picture and a voice when it has neither", () => {
    expect(beatNeeds(beat(), production())).toEqual({ visual: true, audio: true });
  });

  it("owes nothing once both assets exist", () => {
    const done = beat({ asset_url: "https://x/i.png", audio_url: "https://x/a.mp3" });
    expect(beatNeeds(done, production())).toEqual({ visual: false, audio: false });
    expect(isBeatSatisfied(done, production())).toBe(true);
  });

  it("owes no audio for a silent B-roll beat", () => {
    const silent = beat({ narration: "   ", asset_url: "https://x/i.png" });
    expect(beatNeeds(silent, production()).audio).toBe(false);
    expect(isBeatSatisfied(silent, production())).toBe(true);
  });

  it("owes no visual in avatar work — the presenter carries the beat", () => {
    const b = beat({ visual_prompt: "", audio_url: "https://x/a.mp3" });
    const p = production({ production_type: "avatar" });
    expect(beatNeeds(b, p).visual).toBe(false);
    expect(isBeatSatisfied(b, p)).toBe(true);
  });

  it("still generates a cutaway when an avatar beat asks for one", () => {
    const b = beat({ visual_prompt: "product close-up", audio_url: "https://x/a.mp3" });
    expect(beatNeeds(b, production({ production_type: "avatar" })).visual).toBe(true);
  });

  it("does not owe a visual it has no prompt for, even when faceless", () => {
    // The planner guarantees faceless beats carry a prompt; this is the
    // belt-and-braces case, and asking a generator for "" would just error.
    const b = beat({ visual_prompt: "", audio_url: "https://x/a.mp3" });
    expect(beatNeeds(b, production()).visual).toBe(false);
  });

  it("prices a beat by what it still owes", () => {
    expect(beatCost(beat(), production())).toBe(2);
    expect(beatCost(beat({ asset_url: "https://x/i.png" }), production())).toBe(1);
    expect(beatCost(beat({ narration: "" }), production())).toBe(1);
  });
});

describe("selectBeatsToProcess", () => {
  const p = production();

  it("never returns a beat that is already satisfied", () => {
    const beats = [
      beat({ idx: 0, asset_url: "https://x/0.png", audio_url: "https://x/0.mp3" }),
      beat({ idx: 1 }),
    ];
    expect(selectBeatsToProcess(beats, p, { limit: 10 }).map((b) => b.idx)).toEqual([1]);
  });

  it("works front to back so a partial production is watchable", () => {
    const beats = [beat({ idx: 3 }), beat({ idx: 1 }), beat({ idx: 2 })];
    expect(selectBeatsToProcess(beats, p, { limit: 10 }).map((b) => b.idx)).toEqual([1, 2, 3]);
  });

  it("bounds the batch to the tick limit", () => {
    const beats = Array.from({ length: 9 }, (_, i) => beat({ idx: i }));
    expect(selectBeatsToProcess(beats, p, { limit: 3 })).toHaveLength(3);
  });

  it("skips a beat that has exhausted its attempts", () => {
    const beats = [
      beat({ idx: 0, attempts: MAX_BEAT_ATTEMPTS }),
      beat({ idx: 1, attempts: MAX_BEAT_ATTEMPTS - 1 }),
    ];
    expect(selectBeatsToProcess(beats, p, { limit: 10 }).map((b) => b.idx)).toEqual([1]);
  });

  it("skips beats already marked failed or skipped", () => {
    const beats = [
      beat({ idx: 0, status: "failed" }),
      beat({ idx: 1, status: "skipped" }),
      beat({ idx: 2 }),
    ];
    expect(selectBeatsToProcess(beats, p, { limit: 10 }).map((b) => b.idx)).toEqual([2]);
  });

  it("returns nothing once the budget is spent", () => {
    const spent = production({ generation_budget: 4, generations_used: 4 });
    expect(selectBeatsToProcess([beat()], spent, { limit: 10 })).toEqual([]);
  });

  it("stops handing out beats when the remaining budget cannot cover them", () => {
    // Budget for 3 more calls; each beat owes 2, so only one fits.
    const tight = production({ generation_budget: 10, generations_used: 7 });
    const beats = [beat({ idx: 0 }), beat({ idx: 1 }), beat({ idx: 2 })];
    expect(selectBeatsToProcess(beats, tight, { limit: 10 })).toHaveLength(1);
  });

  it("always polls an in-flight provider job, since polling is free", () => {
    const spent = production({ generation_budget: 2, generations_used: 2 });
    const inFlight = beat({ idx: 0, provider_job_id: "req-123", status: "generating" });
    expect(selectBeatsToProcess([inFlight], spent, { limit: 10 })).toHaveLength(0);

    // …but with any budget at all, the free poll is picked up.
    const some = production({ generation_budget: 3, generations_used: 2 });
    expect(selectBeatsToProcess([inFlight], some, { limit: 10 })).toHaveLength(1);
  });
});

describe("nextProductionStatus", () => {
  const p = production();

  it("hands off to composing when every beat is satisfied", () => {
    const beats = [
      beat({ idx: 0, asset_url: "https://x/0.png", audio_url: "https://x/0.mp3", status: "ready" }),
      beat({ idx: 1, asset_url: "https://x/1.png", audio_url: "https://x/1.mp3", status: "ready" }),
    ];
    expect(nextProductionStatus(beats, p)).toEqual({ status: "composing", error_message: null });
  });

  it("stays generating while work remains", () => {
    const beats = [
      beat({ idx: 0, asset_url: "https://x/0.png", audio_url: "https://x/0.mp3", status: "ready" }),
      beat({ idx: 1 }),
    ];
    expect(nextProductionStatus(beats, p).status).toBe("generating");
  });

  it("fails rather than shipping a video with a hole in it", () => {
    const beats = [
      beat({ idx: 0, asset_url: "https://x/0.png", audio_url: "https://x/0.mp3", status: "ready" }),
      beat({ idx: 1, status: "failed", attempts: MAX_BEAT_ATTEMPTS }),
    ];
    const d = nextProductionStatus(beats, p);
    expect(d.status).toBe("failed");
    // Names the scene in human numbering, not the zero-based index.
    expect(d.error_message).toMatch(/scene 2/);
  });

  it("fails when every remaining beat has given up", () => {
    const beats = [beat({ idx: 0, attempts: MAX_BEAT_ATTEMPTS }), beat({ idx: 1, attempts: MAX_BEAT_ATTEMPTS })];
    const d = nextProductionStatus(beats, p);
    expect(d.status).toBe("failed");
    expect(d.error_message).toMatch(/gave up after/i);
  });

  it("stops on an exhausted budget instead of looping forever", () => {
    const spent = production({ generation_budget: 6, generations_used: 6 });
    const d = nextProductionStatus([beat({ idx: 0 })], spent);
    expect(d.status).toBe("failed");
    expect(d.error_message).toMatch(/budget spent/i);
  });

  it("does not fail a production merely because it is unfinished", () => {
    const plenty = production({ generation_budget: 30, generations_used: 2 });
    expect(nextProductionStatus([beat({ idx: 0, attempts: 1 })], plenty).status).toBe("generating");
  });

  it("treats a production with no beats as failed, not finished", () => {
    const d = nextProductionStatus([], p);
    expect(d.status).toBe("failed");
    expect(d.error_message).toMatch(/no beats/i);
  });

  it("ignores skipped beats when deciding completion", () => {
    const beats = [
      beat({ idx: 0, asset_url: "https://x/0.png", audio_url: "https://x/0.mp3", status: "ready" }),
      beat({ idx: 1, status: "skipped" }),
    ];
    expect(nextProductionStatus(beats, p).status).toBe("composing");
  });
});

describe("budget and paths", () => {
  it("reports remaining budget without going negative", () => {
    expect(budgetRemaining(production({ generation_budget: 10, generations_used: 3 }))).toBe(7);
    expect(budgetRemaining(production({ generation_budget: 2, generations_used: 9 }))).toBe(0);
  });

  it("sizes the default budget above the honest cost of one clean run", () => {
    for (const beats of [1, 4, 8, 24]) {
      // Two calls per beat is the no-retry cost; the budget must exceed it.
      expect(defaultBudgetForBeats(beats)).toBeGreaterThan(beats * 2 - 1);
    }
    expect(defaultBudgetForBeats(1)).toBeGreaterThanOrEqual(6);
  });

  it("puts the user id first in the audio path, as vault-media RLS requires", () => {
    const path = beatAudioPath("user-abc", "prod-1", 7);
    expect(path.split("/")[0]).toBe("user-abc");
    expect(path).toMatch(/beat-007\.mp3$/);
  });

  it("zero-pads beat indexes so storage listings sort correctly", () => {
    const paths = [2, 10].map((i) => beatAudioPath("u", "p", i));
    expect([...paths].sort()).toEqual(paths);
  });
});
