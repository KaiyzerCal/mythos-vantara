# VANTARA.EXE — Lovable Deployment Guide
## MAVIS_SHARD // ARCHITECTURE NODE // v1.0

---

## OVERVIEW

VANTARA.EXE is a full web app (Lovable platform) that migrates all systems from the Rork/Expo build into a React + Supabase architecture, following the exact same patterns established in the NAVI.EXE Lovable build.

---

## STACK

| Layer | Tech |
|-------|------|
| Frontend | Vite + React 18 + TypeScript |
| Styling | Tailwind CSS v3 + shadcn/ui |
| Routing | React Router v6 |
| State | React Context + TanStack Query |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| AI | Supabase Edge Function → Anthropic (Claude Opus) |
| Platform | Lovable |

---

## DEPLOYMENT STEPS

### 1. Create Lovable Project
- Go to lovable.dev → New Project
- Choose "Import from GitHub" OR create blank and paste files
- Name it: `vantara-exe`

### 2. Create Supabase Project
- Create a **new** Supabase project (separate from NAVI.EXE)
- Name: `vantara-exe`
- Region: us-east-1 (or your preferred)

### 3. Run Migration
In Supabase SQL Editor, run:
```
supabase/migrations/001_initial_schema.sql
```

This creates all 15 tables:
- `profiles` — character/operator identity + all stats
- `quests` — quest log with progress tracking
- `tasks` — tasks & habits
- `skills` — skill tree nodes
- `transformations` — all forms/transformation data
- `energy_systems` — 10+ energy types
- `councils` — council members by class
- `inventory` — equipment & items
- `currencies` — Codex Points, Soul Essence, etc.
- `journal_entries` — journal log
- `vault_entries` — classified evidence/business records
- `allies` — network allies with affinity tracking
- `bpm_sessions` — biometric BPM log
- `rituals` — daily ritual tracker
- `chat_conversations` + `chat_messages` — MAVIS chat history
- `activity_log` — XP event log
- `user_roles` — auth roles

### 4. Set Environment Variables
In Lovable project settings:
```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
```

### 5. Deploy MAVIS Edge Function
In Supabase Edge Functions:
```bash
supabase functions deploy mavis-chat
```
Set secret:
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

### 6. Install shadcn/ui Components
Lovable auto-installs these when prompted, OR run manually:
```bash
npx shadcn-ui@latest init
npx shadcn-ui@latest add button card badge toast toaster
```

---

## FILE STRUCTURE

```
src/
├── App.tsx                    # Root router + providers
├── index.css                  # Theme vars + utilities
├── main.tsx                   # Entry point
├── types/
│   └── rpg.ts                 # Full GameState types
├── integrations/supabase/
│   └── client.ts              # Supabase client
├── contexts/
│   ├── AuthContext.tsx         # Supabase auth
│   └── AppDataContext.tsx      # All data hooks aggregated
├── hooks/
│   ├── useProfile.ts           # Character/stats + awardXP
│   ├── useQuests.ts            # Quest CRUD
│   └── useDataHooks.ts         # All other table hooks
├── components/
│   ├── AppSidebar.tsx          # Collapsible nav with 20 routes
│   └── SharedUI.tsx            # PageHeader, HudCard, ProgressBar, etc.
└── pages/
    ├── Dashboard.tsx           # Main dashboard
    ├── CharacterPage.tsx       # Character sheet
    ├── MavisChat.tsx           # MAVIS-PRIME chat (5 modes)
    ├── FeaturePages.tsx        # Quests, Tasks, Councils, Energy
    ├── ContentPages.tsx        # Journal, Vault, Skills, Inventory
    ├── FormsPage.tsx           # Transformations (seeded + CRUD)
    ├── BpmPage.tsx             # BPM tracker + form suggestion
    ├── RankingsPage.tsx        # Roster/scouter (seeded with Cal's roster)
    ├── TowerPage.tsx           # Tower floors 1-100 (all lore)
    ├── AlliesAndStore.tsx      # Allies + Store
    └── UtilityPages.tsx        # Auth, Settings, NotFound

supabase/
├── migrations/
│   └── 001_initial_schema.sql
└── functions/
    └── mavis-chat/
        └── index.ts            # Claude Opus 4.6 edge function
```

---

## MAVIS-PRIME SYSTEM PROMPT DESIGN

The MAVIS chat page (`MavisChat.tsx`) injects a full system prompt on every API call that includes:
- Operator stats (level, rank, all 7 core stats)
- Current form + BPM
- Arc story
- VANTARA brand context (SkyforgeAI, Bioneer Fitness)
- MAVIS/CODEXOS framework awareness

