// Baseline coverage for useDataHooks.ts's generic makeHook() — the CRUD
// contract ~15 other hooks (tasks, journal, vault, inventory, store,
// currencies, ...) all inherit, so a regression here ripples across most
// of the app's pages at once. Exercised through useInventory as a
// representative concrete hook, plus useCurrencies for its bespoke spend()
// logic (real balance-checking behind the Store's purchase flow).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { AUTH_SESSION_FIXTURE } from "@/test/supabaseMock";

// vi.mock factories are hoisted above imports, so the mocked values must be
// declared via vi.hoisted() to exist by the time the factory below runs.
const { fromMock, queueChain } = vi.hoisted(() => {
  function makeChain(result: { data?: unknown; error?: unknown }) {
    const resolved = Promise.resolve(result);
    const chain: any = {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      upsert: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      ilike: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      single: vi.fn(() => resolved),
      maybeSingle: vi.fn(() => resolved),
      then: (onFulfilled: any, onRejected?: any) => resolved.then(onFulfilled, onRejected),
    };
    return chain;
  }
  const from = vi.fn();
  return {
    fromMock: from,
    queueChain: (result: { data?: unknown; error?: unknown }) => {
      const chain = makeChain(result);
      from.mockImplementationOnce(() => chain);
      return chain;
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: AUTH_SESSION_FIXTURE.user, session: null as null, loading: false, signOut: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useInventory, useCurrencies } from "@/hooks/useDataHooks";
import { toast } from "sonner";

beforeEach(() => {
  fromMock.mockReset();
});

describe("makeHook generic CRUD contract (via useInventory)", () => {
  it("fetches on mount and exposes the rows", async () => {
    const row = { id: "i1", name: "Sword", user_id: AUTH_SESSION_FIXTURE.user.id };
    queueChain({ data: [row], error: null });

    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual([row]);
    expect(fromMock).toHaveBeenCalledWith("inventory");
  });

  it("create() prepends the new row and stamps user_id", async () => {
    queueChain({ data: [], error: null }); // initial fetch
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const newRow = { id: "i2", name: "Shield", user_id: AUTH_SESSION_FIXTURE.user.id };
    const chain = queueChain({ data: newRow, error: null });

    await act(async () => {
      await result.current.create({ name: "Shield" } as any);
    });

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Shield", user_id: AUTH_SESSION_FIXTURE.user.id })
    );
    expect(result.current.data[0]).toEqual(newRow);
  });

  it("update() applies optimistically and stays applied on success", async () => {
    const row = { id: "i1", name: "Sword", is_equipped: false, user_id: AUTH_SESSION_FIXTURE.user.id };
    queueChain({ data: [row], error: null });
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.loading).toBe(false));

    queueChain({ data: null, error: null });
    await act(async () => {
      await result.current.update("i1", { is_equipped: true } as any);
    });

    expect(result.current.data[0].is_equipped).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("update() rolls back and refetches on failure", async () => {
    const row = { id: "i1", name: "Sword", is_equipped: false, user_id: AUTH_SESSION_FIXTURE.user.id };
    queueChain({ data: [row], error: null }); // initial fetch
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.loading).toBe(false));

    queueChain({ data: null, error: { message: "boom" } }); // failed update
    queueChain({ data: [row], error: null }); // rollback refetch
    await act(async () => {
      await result.current.update("i1", { is_equipped: true } as any);
    });

    expect(toast.error).toHaveBeenCalled();
    // Rollback refetch restored the pre-update row.
    expect(result.current.data[0].is_equipped).toBe(false);
  });

  it("remove() drops the row optimistically and stays gone on success", async () => {
    const row = { id: "i1", name: "Sword", user_id: AUTH_SESSION_FIXTURE.user.id };
    queueChain({ data: [row], error: null });
    const { result } = renderHook(() => useInventory());
    await waitFor(() => expect(result.current.loading).toBe(false));

    queueChain({ data: null, error: null });
    await act(async () => {
      await result.current.remove("i1");
    });

    expect(result.current.data).toEqual([]);
  });
});

describe("useCurrencies().spend — the real gate behind Store purchases", () => {
  it("refuses a purchase when the balance is insufficient, without writing anything", async () => {
    queueChain({ data: [], error: null }); // initial fetch
    const { result } = renderHook(() => useCurrencies());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const selectChain = queueChain({ data: { id: "c1", amount: 50 }, error: null });

    let spendResult: { ok: boolean; balance: number } | undefined;
    await act(async () => {
      spendResult = await result.current.spend("Codex Points", 100);
    });

    expect(spendResult).toEqual({ ok: false, balance: 50 });
    expect(selectChain.ilike).toHaveBeenCalledWith("name", "Codex Points");
    // Only the balance check ran — no update call was queued/consumed.
    expect(fromMock).toHaveBeenCalledTimes(2); // initial fetch + balance check
  });

  it("treats a currency that was never funded as a zero balance", async () => {
    queueChain({ data: [], error: null });
    const { result } = renderHook(() => useCurrencies());
    await waitFor(() => expect(result.current.loading).toBe(false));

    queueChain({ data: null, error: null }); // maybeSingle finds nothing

    let spendResult: { ok: boolean; balance: number } | undefined;
    await act(async () => {
      spendResult = await result.current.spend("Gil", 1);
    });

    expect(spendResult).toEqual({ ok: false, balance: 0 });
  });

  it("deducts on success and updates local state to the new balance", async () => {
    queueChain({ data: [{ id: "c1", name: "Codex Points", amount: 200, user_id: AUTH_SESSION_FIXTURE.user.id }], error: null });
    const { result } = renderHook(() => useCurrencies());
    await waitFor(() => expect(result.current.loading).toBe(false));

    queueChain({ data: { id: "c1", amount: 200 }, error: null }); // balance check
    const updateChain = queueChain({ data: null, error: null }); // deduction

    let spendResult: { ok: boolean; balance: number } | undefined;
    await act(async () => {
      spendResult = await result.current.spend("codex points", 75); // case-insensitive
    });

    expect(spendResult).toEqual({ ok: true, balance: 125 });
    expect(updateChain.update).toHaveBeenCalledWith({ amount: 125 });
    expect(result.current.data.find((c) => c.id === "c1")?.amount).toBe(125);
  });
});
