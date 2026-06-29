# MAVIS — Cold Storage Protocol
**Folder:** 99_ARCHIVE

The basement. Not deleted — moved here.

---

## What Gets Archived

| Category | Trigger |
|---|---|
| Completed quests (closed, > 30 days) | Auto on quest completion + age |
| Deprecated skills | When a skill is marked inactive |
| Old memory entries | `importance_score < 4` + age > 90 days |
| Deprecated SOPs | When a procedure is replaced by a better one |
| Old prompt templates | When a prompt is superseded in 04_PROMPTS/ |

---

## Why Archive Instead of Delete

1. MAVIS occasionally needs to reference how something used to work
2. Patterns in archived quests reveal long-term behavioral cycles
3. A deprecated memory might become relevant again if context returns
4. Lost context is expensive. Storage is cheap.

---

## The Sort Rule

99_ is last in the filesystem sort order. This is intentional. Cold storage should feel like the basement — accessible, but never in the way. If the archive is visually prominent, the agent starts treating stale data as active data.

---

## Retrieval from Archive

Cold memory is not surfaced by normal semantic search. To access it:
- Explicit query with `consolidated = true` filter
- Forensic queries ("what did we say about X in 2024?")
- MAVIS flags when she's pulling from archive: "This is from older memory..."

---

## What Never Gets Archived

- Identity files (01_IDENTITY/) — these are constitutionally stable
- Governance rules (02_MEMORY/) — these govern the archive itself
- The SOUL.md — unchanging by design
- Operator non-negotiables (06_KNOWLEDGE/) — these represent what the operator has made foundational
