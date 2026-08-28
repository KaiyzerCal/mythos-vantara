// Self-heal a page whose lazy route chunks no longer exist on the server.
//
// Every route in App.tsx is `lazy(() => import(...))`, so each page is a
// separate content-hashed chunk. When a new build is published, the old
// chunk filenames stop existing — but a tab that was already open still
// holds the previous index.html and will ask for those dead filenames the
// next time the user navigates. The dynamic import rejects, Suspense never
// resolves, and the user gets a shell with no page content: "the app isn't
// loading data on the pages".
//
// A reload fixes it, because the service worker serves navigations
// network-first (see public/sw.js) — so index.html comes back fresh with
// the new chunk names. This just does that reload automatically instead of
// leaving the user staring at a broken page.
//
// The hard requirement is that this can never become a reload loop. If the
// chunk is genuinely gone (a bad deploy, a truncated upload) then reloading
// does not help, and a page that reloads forever is far worse than one that
// shows an error. Hence the cooldown: at most one reload per COOLDOWN_MS.
// In the real deploy case that means exactly one; in the broken case it
// means one, then the error surfaces to the ErrorBoundary as it would have
// anyway.

/** Reload at most this often. One deploy needs one reload; a loop needs none. */
export const COOLDOWN_MS = 60_000;

const STORAGE_KEY = "vantara:last-chunk-reload";

/**
 * Does this rejection look like a lazy chunk that isn't on the server?
 *
 * Matched by message rather than error type because every engine words it
 * differently and none of them use a distinguishable class:
 *   Chrome/Edge  "Failed to fetch dynamically imported module: …"
 *   Firefox      "error loading dynamically imported module: …"
 *   Safari       "Importing a module script failed."
 * Vite's own preload failure adds "Unable to preload CSS for …".
 *
 * Deliberately narrow. A generic network blip must NOT match — that is what
 * withTransientRetry is for, and reloading the page over one would throw
 * away unsaved UI state for no reason.
 */
export function isChunkLoadError(reason: unknown): boolean {
  const message =
    typeof reason === "string"
      ? reason
      : (reason as { message?: unknown } | null | undefined)?.message;
  if (typeof message !== "string") return false;

  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    /unable to preload css/i.test(message)
  );
}

export interface ReloadDecision {
  now: number;
  /** Value previously stored by this guard; NaN/0 when never reloaded. */
  lastReloadAt: number;
  online: boolean;
}

/**
 * Whether to reload right now.
 *
 * Offline is excluded on purpose: with no network the import fails for a
 * completely different reason, and reloading an offline user swaps a
 * partially-working app for the service worker's offline shell. Better to
 * let the ErrorBoundary show something and let them retry when they have
 * signal.
 */
export function shouldReload({ now, lastReloadAt, online }: ReloadDecision): boolean {
  if (!online) return false;
  if (!Number.isFinite(lastReloadAt) || lastReloadAt <= 0) return true;
  return now - lastReloadAt >= COOLDOWN_MS;
}

function readLastReload(storage: Storage | undefined): number {
  try {
    return Number(storage?.getItem(STORAGE_KEY) ?? 0);
  } catch {
    // Safari private mode throws on sessionStorage access. Treating that as
    // "never reloaded" is the right failure direction: the first chunk error
    // still self-heals, and the cooldown simply cannot be enforced — which
    // is bounded anyway, because a reload that fixes nothing lands on a page
    // the user then has to navigate again to re-trigger.
    return 0;
  }
}

function markReloaded(storage: Storage | undefined, now: number): void {
  try {
    storage?.setItem(STORAGE_KEY, String(now));
  } catch {
    /* see readLastReload */
  }
}

/**
 * Wire the guard to the window. Safe to call once at startup.
 *
 * Two listeners because the failure surfaces two different ways: Vite emits
 * `vite:preloadError` when its own preload helper fails, and a bare
 * `import()` that rejects with nothing catching it arrives as an
 * `unhandledrejection`.
 */
export function installChunkReloadGuard(win: Window = window): void {
  const handle = (reason: unknown, event?: Event): void => {
    if (!isChunkLoadError(reason)) return;

    const now = Date.now();
    const storage = (() => {
      try {
        return win.sessionStorage;
      } catch {
        return undefined;
      }
    })();

    if (!shouldReload({ now, lastReloadAt: readLastReload(storage), online: win.navigator.onLine })) {
      // Let it through to the ErrorBoundary — we have already tried a reload
      // and it did not help, so this is a real failure worth showing.
      return;
    }

    // Only suppress the default once we have actually decided to act on it.
    event?.preventDefault();
    markReloaded(storage, now);
    win.location.reload();
  };

  win.addEventListener("vite:preloadError", (event) => {
    handle((event as Event & { payload?: unknown }).payload, event);
  });

  win.addEventListener("unhandledrejection", (event) => {
    handle((event as PromiseRejectionEvent).reason, event);
  });
}
