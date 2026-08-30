# Orchestrator — Claude Code Playbook

You are the **Orchestrator** for this repository. Your job is to route incoming work to the right specialist and synthesize their outputs. You do not execute specialist work yourself.

## This Repo

**mythos-vantara** — the codebase for CODEXOS / Mavis. A Supabase + React + Vite application with Deno edge functions. The operator is Calvin.

### Backend: Lovable

**This app's backend is Lovable-managed** (Calvin, 2026-08-21). Same for the
NAVI app (`NAVI.EXE-lovable`). Consequences that matter every session:

- The Supabase project (`wlygujlvsfimhtqsdxrx`, per `supabase/config.toml`) is
  provisioned *through Lovable*, so it does NOT appear in Calvin's own Supabase
  org — the Supabase MCP's `list_projects` will not return it. Reach the live
  DB through the **Lovable MCP** (`query_database`) instead, against the
  Lovable project rather than the Supabase ref.
- Schema and storage changes land via Lovable, not `supabase db push` from this
  repo. A file in `supabase/migrations/` is not applied just because it is
  committed — assume it is NOT live until confirmed against the running DB.
- Lovable writes back to the GitHub repo. A branch pushed from here and an edit
  made in the Lovable editor can diverge; check which side is authoritative
  before assuming a local push reached the running app.
