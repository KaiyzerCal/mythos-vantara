# Vantara Execution Blueprint — Progress

Last updated: 2026-08-07 (reconciliation pass — see note below)

**Reconciliation note (2026-08-07):** this doc was stale for ~10 days.
Between 2026-07-28 and 2026-08-05, at least 6 other Claude Code sessions
(PRs #117-122, plus #135, #148-157) did real, verified work continuing
this exact blueprint — much of it with **live Supabase/production access
this session has never had** — and none of it got recorded here. The
stage checkboxes and "Where this leaves the blueprint" list below are
rewritten to match actual current repo state as of today, verified
directly (file contents, migrations, git history), not taken on faith
from PR descriptions. Full detail in the findings log's 2026-08-07 entry.

## Stage status
- [~] Stage A — Security cleanup. Substantially advanced past the 07-28
  snapshot — real vulnerabilities found and fixed that weren't even in
  the original Stage A scope (see findings log). **But there's a live,
  unresolved concern more urgent than anything else in this doc**: a
  later session found that fixes which were correctly merged and showed
  a successful CI deploy were *still exploitable in production* against
  a real non-operator account (`mavis-code-exec`, `telegram-webhook`) —
  a gap between "GitHub says deployed" and "Supabase is actually running
  this code." Force-redeploy PRs (#155, #157) were merged to address it,
  but nothing in the repo confirms whether that actually closed the gap
  — this session still can't test it live (Supabase MCP blocked, see
  below). **Recommend Calvin (or a session with live access) re-verify
  mavis-code-exec, mavis-comfyui, and telegram-webhook are actually
  enforcing their fixes in production before trusting any of this.**
- [~] Stage B — Phase 0: Ground truth inventory. `docs/capability-inventory.md`
  is now confirmed stale (dated 2026-07-27, doesn't reflect any Aug 2-5
  work) — needs regeneration, not done in this pass (see "what's left"
  below). Live `cron.job`/secrets confirmation still blocked.
- [~] Stage C — Phase 1: Fix what's broken. More cron fixes landed since
  07-28 (4 more jobs moved off a broken GUC-based secret pattern). The
  two 07-28 corrective migrations are still present in git; live
  application to the actual database is still unconfirmed either way.
