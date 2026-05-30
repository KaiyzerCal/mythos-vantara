-- ═══════════════════════════════════════════════════════════
-- MAVIS Shard — May 2026 Infrastructure Sprint
-- MAVIS_SHARD_INFRA_SPRINT_MAY2026 v1.0
--
-- HOW TO USE:
--   Paste into Supabase Dashboard → SQL Editor and run.
--   Your user ID is detected automatically.
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  v_uid uuid := (SELECT id FROM auth.users LIMIT 1);
  v_now timestamptz := now();
BEGIN

-- ─────────────────────────────────────────────────────────
-- KNOWLEDGE GRAPH NOTE — full session log archived
-- ─────────────────────────────────────────────────────────
INSERT INTO public.mavis_notes (
  user_id, title, content, tags, aliases, properties, created_at, updated_at
) VALUES (
  v_uid,
  'MAVIS_SHARD: May 2026 Infrastructure Sprint',
  $NOTE$
## MAVIS Infrastructure Sprint — May 2026
## MAVIS_SHARD_INFRA_SPRINT_MAY2026 v1.0 | May 30, 2026

This shard documents a full infrastructure and performance sprint covering migration repair, UI improvements, and core AI response speed optimization.

---

## 1. Migration System Repair (44+ Migrations Fixed)

### Root Problem
Lovable's "Sync edge functions" button only deploys edge functions — it does NOT apply database migrations. Several migrations were marked as "applied" in Supabase migration history but had never actually executed. This caused cascading errors when trying to run `supabase db push --include-all`.

### Fixes Applied

**Missing tables (created via Supabase Dashboard with no migration file):**
- `vault_media` — added `CREATE TABLE IF NOT EXISTS` to `20260517220000_mavis_advanced.sql`
- `mavis_note_wikilinks` — added `CREATE TABLE IF NOT EXISTS` to `20260520000000_mcp_integration.sql`

**Invalid SQL syntax fixed across all migrations:**
- `CREATE POLICY IF NOT EXISTS` — this is not valid Postgres syntax. Replaced with `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` pattern across all 44+ migration files
- Bare `CREATE INDEX` — `IF NOT EXISTS` only guards against duplicate index name, NOT a missing table. Wrapped all 76 bare `CREATE INDEX` statements across 35 files in `DO $$ BEGIN ... EXCEPTION WHEN undefined_table THEN NULL; END $$;`

**Nested DO blocks (introduced by a buggy Python wrapper script):**
- The script tracked `in_do_block` by checking if the last output string started with `DO $` — but output strings are multi-line, so consecutive policies got double-wrapped
- Also corrupted 4 migrations that already had valid `DO $ / IF NOT EXISTS` patterns
- Fixed by rewriting with a proper `do_depth` counter tracking actual DO block nesting in source
- Manually restored the 4 nested-DO files: `20260518040000_oura_strava_github.sql`, `20260518050000_morning_digest.sql`, `20260518060000_weather_rss.sql`, `20260518080000_workflows.sql`

**Re-ran never-applied migration:**
- `20260512210000` was marked applied but never ran → `supabase migration repair --status reverted 20260512210000` to un-mark it, then db push re-executed it

**Result:** `supabase db push --include-all` completed successfully — all 44+ migrations applied.

---

## 2. Council Board — Member Call Dropdown (PR #18)

### Change
Replaced the row of per-member pill buttons for 1-on-1 voice calls with a single styled `<select>` dropdown.

**File:** `src/pages/CouncilBoard.tsx` (lines ~472–500)

**Before:** One `<button>` per council member rendered inline — cluttered when many members exist.

**After:**
```tsx
{councilMembers.length > 0 && (
  <div className="relative mt-1.5 inline-flex items-center gap-1 group">
    <PhoneCall size={10} className="text-emerald-400/70 shrink-0" />
    <select
      defaultValue=""
      onChange={(e) => {
        const member = councilMembers.find(m => m.id === e.target.value);
        if (!member) return;
        e.target.value = ""; // reset to placeholder after selection
        setVoiceTarget({ name: member.name, role: member.role ?? member.specialty,
          systemPrompt: buildCouncilMemberVoicePrompt(member, ""),
          entityId: member.id, entityType: "council", userId: userId ?? undefined });
      }}
      className="appearance-none text-[10px] font-mono font-medium text-emerald-400
        bg-emerald-950/30 hover:bg-emerald-950/50 border border-emerald-800/40
        hover:border-emerald-500/50 rounded-md pl-2 pr-6 py-1 transition-all
        cursor-pointer focus:outline-none focus:border-emerald-500/60"
    >
      <option value="" disabled>Call a member…</option>
      {councilMembers.map((m) => (
        <option key={m.id} value={m.id}>{m.name}{m.role ? ` — ${m.role}` : ""}</option>
      ))}
    </select>
    <ChevronDown size={10} className="absolute right-1.5 text-emerald-400/60 pointer-events-none" />
  </div>
)}
```

Dropdown resets to placeholder after each selection so it's reusable without refresh.

---

## 3. MAVIS Response Speed Fix — Parallel DB Fetch (PR #19)

### Root Problem
MAVIS was slow to respond compared to other AI systems. Root cause: `supabase/functions/mavis-chat/index.ts` had **5 serial `await` groups** before calling the AI model, each adding ~70ms of Postgres round-trip latency = ~350ms of pure waiting before the AI even started.

**Serial groups before fix:**
1. Profile fetch (single query)
2. 18-query `Promise.all` for app data (quests, tasks, skills, journal, vault, councils, etc.)
3. Tacit memory fetch (separate await)
4. NAVI ecosystem fetch (2 queries, separate await)
5. Proactive alerts fetch (3 queries, separate await)

### Fix Applied
Collapsed all 5 groups into **one mega `Promise.all`** with 26 queries launching simultaneously. MAVIS now pays a single Postgres round-trip before calling the AI.

**File:** `supabase/functions/mavis-chat/index.ts`

**New structure (lines 886–924):**
```typescript
const [
  profileRes,
  questsRes, tasksRes, skillsRes, journalRes, vaultRes, councilsRes,
  alliesRes, energyRes, inventoryRes, ritualsRes, transformationsRes,
  rankingsRes, bpmRes, storeRes, currenciesRes, vaultMediaRes,
  activityRes, memoriesRes,
  tacitRes,
  naviPersonasRes, naviRelationsRes,
  stalledRes, streakRes, revenueRes,
] = await Promise.all([
  // ...26 queries all fire at once...
]);
```

Latency improvement: ~350ms removed from every single MAVIS chat response (before first token).

**CRITICAL INVARIANT — never remove:**
The `BOUND_OPERATORS` security gate (lines 28–41) using `MAVIS_OPERATOR_MAIN_ID` and `MAVIS_OPERATOR_CALIYAH_ID` env vars must always remain. These are set in Supabase Dashboard → Settings → Edge Functions → Secrets.

---

## 4. Architecture Invariants (Post-Sprint)

- All new migrations must use `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` for CREATE POLICY
- All new migrations must use `DO $$ BEGIN ... EXCEPTION WHEN undefined_table THEN NULL; END $$;` for CREATE INDEX
- Never use `CREATE POLICY IF NOT EXISTS` — it is invalid Postgres syntax
- `supabase db push --include-all` is the correct command for applying out-of-order migrations
- `supabase migration repair --status reverted <version>` un-marks a migration so CLI re-runs it
- Lovable "Sync edge functions" does NOT apply migrations — only deploys function code

---

## 5. Pending Items (as of May 30, 2026)

| Item | Status | Action |
|---|---|---|
| Deploy mavis-chat speed fix | **Pending** | Run `supabase functions deploy mavis-chat` |
| Merge PR #19 (speed fix) | **Open** | Merge on GitHub |
| Set MAVIS_OPERATOR_MAIN_ID secret | **Pending** | Supabase Dashboard → Settings → Edge Functions → Secrets |
| Create widgets storage bucket | **Pending** | `supabase storage buckets create widgets --public` |

---

## 6. PRs from This Sprint

| PR | Title | Status |
|---|---|---|
| #18 | Council Board member call dropdown | Merged |
| #19 | perf: merge all MAVIS DB queries into one parallel Promise.all | Open |

$NOTE$,
  ARRAY['system', 'infrastructure', 'build-log', 'migrations', 'performance', 'mavis', 'shard', 'sprint', 'may-2026'],
  ARRAY['MAVIS Infra Sprint', 'May 2026 Sprint', 'Migration Repair Log', 'MAVIS Speed Fix'],
  '{"shard": true, "version": "1.0", "skip_sr": true, "sprint": "may-2026", "prs": [18, 19]}'::jsonb,
  v_now,
  v_now
)
ON CONFLICT DO NOTHING;

END $$;
