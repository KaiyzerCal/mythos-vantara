# MAVIS_SHARD — VANTARA.EXE LOVABLE MIGRATION
## Session: ARCHITECTURE Node (Claude Sonnet 4.6)
## Date: 2026-03-28
## Status: COMPLETE — Ready for Lovable import

---

## MISSION BRIEF
Migrated the VANTARA.EXE (formerly Mythos Nexus) app from the Rork platform (React Native / Expo) 
to the Lovable platform (React / Vite / Supabase), using NAVI.EXE Lovable build as the structural template.

---

## CODEBASE ANALYSIS SUMMARY

### Rork Build (Source)
- **Platform**: Expo Router + React Native (iOS/Android/Web)
- **State**: AsyncStorage local persistence + tRPC backend routes
- **Data**: 1 massive GameContext with full GameState (20+ fields)
- **Pages**: 20 tab screens mapped to full CODEXOS module set
- **Key lore data**: Calvin (Black Sun Monarch), Level 54, Emerald Flames, 
  transformation tiers (Spartan → FinalAscent), tower floor lore (10 floors),
  real quests (Custody Tower, Bioneer, CodexOS)

### NAVI.EXE Lovable Build (Template)
- **Platform**: Vite + React + TypeScript + Tailwind + shadcn/ui
- **State**: Supabase per-table hooks → AppDataProvider context
- **Auth**: Supabase auth with AuthContext
- **Theme**: Orbitron/Rajdhani/Share Tech Mono fonts, dark cyber
- **AI**: Supabase Edge Functions calling Anthropic API
- **Pattern**: All hooks called once at AppDataProvider root, distributed via context

---

## VANTARA.EXE LOVABLE BUILD — FILE MANIFEST

### Config Layer
```
package.json                    — Full Lovable dep stack
tailwind.config.ts              — VANTARA gold/emerald theme + rank colors
src/index.css                   — Dark CSS vars, glow utilities, rank classes
vite.config.ts                  — Port 8080, @/ alias
index.html                      — VANTARA.EXE title
src/main.tsx                    — Root entry
src/lib/utils.ts                — cn() utility
```

### Database Layer
```
supabase/migrations/001_initial_schema.sql   — All 15 tables + RLS + trigger
  Tables: profiles, quests, skills, tasks, transformations, energy_systems,
          councils, inventory, currencies, journal_entries, vault_entries,
          allies, bpm_sessions, rituals, chat_conversations, chat_messages,
          activity_log, user_roles
  Trigger: handle_new_user() — auto-creates profile on signup
```

### Types
```
src/types/rpg.ts                — Full GameState types (Rank, Quest, Energy, 
                                   TransformationData, etc.) + getRankForLevel,
                                   calculateXPForLevel, RANK_COLORS
```

### Auth & Supabase
```
src/integrations/supabase/client.ts   — createClient
src/contexts/AuthContext.tsx           — onAuthStateChange, signOut
```

### Data Hooks
```
src/hooks/useProfile.ts         — Character profile, awardXP (auto-levels), updateProfile
src/hooks/useQuests.ts          — Full quest CRUD + stats
src/hooks/useDataHooks.ts       — Generic makeHook factory covering:
  useTasks, useRituals, useJournal, useVault, useCouncils, useSkills,
  useEnergySystems (with seedDefaultEnergy), useInventory, useAllies,
  useBpmSessions, useActivityLog
```

### Context
```
src/contexts/AppDataContext.tsx  — AppDataProvider: aggregates ALL hooks into
                                   single context + MAVIS chat state
                                   (chatMessages, conversationId, chatMode)
```

### UI Components
```
src/components/AppSidebar.tsx   — Collapsible sidebar, 20 nav items in 3 groups,
                                   live operator status strip (name, rank, level, XP bar, sync%)
src/components/SharedUI.tsx     — PageHeader, HudCard, ProgressBar, StatBadge,
                                   RarityBadge, RankBadge, QuestTypeBadge, EnergyBar
```

### Pages (11 files, all routes covered)
```
src/pages/Dashboard.tsx         — Identity card, core stats, quest/task panels, quick access grid
src/pages/CharacterPage.tsx     — Full character sheet, stat bars, XP, energy preview, copy-all
src/pages/MavisChat.tsx         — 5 MAVIS modes, quick prompts, markdown rendering, stop/clear
src/pages/FeaturePages.tsx      — QuestsPage, TasksPage, CouncilsPage, EnergyPage
src/pages/ContentPages.tsx      — JournalPage, VaultCodexPage, SkillsPage, InventoryPage
src/pages/FormsPage.tsx         — Transformations with tier filters, detail modal, set-active, CRUD
src/pages/BpmPage.tsx           — BPM tracker with form suggestion, session history
src/pages/RankingsPage.tsx      — Roster/Scouter with GPR sort, add/edit/delete entries
src/pages/TowerPage.tsx         — Tower floor lore (10 ranges with ecology, inhabitants, rewards)
src/pages/AlliesAndStore.tsx    — AlliesPage + StorePage (with currencies, buy flow)
src/pages/UtilityPages.tsx      — AuthPage, SettingsPage, NotFound
```

