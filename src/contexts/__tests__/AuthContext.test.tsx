// Regression cover for a real "app state" bug: supabase-js hands back a
// freshly-constructed session (and therefore a new `user` object) on every
// TOKEN_REFRESHED event and on every native foreground resume, whether or
// not anything about the signed-in user actually changed. AuthContext used
// to pass `session?.user ?? null` straight into an unmemoized provider
// value, so every one of those refreshes gave `user` a new identity.
//
// Every one of useDataHooks.ts's ~17 CRUD hooks depends on `user` in its own
// fetch useCallback, and AppDataContext's realtime subscription effect
// depends on ~16 of their `refetch` functions. A new `user` identity cascaded
// through all of it: every hook's initial-load effect re-fired (17 refetches
// of tables already loaded) and the entire Supabase realtime channel tore
// down and rebuilt — on every resume, not just sign-in or sign-out. That is
// the mechanism behind "freezing or slow when loading a page": reopening the
// app (or just waiting past a token's ~hourly refresh) reloaded everything.
//
// This test drives AuthProvider through the actual sequence — two
// TOKEN_REFRESHED-shaped events for the same user, then a real user change —
// and asserts on `user`'s object identity, which is what every downstream
// hook's dependency array actually checks. A textual/regex test can pin the
// presence of a useMemo call; it can't verify the memo produces the right
// answer across renders, which is the part that was actually broken.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "../AuthContext";

const h = vi.hoisted(() => {
  let authCallback: ((event: string, session: any) => void) | null = null;
  return {
    getAuthCallback: () => authCallback,
    onAuthStateChange: vi.fn((cb: (event: string, session: any) => void) => {
      authCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    // Never resolves: AuthProvider also calls getSession() directly at
    // mount (belt-and-suspenders alongside onAuthStateChange), and letting
    // that resolve asynchronously races with the events this test drives
    // through the captured onAuthStateChange callback below — it can
    // resolve on a later microtask and stomp a session these tests just
    // set. Driving everything through one path keeps the test deterministic.
    getSession: vi.fn(() => new Promise(() => {})),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: h.onAuthStateChange,
      getSession: h.getSession,
      startAutoRefresh: vi.fn(),
      stopAutoRefresh: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock("@capacitor/app", () => ({
  App: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) },
}));

/** A fresh object every call, the way a real token-refresh response is. */
function sessionFor(userId: string): any {
  return { access_token: `token-${Math.random()}`, user: { id: userId } };
}

let renders: Array<{ user: unknown }> = [];
function Probe() {
  const { user } = useAuth();
  renders.push({ user });
  return <div data-testid="uid">{(user as any)?.id ?? "none"}</div>;
}

beforeEach(() => {
  renders = [];
  h.onAuthStateChange.mockClear();
});

describe("AuthContext: user identity survives a same-user session refresh", () => {
  it("keeps the same user object across two TOKEN_REFRESHED-shaped events for one user", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    const cb = h.getAuthCallback();
    expect(cb, "AuthProvider never called onAuthStateChange").not.toBeNull();

    await act(async () => cb!("SIGNED_IN", sessionFor("u1")));
    const firstUser = renders.at(-1)!.user;
    expect((firstUser as any)?.id).toBe("u1");

    // A brand-new session object, same user — exactly what TOKEN_REFRESHED
    // and the native resume path both hand back.
    await act(async () => cb!("TOKEN_REFRESHED", sessionFor("u1")));
    const secondUser = renders.at(-1)!.user;

    expect(secondUser, "a same-user refresh must not hand every dependent hook a new user reference")
      .toBe(firstUser);
  });

  it("still produces a new user reference on an actual user change", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    const cb = h.getAuthCallback()!;

    await act(async () => cb("SIGNED_IN", sessionFor("u1")));
    const u1 = renders.at(-1)!.user;

    await act(async () => cb("SIGNED_IN", sessionFor("u2")));
    const u2 = renders.at(-1)!.user;

    // The memo must track real changes, not just freeze forever — a stale
    // `user` across an actual account switch would be its own bug.
    expect(u2).not.toBe(u1);
    expect((u2 as any)?.id).toBe("u2");
  });

  it("goes to null, not a stale user, on sign-out", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    const cb = h.getAuthCallback()!;

    await act(async () => cb("SIGNED_IN", sessionFor("u1")));
    expect(screen.getByTestId("uid").textContent).toBe("u1");

    await act(async () => cb("SIGNED_OUT", null));
    expect(screen.getByTestId("uid").textContent).toBe("none");
  });
});
