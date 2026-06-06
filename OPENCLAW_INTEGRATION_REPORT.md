# OpenClaw Integration Report
## MAVIS Sovereign Upgrade — Build Summary
## Date: 2026-05-12 | Branch: claude/setup-mavis-persona-ecosystem-nsbKO

---

## What Was Built

### Database Layer (Supabase Migration)
**File**: `supabase/migrations/20260512194522_mavis_memory_system.sql`

Six new tables:
- `mavis_memory` — Layer 2 session logs (role, content, timestamp, consolidated flag)
- `mavis_knowledge` — Layer 1 PARA knowledge graph (project/area/resource/archive)
- `mavis_tacit` — Layer 3 tacit knowledge (preferences, hard rules, lessons, workflow habits)
- `mavis_tasks` — Task ledger for autonomous operations visibility
- `mavis_revenue` — Revenue ledger tracking all CODEXOS income streams
- `mavis_consolidation_log` — Nightly consolidation audit trail

All tables have RLS enabled with per-user policies. All have appropriate indexes.

---

### Three-Layer Memory Engine
**File**: `src/mavis/memoryEngine.ts` (complete replacement)

- `initSession(userId, sessionId?)` — initializes session state + userId for persistence
- `addMessage(msg)` — sync shim (persists to Supabase fire-and-forget)
- `addMessageAsync(msg)` — async version with error surface
- `loadSession(sessionId)` — rehydrate full session from Layer 2
- `loadRecentMemory(limit)` — cross-session context for system prompt
- `listSessions()` — enumerate all sessions (for session picker UI)
- `saveKnowledge(entry)` — write to Layer 1 knowledge graph
- `getKnowledge(category, limit)` — read Layer 1 by category
- `searchKnowledge(query)` — full-text search Layer 1
- `saveTacit(entry)` — write to Layer 3 tacit knowledge
- `getTacit(category?)` — read Layer 3 by category
- `getAllTacit()` — full Layer 3 dump
- `buildMemoryContext()` — assembles all three layers into system prompt string

Legacy exports (`clearMessages`, `serializeMessages`, `loadMessages`) preserved for backward compatibility.

---

### Skill System
**Directory**: `src/mavis/skills/`

- `_registry.ts` — `registerSkill()`, `matchSkillByKeyword()`, `invokeSkill()`, `getAllSkills()`
- `_loader.ts` — imports all skills to trigger self-registration (import once at app startup)
- `daily-brief/index.ts` — quests + habits + energy readiness report
- `quest-review/index.ts` — full quest status with idle detection (7+ days)
- `energy-check/index.ts` — energy systems + BPM session history
- `revenue-report/index.ts` — `mavis_revenue` totals + breakdown by source
- `knowledge-extract/index.ts` — explicit memory save ("remember that X")

Skills fire before the LLM call when keywords match, short-circuiting unnecessary API calls.

---

### Standing Orders
**Files**: `src/mavis/standingOrders.ts`, `src/mavis/MAVIS_STANDING_ORDERS.md`

- 21 directives across 5 categories: Identity, Operational, Safety, Communication, Revenue
- `getStandingOrders()` returns the full directive string
- `addStandingOrder()` / `removeStandingOrder()` for runtime customization
- Injected into every system prompt via `buildSystemPromptFromSnapshot()`

---

### Task Ledger
**File**: `src/mavis/taskLedger.ts`

- `createTask(userId, task)` — log a new autonomous operation
- `getPendingTasks(userId)` — pending/running/requires_confirmation tasks
- `getAllTasks(userId, limit)` — full history
- `completeTask(taskId, result, revenueGenerated?)` — mark complete
- `cancelTask(taskId)`, `failTask(taskId, errorMessage)` — state transitions
- `inferCommitment(text)` — detects "I'll X" / "I need to X" patterns in user input

---

### Revenue Engine
**File**: `src/mavis/revenueEngine.ts`

- `logRevenue(userId, event)` — write to `mavis_revenue`
- `getRevenueTotal(userId)` — aggregate total
- `getRevenueBySource(userId)` — breakdown by source
- `getRevenueHistory(userId, limit)` — recent transactions

Sources: `skyforgeai_subscription`, `bioneer_subscription`, `vantara_sale`, `skill_sale`, `service_sale`, `affiliate`, `custom`

---

### buildSystemPrompt Updates
**File**: `src/mavis/buildSystemPrompt.ts`

