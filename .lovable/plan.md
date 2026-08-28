# Make app data load reliably on page loads

## What I checked

- `AppDataProvider` is mounted once at the root of `src/App.tsx`, wrapping all routes.
- Every table hook in `src/hooks/useDataHooks.ts` fetches **once on mount**. Because the provider never unmounts during navigation, opening a different page does not trigger any fetch.
- Refetches today happen in only three places: a realtime change event, a `visibilitychange` resume (throttled 10s), or an explicit `refetchAll()` call.
- In `makeHook`, `fetch()` returns early when `user` is null and `loading` is never set to `false` in that path; the same is true in `useProfile`. If a fetch errors, `loading` does flip but the list silently stays empty with no retry and no error surface.

So: if the initial boot fetch happens before auth settles, is thrown away, or errors, a page opened later shows empty/spinning forever — nothing re-requests it.

## Fix

1. **Track freshness per table.** Store a `lastFetchedAt` and a `status` (`idle | loading | ready | error`) alongside the data in `makeHook` and `useProfile`.
2. **Refetch stale data on route change.** Add a small hook the layout calls on navigation that asks the provider to refresh any section older than a threshold (e.g. 60s) or in `error`/`idle` state. Fetches stay deduped by the existing `inflight` guard, so a fast tab-switch costs nothing.
3. **Never strand a hook.** When `user` is null, set `loading` false and mark status `idle`; when auth resolves to a real user, kick the fetch. On error, mark `error` and keep the previous data instead of leaving a permanent blank.
4. **Surface it.** Pages already render off `loading`; where a section is in `error`, show the existing `ErrorState` with a Retry that calls that section's `refetch`, instead of an empty list that looks like "no data".
5. **Verify** in the running preview: load the app, navigate across Quests / Inventory / Vault / Council, and confirm each populates, plus a forced-error case recovers via Retry.

## Scope

Frontend only — `src/hooks/useDataHooks.ts`, `src/hooks/useProfile.ts`, `src/contexts/AppDataContext.tsx`, and the layout that triggers the route-change refresh. No schema, edge function, or backend changes.
