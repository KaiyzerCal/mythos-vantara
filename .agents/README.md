# .agents/ — Vantara Agent Nervous System

The folder structure is not documentation. It is the nervous system.

MAVIS's filesystem is where her identity, memory governance, operational patterns, and reference material physically live. A messy filesystem produces a confused agent — not metaphorically, literally. The model reads paths. The model picks files by name. The model writes based on patterns it sees in old ones.

This directory follows the **numbered-gap convention**: two-digit prefixes, intentional gaps as reserved insertion points. Folders that don't have numbers (EVALS/) are meta-structural — they exist outside the operational flow.

---

## MAVIS's Structure

```
.agents/
├── MAVIS/
│   ├── 01_IDENTITY/        ← Constitutional layer (who she is, how she speaks)
│   │   ├── SOUL.md          — Identity, principles, relationship to ecosystem
│   │   └── VOICE.md         — Tone, forbidden phrases, format rules
│   │
│   ├── 02_MEMORY/          ← Memory GOVERNANCE (HOW to remember, not the memories)
│   │   └── GOVERNANCE.md    — Memory types, scoring, naming, contradiction protocol
│   │
│   │   [03_, 05_ reserved]
│   │
│   ├── 04_PROMPTS/         ← Reusable named prompt templates
│   │   └── LIBRARY.md       — Morning brief, quest review, content machine, etc.
│   │
│   │   [05_ reserved]
│   │
│   ├── 06_KNOWLEDGE/       ← What MAVIS learned about the operator (agent-produced)
│   │   └── OPERATOR.md      — Operator profile, live data sources, behavioral patterns
│   │
│   ├── 07_LIBRARY/         ← External material MAVIS did NOT produce (read-only)
│   │   └── SOURCES.md       — Frameworks, science, philosophy, strategy references
│   │
│   │   [08_, 10_ reserved]
│   │
│   ├── 09_OPERATIONS/      ← SOPs and recurring procedures
│   │   ├── WORKFLOW.md      — Per-interaction: Inbox model, decision tree
│   │   ├── INBOX.md         — How to classify and clear every operator message
│   │   └── SOPS.md          — Scheduled/recurring: morning brief, retro, memory consolidation
│   │
│   │   [10_ reserved]
│   │
│   ├── 11_SESSIONS/        ← Session archive protocol
│   │   └── ARCHIVE.md       — How sessions are stored, retrieved, consolidated
│   │
│   │   [12_–98_ reserved]
│   │
│   ├── 99_ARCHIVE/         ← Cold storage (moved here, not deleted)
│   │   └── README.md        — What gets archived, retrieval protocol
│   │
│   └── EVALS/              ← Quality gate (no number — meta-structural)
│       └── QUALITY.md       — What a good MAVIS response looks like
│
├── _PERSONA_TEMPLATE/      ← Starter files for new personas
│   └── (simplified 5-folder structure)
│
└── _COUNCIL_TEMPLATE/      ← Starter files for council members
    └── (simplified 3-folder structure)
```

---

## The Two Distinctions That Matter Most

**06_KNOWLEDGE vs 07_LIBRARY:**
- `06_KNOWLEDGE/` = what MAVIS produced by learning. Her inferences, operator profile, patterns she detected.
- `07_LIBRARY/` = external material she cites but didn't create. Frameworks, research, references.

Keeping them separate prevents MAVIS from confusing her own inferences with cited sources — a hallucination class that compounds over time.

**02_MEMORY vs `.auto-memory/`:**
- The actual memories live in `mavis_memory` (Supabase table) — MAVIS's hot memory.
- `02_MEMORY/GOVERNANCE.md` holds the rules for HOW to write memories. Constitution, not data.

Without governance, every memory write is improvised. With it, the memory index stays useful as it grows.

---

## How This Maps to the Database

For **MAVIS**: content from these files informs her system prompt via `buildMavisPrompt()`. Governance rules from `02_MEMORY/GOVERNANCE.md` are injected directly. SOPs from `09_OPERATIONS/` are encoded in her action decision tree.

For **personas and council members**: content is stored in the `agent_folders` JSONB column on `personas` / `councils` tables:

| Folder | DB key | Purpose |
|---|---|---|
| 01_IDENTITY | `identity` | Constitutional identity |
| 02_MEMORY governance | `memory_notes` | Long-running memory notes |
| 04_PROMPTS | `prompts` | Entity-specific prompt templates |
| 06_KNOWLEDGE | `knowledge` | What this entity knows about the operator |
| 07_LIBRARY | `library` | External sources this entity draws from |
| 09_OPERATIONS | `operations` | Behavior rules, decision patterns |
| EVALS | `evals` | Quality criteria |

---

## Timezone

Every entity can have its own timezone:
- Operator: `profiles.timezone` (e.g. `"America/Sao_Paulo"`)
- Persona: `personas.timezone` (only if the persona canonically lives in a different timezone)
- Council member: `councils.timezone` (same logic)

When set, all temporal context uses the entity's local time. Operator's local time is the secondary reference.

---

## The Numbered Gap Convention

Gaps are intentional. They are reserved insertion points. When a new domain emerges in MAVIS's architecture, it slots in without renaming everything.

Current reserved slots: 03_, 05_, 08_, 10_, 12_–98_ (except 99_ which is Archive)

Do NOT create a `MISC/` folder. If something doesn't fit, the structure needs a new home — not a junk drawer.
