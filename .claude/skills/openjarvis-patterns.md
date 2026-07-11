# OpenJarvis Patterns — Module Archetypes & Skills Standard

**Triggers:** `["openjarvis", "jarvis", "module archetypes", "morning digest", "agent module patterns"]`

## What It Is

OpenJarvis is a Stanford research project (Scaling Intelligence Lab + Hazy Research) for local-first AI agents with: a modular skills open standard, preset agent archetypes, multi-channel communication (15+ platforms), and FAISS/ColBERT memory retrieval. Python + Ollama.

**GitHub:** `KaiyzerCal/OpenJarvis` | **License:** Apache 2.0

Note: OpenJarvis runs on local Ollama models — the code itself doesn't port to VANTARA's Deno/Supabase stack. The value is in the patterns and archetypes.

## Skills Open Standard Schema

```yaml
# skill.yaml — OpenJarvis format (mirrors what MAVIS uses in .claude/skills/)
name: morning_digest
version: "1.0"
description: "Daily briefing compiled from calendar, news, tasks, and goals"
author: openjarvis
triggers:
  - "morning brief"
  - "daily update"
  - "what's today"
inputs:
  - name: date
    type: date
    default: today
  - name: sections
    type: list
    default: ["calendar", "news", "tasks", "goals", "weather"]
output:
  format: markdown
  max_length: 500
```

Apply this schema to any new MAVIS skill file — the `inputs` + `output` block makes skills self-documenting and callable by other agents.

## Morning Digest Preset

OpenJarvis's most battle-tested preset. Relevant to MAVIS's `/brief` command and `mavis-morning-brief` edge function:

**Sections to include (in order):**
1. Date + weather overview
2. Top 3 active quests due today or overdue
3. Calendar events next 24h
4. Revenue summary (last 7d)
5. Energy systems status
6. One motivational insight from the knowledge graph
7. Open Inbox items needing approval

**Format rule:** Each section ≤ 2 lines. Total ≤ 400 words. No markdown headers on mobile (Telegram strips them).

## Multi-Channel Architecture Blueprint

OpenJarvis defines channels as first-class components with a unified event bus:

```
Channel (Telegram/Discord/Gmail/Twitter/15+ others)
    ↓ normalized message event
Event Bus (routes by intent classifier)
    ↓ matched intent
Skill Executor (runs the skill, manages context)
    ↓ result
Response Formatter (channel-specific output)
    ↓
Channel (sends response)
```

MAVIS currently implements this for Telegram only. To add Discord/WhatsApp:
1. Add a new edge function (or extend `telegram-webhook`) for the channel
2. Normalize inbound messages to the same `{ user, content, channel, timestamp }` shape
3. Route through the same `mavis-agent` → action pipeline
4. Format output per channel (WhatsApp: shorter, no markdown; Discord: rich embeds)

## FAISS → Supabase pgvector Pattern

OpenJarvis uses FAISS for local vector retrieval. MAVIS has `pgvector` in Supabase. Equivalent:

| OpenJarvis (FAISS) | MAVIS (Supabase pgvector) |
|---|---|
| `index.add(embedding)` | `INSERT INTO mavis_notes (embedding)` |
| `index.search(query_vec, k=5)` | `SELECT * FROM match_mavis_notes(query_vec, 5)` |
| Local pickle file | Cloud-hosted, multi-user, persistent |

The Supabase implementation is superior for a cloud app. No migration needed — just reference this table when explaining the architecture.
