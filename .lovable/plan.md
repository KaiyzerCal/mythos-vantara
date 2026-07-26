# Skill Catalog Overhaul Plan

## Goal
Make the skill catalog a first-class surface of MAVIS — fully discoverable, reliable, extensible, and deeply wired into chat so custom and built-in skills feel like native capabilities.

## Current State (verified)
- **System Settings → Custom Skills tab**: CRUD for user-created skills (`mavis_custom_skills` table) with name, trigger phrase, system prompt, description, modes, and enabled flag.
- **MavisChat Skill Catalog Drawer**: side panel showing all registered skills grouped into Creative, Intelligence, Business, Personal, System.
- **Registry**: `src/mavis/skills/_registry.ts` registers built-in skills via `registerSkill()` and supports runtime DB-backed skills (`mavis_skill_definitions`) and custom skills (`mavis_custom_skills`).
- **Skill count**: 300+ skill directories under `src/mavis/skills/`.
- **Built-in skill examples**: `image-gen`, `video-gen`, `logo-gen`, `music-gen`, `world-monitor`, `economics-calendar`, `revenue-report`, `daily-brief`, `agent-builder`, `code-delegate`, `persona-forge`, `capability-manifest`, `skill-catalog-browse`.

## Workstreams

### 1. Audit Existing Skills
- Inventory every `src/mavis/skills/**/index.ts` and confirm each calls `registerSkill()` with name, description, and keywords.
- Build a small test harness that invokes each skill via `supabase.functions.invoke("mavis-chat")` or direct skill handler and records success/failure.
- Categorize failures: missing edge function, broken API key, stale model ID, invalid imports, empty handler.
- Fix the highest-impact broken skills first (e.g., `image-gen`, `video-gen`, `world-monitor`, `web-search`, `telegram-send`).
- Add a `skill-health` edge function or a health page row so the user can see skill status at a glance.

### 2. Improve the Skill Catalog UI/UX
- **System Settings → Custom Skills tab**:
  - Add inline search/filter.
  - Show which skills are enabled/disabled with a clearer toggle.
  - Add a "Test Skill" button that sends a quick prompt through the skill.
  - Add a duplicate/clone action.
  - Add a suggested template picker (e.g., "Sales email drafter", "Daily standup summary").
- **Skill Catalog Drawer (MavisChat)**:
  - Add live skill count and recently used section.
  - Add favorites / pin skills.
  - Show skill status indicators (working, deprecated, needs API key).
  - Add keyboard shortcut `/` to open the drawer.
- **Shared**:
  - Consistent empty/loading/error states using `EmptyState`, `LoadingState`, `ErrorState`.
  - Add category iconography and color coding.

### 3. Add More Built-In Skills
Add missing high-value skills that fit the "ultimate AI agent copilot" vision:
- **Productivity**: `meeting-brief`, `weekly-retro`, `travel-planner`, `expense-report`.
- **Intelligence**: `reddit-sentiment`, `sec-filing-summarizer`, `patent-search`, `job-market-scan`.
- **Creative**: `meme-gen`, `thumbnail-gen`, `ad-copy-gen`, `voice-clone`.
- **Business**: `invoice-generator`, `contract-review`, `proposal-score`, `crm-enrichment`.
- **System**: `skill-health`, `cost-tracker`, `prompt-optimizer`, `model-recommender`.
Each new skill will follow the existing pattern in `src/mavis/skills/**/index.ts` and register itself with relevant keywords.

### 4. Wire Custom Skills Deeper into Chat
- Ensure `mavis-chat` and `mavis-agent` edge functions check `mavis_custom_skills` for the user's triggers and prepend the custom system prompt when matched.
- Add a visual indicator in MavisChat when a custom skill is active (e.g., badge in the composer or message header).
- Render custom skill output with the same markdown/code/media support as built-in skills.
- Add a `/skills` slash command in the composer that opens the catalog drawer or lists available skills.
- Persist skill invocation history so the user can see which skills were used and when.

## Deliverables
1. `SKILL_AUDIT_REPORT.md` with skill inventory, health status, and fixed items.
2. Updated `src/pages/SystemSettingsPage.tsx` with improved Custom Skills UI.
3. Updated `src/components/chat/SkillCatalogDrawer.tsx` with search, favorites, status, and keyboard shortcut.
4. New skill files under `src/mavis/skills/` for the selected high-value skills.
5. Updated `mavis-chat` edge function to integrate custom skills and `/skills` slash command.
6. Health/status badge or page row showing skill system status.

## Next Step
Approve this plan and I'll start with the audit inventory so we know exactly which skills are real, broken, or missing before building the UI and new skills.