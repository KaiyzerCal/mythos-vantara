# .agents/ — Vantara Agent Framework

Organized using the 7-Folders framework. Each agent (MAVIS, personas, council members) has the same folder structure, ensuring consistent identity, memory, operations, and quality standards across the entire ecosystem.

## Structure

```
.agents/
├── MAVIS/                    ← Core system agent (hardcoded in edge functions)
│   ├── 01_IDENTITY/SOUL.md   ← Who MAVIS is at the constitutional level
│   ├── 02_USER/OPERATOR.md   ← Template for what MAVIS knows about the operator
│   ├── 03_OPERATIONS/        ← SOPs, decision rules, formatting guidelines
│   ├── 04_MEMORY/            ← Memory strategy docs (data lives in DB)
│   ├── 05_REFERENCES/        ← Knowledge base, domain refs MAVIS draws from
│   ├── 06_OUTPUT/            ← Output standards and examples
│   └── 07_EVALS/QUALITY.md  ← Quality gate: what a good MAVIS response looks like
│
├── _PERSONA_TEMPLATE/        ← Starter template for new personas
│   └── ...same 7 folders...
│
└── _COUNCIL_TEMPLATE/        ← Starter template for new council members
    └── ...same 7 folders...
```

## How it maps to the database

For MAVIS: The content of these files is loaded directly into the edge function system prompts via the `buildContextSummary` and `fullPrompt` assembly pipeline.

For personas and council members: The 7-folder content is stored in the `agent_folders` JSONB column on the `personas` and `councils` tables respectively. Keys:

| Folder | DB key | Purpose |
|---|---|---|
| 01_IDENTITY | `identity` | Constitutional identity — who they are |
| 02_USER | `user_context` | Context about the operator they serve |
| 03_OPERATIONS | `operations` | Behavior rules, SOPs, decision logic |
| 04_MEMORY | `memory_notes` | Long-running memory notes (indexed logs live in DB) |
| 05_REFERENCES | `references` | Domain knowledge, style guides, data they draw from |
| 06_OUTPUT | `output` | Output standards, recent deliverables |
| 07_EVALS | `evals` | Quality criteria, what "good" looks like for this entity |

## Timezone

Every entity can have its own timezone:
- Operator timezone: `profiles.timezone` (e.g. `"America/Sao_Paulo"`)
- Persona timezone: `personas.timezone` (optional — only set if the persona canonically "lives" in a different timezone or era, e.g. a Tokyo-based street trader persona uses `"Asia/Tokyo"`)
- Council member timezone: `councils.timezone` (optional, same logic)

When a persona or council member has a timezone set, ALL temporal context injected into their system prompt uses their local time. The operator's local time is shown as a secondary reference.
