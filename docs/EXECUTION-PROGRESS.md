# Vantara Execution Blueprint — Progress

Last updated: 2026-07-28, session 1 (continued)

## Stage status
- [~] Stage A — Security cleanup (functionally done; 1 item still needs
  live Supabase confirmation, see below)
- [~] Stage B — Phase 0: Ground truth inventory (`docs/capability-inventory.md`
  written, all 314 functions classified via static analysis; live
  `cron.job`/secrets confirmation still blocked)
- [~] Stage C — Phase 1: Fix what's broken. Everything statically fixable
  is done (2 webhook security gaps, trigger-engine cron consolidation, 6
  stranded cron jobs activated). The blueprint's own "9 broken cron jobs
  from the original audit" premise didn't match what static reconciliation
  found (0 dead/renamed targets) — the real issues were different ones,
  documented above and in capability-inventory.md. Remaining items (env
  var confirmation, live cron re-check) are blocked on Supabase MCP
  access, not further static work.
- [~] Stage D — Phase 2: Orphan triage. All 19 ORPHANED/WEBHOOK? functions
  triaged (`mavis-yamete` excluded, hands-off): 3 more webhook auth gaps
  fixed, 4 archived, 3 dispatcher gaps wired in, 5 flagged as real feature
  work needing Calvin's decision (not built speculatively), 4 confirmed
  correctly external-only. Orphan count is at zero for anything with a
  clear disposition — the 5 flagged items are the only open loop, and
  that's a "needs a product decision" state, not unfinished triage.
- [ ] Stage E — Phase 3: Capabilities Hub + drift-proofing
- [ ] Stage F — Phase 4: Smoke tests
- [ ] Stage G — Phase 5: Composio (Track A / Track B — track separately)

## Currently in progress
Calvin said to keep going and finish everything rather than stop at every
checkpoint — proceeding continuously through the stages now, still
flagging anything destructive or genuinely blocked rather than plowing
through those. Stage B's static analysis is done (`docs/capability-
inventory.md`); moving into Stage C fixes next. Live Supabase MCP access
is still blocked (see below) — Stage B's live-verification items and
Stage F's live smoke-test requirement will stay marked unverified until
that's resolved; not stalling the rest of the work on it.

## Blocked / needs Calvin's decision

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
