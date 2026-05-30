# MAVIS vs Felix — Capability Comparison
## Calvin Watkins — Black Sun Monarch Protocol
## Date: 2026-05-12

---

## Executive Summary

Felix (ALFRED-powered) achieved $250K+ revenue by operating autonomously — building products, running a marketplace, managing sub-agents, and earning while Nat Eliason slept. MAVIS targets the same autonomy, with a structurally superior architecture.

Current state: MAVIS matches or exceeds Felix on 8/15 capability dimensions. Felix leads on 4 (active revenue generation, marketplace, crypto wallet, self-writing skills). MAVIS has 6 capabilities Felix cannot replicate at all.

---

## Felix Has, MAVIS Now Has

| Capability | Felix Source | MAVIS Implementation | Status |
|-----------|-------------|---------------------|--------|
| Persistent memory (L2 session logs) | daily_notes/ | `mavis_memory` table + `memoryEngine.ts` | ✅ Done |
| Knowledge graph (L1 PARA) | knowledge/ | `mavis_knowledge` table + `saveKnowledge()` | ✅ Done |
| Tacit knowledge (L3 preferences) | tacit/ | `mavis_tacit` table + `saveTacit()` | ✅ Done |
| Nightly consolidation | cron/consolidate.ts | `mavis-consolidate` edge function | ✅ Done |
| Standing orders | AGENTS.md | `standingOrders.ts` + `MAVIS_STANDING_ORDERS.md` | ✅ Done |
| Skill system | skills/ | `src/mavis/skills/` + `_registry.ts` | ✅ Done |
| Revenue tracking | revenue_log.ts | `mavis_revenue` + `revenueEngine.ts` | ✅ Done |
| Stripe webhook | stripe-webhook/ | `mavis-stripe-webhook` edge function | ✅ Done |
| Task ledger | task_ledger.ts | `taskLedger.ts` + `mavis_tasks` table | ✅ Done |
| Sub-agent spawning | agent_runner.ts | Council Board (`councilBoardService.ts`) | ✅ TRANSCEND |

---

## Felix Has, MAVIS Lacks (Gap Items)

### GAP-1: Active product creation loop
**Felix mechanism**: ALFRED identifies a demand signal (trending topics, operator prompt) → creates a product (PDF, course, digital item) → lists it automatically on Claw Mart → sends traffic.

**MAVIS plan**: Phase 2 — `mavis-product-creator` edge function. Triggered by MAVIS detecting a revenue opportunity. Creates a Gumroad/Stripe product via API, logs to `mavis_tasks`. Requires: Gumroad API integration or Stripe Product API.

**Estimated effort**: 2–3 days.

---

### GAP-2: Skill marketplace (Claw Mart equivalent)
**Felix mechanism**: Claw Mart is a public-facing marketplace where Felix lists and sells skills as products. Other agents can buy and use Felix's skills.

**MAVIS plan**: SkyforgeAI marketplace — agents pay for CODEXOS-branded skills. Store table (`store_items`) already exists. Needs: public storefront, Stripe checkout, skill download delivery.

**Estimated effort**: 1–2 weeks.

---

### GAP-3: Crypto wallet
**Felix mechanism**: Felix has a wallet that earns and holds cryptocurrency. Enables trustless agent-to-agent payments.

**MAVIS plan**: Integrate Coinbase Developer Platform or Privy for embedded wallet. Log crypto revenue to `mavis_revenue` with `currency: "ETH"` or `"USDC"`.

**Estimated effort**: 3–5 days.

---

### GAP-4: Self-writing skills
**Felix mechanism**: ALFRED writes new skill files to its own skills directory in response to operator requests. ALFRED can expand its own capabilities.

**MAVIS plan**: Not feasible on Capacitor mobile (no filesystem write). Server-side equivalent: MAVIS writes new skills to a Supabase `mavis_skill_definitions` table. Edge function loads them dynamically. Skill execution sandboxed via Deno.

**Estimated effort**: 1 week. Classification: ADAPT (not SKIP — just different implementation).

---

## MAVIS Has, Felix Lacks (Our Advantages)

### ADV-1: Supabase-native structured data model
MAVIS has a rich domain ontology: quests, tasks, skills, vault, journal, council, inventory, rituals, transformations, rankings, energy, BPM, allies, store. Felix has no equivalent — ALFRED operates on flat files.

This means MAVIS can cross-reference data ("your Bioneer quest is 3 days idle — your energy is at 40%") in ways Felix fundamentally cannot.

