## Goal
Execute all three post-audit tracks to bring MAVIS to "supreme intelligence lifeOS copilot" state: wire dead pages, polish UX, and build the next-tier autonomous features.

## Track 1 — Wire the 6 static pages to live data

- **AgentConsolePage** → live view of `mavis_agent_traces`, `mavis_action_queue`, `mavis_autonomous_runs` with pause/resume + approval controls.
- **AlliesAndStore** → `store_items` catalog + `contacts` (allies) with purchase/interact actions.
- **BpmPage** → wire to `bpm_sessions`; add start/stop session, history chart.
- **CharacterPage** → aggregate `profiles`, `skills`, `user_difficulty_profile`, `rankings_profiles`, `quests` for the RPG character sheet.
- **MyAgents** → list `customer_agents` + `mavis_letta_agents` with create/edit/delete.
- **RankingsPage** → live leaderboard from `rankings_profiles` + `mavis_daily_scores`.

Each: loading skeleton, empty state, error toast, mobile-safe, light-mode readable.

## Track 2 — UX polish pass

- Standardize `<LoadingState />`, `<EmptyState />`, `<ErrorState />` primitives; adopt across chat, council, persona, creative studio, gallery, avatar studio.
- Light-mode audit sweep: replace remaining hardcoded `text-white`/`bg-black` with semantic tokens; verify prose readability on light bg.
- Chat streaming: consistent typing indicator, retry button on failed messages, auto-scroll lock when user scrolls up.
- Creative Studio: progress bar during generation, provider fallback badge ("generated via Pollinations after FLUX failed"), one-click regenerate.
- Mobile: bottom-safe-area padding, tap-target sizing on council/persona cards.

## Track 3 — Supreme-intelligence roadmap

1. **Autonomous loop upgrade** — new `mavis-autonomy-orchestrator` function that reads `mavis_goals` + `mavis_telos`, plans via `mavis_plans`/`mavis_plan_steps`, dispatches to `mavis-agent`, logs to `mavis_autonomous_runs`. Cron every 15 min.
2. **Unified cross-service memory** — consolidate `mavis_memory`, `mavis_agent_memories`, `mavis_persona_memory`, `memories` behind a single `memory-service` edge function with hybrid semantic+keyword search. Inject top-K into every chat/agent call.
3. **Unified inbox** — new `/inbox` page merging `gmail_messages`, Telegram threads, `chat_messages`, `council_chat_messages`, `mavis_action_queue` approvals. Single triage surface with keyboard shortcuts.
4. **Advanced creative tools** — image-to-video handoff (Gallery → Video tab prefilled), style presets library saved to `mavis_design_tokens`, batch generation queue in `mavis_scrape_queue` pattern.
5. **Cross-app context bridge** — MCP tools already live; add `get_inbox`, `get_today_brief`, `run_autonomous_step` so external agents can drive MAVIS.

## Execution order & checkpoints

1. Track 2 primitives first (small, unblocks everything).
2. Track 1 pages in parallel batches of 2 (Agent Console + My Agents → Character + Rankings → BPM + Allies).
3. Track 3 in order: memory-service → autonomy-orchestrator → unified inbox → creative upgrades → new MCP tools.

Checkpoint after each track for review before moving on. Deploy edge functions as we go; no big-bang deploy at the end.

## Technical notes

- Reuse `AppDataContext` null-guard pattern for new layouts.
- All new tables get `GRANT` + RLS in the same migration.
- New edge functions use `npm:` specifiers, `Deno.serve`, shared CORS, Zod validation, 25s AbortSignal timeouts, Lovable AI Gateway with `gemini-flash-latest`.
- New pages honor cyberpunk theme (Orbitron/Rajdhani, dark default, light-mode tested).