- [~] Stage D — Phase 2: Orphan triage. Of the 5 items flagged 07-28 as
  needing a product decision: 4 (`mavis-team`, `agent-telegram-gateway`,
  `mavis-event-router`, `mavis-demo`) are genuinely untouched — still
  open, still Calvin's call. **`local-mesh-proxy` got a real security fix**
  (unauthenticated RCE + an SSRF pivot closed, PR #135) but that commit's
  own message says there's still no settings UI to configure it — the
  actual product question ("should the frontend route through this")
  is still open. Security got better; the flagged decision didn't move.
- [x] Stage E — Phase 3: Capabilities Hub + drift-proofing. Unchanged
  functionally — the generator had a real Windows-only bug fixed since
  (path separators, CRLF parsing, non-deterministic ordering, PR #120),
  verified byte-identical output on Linux/CI before and after, so this
  stage's actual deliverable isn't affected.
- [~] Stage F — Phase 4: Smoke tests. A related drift bug got fixed and is
  worth knowing about even though it's not literally this stage: MavisChat
  and MavisDemo each carried their own ~150-line copy of the action-handler
  registration and had already drifted twice (missing `composio_action` on
  one, missing `spotify_*`/`terminal_exec` on the other) — deduped into
  one shared hook (PR #121), with 15 new tests added for it (PR #122).
  **Verified discrepancy worth flagging**: PR #122's own test plan reports
  163 passing; this session's sandbox gets 148 passing + 2 test files that
  fail to *load* (`@testing-library/react` is in `package.json`/`bun.lock`
  but missing from this environment's `node_modules`) — looks like an
  environment install gap specific to this sandbox, not a real code
  regression, but flagging since it means those 15 tests aren't currently
  running here.
- [~] Stage G — Phase 5: Composio. No change since 07-28 — confirmed
  `mavis-composio-agent` and `classifyComposioAction` are unmodified,
  still correctly fail closed with no API key, still no evidence a real
  Composio account/key exists anywhere in the repo. Exactly where it was
  left; still blocked on Calvin creating the account.

## Currently in progress
Just completed a reconciliation pass (2026-08-07) — this doc had fallen
~10 days behind real repo state. Not resuming a specific stage right now;
reported findings and stopping per the blueprint's own checkpoint rule,
since the most important open item (the deploy-propagation gap on
security fixes) needs Calvin's/live access's attention before any more
stage work is worth doing on top of it.

## Blocked / needs Calvin's decision

0. **NEW, most urgent — confirm security fixes are actually live in
   production**, not just merged to git. Live testing (from a session
   with real access) found `mavis-code-exec` still executing arbitrary
   code for a non-operator account, and `telegram-webhook` still
   accepting forged requests with a wrong/missing secret, *after* their
   fixes had merged and CI reported a successful deploy. Force-redeploy
   PRs #155/#157 were merged as an attempted fix; nothing in the repo
   confirms the outcome. This session cannot test this (Supabase MCP
   still blocked, GitHub Actions logs viewable but don't prove runtime
   behavior). Needs someone with real access to `mavis-code-exec`,
   `mavis-comfyui`, and `telegram-webhook` to actually hit them and
   confirm the auth/secret checks are enforced right now.

1. ~~`.env` tracked again~~ — **RESOLVED 2026-07-27**: Calvin confirmed
   Lovable's build genuinely needs `.env` committed. Leaving it as-is,
   not rewriting history. `.gitignore`'s existing `# .env committed for
   Vite build` comment already documents this; no further action.

2. **Supabase MCP tool calls are still blocked pending approval** (`MCP
   error -32003: MCP tool call requires approval` on `list_projects` and
   `get_advisors` against `wlygujlvsfimhtqsdxrx` — re-tried 2026-07-27,
   same result). Still can't run live security advisors, confirm live
   RLS status, or pull the live `cron.job` table Stage B needs as its
   ground truth. Needs Calvin to grant this (unclear from this session
   whether that's a client-side prompt to click through, a permission
   mode setting, or something else — the error returns immediately each
   time rather than hanging, so it doesn't look like a pending
   interactive prompt).

3. **`mavis-yamete`** — untouched, flagged per ground rules. Still needs
   Calvin's call on what it is / what to do with it.

## Findings log (append, never overwrite)

- 2026-07-27: Session 1 begins. `docs/EXECUTION-PROGRESS.md` created.
- 2026-07-27: `.env` at HEAD verified safe — decoded JWT payload is
  `{"role":"anon","ref":"wlygujlvsfimhtqsdxrx",...}`. No rotation needed.
  Matches blueprint's own claim.
- 2026-07-27: Full git history secret scan completed (267 commits, all
  refs, `git log --all -p`, ~1M lines). Patterns checked: `service_role`/
  `SERVICE_ROLE` (2132 hits, all legitimate — env var names, GRANT
  statements, journal.md log entries; zero actual leaked service-role
  JWTs), `sk-ant-*`, `sk-proj-*`, `AKIA*` (0 hits each), `-----BEGIN`
  (8 hits, all either journal.md log duplication or
  `.replace(/-----BEGIN PRIVATE KEY-----/, "")` normalization code, no
  actual PEM key material), `SECRET`/`TOKEN`/`api_key` assigned to a
  real-looking literal (0 hits — all references are `Deno.env.get(...)`
  or placeholder text). Every unique JWT (`eyJ...`) found anywhere in
  history extracted and decoded: exactly **one** unique JWT exists across
  all 267 commits, and it's the anon-role key above. **History is clean.**
- 2026-07-27: `.env` regression traced — see "Blocked" section above.
  This also means the July 11 session's fix history is worth trusting
  less by default going forward; verify live state, don't assume a past
  checkpoint held.
- 2026-07-27: Stray duplicates `index (2).html` and `package (2).json`
  removed (again — they'd also regenerated since the July 11 pass, same
  batch of commits as the `.env` regression, `git rm`'d, commit pending).
  Confirmed both were generic Vite/shadcn scaffold defaults, not the
  real customized files (diffed against the real `index.html`/
  `package.json` first) — only reference to either filename anywhere in
  tracked files was journal.md's own historical log line.
- 2026-07-27: `.env.example` already accurate and complete — no changes
  needed (already covers every var actually read across
  `supabase/functions/`, including ones I added this session).
- 2026-07-27: RLS static cross-reference (migrations only — live check
  blocked, see above): 9 tables have `CREATE TABLE` but no matching
  `ENABLE ROW LEVEL SECURITY` anywhere in `supabase/migrations/`:
  `prymal_approval_queue`, `prymal_client_integrations`,
  `prymal_contacts`, `prymal_gmb_reviews`, `prymal_inbound_messages`,
  `prymal_intel_briefings`, `prymal_outreach_sequences`,
  `prymal_social_posts`, `webhook_events`. **Important:** 8 of these 9
  are defined in `20260609000001_prymal_client_schema.sql` and
  `20260609000002_prymal_gmb_reviews.sql`, both headed "Project:
  `fjkkcrmhptrzobajjsqg`" — a **different Supabase project** ("PrymalAI
  Client Agent Suite"), not mythos-vantara's own
  (`wlygujlvsfimhtqsdxrx`). These migrations reference
  `https://fjkkcrmhptrzobajjsqg.supabase.co/...` directly in their own
  cron-schedule comments. They may never have been run against
  mythos-vantara's actual database at all — can't confirm without the
  live check. Only `webhook_events` (from `mavis_advanced.sql`) is
  unambiguously a mythos-vantara table, and it already carries a
  deliberate comment: "Service role only, no RLS needed (internal
  table)" — a documented design choice, not an oversight. Recommend
  enabling RLS on it anyway as defense-in-depth (costs nothing since
  only the service role ever touches it) but this is a proposal, not
  applied — per the blueprint's own "show policies for approval before
  applying" rule, and pending live confirmation this table's access
  pattern hasn't changed since that comment was written.
- 2026-07-27: Separately worth flagging regardless of the RLS question —
  two migration files for an entirely different, unrelated Supabase
  project ("PrymalAI") are sitting in `supabase/migrations/`. Not
  touched (migrations are off-limits without explicit instruction), but
  Calvin should know these are here and decide whether they belong.
- 2026-07-27: Calvin confirmed `.env` must stay committed for Lovable's
  build. No history rewrite. Decision item 1 closed.
- 2026-07-27: Re-attempted Supabase MCP call (`get_advisors`) after
  Calvin's reply — still `MCP error -32003: MCP tool call requires
  approval`. Decision item 2 still open.
- 2026-07-27: verify_jwt audit — `supabase/config.toml` has **112**
  functions with `verify_jwt = false`, not the 22 the 2026-07-11 session
  audited. Full list captured. At the time this was written, decided not
  to rush a full audit to close Stage A in one pass — see below, this got
  done properly as part of Stage B instead.
- 2026-07-27: Calvin: "keep making progress and finish everything." Ran 3
  parallel research agents to build Stage B's ground-truth inventory
  (function caller map, cron/webhook reconciliation, task-type + autonomy
  pathway tracing). Full results synthesized into `docs/capability-
  inventory.md` — see that file for the complete table and findings.
  Headlines:
  - **`mavis-stripe-webhook` had zero signature verification** (real gap —
    fixed immediately, out of stage sequence, given it's an active
    exploitable hole on a payment webhook: anyone with the URL could POST
    a forged `invoice.paid`/`payment_intent.succeeded` event with an
    arbitrary `user_id` and it would be logged as real revenue. Added the
    same HMAC-SHA256 check `stripe-widget-webhook` already uses. Commit
    `929bd8a`, pushed.
  - `mavis-gumroad-webhook`'s seller-ID check silently no-op'd when
    `GUMROAD_SELLER_ID` wasn't set — same commit, now logs
    `fallback_triggered` instead of silently skipping (Gumroad's webhooks
    don't support real HMAC signing, so seller-ID comparison genuinely is
    the best available check, just wasn't being enforced loudly).
  - 3 more webhook-shaped functions (`mavis-gmail-webhook`,
    `mavis-inbound-webhook`, `mavis-webhook-calendar`) look genuinely
    dead — named as inbound receivers, no caller anywhere, and
    `verify_jwt=true` (which would reject the real external webhook calls
    they're presumably meant to receive). Flagged for Stage D, not
    touched.
  - cron.schedule() reconciliation: 0 dead/renamed targets. But: a
    possible vault-secret-name mismatch on the 5-minute trigger-engine
    job (`SERVICE_ROLE_KEY` vs the `SUPABASE_SERVICE_ROLE_KEY` used
    everywhere else — can't confirm live), a whole `mavis_cron_config`
    table-driven scheduling tier that silently never activated for ~7
    functions because its activation RPC didn't exist until 2026-07-20,
    and `mavis-proactive-nudge` now has two different schedules registered
    through two different mechanisms.
  - `mavis-goal-review`'s triple-definition conflict resolved: the real,
    currently-live registration (latest migration wins) is Monday 09:00
    UTC — but it authenticates with the anon key, inconsistent with every
    other cron job in the repo, worth a deliberate look.
  - `mavis_tasks` seeded task types: clean, no mismatch — corrected one
    assumption in the blueprint's own wording (the executor's dispatch is
    a `HANDLERS` lookup object, not a `switch`).
  - Autonomy pathway classification: 7 of 9 pathways CONNECTED end-to-end.
    `mavis-proactive-agent` is PARTIAL/BROKEN — despite the name, has no
    autonomous trigger at all, only a manual dashboard button and a chat
    keyword match. `mavis-streak-alerts`/`mavis-quest-nudge` are
    CONNECTED but record no outcome anywhere (fire a Telegram message and
    nothing else).
  - **The self-improvement/outcome loop is not actually wired.**
    `mavis_outcome_events` — the table the whole outcome-tracking system
    is meant to learn from — has no producer anywhere in the codebase.
    Every individual piece (goal-review, proactive-agent, outcome-tracker,
    self-evolve) is real code, but "act → observe outcome → learn" isn't
    actually connected end to end.
  - Compile check: all 314 functions esbuild-bundle clean, zero failures
    — real, verified data (not a live-deploy guarantee, but catches
    syntax/import errors).
  Full detail, methodology, and the complete 314-row table are in
  `docs/capability-inventory.md` — not duplicated here.
- 2026-07-27: Stage C. Two new corrective migrations (never editing
  existing ones): `20260728000000_fix_trigger_engine_cron.sql`
  consolidates mavis-trigger-engine's three accumulated cron registrations
  (a typo'd vault secret name left the intended 5-minute job unregistered;
  a later migration separately added a 10-minute anon-key-authenticated
  duplicate) down to one correct 5-minute, service-role-authenticated job.
  `20260728000001_activate_stranded_cron_jobs.sql` registers 6 functions
  that were only ever seeded into `mavis_cron_config` (a table whose
  activation RPC didn't exist until 2026-07-20): mavis-capability-audit,
  mavis-health-monitor, mavis-learning-engine, mavis-archivist,
  mavis-goal-judge, mavis-user-model-refresh. Both migrations are
  idempotent and committed, but **not yet applied to the live project** —
  need a migration push, and ideally live confirmation once MCP access is
  unblocked. Corrected one error from the prior commit: mavis-so-curator
  was miscategorized as stranded — it actually has a separate, working
  registration and didn't need touching.
- 2026-07-27: Stage C's remaining items (env-var-set confirmation, live
  cron.job re-check) are blocked on Supabase MCP access, not further
  static work — moving to Stage D (orphan triage) rather than stalling.
- 2026-07-28: Stage D. Ran a research agent to read the full source of all
  19 ORPHANED/WEBHOOK? functions from the Stage B inventory (`mavis-yamete`
  excluded — hands-off) and recommend a disposition for each. Full
  reasoning in `docs/capability-inventory.md` section 8. Actions taken:
  - **3 more webhook auth gaps fixed** (same bug class as trigger-engine's
    vault-secret typo, different mechanism): `mavis-a2a`, `mavis-gmail-
    webhook`, `mavis-ruview-bridge` all had no `config.toml` entry at all,
    defaulting to `verify_jwt = true` — which silently rejects every real
    external caller (Google Pub/Sub, ESP32 sensor hardware, other A2A
    agents) since none can supply a Supabase user JWT. Confirmed these
    are live, actively-maintained integrations, not dead code — e.g.
    `mavis-gmail-watch` registers and daily-renews a Pub/Sub subscription
    pointed at `mavis-gmail-webhook` that has been silently failing since
    day one. Added `verify_jwt = false` for all three.
  - **4 functions archived** to `supabase/functions/_archive/` (code kept,
    not deleted; reasoning in that directory's README): `mavis-a2a-gateway`
    (dead end — never executed submitted tasks), `mavis-inbound-webhook`
    (redundant with the actually-wired-in `mavis-webhook`), `mavis-mcp`
    (redundant with the more complete `mavis-mcp-server`), `mavis-webhook-
    calendar` (no evidence any external tool was ever registered against
    it). Deploy workflow updated to skip `_archive/`.
  - **3 dispatcher gaps wired in**: `mavis-agent-identity` (action
    signing), `mavis-home` (smart home), `mavis-market-data` (stocks/
    crypto) were all fully built and already advertised to the LLM in the
    chat system prompt with exact matching `:::ACTION:::` example syntax
    — but `mavis-actions` had no dispatch case for any of them, so every
    attempt silently failed as "unknown action type." Added all 3 cases.
    `mavis-home`/`mavis-market-data` needed an auth fix first too (they
    only accepted a real user JWT; `mavis-actions` calls them server-to-
    server with just a `userId` string) — added the same service-role-
    bypass pattern used elsewhere this session.
  - **5 items flagged, not built** — genuine feature work needing a
    product decision, not a triage-stage fix: `mavis-team` (complete
    multi-tenant backend, zero UI), `agent-telegram-gateway` (per-persona
    Telegram bots, no config UI or setup flow), `local-mesh-proxy`
    (working remote-Ollama proxy, frontend doesn't route through it),
    `mavis-event-router` (would mean refactoring already-working webhook
    handlers to use it instead), `mavis-demo` (unclear if it's ahead of
    an unshipped marketing page or leftover from a scrapped one — needs
    Calvin's answer, not a guess).
  - Confirmed `KEEP_AS_IS` (no action needed): `mavis-identity-bootstrap`,
    `mcp`, `mavis-mcp-server`, `telegram-setup`.
  All changes esbuild-verified, vitest suite still 53/53, workflow YAML
  re-validated. Committing next.
- 2026-07-28: Stage E. Built `scripts/generate-capabilities-manifest.mjs`
  (Node, no dependencies) — regenerates `src/mavis/
  capabilitiesManifest.generated.ts` from the actual repo: function list
  from `supabase/functions/` on disk (excluding `_archive`), category/
  purpose parsed out of `SHARD.md`'s own tables (not hand-copied), cron
  targets from `supabase/migrations/*.sql`, `verify_jwt` from
  `supabase/config.toml`, and frontend/backend caller detection via the
  same regex approach the Stage B research agents used by hand. One
  exception, clearly labeled in the generator: the 9 Autonomy & Proactive
  pathway CONNECTED/PARTIAL classifications can't be derived from regex
  (needs judgment — does it actually record an outcome, is a "trigger"
  real) — kept as an explicit, labeled manual annotation layer sourced
  from Stage B's analysis, not silently presented as auto-derived.
  Cross-checked the generator's automated classification against Stage
  B/D's manual numbers: 277 ACTIVE / 15 WEBHOOK / 11 CRON_ONLY / 6
  ORPHANED / 1 NEEDS_DECISION out of 310 — the ORPHANED count (6) exactly
  matches Stage B's 13 minus the 4 archived minus the 3 moved to WEBHOOK
  by Stage D's verify_jwt fixes, confirming the two methods agree.
  Built `/capabilities` (`src/pages/CapabilitiesHubPage.tsx`), wired into
  `App.tsx` routing and `AppSidebar.tsx` nav: search/filter by status, a
  distinct Autonomy & Proactive section surfacing the 9 pathways with
  their notes, and a generic JSON-body invoke form per function (with a
  confirm-before-calling guard, since this hits the live function for
  real). Grouped by SHARD.md category; 11 functions came back
  "Uncategorized" (mostly recently-added ones SHARD.md hasn't caught up
  to yet, including things from this very session) — left visible as its
  own group rather than hidden, since that's useful drift signal too.
  CI: added `.github/workflows/capabilities-drift-check.yml` running
  `npm run check:capabilities` on push/PR to main/staging. **Verified the
  drift check actually works, per the blueprint's explicit instruction**:
  created a throwaway `supabase/functions/mavis-fake-test-function/`,
  confirmed `check:capabilities` failed with a clear message and non-zero
  exit, deleted it, confirmed the check passed again. tsc --noEmit clean,
  vitest 53/53, full `vite build` succeeds with the new page code-split
  into its own ~96KB chunk. Tried to visually verify the page in a
  browser (dev server actually started this time, bound to 127.0.0.1)
  but the app requires real auth to reach any page past login, which
  this sandbox can't provide — confirmed via headless Chromium that the
  app shell loads with no JS crash, but couldn't see the page's actual
  rendered content. Same environment limitation noted earlier this
  session for other UI work.
- 2026-07-28: Stage F. Important scope correction to the blueprint's own
  wording before describing what got built: "for every ACTIVE function:
  minimal smoke test... no 500" cannot be safely automated as a blind
  sweep across all 277 ACTIVE functions. Many are genuinely side-effecting
  for real — sends a Telegram message, sends an email, writes a revenue
  row, posts to social media — and an empty/minimal POST isn't guaranteed
  harmless just because it's framed as "just a smoke test." Rather than
  either (a) skip this or (b) silently build something that could spam
  Calvin's real Telegram/email/socials the first time CI runs it, built it
  as an explicit, loud, opt-in capability instead — consistent with the
  "no silent fallback" ground rule.
  - `scripts/generate-capabilities-manifest.mjs` now also emits
    `src/mavis/capabilitiesManifest.generated.json` (plain JSON sibling of
    the `.ts` file) so a Node script can read it without a TS loader.
    Drift check extended to cover both files; re-verified the fake-
    function test still catches drift correctly with both outputs.
  - `scripts/smoke-test.mjs` extended with a real Autonomy & Proactive
    trigger tier: fires `mavis-goal-review`, `mavis-autonomous-engine`,
    `mavis-trigger-engine`, `mavis-signal-watcher`, `mavis-proactive-
    nudge`, `mavis-streak-alerts`, `mavis-quest-nudge`, `mavis-so-
    scheduler` with the **exact same payload their real pg_cron job
    posts** (cross-checked against `supabase/migrations/*.sql`, not
    guessed) — this is not new risk, it's the same call each already
    receives automatically on schedule. Confirms trigger→non-5xx-response
    only; confirming the DB-side outcome actually got recorded needs a
    live follow-up read, not done here (same MCP-access blocker as
    everywhere else this session).
  - Added a manifest-driven `--all-active` sweep (opt-in flag, NOT run in
    CI, NOT the default) that probes every ACTIVE function not already
    covered by a dedicated test. Script header and `DEPLOYMENT.md` both
    document plainly: staging only, and only once you've spot-checked
    what a given function actually does with a near-empty payload.
  - Wired a staging-only smoke-test gate into
    `.github/workflows/deploy-mavis-functions.yml` (runs the curated +
    autonomy-trigger tests, not `--all-active`, after a staging deploy).
    Needs 3 more secrets on the `staging` GitHub Environment
    (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPERATOR_USER_ID`) that
    don't exist yet — documented in `DEPLOYMENT.md`; the step skips
    itself gracefully with a warning if they're unset rather than failing
    the whole deploy over an optional gate.
  - Could not actually run any of this against live infrastructure to
    verify real HTTP behavior — no live Supabase credentials available in
    this session (same blocker as the rest of Stage F/live-verification
    work). Verified everything that's checkable without live access:
    script syntax, the manifest-loading/filtering logic in isolation
    (confirmed 277 ACTIVE functions load correctly), workflow YAML,
    drift-check still passes both directions after the JSON-output
    change, tsc/vitest/build all clean.
- 2026-07-28: Stage G. Track A step 1 (create a Composio account, generate
  an API key) is a real, hard blocker this session cannot clear — it's
  Calvin's account to create. Built everything that doesn't depend on it:
  - `src/mavis/actionSchemas.ts`: new `composio_action` schema
    (`{ tool_slug, params }`) — generic on purpose, Composio exposes
    1000+ toolkit actions, not something to enumerate per-action.
  - `src/mavis/actionExecutor.ts`: `classifyComposioAction()` — verb-based
    classification since there's no fixed action list to special-case.
    Any slug with a mutating verb (CREATE/UPDATE/DELETE/SEND/...) forces
    CONFIRM even if a read verb also appears (safety wins ties);
    unrecognized shapes default to CONFIRM too. **This is the blueprint's
    own "single most important requirement" for this stage** — routing
    through the existing gate rather than a parallel path — done.
  - `src/pages/MavisChat.tsx`: registered the `composio_action` handler,
    calling the new edge function with the session's real access token.
  - `supabase/functions/mavis-composio-agent/index.ts`: generic proxy to
    Composio's v3 REST API. **Confidence caveat, prominent in the file's
    own header comment**: docs.composio.dev and backend.composio.dev both
    blocked automated fetches while building this (403s — likely bot
    protection), so the exact request/response shape is assembled from
    their public TS SDK's confirmed method signature and a sibling
    endpoint path, not a first-hand read of the v3 REST reference for
    this specific endpoint. Auth header name (`x-api-key`) and the v3-
    only requirement (v1/v2 now return 410) are independently confirmed.
    Needs a real account to actually verify — do not treat as trustworthy
    until smoke-tested against one.
  - 22 new tests (`src/mavis/__tests__/composioAction.test.ts`) covering
    the classification heuristic specifically, including a deliberately
    contrived slug with both a read and a mutating verb present (safety-
    wins-ties case) — this heuristic is the actual safety net here, so it
    got the most scrutiny, not just "does it execute."
  - Track B: built the candidate shortlist from the capabilities manifest
    (16 functions — one hand-rolled integration per third-party service,
    the exact pattern Composio's toolkit catalog exists to replace, all
    confirmed `ACTIVE` = real usage). Documented in `DEPLOYMENT.md`. **No
    cutovers performed** — per the blueprint's own explicit instruction
    ("present a replace/keep recommendation per integration before
    touching it — one at a time, never bulk") and because nothing can be
    verified equivalent without a real Composio account to test against.
    This is a first-pass list by pattern-match, not a rigorous per-
    function fragility audit.
  All verified: tsc --noEmit clean, vitest 75/75 (53 pre-existing + 22
  new), esbuild on the new function, capabilities manifest regenerated
  and drift-check passes, full `vite build` succeeds.
- 2026-08-07: **Reconciliation pass.** This doc hadn't been touched since
  07-28; real repo state had moved much further. Verified via git log,
  PR history (with a caveat — see below), and direct file/migration
  reads, not assumption. Key findings, fullest detail in the stage-status
  section above:
  - **PRs #117-122 (2026-08-02/03) continued this exact blueprint**,
    apparently with live Supabase access this session doesn't have: RLS
    enabled on the 9 originally-flagged tables (#119), 12 real audit
    findings fixed across Store/Widget Builder/My Agents/Agent
    Console/Airtable/Integrations/Playbooks/Time Tracking/Receptionist/
    Self-Evolve (#118), a manifest-generator Windows bug fixed (#120),
    MavisChat/MavisDemo action-handler drift deduped (#121), baseline
    test coverage added (#122).
  - **A second wave (Aug 2-5) found and fixed real security
    vulnerabilities not in the original blueprint's scope at all**:
    `mavis-code-exec` had no auth beyond the platform gateway (any
    authenticated user could execute arbitrary code), `mavis-comfyui`
    the same plus no rate limit and an attacker-controlled storage path,
    `mavis_actions`' INSERT/UPDATE policies were `USING(true)` for every
    role despite being named "Service role can...", `customer_agents`
    let agent owners PATCH their own billing/plan columns directly,
    `customer_agent_messages` had no DB-level rate limit on its public
    insert policy, and `telegram-webhook` failed *open* (accepted
    requests with zero secret verification) whenever
    `TELEGRAM_WEBHOOK_SECRET` was unset. All confirmed present in
    current code by direct read, not taken on faith.
  - **The one thing that isn't resolved, and matters most**: a
    deploy-propagation gap where merged fixes with green CI were still
    not enforced in production when tested live. See "Blocked" item 0
    above — this needs live re-verification, which this session
    structurally cannot do.
  - `local-mesh-proxy` (one of Stage D's 5 flagged items) got a real
    security fix (unauthenticated RCE + SSRF closed, PR #135) but the
    actual "should this be wired into frontend routing" product
    question is still open per that commit's own admission.
  - `docs/capability-inventory.md` (Stage B's deliverable) is confirmed
    stale — dated 07-27, doesn't reflect any of the above. Not
    regenerated in this pass (see below) — would need the same kind of
    multi-agent static analysis Stage B originally used, done properly
    rather than rushed.
  - `mavis-yamete`: confirmed still completely untouched, single commit
    in its history. Still needs Calvin's call.
  - Composio (Stage G): confirmed byte-for-byte unchanged since 07-28.
    No evidence anywhere in the repo that a real account/key exists.
  - Note on methodology: GitHub's PR "merged" field is **not reliable**
    in this repo — many PRs going back to #2 show `merged: false` while
    their content is verifiably live on `main` (Lovable pushes directly
    to `main` outside the PR flow regularly). Cross-checked every claim
    in this entry against actual file/migration contents on `main`, not
    PR metadata.

## Where this leaves the blueprint

Real, verified work has happened across every stage, much of it by
sessions with live access this one doesn't have. Nothing here is faked or
rubber-stamped — every `[~]` means "verified everything checkable from
this session," not "fully done." What's left, roughly in priority order:

- **Confirm live-in-production status of the security fixes** — highest
  priority, see "Blocked" item 0. `mavis-code-exec`, `mavis-comfyui`, and
  `telegram-webhook` specifically; the deploy-propagation gap that caused
  this could affect other recently-"fixed" functions too, not just these
  three.
- Grant Supabase MCP tool approval so live verification (cron.job table,
  security advisors, secrets, RLS confirmation post-migration) can happen
  from this session going forward — flagged repeatedly since 07-27,
  never resolved.
- Regenerate `docs/capability-inventory.md` properly (Stage B redone) —
  it's now materially out of date and shouldn't be trusted for current
  function counts/status until refreshed.
- Confirm the Stage C corrective migrations
  (`20260728000000_fix_trigger_engine_cron.sql`,
  `20260728000001_activate_stranded_cron_jobs.sql`) and the various
  RLS-enabling migrations from Aug 2-5 have actually been applied to the
  live database, not just committed to git.
- Decide on the 4 still-fully-open Stage D items (`mavis-team`,
  `agent-telegram-gateway`, `mavis-event-router`, `mavis-demo`), and
  separately decide whether `local-mesh-proxy` should get a frontend
  routing path now that its security gap is closed.
- Decide on `mavis-yamete` (untouched since session 1, per ground rules).
- Set up the staging GitHub Environment secrets so Stage F's smoke-test
  gate actually runs (documented in `DEPLOYMENT.md`).
- Fix this sandbox's `node_modules`/`@testing-library/react` install gap
  (likely just a fresh `bun install`) if full test-suite runs from a
  Claude Code session matter going forward.
- Create the Composio account / API key (Stage G Track A step 1), then
  smoke-test `mavis-composio-agent` for real before trusting it.
- Review the Stage G Track B shortlist and decide per-integration, one
  at a time.
