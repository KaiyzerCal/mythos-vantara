import { describe, it, expect, vi, beforeEach } from "vitest";

const aiComplete = vi.fn();
vi.mock("../../../supabase/functions/_shared/providers.ts", () => ({ aiComplete: (o: unknown) => aiComplete(o) }));

import {
  claudeFetch, claudeCreate, claudeFetchBg, claudeCreateBg,
} from "../../../supabase/functions/_shared/claudeCompat.ts";

const URL_MSG = "https://api.anthropic.com/v1/messages";
const req = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const realFetch = vi.fn();

beforeEach(() => {
  aiComplete.mockReset();
  realFetch.mockReset().mockResolvedValue(new Response("real", { status: 200 }));
  vi.stubGlobal("fetch", realFetch);
});

describe("claudeFetch", () => {
  it("answers a plain-text request from the cascade, in Anthropic's response shape", async () => {
    aiComplete.mockResolvedValue({ content: "hello", provider: "groq" });
    const res = await claudeFetch(URL_MSG, req({ model: "claude-x", max_tokens: 100, system: "sys", messages: [{ role: "user", content: "hi" }] }));
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.content[0]).toEqual({ type: "text", text: "hello" });
    expect(aiComplete).toHaveBeenCalledWith(expect.objectContaining({ system: "sys", premiumFirst: true, thinking: false }));
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("flattens text blocks in system and messages", async () => {
    aiComplete.mockResolvedValue({ content: "ok", provider: "p" });
    await claudeFetch(URL_MSG, req({
      system: [{ type: "text", text: "a" }, { type: "text", text: "b" }],
      messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
    }));
    expect(aiComplete).toHaveBeenCalledWith(expect.objectContaining({ system: "a\nb", messages: [{ role: "user", content: "x" }] }));
  });

  it.each([
    ["tools", { tools: [{ name: "t" }], messages: [{ role: "user", content: "x" }] }],
    ["streaming", { stream: true, messages: [{ role: "user", content: "x" }] }],
    ["images", { messages: [{ role: "user", content: [{ type: "image", source: {} }] }] }],
  ])("passes %s requests straight to the real fetch", async (_n, body) => {
    await claudeFetch(URL_MSG, req(body));
    expect(realFetch).toHaveBeenCalledTimes(1);
    expect(aiComplete).not.toHaveBeenCalled();
  });

  it("passes other Anthropic endpoints through", async () => {
    await claudeFetch("https://api.anthropic.com/v1/models", { method: "GET" });
    expect(realFetch).toHaveBeenCalledTimes(1);
  });

  it("returns an Anthropic-style 529 when every provider is down", async () => {
    aiComplete.mockRejectedValue(new Error("all down"));
    const res = await claudeFetch(URL_MSG, req({ messages: [{ role: "user", content: "x" }] }));
    expect(res.status).toBe(529);
    expect((await res.json()).error.message).toBe("all down");
  });

  it("the background variant uses the background lane", async () => {
    aiComplete.mockResolvedValue({ content: "ok", provider: "p" });
    await claudeFetchBg(URL_MSG, req({ messages: [{ role: "user", content: "x" }] }));
    expect(aiComplete).toHaveBeenCalledWith(expect.objectContaining({ premiumFirst: false }));
  });

  it("maps a thinking request to the cascade's thinking option", async () => {
    aiComplete.mockResolvedValue({ content: "ok", provider: "p" });
    await claudeFetch(URL_MSG, req({ thinking: { type: "enabled", budget_tokens: 100 }, messages: [{ role: "user", content: "x" }] }));
    expect(aiComplete).toHaveBeenCalledWith(expect.objectContaining({ thinking: true }));
  });
});

describe("claudeCreate", () => {
  it("returns an SDK-shaped message", async () => {
    aiComplete.mockResolvedValue({ content: "done", provider: "gemini" });
    const m = await claudeCreate({ model: "m", max_tokens: 10, messages: [{ role: "user", content: "q" }] });
    expect(m.content[0].text).toBe("done");
    expect(m.role).toBe("assistant");
  });

  it("refuses requests the cascade cannot serve instead of silently dropping them", async () => {
    await expect(claudeCreate({ tools: [{}], messages: [{ role: "user", content: "q" }] })).rejects.toThrow(/cannot serve/);
  });

  it("the background variant uses the background lane", async () => {
    aiComplete.mockResolvedValue({ content: "ok", provider: "p" });
    await claudeCreateBg({ messages: [{ role: "user", content: "q" }] });
    expect(aiComplete).toHaveBeenCalledWith(expect.objectContaining({ premiumFirst: false }));
  });
});
