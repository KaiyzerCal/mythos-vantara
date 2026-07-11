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

[2026-07-10] CODE → 17-repo integration — researched and integrated 17 Calvin forks: (1) 8 new .claude/skills/ files added: ponytail (minimal-code decision ladder), no-mistakes (AI git push validation pipeline), character-animation (64×64 pixel-art spritesheet generation), remotion (programmatic React video), video-production (full AI video pipeline — OpenMontage patterns), clone-website (AI website reverse-engineering), design-md (design token format for agents), inbox-zero (AI email management); (2) context/api-catalog.md updated with new "Standalone Tools & Frameworks" section covering: no-mistakes, orca, ponytail, codebase-memory-mcp, firecrawl (standalone), free-for-dev, Flowise, remotion, OpenMontage, character-animation, inbox-zero, simplex-chat, gws CLI, design.md, ai-website-cloner-template

[2026-07-11] CODE → 39-repo integration audit — researched all 39 Calvin fork repos; 7 new .claude/skills/ files added: navi-patterns (predecessor VANTARA.EXE component archaeology), ruview-integration (WiFi ambient sensing MCP — presence/vitals/falls), agentsmesh (multi-agent Claude Code orchestration fleet), open-notebook (self-hosted NotebookLM with REST+MCP), hermes-patterns (Telegram gateway + ACP agent delegation protocol), openclaude (multi-provider Claude Code + gRPC server), openjarvis-patterns (module archetypes + skills standard); api-catalog.md expanded with: AgentsMesh, openclaude, page-agent, activepieces, open-notebook, hermes-agent, RuView, NAVI.EXE-lovable, public-apis reference, worldmonitor data feeds, Composio (118+ OAuth integrations). Skipped: PrymalAI-dashboard (empty scaffold), server (Nextcloud fork), MyClaw (commercial product), openclaw-fork (already covered), mirofish (AGPL conflict), OpenCut (rewrite in progress), agentskills (already the standard in use), 500-AI-Agents-Projects/claude-skills/agent-skills (reference/inspiration only).
