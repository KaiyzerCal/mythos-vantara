
# MAVIS Supreme Intelligence — Exhaustive System Audit

Given the size (308 edge functions, 170+ tables, ~50 pages), a single-pass audit is not tractable in one turn. This plan runs the audit as **6 sequential phases**, each ending with a checkpoint report so you can steer before the next phase burns credits.

## Phase 0 — Inventory & Map (read-only, 1 turn)

Build the ground-truth map so every later phase has a target list. No fixes yet.

- Enumerate all `supabase/functions/*` → classify: user-facing / cron / webhook / internal / orphan.
- Enumerate all `src/pages/*` and top-level routes in `App.tsx`.
- Enumerate all public tables + RLS status (from `supabase--linter` + `read_query`).
- Cross-reference: which function is called by which page/hook; which table is read by which function.
- Output: `AUDIT_MAP.md` — a single document listing every function with its trigger, caller, tables, and status (WIRED / ORPHAN / DEAD / UNKNOWN).

## Phase 1 — Backend Health Sweep (2 turns)

- Run `supabase--linter`, `supabase--db_health`, `supabase--slow_queries`, `security--run_security_scan`.
- Pull last 7 days of `ai_gateway_logs` — flag models returning >5% errors, functions with runaway costs.
- Spot-check `edge_function_logs` for the 30 most-invoked functions; flag any with recent 500s.
- Auto-fix: obviously broken model IDs, missing CORS, dead imports, undeployed functions.
- Flag: RLS gaps, slow queries, security findings.

## Phase 2 — Critical-Path Live Tests (1 turn)

Curl-test every user-facing function group and confirm 200/expected-4xx:
- Chat: `mavis-chat`, `mavis-agent`, `mavis-persona-router`, `mavis-council-*`
- Actions: `mavis-actions`, `mavis-action-executor`, `mavis-autonomous-runner`
- Creative: `mavis-image-gen`, `mavis-video-gen`, `mavis-tts`, `mavis-transcribe`
- Integrations: `mavis-telegram-bot`, `mavis-slack-bot`, `mavis-phone-call`, gmail/calendar/drive
- Memory: `embed-and-search`, `mavis-memory-agent`, `mavis-entity-graph`
- MCP: `mcp` server + tool endpoints

Auto-fix small failures (model IDs, headers, timeouts). Flag deeper breaks.

## Phase 3 — Frontend Wiring Audit (2 turns)

For each page in `src/pages/`:
- Does it actually call the backend functions it should?
- Are hooks (`use*`) subscribed to the right realtime channels?
- Are there dead buttons (onClick → nothing / TODO / console.log)?
- Are there orphan pages (routed but no nav entry) or orphan features (built but never routed)?

Auto-fix: missing loading spinners, missing error toasts, missing empty states, dead imports.
Flag: features present in backend with no UI, or UI with no backend.

## Phase 4 — UX Polish Pass on Rough Surfaces (1-2 turns)

Only surfaces identified as "rough" in Phase 3:
- Add loading / error / empty states.
- Fix light-mode readability gaps.
- Ensure card-expansion + click-through rules (per project memory).
- Ensure chat textareas keep focus (per chat-agent-ui contract).
- No visual redesign; no changes to healthy surfaces.

## Phase 5 — Final Report & Roadmap (1 turn)

- Delivered fixes list (files changed, functions redeployed).
- Flagged issues sorted by severity, each with a proposed remedy and effort estimate.
- Recommended next-build roadmap for turning MAVIS into the "supreme intelligence lifeOS" (missing capabilities, redundant systems to consolidate, architectural refactors).

---

## Technical Details

- **Tools used per phase**: Phase 0-1: `read_query`, `linter`, `db_health`, `slow_queries`, `security--run_security_scan`, `ai_gateway_logs`. Phase 2: `curl_edge_functions`, `edge_function_logs`. Phase 3-4: `code--view`, `line_replace`, `write`. Phase 5: report only.
- **Parallelization**: Every phase batches independent reads/curls in parallel.
- **Deployments**: Functions changed in a phase are deployed at end of that phase (batched via `deploy_edge_functions`).
- **Cost control**: Each phase ends with a checkpoint. You can stop, redirect, or continue. No blind full-runs.
- **Off-limits (respected)**: no touching `supabase/migrations/*` without asking, no pushes to `main`, no edits to auto-generated Supabase client files, no NSFW work.

## Checkpoints

After each phase I'll post a short summary: what was fixed, what was flagged, what's queued for the next phase. You approve or redirect before Phase N+1.

## Starting Point

Phase 0 begins immediately on approval — it's pure read/mapping, low cost, and produces the artifact that every later phase depends on.