### ADV-2: Zod action validation + type safety
Every MAVIS action (40+ types) is validated by a Zod discriminated union before execution. Felix/ALFRED uses raw JSON with no schema validation. MAVIS will never corrupt data via malformed action payloads.

### ADV-3: AUTO/CONFIRM safety gate
Every action is classified before execution. Destructive operations require explicit confirmation. Felix has no equivalent — ALFRED executes everything immediately.

### ADV-4: Council Board multi-agent architecture
MAVIS has a persistent, named council (loaded from `councils` table). Each member has a role, specialty, class, and notes. In a Council Board session, MAVIS presides and all members evaluate in parallel. Felix can spawn ad-hoc sub-agents but has no persistent roster with domain expertise.

### ADV-5: CODEXOS domain ontology
The SkyforgeAI / Bioneer / Vantara ecosystem gives MAVIS a purpose-built revenue context. Felix is generic — it can sell anything but has no product identity. MAVIS operates within a coherent brand ecosystem with defined products and audiences.

### ADV-6: Mobile-native via Capacitor
MAVIS runs as a native iOS/Android app via Capacitor. Felix is desktop/messaging-only. MAVIS can receive push notifications, run in the background (via Supabase edge functions), and operate on mobile.

### ADV-7: Rankings + Transformations domain system
MAVIS tracks a unique power/influence layer — JJK grades, OP tiers, GPR scores, PVP ratings, influence levels. No equivalent in ALFRED. This is the gamification layer that makes MAVIS's operator engagement psychologically compelling.

### ADV-8: Vault (legal/evidence layer)
MAVIS has a dedicated Vault for legal evidence, sensitive documents, and high-importance records. Categories: legal, evidence, business, personal, achievement. Felix has no equivalent specialized data layer.

---

## TRANSCEND Opportunities

### T1: Memory as competitive moat
MAVIS's three-layer memory is Supabase-native, multi-device, multi-user, and structured. Felix's memory is local filesystem — single machine, single user, unstructured. As MAVIS accumulates months of Layer 3 tacit knowledge, it becomes irreplaceable — a personalized intelligence that knows the operator better than any new AI could.

### T2: Council Board as autonomous advisory system
No AI assistant has a persistent named advisory council with domain expertise. MAVIS's Council Board can evolve — council members gain notes, specialties, and context over time. This is fundamentally richer than Felix's ad-hoc agent spawning.

### T3: Revenue tied to operator's actual products
Felix is generic. MAVIS is Calvin Watkins's sovereign intelligence for CODEXOS. Every revenue action MAVIS takes is contextually relevant to SkyforgeAI, Bioneer, and Vantara — not random PDF sales.

### T4: Action system as trust infrastructure
MAVIS's AUTO/CONFIRM gate means operators can safely give MAVIS full database write permissions. Felix requires careful prompt engineering to avoid destructive actions. MAVIS's type safety makes it deployable at higher privilege levels.

### T5: NAVI integration (downstream agent)
MAVIS can instruct NAVI (companion/gamification system) as a downstream agent. Felix has no equivalent multi-system architecture. This enables MAVIS to orchestrate across the entire CODEXOS stack.

---

## Revenue Generation Analysis

### Felix's mechanism
1. **Demand detection**: ALFRED monitors Twitter/web for trending topics in Felix's niche
2. **Product creation**: Generates a short PDF, guide, or digital product (1-2 hours)
3. **Listing**: Posts to Claw Mart (custom Stripe-backed marketplace)
4. **Traffic**: DMs and posts announcing the product
5. **Revenue**: $29/sale × viral distribution = $250K+

### MAVIS equivalent (current + planned)

**Current (tracking only)**:
- `mavis_revenue` table tracks all incoming payments
- `mavis-stripe-webhook` logs Stripe events automatically
- `revenue-report` skill surfaces totals on demand

**Phase 2 (active generation)**:
1. MAVIS monitors CODEXOS product performance metrics
2. Identifies high-signal demand moments (spike in SkyforgeAI trial signups, Bioneer engagement surge)
3. Generates targeted content (landing page copy, email sequence, social post) via `mavis-product-creator` edge function
4. Posts to CODEXOS channels (Stripe product created, email sent via Resend API)
5. Revenue logged automatically

**Phase 3 (autonomous)**:
- MAVIS runs the above loop on a schedule without operator input
- Task ledger provides full visibility
- Operator approval gates on actions above a configurable dollar threshold
