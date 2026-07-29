# Shared Source of Truth for every MAVIS chat surface

## Problem (verified)

Each chat path builds its own context independently:
- `supabase/functions/mavis-chat/index.ts` (2537 lines) builds temporal awareness at ~line 1398 with operator timezone from `profiles`, plus a world-model snapshot at ~1505.
- `supabase/functions/mavis-agent/index.ts` (3008 lines) rebuilds its own `timeFragment` at ~2862 and composes `SYSTEM_PROMPT + memory + prefs + specialist + time + settings` at ~2897.
- `supabase/functions/mavis-persona-router/index.ts` has its own `buildSystemPrompt(...) + timeBlock + appCtx + settingsBlock` at ~563.
- `supabase/functions/mavis-council-session/index.ts` builds its own group prompt with no shared app snapshot.

Result: three-to-four different versions of "who Calvin is", "what time it is", and "what's in the app" — they drift, and council members get the least context.

## The build

### 1. New module: `supabase/functions/_shared/context.ts`

One exported function, `buildSharedTruth(supabase, userId, opts)`, returning a single formatted block plus the raw object. Sections:

- **OPERATOR IDENTITY** — from `profiles` (display name, title, location) + `mavis_user_profile` (profile_md, communication_style, key_context, preferences, topics_of_interest). This is the AGENTS.md-equivalent layer.
- **TEMPORAL** — current time/date rendered in the operator's `profiles.timezone` (fallback UTC), day of week, plus an optional entity timezone override for personas/council members that have their own.
- **APP STATE SNAPSHOT** — compact counts + headline rows: active quests, high-priority tasks, energy systems, active goals, pending approvals/action queue, recent journal, top memories, latest world-model synthesis.
- **STANDING DIRECTIVES** — system settings/autonomy config and learned preferences.

Design rules: one `Promise.all` per call, hard per-query timeouts, everything failure-tolerant (a dead table yields an omitted section, never a 500), and a short in-memory TTL cache keyed by `userId` so a burst of messages doesn't re-query. Output is size-budgeted (each section truncated) so it can't blow the context window.

### 2. Wire every surface to it

| Function | Change |
|---|---|
| `mavis-chat` | Replace inline time block + snapshot assembly with `buildSharedTruth`; keep MAVIS persona prompt and tool definitions as-is |
| `mavis-agent` (agent mode) | Replace `timeFragment` and duplicated prefs/memory fragments with the shared block |
| `mavis-persona-router` | Replace `timeBlock + appCtx + settingsBlock` with the shared block, appended after the persona's own identity prompt |
| `mavis-council-session` | Add the shared block (currently missing) so council members reason on real app state |
| `mavis-actions` / action executor | Use the same snapshot when resolving entities by name, so CRUD sees the same truth the chat saw |

Persona and council prompts keep their distinct voice/identity; only the *truth layer* is shared and identical.

### 3. Client parity

`src/mavis/appContextLoader.ts` and `src/mavis/contextProviders.ts` duplicate this on the frontend (and `appContextLoader` currently queries `quests` twice — once as `quests`, once as `tasks`). Point both at the same section shape and fix the duplicate query so the client-side prompt matches the server-side truth.

### 4. Verify

- Invoke each of the 5 functions with a probe message and confirm the returned prompt contains the identical OPERATOR/TEMPORAL/SNAPSHOT header.
- Confirm the time rendered matches the profile timezone, not UTC.
- Confirm a council member and a persona both answer a "what's on my plate today?" question with the same underlying facts.
- Deploy all touched functions.

## Technical notes

No schema changes required — all reads use existing tables (`profiles`, `mavis_user_profile`, `quests`, `tasks`, `energy_systems`, `mavis_goals`, `mavis_action_queue`, `approvals`, `mavis_agent_memories`, `mavis_learned_preferences`). No migration, no new secrets. Token cost per call is bounded by the section budget and reduced overall by removing duplicated fragments.
