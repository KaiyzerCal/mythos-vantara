// Drift guard between MAVIS's video tools and the edge function behind them.
//
// Both sides are Deno edge functions with no live project to integration-test
// against here, so this follows the same static-verification approach as
// actionBackendFieldSync.test.ts: read both sources and assert the contract
// they have to agree on.
//
// The failure this exists to catch is silent. Every tool in MAVIS_TOOL_DEFS
// that lacks an inline handler in resolveActionsNative falls through to
// executeAgentAction → mavis-actions, which knows nothing about video
// productions. The model would call the tool, get an opaque failure, and tell
// the operator it had made their video. Nothing type-checks that relationship.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DISPATCH = readFileSync(join(ROOT, "supabase/functions/mavis-chat/toolDispatch.ts"), "utf8");
const PRODUCER = readFileSync(join(ROOT, "supabase/functions/mavis-video-producer/index.ts"), "utf8");

const VIDEO_TOOLS = ["produce_video", "production_status", "revise_video_beat"] as const;

/** Actions the producer's top-level switch actually implements. */
function producerActions(): string[] {
  const block = PRODUCER.slice(PRODUCER.indexOf("switch (String(body.action"));
  return [...block.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]);
}

/** Action strings a given inline handler sends to the producer. */
function actionsSentBy(tool: string): string[] {
  const start = DISPATCH.indexOf(`if (call.name === "${tool}")`);
  expect(start, `no inline handler for "${tool}"`).toBeGreaterThan(-1);
  const body = DISPATCH.slice(start, DISPATCH.indexOf("\n        continue;\n      }", start));
  return [...body.matchAll(/action:\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("video tools are declared", () => {
  it.each(VIDEO_TOOLS)("%s is in MAVIS_TOOL_DEFS", (tool) => {
    expect(DISPATCH).toContain(`name: "${tool}"`);
  });

  it.each(VIDEO_TOOLS)("%s has an inline handler and never reaches mavis-actions", (tool) => {
    expect(DISPATCH).toContain(`if (call.name === "${tool}")`);
  });

  it.each(VIDEO_TOOLS)("%s's handler ends in continue, so it cannot fall through", (tool) => {
    const start = DISPATCH.indexOf(`if (call.name === "${tool}")`);
    const next = DISPATCH.indexOf("\n      if (call.name ===", start + 1);
    const block = DISPATCH.slice(start, next === -1 ? start + 4000 : next);
    expect(block).toContain("continue;");
  });
});

describe("handlers only send actions the producer implements", () => {
  it("the producer implements a known action set", () => {
    expect(producerActions().sort()).toEqual(["list", "revise_beat", "status", "storyboard"]);
  });

  it.each(VIDEO_TOOLS)("%s sends only implemented actions", (tool) => {
    const implemented = producerActions();
    const sent = actionsSentBy(tool);
    expect(sent.length).toBeGreaterThan(0);
    for (const action of sent) expect(implemented).toContain(action);
  });
});

describe("required params reach the producer", () => {
  it("produce_video forwards the brief the producer requires", () => {
    expect(PRODUCER).toMatch(/body\.brief/);
    expect(actionsSentBy("produce_video")).toContain("storyboard");
    const start = DISPATCH.indexOf('if (call.name === "produce_video")');
    const block = DISPATCH.slice(start, start + 2000);
    expect(block).toMatch(/brief,/);
  });

  it("revise_video_beat forwards both keys the producer needs to find a beat", () => {
    const start = DISPATCH.indexOf('if (call.name === "revise_video_beat")');
    const block = DISPATCH.slice(start, start + 2000);
    expect(block).toMatch(/production_id/);
    expect(block).toMatch(/idx/);
  });

  it("every declared param of produce_video is actually forwarded", () => {
    const defStart = DISPATCH.indexOf('name: "produce_video"');
    const defBlock = DISPATCH.slice(defStart, DISPATCH.indexOf("},\n  {", defStart));
    const declared = [...defBlock.matchAll(/^\s{6}([a-z_]+):\s*\{ type:/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(3);

    const hStart = DISPATCH.indexOf('if (call.name === "produce_video")');
    const hBlock = DISPATCH.slice(hStart, hStart + 2500);
    for (const param of declared) {
      expect(hBlock, `produce_video declares "${param}" but the handler never forwards it`)
        .toMatch(new RegExp(`\\b${param}\\b`));
    }
  });
});

describe("the storyboard step is honest about cost", () => {
  it("tells the model no footage exists and nothing was charged", () => {
    const start = DISPATCH.indexOf('if (call.name === "produce_video")');
    const block = DISPATCH.slice(start, start + 2500);
    // The whole point of splitting planning from generation is that the
    // operator approves before money is spent — if this framing is lost, the
    // model will claim the video is made.
    expect(block).toMatch(/PLAN only/i);
    expect(block).toMatch(/nothing has been charged/i);
  });
});
