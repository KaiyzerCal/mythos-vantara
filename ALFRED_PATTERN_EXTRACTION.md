# ALFRED Pattern Extraction
## Source: KaiyzerCal/openclaw-fork (OpenClaw / ALFRED)
## Status: Analysis from spec — openclaw-fork not locally available for direct read

---

## Pattern Index

| # | Pattern | Classification | MAVIS Status |
|---|---------|---------------|-------------|
| 1 | SOUL.md — identity persistence | ADAPT | Implemented via `buildSystemPrompt.ts` personality block |
| 2 | AGENTS.md — standing orders | ADAPT | Implemented via `standingOrders.ts` |
| 3 | Three-layer memory | ADAPT | Implemented via `memoryEngine.ts` (Supabase-native) |
| 4 | Skill definition/discovery/invocation | ADAPT | Implemented via `skills/` directory |
| 5 | Cron/scheduled tasks | ADAPT | Implemented via `mavis-consolidate` edge function |
| 6 | Sub-agent spawning | TRANSCEND | Council Board — superior multi-agent architecture |
| 7 | Tool execution | ADAPT | Edge functions + Zod-validated action system |
| 8 | Wallet + payment integration | ADAPT | Implemented via `revenueEngine.ts` + `mavis-stripe-webhook` |
| 9 | Revenue generation logic | ADAPT | `revenueEngine.ts` + `mavis_revenue` table |
| 10 | Nightly consolidation | ADAPT | `mavis-consolidate` edge function |
| 11 | Context window management | ADAPT | `getLastN()` + `loadRecentMemory()` |
| 12 | Hook system (event-driven) | ADAPT | `setDefaultHandler()` in actionExecutor |
| 13 | Self-writing skills | PENDING | Future: MAVIS writes new skills to filesystem |
| 14 | External channel support | PENDING | Future: Telegram/Discord via edge function |
| 15 | Operator trust ladder | TRANSCEND | AUTO/CONFIRM safety gate — superior to ALFRED |

---

## Detailed Pattern Analysis

### 1. SOUL.md → MAVIS identity and persona persistence
**ALFRED mechanism**: `SOUL.md` is injected at the start of every session as the system prompt prefix. Contains character description, values, speaking style, and self-conception.

**MAVIS equivalent**: The 200-line personality block in `buildSystemPrompt.ts` serves this function. Unlike ALFRED's flat markdown file, MAVIS's identity is code — it interpolates live operator data (profile name, level, rank, current form, arc story) directly into the identity declaration.

**Classification**: ADAPT

**Improvement over ALFRED**: MAVIS identity is dynamic — it reflects the operator's actual current state. ALFRED's SOUL.md is static.

---

### 2. AGENTS.md → Standing orders injection
**ALFRED mechanism**: `AGENTS.md` contains persistent behavioral directives injected into every system prompt session. Defines what ALFRED should always do, never do, and how to handle edge cases.

**MAVIS equivalent**: `standingOrders.ts` exports `getStandingOrders()`. The string is injected by `buildSystemPromptFromSnapshot()` on every call. Source of truth is `MAVIS_STANDING_ORDERS.md`.

**Classification**: ADAPT

**Improvement**: MAVIS standing orders support runtime `addStandingOrder()` / `removeStandingOrder()` — they can be modified programmatically without a file edit.

---

### 3. Three-layer memory system
**ALFRED mechanism**:
- Layer 1: Knowledge graph using PARA (Projects/Areas/Resources/Archives) — durable facts extracted from sessions
- Layer 2: Daily notes — dated logs of conversations
- Layer 3: Tacit knowledge — operator preferences, hard rules, lessons learned

ALFRED uses local filesystem (markdown files) for all three layers. Nightly consolidation runs Claude to extract Layer 1 and Layer 3 from Layer 2.

**MAVIS equivalent**:
- Layer 1: `mavis_knowledge` Supabase table — PARA categories, full-text search
- Layer 2: `mavis_memory` Supabase table — session logs with session_id grouping
- Layer 3: `mavis_tacit` Supabase table — preferences, hard rules, lessons, workflow habits

`buildMemoryContext()` in `memoryEngine.ts` assembles all three layers into the system prompt.
`mavis-consolidate` edge function extracts from Layer 2 → Layer 1/3 nightly.

**Classification**: ADAPT + TRANSCEND

**Improvements over ALFRED**:
- Supabase = multi-device sync (ALFRED is single-machine)
- RLS = multi-user by design (ALFRED is single-operator)
- SQL = queryable, indexable, structured (ALFRED is flat markdown)
- Mobile-accessible via Capacitor (ALFRED is desktop-only)

---

### 4. Skill definition, discovery, and invocation
**ALFRED mechanism**: Skills are TypeScript files in a `skills/` directory. Each skill exports a `definition` (name, description, keywords) and a `handler` (async function). A `matchSkillByKeyword()` function scans user input before sending to Claude, allowing skills to short-circuit the LLM call.

**MAVIS equivalent**: `src/mavis/skills/_registry.ts` with `registerSkill()`, `matchSkillByKeyword()`, `invokeSkill()`. Skills: `daily-brief`, `quest-review`, `energy-check`, `revenue-report`, `knowledge-extract`.

