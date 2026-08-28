// The guard's job is to turn "blank page after a deploy" into one automatic
// reload. Its anti-job is to never become a reload loop — a page that
// reloads forever is strictly worse than one that shows an error, so most of
// what is pinned here is restraint rather than action.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isChunkLoadError,
  shouldReload,
  installChunkReloadGuard,
  COOLDOWN_MS,
} from "../chunkReloadGuard";

describe("isChunkLoadError", () => {
  it("matches how each engine words a missing lazy chunk", () => {
    // All four are real strings from real engines; a guard that only knew
    // Chrome's wording would silently do nothing for Firefox and Safari users.
    for (const message of [
      "Failed to fetch dynamically imported module: https://app/assets/QuestsPage-a1b2c3.js",
      "error loading dynamically imported module: https://app/assets/VaultPage-d4e5f6.js",
      "Importing a module script failed.",
      "Unable to preload CSS for /assets/index-9f8e7d.css",
    ]) {
      expect(isChunkLoadError(new Error(message)), message).toBe(true);
    }
  });

  it("accepts a bare string reason", () => {
    // Not every rejection carries an Error.
    expect(isChunkLoadError("Failed to fetch dynamically imported module: /x.js")).toBe(true);
  });

  it("ignores ordinary network and app errors", () => {
    // The expensive mistake: reloading the page over a transient fetch
    // failure would throw away unsaved UI state, and withTransientRetry
    // already handles that case properly.
    for (const reason of [
      new Error("Failed to fetch"),
      new Error("NetworkError when attempting to fetch resource."),
      new Error("supabase: JWT expired"),
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isChunkLoadError(reason), String(reason)).toBe(false);
    }
  });
});

describe("shouldReload", () => {
  const now = 1_000_000;

  it("reloads the first time", () => {
    expect(shouldReload({ now, lastReloadAt: 0, online: true })).toBe(true);
  });

  it("does not reload again inside the cooldown", () => {
    // This is the loop guard. Without it, a genuinely missing chunk makes
    // the page reload, fail, reload, forever.
    expect(shouldReload({ now, lastReloadAt: now - 1, online: true })).toBe(false);
    expect(shouldReload({ now, lastReloadAt: now - (COOLDOWN_MS - 1), online: true })).toBe(false);
  });

  it("reloads again once the cooldown has passed", () => {
    // A second deploy hours later must still self-heal.
    expect(shouldReload({ now, lastReloadAt: now - COOLDOWN_MS, online: true })).toBe(true);
  });

  it("never reloads while offline", () => {
    // Offline, the import fails for an unrelated reason and a reload just
    // swaps a partly-working app for the service worker's offline shell.
    expect(shouldReload({ now, lastReloadAt: 0, online: false })).toBe(false);
  });

  it("treats unusable stored values as never-reloaded", () => {
    // sessionStorage returning junk must fail toward self-healing, not
    // toward a permanently disabled guard.
    expect(shouldReload({ now, lastReloadAt: NaN, online: true })).toBe(true);
  });
});

describe("installChunkReloadGuard", () => {
  let reload: ReturnType<typeof vi.fn>;
  let store: Record<string, string>;
  let win: any;

  beforeEach(() => {
    reload = vi.fn();
    store = {};
    const listeners: Record<string, Array<(e: any) => void>> = {};
    win = {
      addEventListener: (type: string, fn: (e: any) => void) => {
        (listeners[type] ??= []).push(fn);
      },
      dispatch: (type: string, event: any) => (listeners[type] ?? []).forEach((fn) => fn(event)),
      location: { reload },
      navigator: { onLine: true },
      sessionStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
      },
    };
    installChunkReloadGuard(win);
  });

  const chunkError = () =>
    new Error("Failed to fetch dynamically imported module: /assets/VaultPage-abc.js");

  it("reloads on an unhandled dynamic-import rejection", () => {
    const event = { reason: chunkError(), preventDefault: vi.fn() };
    win.dispatch("unhandledrejection", event);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("reloads on Vite's own preloadError", () => {
    const event = { payload: chunkError(), preventDefault: vi.fn() };
    win.dispatch("vite:preloadError", event);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads exactly once across a burst of failures", () => {
    // A single navigation can fail several imports at once (route chunk plus
    // its CSS plus a shared vendor chunk). That is one problem, not four.
    for (let i = 0; i < 4; i++) {
      win.dispatch("unhandledrejection", { reason: chunkError(), preventDefault: vi.fn() });
    }
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("leaves unrelated rejections alone", () => {
    const event = { reason: new Error("Failed to fetch"), preventDefault: vi.fn() };
    win.dispatch("unhandledrejection", event);
    expect(reload).not.toHaveBeenCalled();
    // Must not swallow an error it is not handling — the ErrorBoundary and
    // Sentry still need to see it.
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not reload when offline", () => {
    win.navigator.onLine = false;
    win.dispatch("unhandledrejection", { reason: chunkError(), preventDefault: vi.fn() });
    expect(reload).not.toHaveBeenCalled();
  });

  it("survives sessionStorage throwing", () => {
    // Safari private mode. The guard must still work, not crash startup.
    const throwing = { ...win, sessionStorage: undefined as any };
    Object.defineProperty(throwing, "sessionStorage", {
      get() { throw new Error("SecurityError"); },
    });
    const listeners: Record<string, Array<(e: any) => void>> = {};
    throwing.addEventListener = (t: string, fn: (e: any) => void) => { (listeners[t] ??= []).push(fn); };
    const reload2 = vi.fn();
    throwing.location = { reload: reload2 };
    installChunkReloadGuard(throwing);
    expect(() =>
      (listeners["unhandledrejection"] ?? []).forEach((fn) =>
        fn({ reason: chunkError(), preventDefault: vi.fn() }),
      ),
    ).not.toThrow();
    expect(reload2).toHaveBeenCalledTimes(1);
  });
});
