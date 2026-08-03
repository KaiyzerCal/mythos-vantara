// Baseline coverage for useMavisActionHandlers — the single registration
// site MavisChat.tsx and MavisDemo.tsx both call (extracted after the two
// pages' independent copies drifted twice: composio_action went missing
// from one, then spotify_*/terminal_exec went missing from the other,
// each time silently failing a real user action with "unknown action
// type"). This test locks in exactly which action types register and
// what each handler actually does, scoped to registration + handler-body
// correctness — dispatch/classification itself already has its own
// thorough suite in actionExecutor.test.ts and is deliberately not
// re-tested here.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { AUTH_SESSION_FIXTURE } from "@/test/supabaseMock";

const { registered, defaultHandlerRef, invokeMock, sessionMock, fromInsertMock } = vi.hoisted(() => ({
  registered: new Map<string, (payload: Record<string, unknown>) => unknown>(),
  defaultHandlerRef: { current: null as ((payload: Record<string, unknown>) => unknown) | null },
  invokeMock: vi.fn(),
  sessionMock: vi.fn(),
  fromInsertMock: vi.fn(),
}));

vi.mock("@/mavis/actionExecutor", () => ({
  registerActionHandler: (type: string, handler: (payload: Record<string, unknown>) => unknown) => {
    registered.set(type, handler);
  },
  setDefaultHandler: (handler: (payload: Record<string, unknown>) => unknown) => {
    defaultHandlerRef.current = handler;
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: sessionMock },
    functions: { invoke: invokeMock },
    from: () => ({ insert: fromInsertMock, upsert: fromInsertMock }),
  },
}));

import { useMavisActionHandlers } from "@/mavis/useMavisActionHandlers";

const SPOTIFY_ACTIONS = [
  "spotify_play", "spotify_pause", "spotify_skip", "spotify_previous",
  "spotify_volume", "spotify_shuffle", "spotify_now_playing",
];
const PLAN_ACTIONS = [
  "generate_plan", "create_plan", "get_plans", "get_plan", "update_plan",
  "advance_step", "update_session", "complete_plan", "delete_plan",
];
const CHAIN_ACTIONS = [
  "auto_link_quest_chains", "auto_link_skill_chains", "get_quest_chains", "get_skill_chains",
  "create_quest_chain", "create_skill_chain", "update_quest_chain", "update_skill_chain",
  "delete_quest_chain", "delete_skill_chain", "add_quest_to_chain", "add_skill_to_chain", "remove_from_chain",
];
const SIGNAL_ACTIONS = ["get_signal_configs", "upsert_signal_config", "delete_signal_config"];

beforeEach(() => {
  registered.clear();
  defaultHandlerRef.current = null;
  invokeMock.mockReset();
  fromInsertMock.mockReset();
  sessionMock.mockReset();
  sessionMock.mockResolvedValue({ data: { session: AUTH_SESSION_FIXTURE } });
  invokeMock.mockResolvedValue({ data: {}, error: null });
  fromInsertMock.mockResolvedValue({ data: null, error: null });
});

describe("useMavisActionHandlers — registration contract", () => {
  it("registers a default handler and every documented action type", () => {
    renderHook(() => useMavisActionHandlers());

    expect(defaultHandlerRef.current).not.toBeNull();
    const expected = [
      "propose_product", "nora_tweet", "create_skill_definition", "composio_action",
      "terminal_exec", ...SPOTIFY_ACTIONS, ...PLAN_ACTIONS, ...CHAIN_ACTIONS, ...SIGNAL_ACTIONS,
    ];
    for (const type of expected) {
      expect(registered.has(type), `missing handler for "${type}"`).toBe(true);
    }
  });
});

describe("useMavisActionHandlers — handler bodies", () => {
  it("spotify_play calls mavis-spotify-control with the play action and query/type", async () => {
    renderHook(() => useMavisActionHandlers());
    await registered.get("spotify_play")!({ query: "lofi", type: "playlist" });

    expect(invokeMock).toHaveBeenCalledWith("mavis-spotify-control", {
      body: { action: "play", query: "lofi", type: "playlist" },
      headers: { Authorization: `Bearer ${AUTH_SESSION_FIXTURE.access_token}` },
    });
  });

  it("spotify_shuffle defaults enabled to true unless explicitly false", async () => {
    renderHook(() => useMavisActionHandlers());
    await registered.get("spotify_shuffle")!({});

    expect(invokeMock).toHaveBeenCalledWith("mavis-spotify-control", {
      body: { action: "shuffle", enabled: true },
      headers: expect.any(Object),
    });
  });

  it("terminal_exec passes session_id through, but omits it when 'auto'", async () => {
    renderHook(() => useMavisActionHandlers());
    await registered.get("terminal_exec")!({ command: "ls", session_id: "auto", timeout: 10 });

    expect(invokeMock).toHaveBeenCalledWith("mavis-terminal", {
      body: { action: "exec", command: "ls", session_id: undefined, timeout: 10 },
      headers: expect.any(Object),
    });
  });

  it("propose_product inserts a requires_confirmation task with the formatted price", async () => {
    renderHook(() => useMavisActionHandlers());
    await registered.get("propose_product")!({ title: "Widget", price_cents: 4900 });

    expect(fromInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "create_product",
        status: "requires_confirmation",
        description: expect.stringContaining('"Widget" — $49.00'),
      })
    );
  });

  it("routes plan/chain/signal action families to their own edge function with {userId, action, ...params}", async () => {
    renderHook(() => useMavisActionHandlers());
    await registered.get("create_plan")!({ type: "create_plan", title: "Q3 roadmap" });

    expect(invokeMock).toHaveBeenCalledWith("mavis-plans", {
      body: { userId: AUTH_SESSION_FIXTURE.user.id, action: "create_plan", title: "Q3 roadmap" },
      headers: { Authorization: `Bearer ${AUTH_SESSION_FIXTURE.access_token}` },
    });

    await registered.get("upsert_signal_config")!({ type: "upsert_signal_config", keyword: "vantara" });
    expect(invokeMock).toHaveBeenCalledWith("mavis-signal-watcher", {
      body: { userId: AUTH_SESSION_FIXTURE.user.id, action: "upsert_signal_config", keyword: "vantara" },
      headers: { Authorization: `Bearer ${AUTH_SESSION_FIXTURE.access_token}` },
    });
  });

  it("the default handler proxies to mavis-actions and surfaces per-action failures", async () => {
    invokeMock.mockResolvedValueOnce({
      data: { results: [{ type: "some_action", success: false, error: "nope" }] },
      error: null,
    });
    renderHook(() => useMavisActionHandlers());

    await expect(defaultHandlerRef.current!({ type: "some_action" })).rejects.toThrow("some_action: nope");
  });
});
