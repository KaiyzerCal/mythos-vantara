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

1. **`.env` is tracked again — and it will keep coming back.** A prior
   session (2026-07-11) ran `git filter-repo` to strip `.env` from all
   history + patched `.gitignore`. Two days later (2026-07-13), Lovable's
   own sync bot (`gpt-engineer-app[bot]`, commit `446132f`) AND a separate
   Claude session (commit `1902ad9`) both independently re-added `.env`
   and rewrote `.gitignore` with the comment `# .env committed for Vite
   build`. Content is still safe (verified twice — JWT decodes to
   `role: anon`, just the public anon key + project URL, no
   `service_role` or private secret). But this means the "fix" already
   regressed once on its own, apparently because Lovable's build pipeline
   expects `.env` present. **Before redoing the filter-repo + force-push:
   does Lovable's hosted build actually require `.env` committed (no env
   var UI on their platform), or is there another way to inject
   `VITE_*` vars there?** If Lovable genuinely needs it, stripping it
   again is a self-defeating exercise that'll just regress on the next
   Lovable sync and cost you disruptive force-pushes. If there's a
   Lovable project-settings alternative, this stage's original plan
   stands and I'll redo it properly.

2. **Supabase MCP tool calls are blocked pending your approval** (`MCP
   error -32003: MCP tool call requires approval` on `list_projects` and
   `get_advisors` against `wlygujlvsfimhtqsdxrx`). I can't run live
   security advisors or confirm live RLS status without this. Please
   grant approval (or tell me how) so Stage A's live verification and
   Stage B's live cron/table checks can actually happen — this blueprint
   is built around live-database ground truth, not just static repo
   analysis.

3. **`mavis-yamete`** — untouched, flagged per ground rules. Still needs
   your call on what it is / what to do with it.

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
- 2026-07-27: verify_jwt audit — `supabase/config.toml` has **112**
  functions with `verify_jwt = false`, not the 22 the 2026-07-11 session
  audited. Full list captured. **Did not attempt to audit all 112
  individually this session** — that's a real, separate body of work
  (confirming each has a legitimate non-JWT auth path: cron-only, HMAC
  webhook signature, service-role-only caller, etc.) and rushing it to
  close out Stage A in one pass risked missing something real. Stopping
  here per the blueprint's explicit "stage bigger than expected, stop
  and report" rule rather than doing a shallow pass.