- Lovable project — **confirmed** 2026-08-29, no longer a guess: workspace
  "Cal's Lovable" (`ggIVIJ8dhqNxDaOjtFhU`) → **mavisprimevantara** /
  "Mythos RPG Nexus" (`6ec06b14-9242-48d0-8241-2a2f8a075e7f`,
  https://mavisprimevantara.lovable.app). Proof: its `latest_commit_sha`
  tracks merges made from this repo within minutes. The git URL it records,
  `rork-mythos-nexus-rpg-clone.git`, is stale from a rename — ignore it.

### Edge functions do NOT deploy on publish — this cost a whole session

Confirmed 2026-08-29, the hard way. Merging to `main` and calling Lovable's
`deploy_project` publishes the **frontend** and nothing else. Every function
under `supabase/functions/` keeps running whatever code was last explicitly
deployed. Nothing warns you: the merge succeeds, the publish succeeds,
`latest_commit_sha` advances to your merge, and the app serves stale
functions.

Five rounds of correct, CI-green, merged fixes changed nothing in the running
app because of this. The tell was a probe that should have been run on the
*second* report of "it's still broken", not the tenth.

**Deploying them.** The Lovable agent has a `supabase--deploy_edge_functions`
tool. Ask it in plain language and name every function, including new ones:

> Please deploy the Supabase edge functions to the backend. Do not change any
> code — this is a deployment-only request. Functions: mavis-chat,
> mavis-actions, ... Deploy them exactly as they are in the repository.

Say "do not change any code" explicitly; the agent will otherwise "fix" what
it thinks is broken. It reports which functions it deployed.

Other paths do NOT work from a Claude Code session:
- The Supabase MCP is permission-denied on this project — it is Lovable
  provisioned and outside Calvin's own org.
- `*.supabase.co` egress is 403 at the sandbox gateway, so functions cannot
  be invoked directly either.

**Verify, never assume.** After any edge-function change, prove the deployed
code is yours before reporting it shipped. The database can reach the
functions even when the sandbox cannot — `pg_net` plus the same secrets the
33 existing cron jobs use:

```sql
SELECT net.http_post(
  url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url')
         || '/functions/v1/<function>',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                  WHERE name='service_role_key')),
  body := '{}'::jsonb, timeout_milliseconds := 60000);
-- then, a few seconds later:
SELECT status_code, content FROM net._http_response WHERE id = <returned id>;
```

Probe something that only exists in the new code. A new action type returning
"Unknown MAVIS action" or a new function returning 404 NOT_FOUND means it did
not deploy, whatever the merge and publish said.

### A batch job's progress is not its throughput

Confirmed 2026-08-30 while draining 2637 mavis_memory rows. The backfill
selects `WHERE embedding IS NULL ... LIMIT 100` with no ORDER BY. 89 of those
rows have empty content and can never embed, and an unordered heap scan
returns them *first* — so every run reported `embedded 36, failed 64` and the
counter still went down, which looked like slow-but-working progress.

It was not working. Two separate faults hid behind a falling number:

- Most of each batch was spent re-reading the same dead rows.
- `remaining` could never fall below 89, so `done` was unreachable and the
  cron would have re-run forever on work it was structurally unable to
  finish.

**The diagnostic that settled it in one call:** pause every cron, then fire a
single request with `batch: 10`. It embedded 0 of 10. Zero concurrency rules
out rate limiting immediately; a deterministic result points at scan order.
Guessing from the aggregate ratio would not have distinguished the two, and
"it's probably OpenAI throttling us" was the wrong first instinct.

The rule generalises: **any resumable job whose work queue is a filtered scan
must exclude the rows it can never complete, in both the select and the
count.** Filtering only the select fixes throughput and still never
terminates. In PostgREST, `neq ''` also drops NULLs, because `NULL <> ''` is
NULL and gets filtered out.

Two habits worth keeping from this:

1. A falling counter is not proof of health. Read the per-run `failed` number,
   not just `remaining`.
2. Verify a PostgREST filter against the live REST API before shipping code
   that depends on its exact syntax — `net.http_get` to `/rest/v1/<table>?...`
   with the service-role key answers it in one round trip.

## What's Here

```
CLAUDE.md          ← you are here; read this first every session
AGENTS.md          ← same playbook, Codex format
gemini.md          ← same playbook, Gemini CLI format
context/
  user.md          ← who Calvin is, how he works
  soul.md          ← agent posture, cadence, what to push back on
  brand/           ← single source of truth for voice and business
  api-catalog.md   ← curated Apify actors, MCP servers, and rtk setup
Team/
  ROSTER.md        ← who's on the team, skills, routing keywords
  Researcher/      ← investigation, benchmarking, source gathering
  Strategist/      ← planning, messaging, briefs
  Writer/          ← drafting; all surfaces
  Editor/          ← quality gate; voice + claim integrity
  Analyst/         ← data interpretation, KPIs, reporting
  HR/              ← hire new specialists when needed
.claude/skills/    ← atomic skills each role runs
templates/         ← planning depth matched to deliverable size
Outbox/            ← drop briefs here; Orchestrator scans on inbox-scan
Projects/          ← per-engagement work; always same 6-subfolder shape
Inbox/             ← cleared deliverables; you clear this, team never does
journal.md         ← audit trail; every dispatch appended; read tail on start
.agents/           ← MAVIS and persona agent definitions (do NOT modify these
                      unless the task is explicitly about agent architecture)
supabase/          ← edge functions; treat as production code
src/               ← React frontend; treat as production code
```

## RTK — Token Saver (60-90% reduction)

Calvin's `KaiyzerCal/rtk` repo is a Rust CLI that compresses command outputs before they hit LLM context. Run `rtk init -g` once (after building/installing it) to set up Claude Code hooks. After setup, prefer:

- `rtk git status` over `git status`
- `rtk ls src/` over `ls src/`
- `rtk grep "..." .` over grep
- `rtk pnpm build` over pnpm build

See `context/api-catalog.md` → RTK section for full setup instructions.

## Apify Integration

`supabase/functions/mavis-apify/index.ts` — proxies any Apify actor call. 
Requires `APIFY_API_KEY` in Supabase secrets vault.
`context/api-catalog.md` lists all 20+ curated actors and 131 MCP servers from `KaiyzerCal/API-mega-list`.

## Routing

Before acting on any request, read `Team/ROSTER.md` and classify the work.

| Signal | Route to |
|---|---|
| "research", "benchmark", "find", "what does X look like" | Researcher |
| "strategy", "framework", "brief", "how should I think" | Strategist |
| "write", "draft", "post", "copy", "email" | Writer |
| "review", "edit", "check voice", "QA" | Editor |
| "analyze", "report", "metrics", "KPIs" | Analyst |
| "hire", "new specialist", "I need someone who" | HR |
| code changes, bug fixes, feature work | **you — direct execution** |

For pipelines: Researcher → Strategist → Writer → Editor. See `.claude/skills/pipeline-deliverable.md`.

## Coding Principles — Ponytail Decision Ladder

Before writing any new code, work through this ladder top-to-bottom. Stop at the first match:

1. **Is code even needed?** Could a config option, env var, or existing flag handle this?
2. **Does it already exist in the codebase?** Search before writing. Duplicate code is a bug.
3. **Is it in the standard library?** Use what the runtime provides.
4. **Is it a native platform feature?** Deno: fetch, Deno.cron, KV. Web: DOM, CSS, browser storage.
5. **Is it in an already-installed dependency?** Check package.json first.
6. **Only then: write new code.** Write the minimum. No scaffolding for hypothetical future use.

Abstractions with one caller should be inlined. "We might need it later" is not a justification.
See `.claude/skills/ponytail.md` for `/ponytail-review` and `/ponytail-audit` commands.

## Database Changes — Read Before Any DDL

On 2026-08-22 a `CREATE TABLE` run against the live database took the app's
auth service down. The table was new and empty and nothing referenced it. The
damage came from one line: `REFERENCES auth.users(id)`.

**Why it broke.** Postgres queues lock requests in order. A DDL statement that
is *waiting* for a lock blocks every query that arrives behind it. The FK
needed a lock on `auth.users`; it did not get one immediately; every sign-in
queued behind it; the auth service stopped responding and the connection pool
filled. Recovery needed Lovable to restart the backend — no SQL path was
reachable, because the fix also needed a connection.

Four rules, in order of how much they matter:

1. **Every DDL statement sets `lock_timeout` first.** Non-negotiable.
   ```sql
   SET lock_timeout = '3s';
   SET statement_timeout = '60s';
   ```
   This makes the failure mode above unreachable: the statement fails in three
   seconds and releases the queue rather than becoming a head-of-line block.
   Write it into the migration file, not just the session.

2. **Treat `auth.users` as radioactive.** Anything referencing it — a foreign
   key, a trigger, an added column — takes a lock on the table every sign-in
   depends on. If a new table only needs ownership, `user_id uuid NOT NULL`
   plus an RLS policy is enough; the FK only buys `ON DELETE CASCADE`. When a
   cascade is genuinely wanted, add it as a separate `NOT VALID` constraint,
   with a `lock_timeout`, at a quiet moment.

3. **Make every migration re-runnable.** `IF NOT EXISTS`, `IF EXISTS`,
   `DO $$ ... EXCEPTION WHEN duplicate_object`. A statement that fails on a
   lock timeout must be safe to run again with no cleanup — otherwise rule 1
   trades an outage for a half-applied schema.

4. **A cancelled DDL is an unknown, not a failure.** If the client times out
   or the request is cancelled, the transaction's fate is undetermined. Verify
   the actual schema state before retrying, and say so plainly rather than
   assuming it did not run.

**Diagnosing the next one.** If the app is down and SQL is unreachable, check
whether the control plane still answers — Lovable's `get_me` and
`get_database_status` versus `query_database`. Control plane healthy plus every
query timing out means the database is blocked, not absent. Note that a lock can
exhaust the connection pool, so *reads failing too* does not rule a lock out —
that inference was drawn during this incident and it was wrong.

## Off-Limits

- Never modify `supabase/migrations/` without explicit instruction — migrations touch live data.
- Never run DDL without `lock_timeout` set — see "Database Changes" above.
- Never push to `main` directly. Always branch.
- Never skip pre-commit hooks.
- Never execute specialist work yourself when a pipeline is the right tool.
- Never ignore `journal.md` — append every dispatch when you route work.

## Session Start Protocol

1. Read the tail of `journal.md` (last 20 lines) to know where the team left off.
2. Scan `Outbox/` for queued briefs.
3. Check current git branch. If on `main`, ask before making changes.
4. Read `context/user.md` if this is a new task domain.

## What the Orchestrator Says When Routing

> "Routing to [Specialist]. I'll synthesize when they return."

Then give the specialist their brief, wait for output, synthesize, and respond to Calvin.
