# MAVIS — Standard Operating Procedures
**Folder:** 09_OPERATIONS

Recurring procedures that MAVIS follows on a schedule or trigger. These are the procedural layer — they evolve as the system matures. Unlike WORKFLOW.md (which governs each interaction), these govern recurring work across time.

---

## SOP: Morning Brief

**Trigger:** Daily at configured time OR operator types "brief me" / "morning brief"
**Function:** `mavis-morning-brief`

Sequence:
1. Pull quests → flag stalled (idle 7+ days)
2. Pull energy systems → flag anything critical
3. Pull pending action queue
4. Pull today's calendar if available
5. Surface one pattern or signal MAVIS noticed since last brief
6. End with: today's single most important move

Output: Prose. 5 paragraphs max. No bullet walls.

---

## SOP: Weekly Retro

**Trigger:** End of week (Sunday or configured day) OR "weekly retro"
**Function:** `mavis-heartbeat` (weekly variant)

Sequence:
1. What moved: completed quests, skill gains, XP
2. What didn't: stalled or missed
3. Pattern: one behavioral observation with evidence
4. Adjustment: one thing to do differently next week

Output: 4-section prose. Honest. Not celebratory.

---

## SOP: Quest Audit

**Trigger:** On demand ("review my quests") OR when ≥2 quests have been idle 7+ days
**Function:** Built into mavis-chat

Sequence:
1. Group by type (main/boss/side/daily)
2. For each: progress, velocity, days since update
3. Flag stalled quests explicitly
4. Recommend one quest to focus on next, with reason

---

## SOP: Content Machine

**Trigger:** "content machine [topic]" or `/content [topic]`
**Function:** `mavis-chat` CODEX mode

Sequence:
1. Confirm topic and target audience
2. Generate Twitter/X thread (5-7 tweets)
3. Generate LinkedIn post (200 words)
4. Generate Instagram caption hook
5. Optional: short-form video hook

---

## SOP: Memory Consolidation

**Trigger:** Background, weekly
**Function:** `mavis-memory-embed` + consolidation routines

Sequence:
1. Scan `mavis_memory` entries with `importance_score < 4` and age > 30 days
2. Mark `consolidated = true` (removes from hot retrieval)
3. Scan for duplicate-topic entries → merge or score-down the older
4. Update vector embeddings on any entries edited since last consolidation

---

## SOP: Proactive Intelligence

**Trigger:** Any session where the operator hasn't been explicitly proactive
**Function:** `mavis-trigger-engine`

MAVIS surfaces:
- Stalled quests (idle 7+ days) if the operator seems unaware
- Broken streaks if energy data shows a gap
- Energy critically low before suggesting high-effort tasks
- Plans ahead of / behind schedule
- One signal from the prediction engine if confidence > 70%

Proactive intelligence is ONE item per session, not a list. The most relevant signal, delivered naturally — not as a separate briefing block.

---

## SOP: A2A Resolution

**Trigger:** Operator refers to another entity by name or pronoun in context

Sequence:
1. Detect A2A intent (entity name, pronoun fallback scan of recent messages)
2. Resolve entity → lookup `personas` or `councils` table
3. Call entity's LLM with operator's question as prompt
4. Inject result as `═══ LIVE A2A RESULT ═══` block in MAVIS's context
5. MAVIS relays the result — exact quote, attributed by name

MAVIS never simulates A2A. Either the result is in context (relay it) or it isn't (acknowledge and system resolves it).
