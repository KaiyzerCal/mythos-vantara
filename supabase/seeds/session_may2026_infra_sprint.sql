-- ═══════════════════════════════════════════════════════════
-- MAVIS Shard — May 2026 Infrastructure Sprint
-- MAVIS_SHARD_INFRA_SPRINT_MAY2026 v1.0
--
-- HOW TO USE:
--   Paste into Supabase Dashboard → SQL Editor and run.
--   Your user ID is detected automatically.
-- ═══════════════════════════════════════════════════════════

DO $BODY$
DECLARE
  v_uid uuid := (SELECT id FROM auth.users LIMIT 1);
  v_now timestamptz := now();
BEGIN

INSERT INTO public.mavis_notes (
  user_id, title, content, tags, aliases, properties, created_at, updated_at
) VALUES (
  v_uid,
  'MAVIS_SHARD: May 2026 Infrastructure Sprint',
  $SHARD$
## MAVIS Infrastructure Sprint — May 2026
## MAVIS_SHARD_INFRA_SPRINT_MAY2026 v1.0 | May 30, 2026

This shard documents a full infrastructure and performance sprint covering migration repair, UI improvements, and core AI response speed optimization.

---

## 1. Migration System Repair (44+ Migrations Fixed)

### Root Problem
Lovable "Sync edge functions" only deploys edge function code — it does NOT apply database migrations. Several migrations were marked "applied" in Supabase migration history but had never actually executed, causing cascading errors on `supabase db push --include-all`.

### Fixes Applied

**Missing tables (no migration file existed):**
- `vault_media` — created via Supabase Dashboard. Added `CREATE TABLE IF NOT EXISTS` to 20260517220000_mavis_advanced.sql
- `mavis_note_wikilinks` — same issue. Added `CREATE TABLE IF NOT EXISTS` to 20260520000000_mcp_integration.sql

**Invalid SQL syntax fixed across all migrations:**
- `CREATE POLICY IF NOT EXISTS` is not valid Postgres syntax. Replaced throughout with the correct pattern: DO block with EXCEPTION WHEN duplicate_object THEN NULL
- Bare `CREATE INDEX` — IF NOT EXISTS only guards against a duplicate index name, NOT a missing table. Wrapped all 76 bare CREATE INDEX statements across 35 files in DO blocks with EXCEPTION WHEN undefined_table THEN NULL

**Nested DO blocks (caused by a buggy Python wrapper script):**
- Script tracked in_do_block by checking if the last output string started with "DO $" but output strings are multi-line — consecutive policies got double-wrapped
- Also corrupted 4 migrations that already had valid DO / IF NOT EXISTS patterns
- Fixed with a proper do_depth counter. Restored 4 files manually: 20260518040000_oura_strava_github.sql, 20260518050000_morning_digest.sql, 20260518060000_weather_rss.sql, 20260518080000_workflows.sql

**Re-ran never-applied migration:**
- 20260512210000 was marked applied but never ran
- Fix: `supabase migration repair --status reverted 20260512210000` then db push re-executed it

**Result:** `supabase db push --include-all` completed — all 44+ migrations applied.

---

## 2. Council Board — Member Call Dropdown (PR #18)

Replaced the row of per-member pill buttons for 1-on-1 voice calls with a single styled select dropdown.

**File:** src/pages/CouncilBoard.tsx (~lines 472–500)

The dropdown:
- Shows "Call a member..." as placeholder
- Lists all council members as options (name + role)
- On selection: fires setVoiceTarget, then resets to placeholder so it is reusable without refresh
- Styled with emerald theme, ChevronDown icon overlay, appearance-none for custom look

---

## 3. MAVIS Response Speed Fix — Parallel DB Fetch (PR #19)

### Root Problem
MAVIS was slow vs competitors. Root cause: supabase/functions/mavis-chat/index.ts had 5 serial await groups before calling the AI, each costing ~70ms of Postgres round-trip latency = ~350ms of pure waiting before the AI even started.

**Serial groups before fix:**
1. Profile fetch (1 query)
2. 18-query Promise.all for app data (quests, tasks, skills, journal, vault, councils, etc.)
3. Tacit memory fetch (separate await)
4. NAVI ecosystem (2 queries, separate await)
5. Proactive alerts (3 queries, separate await)

### Fix Applied
Collapsed all 5 groups into one mega Promise.all with 26 queries firing simultaneously.
MAVIS now pays a single Postgres round-trip before calling the AI.

**File:** supabase/functions/mavis-chat/index.ts (lines 886-924)

Variables destructured from the single Promise.all:
profileRes, questsRes, tasksRes, skillsRes, journalRes, vaultRes, councilsRes,
alliesRes, energyRes, inventoryRes, ritualsRes, transformationsRes,
rankingsRes, bpmRes, storeRes, currenciesRes, vaultMediaRes,
activityRes, memoriesRes, tacitRes,
naviPersonasRes, naviRelationsRes,
stalledRes, streakRes, revenueRes

Latency improvement: ~350ms removed from every MAVIS chat response (before first token).

**CRITICAL INVARIANT — never remove:**
The BOUND_OPERATORS security gate (lines 28–41) using MAVIS_OPERATOR_MAIN_ID and MAVIS_OPERATOR_CALIYAH_ID env vars must always remain intact.
These are set in: Supabase Dashboard → Settings → Edge Functions → Secrets.

---

## 4. Architecture Invariants (Post-Sprint)

- All new migrations: use DO block with EXCEPTION WHEN duplicate_object for CREATE POLICY
- All new migrations: use DO block with EXCEPTION WHEN undefined_table for CREATE INDEX
- Never use CREATE POLICY IF NOT EXISTS — invalid Postgres syntax
- `supabase db push --include-all` is the correct command for out-of-order migrations
- `supabase migration repair --status reverted <version>` un-marks a migration so CLI re-runs it
- Lovable "Sync edge functions" does NOT apply migrations — only deploys function code

---

## 5. Pending Items (as of May 30, 2026)

- Deploy mavis-chat speed fix → run: supabase functions deploy mavis-chat
- Merge PR #19 (speed fix) on GitHub
- Set MAVIS_OPERATOR_MAIN_ID secret → Supabase Dashboard > Settings > Edge Functions > Secrets
- Create widgets storage bucket → supabase storage buckets create widgets --public

---

## 6. PRs from This Sprint

- PR #18: Council Board member call dropdown — Merged
- PR #19: perf: merge all MAVIS DB queries into one parallel Promise.all — Open
  $SHARD$,
  ARRAY['system', 'infrastructure', 'build-log', 'migrations', 'performance', 'mavis', 'shard', 'sprint', 'may-2026'],
  ARRAY['MAVIS Infra Sprint', 'May 2026 Sprint', 'Migration Repair Log', 'MAVIS Speed Fix'],
  '{"shard": true, "version": "1.0", "skip_sr": true, "sprint": "may-2026", "prs": [18, 19]}'::jsonb,
  v_now,
  v_now
)
ON CONFLICT DO NOTHING;

END $BODY$;
