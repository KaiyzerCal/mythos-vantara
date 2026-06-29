# MAVIS — Memory Governance
**Folder:** 02_MEMORY

This file governs HOW MAVIS writes memory. The actual memories live in `mavis_memory` (Supabase). This file is the constitution that makes those memories useful.

---

## The Core Rule

One entry = one topic. Never bundle. Never consolidate into a "misc session notes" blob.

A memory entry about the operator's sleep habits should not contain anything about their business model. Split them. The model retrieves by topic — a mixed entry is noise at retrieval time.

---

## Memory Types

| Type | What it is | DB: `importance_score` range |
|---|---|---|
| **Fact** | Verified truth about the operator or their world | 7–10 |
| **Pattern** | Behavioral signal observed across ≥2 instances | 6–9 |
| **Preference** | Stated or inferred operator preference | 5–8 |
| **Context** | Current project/arc state that changes often | 3–6 |
| **Ephemeral** | Single-session relevance only | 1–3 |

Ephemeral entries are never written. If it won't matter next session, don't write it.

---

## Importance Scoring Guide

| Score | Meaning |
|---|---|
| 10 | Identity-level: core goals, values, relationships, non-negotiables |
| 8–9 | High-signal: business decisions, health insights, stated priorities |
| 6–7 | Useful context: project states, preferences, recurring patterns |
| 4–5 | Low-signal context: mood patterns, minor preferences |
| 1–3 | Ephemeral (do not write) |

When unsure, round down. The memory index is more useful sparse than polluted.

---

## What Gets Written

✅ Write when:
- The operator corrects MAVIS (the correction is the truth now)
- A new fact about goals, relationships, or health is stated
- A behavioral pattern emerges for the second time
- A stated preference is clear and durable
- A decision was made that future sessions need to know about

❌ Do NOT write when:
- The operator is venting (emotion, not fact)
- The same fact already exists in memory
- The content is one-session context that will be stale tomorrow
- Weather, prices, or anything time-bound and trivial

---

## Naming Convention

Format for `session_id` or source tags: `{entity}-{topic}-{YYMMDD}`

Examples:
- `mavis-calvin-sleep-patterns`
- `mavis-calvin-business-skyforgeai`
- `tao-calvin-philosophy-debate`

---

## Contradiction Protocol

When new information contradicts existing memory:
1. The newer information wins
2. The old entry's `importance_score` is set to 1 (effectively stale)
3. The new entry is written with full score

MAVIS does not accumulate contradictions. She overwrites.

---

## Hot vs Cold Memory

**Hot** (`mavis_memory` table): last 90 days, referenced in every session, subject to semantic search.

**Cold** (archived via `consolidated = true` flag, low score): facts that have been superseded, one-off session notes that were written in error, entries older than 90 days with score < 5.

Cold memory is not deleted — it becomes invisible to normal retrieval but remains for forensic queries.

---

## What MAVIS Is NOT Doing

The `.auto-memory/` analogy from filesystem agents: MAVIS's equivalent is the `mavis_memory` table. She writes small, topic-specific entries. She does not maintain a monolithic "session summary" file. She does not concatenate everything the operator said into one blob.

This governance file is what keeps the memory index useful as it grows.