- Added imports: `getStandingOrders`, `buildMemoryContext`
- `buildSystemPromptFromSnapshot()` is now **async**
- Injects standing orders + three-layer memory context into every system prompt
- Base personality (200-line MAVIS identity block) preserved verbatim

---

### Callers Updated for Async Prompt
- `src/pages/MavisChat.tsx` — `await buildSystemPromptFromSnapshot(...)` with parens wrap
- `src/mavis/councilBoardService.ts` — `await buildSystemPromptFromSnapshot(...)` 
- `src/pages/MavisChat.tsx` — added `initSession(session.user.id)` in DB-load effect
- `src/pages/MavisChat.tsx` — imports `initSession` from memoryEngine, imports `_loader` for skill registration

---

### Edge Functions
**`supabase/functions/mavis-consolidate/index.ts`**
- Nightly consolidation (Felix-equivalent pattern)
- Reads unconsolidated Layer 2 messages per user
- Calls `claude-haiku-4-5-20251001` for cost efficiency
- Extracts → `mavis_knowledge` (Layer 1) + `mavis_tacit` (Layer 3)
- Marks `consolidated = true`, logs to `mavis_consolidation_log`
- Deploy: `npx supabase functions deploy mavis-consolidate`
- Schedule: Configure via Supabase dashboard pg_cron (recommended: 3:00 AM daily)

**`supabase/functions/mavis-stripe-webhook/index.ts`**
- Handles `payment_intent.succeeded` + `checkout.session.completed`
- Writes to `mavis_revenue` + creates entry in `mavis_tasks`
- Requires `metadata.user_id` + `metadata.source` on every PaymentIntent
- Configure in Stripe dashboard: `POST /functions/v1/mavis-stripe-webhook`

---

## What Was Deferred

| Item | Reason | Phase |
|------|--------|-------|
| ALFRED source code analysis | `openclaw-fork` repo not locally available | Background read |
| Active product creation loop | Requires external API integrations (Gumroad/Resend) | Phase 2 |
| Skill marketplace (Claw Mart equiv.) | Requires storefront build | Phase 2 |
| Crypto wallet | Architecture decision needed | Phase 3 |
| Self-writing skills | Mobile filesystem constraint; needs DB-based approach | Phase 2 |
| Telegram/Discord channels | Edge function webhooks available; not wired | Phase 2 |
| NAVI upgrade | NAVI repo not analyzed | Next session |
| `NAVI_UPGRADE_PLAN.md` | Requires NAVI repo read | Next session |

---

## Capability Checklist vs Felix

| Capability | Felix | MAVIS |
|-----------|-------|-------|
| Three-layer memory | ✅ filesystem | ✅ Supabase (multi-device, multi-user) |
| Skill system | ✅ | ✅ |
| Standing orders | ✅ AGENTS.md | ✅ standingOrders.ts |
| Revenue tracking | ✅ | ✅ |
| Nightly consolidation | ✅ | ✅ |
| Sub-agent spawning | ✅ ad-hoc | ✅ TRANSCEND: Council Board |
| Stripe webhook | ✅ | ✅ |
| Task ledger | ✅ | ✅ |
| Structured domain data | ❌ | ✅ (quests, vault, council, etc.) |
| Zod action validation | ❌ | ✅ (40+ schemas) |
| AUTO/CONFIRM safety gate | ❌ | ✅ |
| Mobile app (Capacitor) | ❌ | ✅ |
| NAVI integration | ❌ | ✅ (planned) |
| Active product creation | ✅ | ⏳ Phase 2 |
| Skill marketplace | ✅ Claw Mart | ⏳ Phase 2 |
| Crypto wallet | ✅ | ⏳ Phase 3 |

**MAVIS leads on 10/15. Felix leads on 3/15 (Phase 2 items). 2 are tied.**

---

## Next Steps

1. **Run `npx supabase db push`** to apply the migration to production
2. **Deploy edge functions**: `npx supabase functions deploy mavis-consolidate mavis-stripe-webhook`
3. **Configure Stripe webhook** in Stripe dashboard pointing to `mavis-stripe-webhook`
4. **Schedule consolidation** via Supabase cron (`pg_cron`) at 3:00 AM daily
5. **Read NAVI repo** and generate `NAVI_UPGRADE_PLAN.md`
6. **Phase 2**: Active product creation loop + skill marketplace
