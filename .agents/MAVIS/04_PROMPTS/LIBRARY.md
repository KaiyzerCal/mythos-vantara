# MAVIS — Prompt Library
**Folder:** 04_PROMPTS

Named, reusable prompt templates. Each has a trigger phrase, use case, and behavioral contract.

---

## [PROMPT: MORNING_BRIEF]

**Trigger:** "morning brief" / "brief me" / `/brief`
**Use case:** Start-of-day orientation

**Behavior:**
1. Pull active quests — flag any stalled (no progress in 7+ days)
2. Pull energy systems — flag anything critical
3. Pull pending actions from the queue
4. Mention one thing MAVIS noticed that the operator probably hasn't (pattern, anomaly, opportunity)
5. End with one move: what should happen first today

**Format:** Prose. No more than 5 paragraphs. No bullet walls.

---

## [PROMPT: QUEST_REVIEW]

**Trigger:** "review my quests" / "how are my quests" / "quest status"
**Use case:** Mid-period progress check

**Behavior:**
1. Group quests by type (main / boss / side / daily)
2. For each active quest: current vs target progress, days since last update
3. Flag anything that's been stalled more than 7 days explicitly
4. Suggest the one quest most worth focusing on right now, with a reason

**Format:** Structured — one section per quest type. Use data from injected context.

---

## [PROMPT: CONTENT_MACHINE]

**Trigger:** "content machine" / `/content [topic]`
**Use case:** Rapid multi-format content from a single topic

**Behavior (sequence):**
1. Confirm the topic and audience
2. Generate: Twitter/X thread (5-7 tweets), LinkedIn post (200 words), and one hook sentence for Instagram caption
3. Optionally: suggest a short-form video script hook

**Format:** Label each clearly. Platform-native tone for each.

---

## [PROMPT: WORLD_MODEL]

**Trigger:** "world model" / "my world model" / `/world`
**Use case:** Synthesized view of operator's current state across all systems

**Behavior:**
1. Pull all app context (quests, skills, energy, journal, vault, allies, rankings)
2. Score each domain: 0-100
3. Surface the top opportunity and top risk right now
4. State trajectory: up / flat / declining in each domain

**Format:** Domain-by-domain table, then 2-paragraph synthesis.

---

## [PROMPT: CAUSAL_SCAN]

**Trigger:** "causal scan" / "what's causing [X]"
**Use case:** Root cause analysis from operator data

**Behavior:**
1. Identify the symptom (what's down/stalled/degraded)
2. Scan last 90 days of journal, quests, health, and energy data
3. Surface 2-3 candidate causes with supporting evidence
4. Distinguish correlation from confirmed pattern

**Format:** Numbered list of causal candidates. Each gets: evidence, confidence level, suggested test.

---

## [PROMPT: DEEP_FOCUS]

**Trigger:** "deep focus" / "get me into flow"
**Use case:** Pre-work mental alignment

**Behavior:**
1. State the one thing that matters most right now (from active quests + stated goals)
2. Clear the noise: what can be deferred, deleted, or delegated
3. Set the container: suggested time block and single deliverable
4. End with one sharp sentence that anchors the session intention

**Format:** Tight prose. Under 3 paragraphs. No lists.

---

## [PROMPT: REFLECTION]

**Trigger:** "reflect" / "weekly retro" / "how did I do"
**Use case:** End-of-period review

**Behavior:**
1. What moved (completed quests, skill gains, journal entries with high importance)
2. What didn't (stalled, missed, deferred)
3. One behavioral pattern MAVIS observed
4. One thing to do differently next period

**Format:** 4-section prose. Honest. Not celebratory.

---

## Adding New Prompts

Each prompt in this library must have:
- A trigger phrase (how the operator naturally says it)
- A use case (one sentence)
- A behavioral contract (what MAVIS does, step by step)
- A format note

If MAVIS catches herself repeating the same reasoning pattern across 3+ sessions for the same kind of request, that pattern belongs here.
