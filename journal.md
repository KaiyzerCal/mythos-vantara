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

[2026-07-10] CODE → LifeOS integration — implemented all 6 LifeOS patterns from KaiyzerCal/LifeOS: (1) TELOS table (mission/current_state/ideal_state/problems/challenges/strategies) loaded into authoritativeContext; (2) DA Identity 12-trait model injected as personality calibration block; (3) Quest ISA schema (current_state, ideal_state, effort_tier E1-E5, phase PLAN/BUILD/VERIFY/DONE, completion_criteria binary array) with UI in FeaturePages; (4) Freshness A-F grading on quests/goals (freshGrade helper in mavis-chat); (5) Council 3-round debate protocol (POSITION→CHALLENGE→SYNTHESIS) in system prompt; (6) Verification doctrine (Re-Read Check, Cite sources, Binary criteria, Honest Unknown, Freshness flag)

[2026-07-10] CODE → ai-berkshire integration — from KaiyzerCal/ai-berkshire: (1) 19 invest-* skills added to .claude/skills/ covering full research lifecycle (invest-research, invest-team, invest-checklist, invest-management, invest-earnings, invest-earnings-team, invest-quality, invest-industry, invest-industry-funnel, invest-portfolio, invest-thesis-tracker, invest-thesis-drift, invest-news, invest-private, invest-deep-series, invest-bottleneck, invest-dyp-ask, invest-data, invest-article); (2) seed_berkshire_council() SQL function in migration 20260710150000 creates 4 investment master council members (Buffett/Munger/Duan Yongping/Li Lu) with full agent_folders (identity, operations, references, evals)
