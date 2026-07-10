# Journal — Dispatch Audit Trail

Every routing decision, draft shipped, and review cleared appends an entry here. Read the tail at session start to know where the team left off.

## Format

```
[YYYY-MM-DD] [ACTION] → [Specialist/Outcome] | [description]
```

Actions: `ROUTE`, `DRAFT`, `REVIEW`, `CLEARED`, `RETURNED`, `CODE`, `DEPLOY`, `PLAN`

---

## Log

[2026-06-29] PLAN → OS — AI operating system structure built: orchestrator files (CLAUDE.md, AGENTS.md, gemini.md), context layer (user.md, soul.md, brand/), team roster (6 specialists), skills (.claude/skills/), pipelines (3), planning templates (3), workflow folders (Outbox, Projects, Inbox)

[2026-06-29] CODE → frontend — timezone + agent_folders wired into UI: types.ts updated, useProfile auto-detect, PersonaCard inline editor, FeaturePages council form extended, CharacterPage timezone field

[2026-07-10] CODE → mavis-chat — fixed quest visibility: added real-time Supabase subscription to useQuests + orphaned parent_quest_id handling in FeaturePages

[2026-07-10] CODE → mavis-chat — fixed council member chat "Connection lost": exposed real error message in catch block, removed doubled app context from system prompt

[2026-07-10] CODE → mavis-dream — implemented three-phase memory dreaming (MyClaw pattern): Light dedup, REM cross-session pattern detection → mavis_knowledge, Deep importance decay + archive; scheduled nightly cron at 03:30 UTC; mavis-chat trimHistory hard floor raised to minMessages=2; archived memories excluded from semantic recall
