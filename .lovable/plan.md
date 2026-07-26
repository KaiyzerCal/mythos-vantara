# MAVIS Full-Sweep — Remaining Work

## What we just shipped
- **Autonomy Orchestrator** page (`/autonomy`) + edge function are live and wired into the sidebar.
- **Gallery** handoff: images can be seeded into the video generator.
- **Inbox** gained a Gmail/Messages tab with unread badges and read-state sync.
- Build passes and the preview is clean.

## What still needs to be done

### 1. Complete UX polish across the highest-traffic surfaces

Finish adopting the `LoadingState` / `ErrorState` / `EmptyState` primitives that were started in AutonomyPage, Gallery, and Inbox.

Pages to fix:
- **`src/pages/MavisChat.tsx`** — replace bare spinners (e.g. initial load, attachment upload, mode switching); add a non-blocking error state when the stream fails; ensure the "thinking" UI is consistent.
- **`src/pages/PersonasPage.tsx`** — replace `Loader2` / `isForging` inline spinners with `LoadingState`; add `EmptyState` when no personas exist; add `ErrorState` when persona fetch fails.
- **`src/pages/FeaturePages.tsx` (CouncilsPage)** — replace bare `Loader2` spinners with `LoadingState`; add empty/error states for member list and council messages.
- **`src/pages/Dashboard.tsx`** — replace the `<div className="animate-pulse text-muted-foreground font-mono text-sm">Loading...</div>` placeholder with `LoadingState`; ensure the skeleton cards are replaced by the `LoadingState` primitive during the heavy initial load.
- **`src/pages/IntelligencePage.tsx`** — replace inline `Loader2` usage in each panel with `LoadingState`; add `ErrorState` panels for failed tab loads.

Deliverable: every major page has a single consistent loading, empty, and error experience.

### 2. Fix light-mode readability issues

The codebase still contains hardcoded dark values that render invisible text when the app is toggled to light mode.

Sweep targets:
- **`src/pages/IntelligencePage.tsx`** — remove `bg-zinc-900/60`, `text-zinc-400`, `text-white`, `text-zinc-300`, `bg-zinc-700/50`, `border-zinc-700/50`, etc. Replace with semantic tokens: `bg-card`, `text-card-foreground`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted`.
- **`src/pages/MavisChat.tsx`** — audit message bubbles, code blocks, and attachment UI for hardcoded `text-white` or `bg-[#...]` that breaks light mode.
- **`src/pages/PersonasPage.tsx`** — verify the persona cards and chat UI use `text-foreground` / `bg-card` instead of hardcoded darks.
- **`src/index.css`** — search for any remaining `text-white` or literal dark hex values that should be theme tokens.

Deliverable: no invisible text in light mode across the five pages above.

### 3. Add real-time subscriptions to live data surfaces

Several pages load data once but do not reflect backend changes until the user manually refreshes.

Add Supabase realtime subscriptions:
- **`mavis_autonomous_runs` / `mavis_plans` / `mavis_plan_steps` / `mavis_action_queue`** in `AutonomyPage` — auto-refresh when a plan or step changes.
- **`mavis_activities`** in `AgentConsolePage` / `AgentDashboardPage` — live activity feed.
- **`persona_conversations`** in `PersonasPage` — live persona chat updates.
- **`gmail_messages`** in `Inbox` messages tab — new emails appear automatically.

Deliverable: the listed pages update within seconds of backend changes without a manual refresh.

### 4. Wire Autonomy Orchestrator into MavisChat

The new orchestrator should be reachable from the main chat so the user can delegate goals conversationally.

Actions:
- In `MavisChat`, add a quick action chip or slash command (`/autonomy <goal>`) that calls `mavis-autonomy-orchestrator` with `{ action: "plan", goal: ... }`.
- Surface the created plan ID and a link to `/autonomy` in the assistant response.
- If the agent-mode action executor detects a `create_plan` intent, route it to the orchestrator instead of returning an error.

Deliverable: users can turn a chat goal into a tracked autonomous plan in one click.

### 5. End-to-end verification and deploy

- Run a full `bun run build`.
- Run the typecheck guard (`tsgo` or `tsc --noEmit`).
- Verify the `/autonomy` route loads, creates a plan, and shows steps in the preview.
- Deploy any changed edge functions.
- Update `journal.md` with the completed track entries.

## Explicit non-goals
- No new backend migrations unless a schema gap is discovered during verification.
- No NSFW capability (previously declined; stays declined).
- No rewrite of `mavis-autonomous-engine` — the orchestrator wraps it.

## Order of work
1. Light-mode color sweep (IntelligencePage is the worst offender; fixing it first removes the biggest class of bugs).
2. UX polish sweep (parallel per page: MavisChat, PersonasPage, CouncilsPage, Dashboard, IntelligencePage).
3. Real-time subscriptions (page-by-page after their polish is done).
4. Autonomy ↔ MavisChat wiring.
5. Verification, build, deploy.