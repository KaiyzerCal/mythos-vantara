# Make app data load reliably on page open

## What's happening today

All app data (quests, tasks, journal, vault, councils, inventory, etc.) is fetched once by `AppDataProvider` when the app boots. Individual pages never fetch anything themselves — they just read whatever the provider already has. So:

- If the boot fetch happens before or without a signed-in user, the hooks return early and their `loading` flag stays `true` forever — pages sit on a skeleton with no error and no retry.
- If the boot fetch fails (network hiccup, cold start, backend blip), nothing ever retries. Opening a page later shows stale or empty data until a full app reload.
- Heavier tables (vault, councils, transformations) are deliberately deferred to after first paint; if that idle callback is cancelled by a remount, they can be left unfetched.

Note: I have not yet reproduced the exact failure you're seeing in the running app, so step 1 below is to confirm which of these is firing before changing behavior.

## Plan

1. **Confirm the failure.** Load the preview signed in, watch the network and console for each table query, and record which hooks never resolve (still `loading`) and which return errors. This decides whether the cause is the auth gate, a failed fetch, or the deferred scheduling.

2. **Never leave a hook stuck loading.** In the shared `makeHook` factory plus `useProfile`, `useQuests`, `useEnergySystems`, and `useCurrencies`: when there is no user, clear `loading` and empty the data instead of returning early. When a fetch errors, clear `loading` and record the error so the UI can show a retry state rather than an endless skeleton.

3. **Expose and surface errors.** Return an `error` alongside `data`/`loading` from the data hooks and thread it through `AppDataContext`, so pages can render the existing `ErrorState` with a retry button instead of a blank list.

4. **Refresh on page open.** Add a lightweight staleness check in the provider: when a route changes, refetch only the sections that route depends on if their last successful fetch is older than a short window (about 30s). Reuses the existing `refreshSections` + section map, so it stays one or two queries per navigation, not seventeen.

5. **Retry the boot fetch once on failure.** If a table's initial fetch fails, schedule a single delayed retry rather than waiting for the user to reload the app.

6. **Verify.** Re-run the preview check from step 1: every section resolves, a forced failure shows a retry state instead of a permanent skeleton, and navigating between pages refreshes stale sections without a burst of duplicate queries.

## Technical notes

- Files touched: `src/hooks/useDataHooks.ts`, `src/hooks/useProfile.ts`, `src/hooks/useQuests.ts`, `src/contexts/AppDataContext.tsx`, and the shared `ErrorState`/`LoadingState` usage in affected pages.
- No schema, RLS, or edge-function changes. Existing realtime subscriptions, the 250ms debounce, and the in-flight dedupe stay as they are.
- The route-driven refresh uses the existing `Section` map in `src/mavis/refreshContract.ts`; no new fetch paths are introduced.