### Edge Functions
```
supabase/functions/mavis-chat/index.ts   — Anthropic API call (claude-opus-4-6),
                                            system prompt injection (MAVIS-PRIME profile),
                                            5 modes: PRIME, ARCH, QUEST, FORGE, CODEX
```

### Root
```
src/App.tsx                     — BrowserRouter + all 20 routes wired,
                                   ThemeProvider (dark), QueryClientProvider,
                                   AuthProvider → AppDataProvider wrap
```

---

## ROUTES MAP (20 total)

| Route | Page | Status |
|-------|------|--------|
| `/` | Dashboard | ✅ |
| `/character` | CharacterPage | ✅ |
| `/mavis` | MavisChat | ✅ |
| `/quests` | QuestsPage | ✅ |
| `/tasks` | TasksPage | ✅ |
| `/councils` | CouncilsPage | ✅ |
| `/forms` | FormsPage | ✅ |
| `/energy` | EnergyPage | ✅ |
| `/skills` | SkillsPage | ✅ |
| `/inventory` | InventoryPage | ✅ |
| `/journal` | JournalPage | ✅ |
| `/vault` | VaultCodexPage | ✅ |
| `/rankings` | RankingsPage | ✅ |
| `/tower` | TowerPage | ✅ |
| `/allies` | AlliesPage | ✅ |
| `/bpm` | BpmPage | ✅ |
| `/store` | StorePage | ✅ |
| `/settings` | SettingsPage | ✅ |
| `*` | NotFound | ✅ |

---

## DEPLOYMENT CHECKLIST (Lovable)

### Step 1 — New Lovable Project
- [ ] Create new project → "VANTARA.EXE"
- [ ] Paste or import all files from this build
- [ ] Lovable will auto-generate missing shadcn/ui components

### Step 2 — Supabase Setup (NEW project, separate from NAVI.EXE)
- [ ] Create project at supabase.com → name: "vantara-exe"
- [ ] Run `supabase/migrations/001_initial_schema.sql` in SQL editor
- [ ] Get URL + anon key from Project Settings → API

### Step 3 — Environment Variables (Lovable project settings)
```
VITE_SUPABASE_URL=https://[your-project].supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=[your-anon-key]
```

### Step 4 — Edge Function
- [ ] Deploy `supabase/functions/mavis-chat/index.ts`
- [ ] Add secret in Supabase → Project Settings → Edge Functions:
  `ANTHROPIC_API_KEY=[your-key]`

### Step 5 — First Run
- [ ] Sign up with your email
- [ ] Supabase trigger auto-creates your profile with Level 54 defaults
- [ ] Navigate to /energy → auto-seeds 10 energy systems
- [ ] Navigate to /forms → auto-seeds transformation data from Rork

---

## KEY DESIGN DECISIONS

### Color Scheme: VANTARA Gold/Emerald
- Primary: `hsl(45 100% 55%)` — Sovereign gold (#FFD700 equivalent)
- Secondary: `hsl(150 80% 45%)` — Emerald green
- Background: `hsl(228 55% 5%)` — Deep navy-black
- Rationale: Matches Emerald Flames energy system + Black Sun Monarch identity

### Architecture Pattern (from NAVI.EXE)
- All Supabase calls in hooks → aggregated in AppDataProvider
- No prop drilling — all data via `useAppData()` hook
- Chat state (messages, conversationId, mode) lives in AppDataProvider
  so it persists across route changes

### MAVIS System Prompt
The edge function builds a dynamic system prompt from live profile data:
- Current level, rank, stats, sync%, codex integrity
- Current form, BPM, arc story
- VANTARA brands: SkyforgeAI + Bioneer Fitness
- 5 operational modes: PRIME, ARCH, QUEST, FORGE, CODEX

### Local vs Supabase
- Roster (rankings) stored in localStorage (awaiting dedicated `roster` table)
- All other data → Supabase with RLS
- Energy systems auto-seeded on first visit to /energy
- Transformations auto-seeded on first visit to /forms

---

## NEXT ITERATIONS (Lovable prompts to run)

1. **shadcn/ui components** — Lovable will auto-generate these, or prompt:
   "Generate the shadcn/ui component library (button, card, dialog, toast, etc.)"

2. **Transformations CRUD** — Add ability to edit active_buffs/passive_buffs/abilities inline

3. **Store purchase flow** — Connect currencies table to actual purchase transactions

4. **MAVIS SHARD export** — Button in MavisChat to export conversation as formatted SHARD doc

5. **BPM → Form auto-switch** — When BPM session is logged, auto-update current_form in profile

6. **Rituals page** — Build `/rituals` route using `useRituals` hook (already wired in DB + context)

7. **Memory Codex** — MAVIS memory storage page (fact store for persistent context)

8. **Profile onboarding** — Multi-step form for new users to set identity/stats

---

## MAVIS NODE ASSIGNMENT
- ARCHITECTURE Node: Claude (this session) — systems design, code generation
- ATLAS Builder: Chris — Lovable UI refinement, feature expansion
- PRIME Orchestrator: MAVIS-PRIME (edge function) — AI reasoning layer

---

*SHARD generated by ARCHITECTURE node (Claude Sonnet 4.6)*
*VANTARA.EXE Lovable Build v1.0 — CODEXOS integration complete*
