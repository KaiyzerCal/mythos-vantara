# MAVIS Full-Sweep Build

Three tracks, executed end-to-end.

---

## Track 1 — UX polish sweep

Adopt `LoadingState` / `ErrorState` / `EmptyState` across the highest-traffic surfaces and fix any lingering light-mode readability.

Surfaces to touch:
- `src/pages/MavisChat.tsx` — replace bare spinners; error state when stream fails; light-mode text check.
- `src/pages/PersonasPage.tsx` — loading, empty (no personas), error (fetch failed).
- `src/pages/CouncilPage.tsx` — loading + empty for members/messages.
- `src/pages/Inbox.tsx` — already partly done; audit approvals/tasks empty states.
- `src/pages/IntelligencePage.tsx` — loading states.
- `src/pages/Dashboard.tsx` — loading skeleton.
- `src/index.css` — sweep for any `text-white` / hardcoded darks that break in light mode.

Deliverable: consistent loading/empty/error primitives, no invisible text in light mode.

---

## Track 2 — Wire the 6 static-ish pages

For each, verify what already exists and finish the gap.

| Page | Action |
|---|---|
| `AgentConsolePage` | Confirm live agent activity feed (mavis_activities); add empty/error states. |
| `AlliesAndStore` | Note: memory says "Allies removed"; will confirm and either hide or repurpose as Store-only. |
| `BpmPage` | Wire `bpm_sessions` history + start/stop control. |
| `CharacterPage` | Surface RPG stats from `profiles` + `skills` + `quests`. |
| `MyAgents` | List `mavis_letta_agents` + `customer_agents` with create/delete. |
| `RankingsPage` | Load `rankings_profiles` leaderboard. |

For any page whose scope isn't clear, I'll build the minimum meaningful data view and note follow-ups in the summary.

---

## Track 3 — Autonomy Orchestrator

New unified control surface for the existing autonomy stack.

**Frontend:** `src/pages/AutonomyPage.tsx` (route `/autonomy`, sidebar entry)
- Live view of `mavis_autonomous_runs`, `mavis_plans` + `mavis_plan_steps`, `mavis_action_queue`.
- Goal input → creates a plan via edge function.
- Per-run timeline: goal → plan → steps → actions → outcomes.
- Manual "Run cycle now" button.

**Backend:** `supabase/functions/mavis-autonomy-orchestrator/index.ts`
- POST `{ goal }` → creates row in `mavis_plans`, invokes `mavis-autonomous-engine` for planning, queues resulting steps into `mavis_action_queue`.
- GET → returns recent runs + active plans + queued actions for the current user.
- Wraps (does not replace) `mavis-autonomous-engine` / `mavis-autonomous-runner` / `mavis-crew-orchestrator`.

**Migration (if needed):** add `goal` + `status` columns to `mavis_autonomous_runs` only if missing after schema check. Will run schema check first in build mode; migration only if a column is genuinely absent.

---

## Order of execution

1. Schema check on autonomy tables (read-only, no migration unless needed).
2. Track 1 UX polish (parallel file edits).
3. Track 2 page wiring (parallel file edits per page).
4. Track 3 orchestrator: edge function + page + sidebar entry.
5. Deploy new/changed edge functions.
6. Typecheck; report per-page status and any pages that need product decisions rather than more code.

## Explicit non-goals

- No NSFW capability (previously declined; stays declined).
- Won't rebuild `mavis-autonomous-engine` — orchestrator wraps it.
- Won't touch `supabase/migrations/` unless a column is genuinely missing.
- Won't re-add "Tasks & Habits" or "Allies" as first-class navigation (per memory).