**Classification**: ADAPT

**Current skills**: 5 implemented. ALFRED has 10+.

---

### 5. Cron/scheduled tasks
**ALFRED mechanism**: Uses local cron or Cloudflare Workers cron triggers to fire scheduled tasks without user input. Primary use: nightly consolidation.

**MAVIS equivalent**: `mavis-consolidate` Supabase Edge Function. Deployed as a Supabase scheduled function (configure via Supabase dashboard or `pg_cron`).

**Classification**: ADAPT

---

### 6. Sub-agent spawning
**ALFRED mechanism**: ALFRED can spawn sub-agents (parallel Claude calls) for support, research, or specialized tasks. Results are merged back into the main context.

**MAVIS equivalent**: **TRANSCEND**. Council Board (`CouncilBoard.tsx` + `councilBoardService.ts`) is a permanent multi-agent architecture. MAVIS presides; each council member (defined in `councils` table) is a specialized agent. Runs in parallel via `Promise.all`. ALFRED has no persistent agent roster — MAVIS's council members have persistent names, roles, specialties, and notes.

**Classification**: TRANSCEND

---

### 7. Tool execution
**ALFRED mechanism**: Shell commands, browser automation, filesystem reads/writes via tool use.

**MAVIS equivalent**: Zod-validated action system with 40+ schemas. AUTO/CONFIRM safety gate. `mavis-actions` edge function as executor. Far more type-safe than ALFRED.

**Classification**: TRANSCEND

---

### 8. Wallet + payment integration
**ALFRED mechanism**: Stripe integration for product sales. Crypto wallet for Felix's on-chain revenue. PaymentIntents with operator user_id in metadata.

**MAVIS equivalent**: `mavis-stripe-webhook` edge function handles `payment_intent.succeeded` and `checkout.session.completed`. Revenue logged to `mavis_revenue` table. `revenueEngine.ts` provides query layer.

**Classification**: ADAPT (crypto wallet not yet implemented)

---

### 9. Revenue generation logic
**ALFRED mechanism**: Felix built and sold a $29 PDF overnight. Logic: identify demand → create product → list on Claw Mart → send traffic → log payment. ALFRED has a marketplace (Claw Mart) and enterprise service (Clawcommerce).

**MAVIS equivalent**: Revenue engine tracks CODEXOS products (SkyforgeAI, Bioneer, Vantara). Stripe webhook auto-logs payments. `revenue-report` skill surfaces totals on demand. Active revenue generation (product creation loop) is **Phase 2 scope**.

**Classification**: ADAPT (tracking implemented; active generation loop pending)

---

### 10. Nightly consolidation / memory compaction
**ALFRED mechanism**: Scheduled Claude call analyzes daily notes → extracts PARA knowledge + tacit preferences → writes back to filesystem. Marks processed notes.

**MAVIS equivalent**: `mavis-consolidate` edge function. Uses `claude-haiku-4-5-20251001` for cost efficiency. Extracts to `mavis_knowledge` + `mavis_tacit`. Marks `consolidated = true`. Logs to `mavis_consolidation_log`.

**Classification**: ADAPT

---

### 11. Context window management
**ALFRED mechanism**: Sliding window over recent messages. Older messages summarized and stored in daily notes rather than dropped.

**MAVIS equivalent**: `getLastN(n)` for in-session window. `loadRecentMemory(50)` for cross-session context. Full session archived to `memories` table on clear. `buildMemoryContext()` injects cross-session summary.

**Classification**: ADAPT

---

### 12. Hook system (event-driven automation)
**ALFRED mechanism**: Event hooks fire on specific triggers (message received, action completed, session end).

**MAVIS equivalent**: `setDefaultHandler()` in `actionExecutor.ts` registers a catch-all for actions that fail Zod validation. The registered handler routes to `mavis-actions` edge function. Event-driven hooks at the edge function level via Supabase realtime subscriptions (pattern available, not yet wired to specific triggers).

**Classification**: ADAPT

---

### 13. Self-writing skills
**ALFRED mechanism**: ALFRED can write new skill files to its own `skills/` directory in response to operator requests.

**MAVIS equivalent**: **PENDING** — Not yet implemented. Would require a `create_skill_file` action type with filesystem write access (not feasible in Capacitor mobile; feasible in CI/CD pipeline).

**Classification**: SKIP (mobile architecture constraint)

---

### 14. External channel support (Telegram/Discord)
**ALFRED mechanism**: ALFRED operates as a Telegram bot and Discord bot, receiving commands from external channels.

**MAVIS equivalent**: **PENDING** — Supabase edge functions can receive webhook posts from Telegram/Discord. Architecture is ready; not yet wired.

**Classification**: PENDING

---

### 15. Operator trust ladder and safety rails
**ALFRED mechanism**: Basic trust levels. No type-safe action validation.

**MAVIS equivalent**: **TRANSCEND**. AUTO/CONFIRM gate classifies every action before execution. Zod schemas validate every action payload. 40+ discriminated union types. Rankings ≠ Transformations enforced at schema level. ALFRED has none of this.

**Classification**: TRANSCEND
