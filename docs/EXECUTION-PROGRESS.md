# Vantara Execution Blueprint — Progress

Last updated: 2026-07-27, session 1

## Stage status
- [~] Stage A — Security cleanup (mostly done, 2 items need Calvin's decision — see below)
- [ ] Stage B — Phase 0: Ground truth inventory
- [ ] Stage C — Phase 1: Fix what's broken
- [ ] Stage D — Phase 2: Orphan triage
- [ ] Stage E — Phase 3: Capabilities Hub + drift-proofing
- [ ] Stage F — Phase 4: Smoke tests
- [ ] Stage G — Phase 5: Composio (Track A / Track B — track separately)

## Currently in progress
Stage A checkpoint reached. Stopped per the blueprint's own rule ("if a
stage's real scope turns out much bigger than expected, stop and report")
— the verify_jwt audit surface is 112 functions, not the 22 a prior
session (2026-07-11) found. Waiting on Calvin for two decisions (below)
before closing out Stage A.

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
  audited. Full list captured. **Did not attempt to audit all 112
  individually this session** — that's a real, separate body of work
  (confirming each has a legitimate non-JWT auth path: cron-only, HMAC
  webhook signature, service-role-only caller, etc.) and rushing it to
  close out Stage A in one pass risked missing something real. Stopping
  here per the blueprint's explicit "stage bigger than expected, stop
  and report" rule rather than doing a shallow pass.