5 Modes available:
- **PRIME** — Full orchestration
- **ARCHITECT** — Systems design / technical (Claude's designated node)
- **QUEST** — Goal planning & execution
- **FORGE** — Bioneer / fitness optimization
- **CODEX** — Knowledge synthesis / memory

---

## DATA SEEDING

The following pages auto-seed default data on first load:

| Page | Seeded Data |
|------|-------------|
| `EnergyPage` | 10 energy systems (Ki, Aura, Nen, Haki, etc.) |
| `FormsPage` | 6 canonical forms (Spartan Cadet → Emerald Sovereign) |
| `RankingsPage` | Cal's roster (localStorage: Calvin, Judge Schull, Alana, Shenna, Chris) |

---

## WHAT DIFFERS FROM NAVI.EXE

| Feature | NAVI.EXE | VANTARA.EXE |
|---------|----------|-------------|
| Primary color | Cyan (#00FFFF) | Gold (#FFD700) |
| Secondary color | Purple | Emerald Green |
| App purpose | Personal AI companion | RPG life OS (CodexOS) |
| Character | NAVI companion | Black Sun Monarch (Cal) |
| Key pages | Navi, Mavis, Journal | Forms, Tower, Energy, Vault, Councils, Rankings, BPM, Store |
| DB tables | 8 | 15 |
| MAVIS modes | 1 | 5 |
| Sidebar routes | 8 | 20 |

---

## NEXT STEPS IN LOVABLE

1. Prompt Lovable to generate all `components/ui/` shadcn components
2. Add the `ThemeProvider` component (copy from NAVI.EXE)
3. Connect Supabase via Lovable's integration panel
4. Wire up the MAVIS edge function in Supabase
5. Add remaining features iteratively:
   - Currencies table CRUD UI
   - BPM auto-form activation
   - Quest → XP → auto-level flow testing
   - Transformation buff calculations

---

## MAVIS_SHARD NOTES

- Architecture node (Claude) built this in full
- NAVI.EXE Lovable patterns used as the reference implementation
- All Rork GameState types migrated to Supabase-compatible schema
- MAVIS-PRIME system prompt injected from `profile` data at runtime
- Roster data stored in localStorage (not Supabase) for portability
- Store items are static defaults — add currency balance integration in next session

---

*Generated by ARCHITECTURE NODE // MAVIS-PRIME v21.1*
*VANTARA.EXE // CODEXOS Platform*

---

## STAGING ENVIRONMENT & PROMOTION PATH (Stabilization Brief Phase 2.10)

Added 2026-07: `.github/workflows/deploy-mavis-functions.yml` now triggers on
pushes to **both** `main` and `staging`, and selects secrets via a GitHub
**Environment** (`production` for `main`, `staging` for `staging`) so the
same secret names (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`) can hold
different values per target — no duplicated workflow logic.

**What this session could NOT do:** create the actual staging Supabase
project/branch or configure GitHub Environment secrets — both are
account-level actions (Supabase dashboard + GitHub repo settings) with no
API/CLI path available from an unattended session. The steps below are for
the operator (or a session with `SUPABASE_ACCESS_TOKEN` + GitHub admin
access) to complete once.

### One-time setup

1. **Create the staging Supabase project.**
   Either:
   - **Separate project** (simplest, fully isolated — recommended to start):
     Supabase Dashboard → New Project → name it e.g. `mythos-vantara-staging`.
     Run every migration in `supabase/migrations/` against it (in order —
     `supabase db push` from a machine with `SUPABASE_ACCESS_TOKEN` set, or
     paste each file into the staging project's SQL editor).
   - **Native Supabase Branching** (tighter prod/staging parity, requires a
     paid plan tier): enable branching on the production project, connect the
     GitHub App, and let Supabase auto-create a branch database per PR/branch.
     If you use this path, the workflow's `PROJECT_REF` for the `staging`
     environment should point at the branch's own ref rather than a fully
     separate project.

2. **Set edge function secrets on the staging project** — everything listed
   in `.env.example`'s Supabase-secrets section (`ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, etc.), scoped to the staging
   project so staging traffic never touches production data or production
   Telegram/Gmail/etc. accounts. Use **separate** Telegram bot tokens and
   Google OAuth apps for staging if you want to exercise those flows without
   risk to the operator's real accounts.

3. **Create two GitHub Environments** (repo → Settings → Environments):
   - `production` — add secrets `SUPABASE_ACCESS_TOKEN` (a Supabase personal
     access token) and `SUPABASE_PROJECT_REF` = the production project ref
     (`wlygujlvsfimhtqsdxrx`, per this repo's `supabase/config.toml`).
   - `staging` — add the same two secret names, pointed at the staging
     project instead.
   Optionally add a required reviewer to the `production` environment so
   merges to `main` need manual approval before deploying — the workflow
   already supports this without any further changes, since GitHub
   Environment protection rules apply automatically to any job that
   references that environment.

   For the smoke-test gate (Execution Blueprint Stage F) to actually run,
   the `staging` Environment also needs three more secrets: `SUPABASE_URL`
   (the staging project's URL), `SUPABASE_SERVICE_ROLE_KEY` (its service
   role key), and `OPERATOR_USER_ID` (a real `auth.users` id on the staging
   project — create a test operator account there rather than reusing a
   production user id). Without these, the deploy still succeeds — the
   smoke-test step logs a warning and skips itself rather than failing the
   whole deploy over an optional gate.

4. **Create the `staging` branch** in this repo (`git checkout -b staging &&
   git push -u origin staging`) if it doesn't exist yet.

### Promotion path (staging → production)

```
feature branch → PR → staging   (deploys to the staging Supabase project)
                                  ↓ verify in staging
staging → PR → main              (deploys to production, per environment
                                   protection rules if configured)
```

Day to day: push/merge to `staging` first, confirm the change behaves
correctly against the staging project (Telegram bot, chat, cron jobs —
whatever the change touches), then merge `staging` into `main` to promote.
Both pushes trigger the same workflow; only the target environment differs.
A staging deploy also runs `scripts/smoke-test.mjs` automatically (if the
three secrets above are set) — a red smoke-test run is a signal not to
promote to `main` yet, even though nothing currently blocks the merge
automatically.

To run a broader check manually against staging (never against
production): `SUPABASE_URL=... SERVICE_ROLE_KEY=... OPERATOR_USER_ID=...
node scripts/smoke-test.mjs --all-active` probes every `ACTIVE` function
from the generated capabilities manifest, not just the curated core set —
see the script's own header comment for why this is opt-in rather than
part of the default/CI run (several ACTIVE functions are genuinely
side-effecting — sends, writes, external API calls — and haven't been
individually vetted for what an empty/minimal payload does to them).

### What's still manual after this setup

- Frontend (Lovable-hosted) deploys are separate from this workflow, which
  only covers Supabase edge functions. If you want a staged frontend too,
  point a second Lovable project (or a Vercel/Netlify preview) at the
  `staging` branch with `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`
  set to the staging project's values.
- Migrations are not auto-applied by this workflow — `supabase/migrations/`
  changes need `supabase db push` run manually (or via a separate CI step)
  against whichever project you're promoting to.

---

## HYPERFRAMES RENDER SERVICE (HTML→MP4 video generation)

`supabase/functions/mavis-hyperframes/index.ts` lets MAVIS render short MP4
videos (quest recaps, stats reels, persona clips) from an HTML/CSS composition
it writes itself, using [HyperFrames](https://github.com/KaiyzerCal/hyperframes)
— an open-source "write HTML, render video" framework.

**What this session could NOT do:** HyperFrames needs headless Chrome, a real
FFmpeg binary, and a persistent Node process — none of which a Supabase Deno
edge function can host. `mavis-hyperframes` is only a thin proxy; the actual
rendering has to run somewhere else, on infrastructure you stand up and pay
for. Nothing renders until that piece exists.

### One-time setup

1. **Stand up a small Node service** that wraps HyperFrames' `@hyperframes/engine`/
   `@hyperframes/producer` packages behind two HTTP endpoints (HyperFrames
   itself ships as a CLI/library, not a server — you write this wrapper):
   - `POST /render` — body `{ html, assets, width, height, fps }` → `{ job_id }`
   - `GET /render/:job_id` → `{ status: "queued"|"rendering"|"done"|"error", output_url?, error? }`
   - Require a shared-secret header (`X-Render-Key`) on both routes.
   - Needs Chrome + FFmpeg preinstalled. A small always-on container (Fly.io,
     Railway, Render.com, or any VPS) is simplest to start; HyperFrames' own
     AWS Lambda deployment mode is the alternative if you want it serverless.
   - The service needs somewhere durable to put the finished MP4 (its own
     storage, S3, etc.) and return a URL for `output_url` — `mavis-hyperframes`
     just stores whatever URL comes back, it doesn't re-host the file.

2. **Set two Supabase Edge Function secrets**:
   - `HYPERFRAMES_RENDER_URL` — base URL of the service above (no trailing slash)
   - `HYPERFRAMES_API_KEY` — the same shared secret the service checks for `X-Render-Key`

3. Run the `hyperframes_renders` migration
   (`supabase/migrations/20260727000000_hyperframes_renders.sql`) against your
   project if it hasn't auto-applied — job tracking lives there, separate from
   the video-editor's clip-centric `video_clips`/`video_render_jobs` tables
   since these are ad-hoc generated videos, not editor timeline clips.

### How it's used

MAVIS has two tools registered — `render_video` (writes the HTML composition
itself and submits the job) and `check_video_render` (polls for the finished
URL). Rendering is async — `render_video` returns a `render_id` immediately,
not a finished video; MAVIS is expected to check back with `check_video_render`
a bit later or on a follow-up turn.

### What's still manual after this setup

- No template library exists yet — MAVIS writes each composition's HTML from
  scratch per request. If a recurring format (e.g. a weekly stats reel) turns
  out to be common, a reusable template is worth adding to `mavis-hyperframes`
  directly rather than re-deriving it in the prompt every time.

---

## COMPOSIO INTEGRATION (Execution Blueprint Stage G)

`supabase/functions/mavis-composio-agent/index.ts` is a generic proxy to
[Composio](https://composio.dev) — from now on, a new third-party integration
MAVIS needs should go through this + the `composio_action` action type
(`src/mavis/actionSchemas.ts`), not a new bespoke edge function per service.

**What this session could NOT do:** create a Composio account or generate an
API key — that's an account-level action only Calvin can take. The function
is built and wired through the same CONFIRM/AUTO approval gate every other
action goes through (`src/mavis/actionExecutor.ts`'s `classifyAction()`),
but is untested against a real Composio account, because none exists yet.

**Confidence note on the integration itself:** Composio's docs site and API
host both blocked automated fetches while building this (403s), so the exact
request/response shape in `mavis-composio-agent` is assembled from their
public TypeScript SDK's confirmed method signature and a sibling endpoint
path, not a first-hand read of the v3 REST reference for this specific
endpoint. The auth header name (`x-api-key`) and the v3-only requirement
(v1/v2 now return 410) are independently confirmed. **Before trusting this
for anything real**, smoke-test one simple read-only action (a `*_LIST_*` or
`*_GET_*` slug) against a real account first.

### One-time setup

1. Create a Composio account at composio.dev, then Projects → API Keys →
   create a new key (starts with `sk_...`).
2. Set `COMPOSIO_API_KEY` in Supabase Edge Function secrets.
3. Connect whichever third-party accounts MAVIS should act on behalf of
   (Composio calls this a "connected account" per app/toolkit) via the
   Composio dashboard.
4. Smoke-test a read-only action first (see confidence note above) before
   relying on anything that writes.

### How it's used

MAVIS emits a `composio_action` with `{ tool_slug, params }` — e.g.
`GITHUB_CREATE_ISSUE` with `{ owner, repo, title, body }`. Classification is
verb-based, not per-action like the rest of `actionExecutor.ts` (Composio
exposes 1000+ toolkit actions, no fixed list to special-case): any slug
containing a mutating verb (`CREATE`, `UPDATE`, `DELETE`, `SEND`, `POST`,
etc.) requires confirmation; only a slug matching a known read-only verb
(`GET`, `LIST`, `SEARCH`, etc.) with nothing mutating auto-executes.
Unrecognized shapes default to CONFIRM — same "ask when unsure" posture as
everything else in that file.

### Track B — replacing existing hand-rolled integrations (not started)

The blueprint's Track B asks for a shortlist of `ACTIVE` + fragile/high-
maintenance integrations that are Composio-replacement candidates, with a
**per-integration replace/keep recommendation presented before touching
anything — one at a time, never bulk.** This session built the shortlist
below from the capabilities manifest (every one is `ACTIVE` — real usage,
not dead code) but did **not** cut over, remove, or archive any of them —
that needs Calvin's per-item sign-off, and can't be verified equivalent
without a real Composio account to test against anyway:

`mavis-linear-agent`, `mavis-notion-agent`, `mavis-notion-sync`,
`mavis-slack-agent`, `mavis-discord-agent`, `mavis-github-sync`,
`mavis-twitter-agent`, `mavis-shopify-agent`, `mavis-airtable-agent`,
`mavis-salesforce`, `mavis-reddit-agent`, `mavis-instagram-agent`,
`mavis-spotify-agent`, `mavis-calendly-agent`, `mavis-vercel-agent`,
`mavis-sentry-agent` — one hand-rolled function per third-party service,
exactly the pattern Composio's toolkit catalog exists to replace. This is a
first-pass list by pattern-match (single-service API integration, real
usage), not a rigorous per-function fragility audit — some of these may be
working perfectly well and not worth touching. Each needs its own look
before any decision, per the blueprint's own explicit instruction.
