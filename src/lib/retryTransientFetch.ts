// Android/Capacitor's WebView can resume from a long background suspend
// before the OS network stack is actually reachable again -- the first
// request thrown at it after resume fails with a plain "Failed to fetch"
// that has nothing to do with the request itself. Shared by AuthContext,
// the login form, and the data hooks so every read on the "just resumed"
// path gets the same bounded retry instead of surfacing a spurious error
// or silently sitting on stale/empty state.
export function isTransientFetchError(e: unknown): boolean {
  const err = e as { message?: string; name?: string } | null | undefined;
  return /failed to fetch|network/i.test(err?.message ?? "") || err?.name === "AuthRetryableFetchError";
}

export async function withTransientRetry<T>(
  fn: () => PromiseLike<T>,
  retriesLeft = 3,
  delayMs = 800
): Promise<T> {
  try {
    const result = await fn();
    if (result && (result as { error?: unknown }).error && retriesLeft > 0 && isTransientFetchError((result as { error?: unknown }).error)) {
      await new Promise((r) => setTimeout(r, delayMs));
      return withTransientRetry(fn, retriesLeft - 1, delayMs * 2);
    }
    return result;
  } catch (e) {
    if (retriesLeft <= 0 || !isTransientFetchError(e)) throw e;
    await new Promise((r) => setTimeout(r, delayMs));
    return withTransientRetry(fn, retriesLeft - 1, delayMs * 2);
  }
}
