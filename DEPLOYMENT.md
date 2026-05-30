# VANTARA.EXE — Lovable Deployment Guide
## MAVIS_SHARD // ARCHITECTURE NODE // v1.0

---

## OVERVIEW

VANTARA.EXE is a full web app (Lovable platform) that migrates all systems from the Rork/Expo build into a React + Supabase architecture, following the exact same patterns established in the NAVI.EXE Lovable build.

---

## STACK

| Layer | Tech |
|-------|------|
| Frontend | Vite + React 18 + TypeScript |
| Styling | Tailwind CSS v3 + shadcn/ui |
| Routing | React Router v6 |
| State | React Context + TanStack Query |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| AI | Supabase Edge Function → Anthropic (Claude Opus) |
| Platform | Lovable |

---

## DEPLOYMENT STEPS

### 1. Create Lovable Project
- Go to lovable.dev → New Project
- Choose "Import from GitHub" OR create blank and paste files
- Name it: `vantara-exe`

### 2. Create Supabase Project
- Create a **new** Supabase project (separate from NAVI.EXE)
- Name: `vantara-exe`
- Region: us-east-1 (or your preferred)

### 3. Run Migration
In Supabase SQL Editor, run:
```
supabase/migrations/001_initial_schema.sql
```

This creates all 15 tables:
- `profiles` — character/operator identity + all stats
- `quests` — quest log with progress tracking
- `tasks` — tasks & habits
- `skills` — skill tree nodes
- `transformations` — all forms/transformation data
- `energy_systems` — 10+ energy types
- `councils` — council members by class
- `inventory` — equipment & items
- `currencies` — Codex Points, Soul Essence, etc.
- `journal_entries` — journal log
- `vault_entries` — classified evidence/business records
- `allies` — network allies with affinity tracking
- `bpm_sessions` — biometric BPM log
- `rituals` — daily ritual tracker
- `chat_conversations` + `chat_messages` — MAVIS chat history
- `activity_log` — XP event log
- `user_roles` — auth roles

### 4. Set Environment Variables
In Lovable project settings:
```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
```

### 5. Deploy MAVIS Edge Function
In Supabase Edge Functions:
```bash
supabase functions deploy mavis-chat
```
Set secret:
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

### 6. Install shadcn/ui Components
Lovable auto-installs these when prompted, OR run manually:
```bash
npx shadcn-ui@latest init
npx shadcn-ui@latest add button card badge toast toaster
```

---

## FILE STRUCTURE

```
src/
├── App.tsx                    # Root router + providers
├── index.css                  # Theme vars + utilities
├── main.tsx                   # Entry point
├── types/
│   └── rpg.ts                 # Full GameState types
├── integrations/supabase/
│   └── client.ts              # Supabase client
├── contexts/
│   ├── AuthContext.tsx         # Supabase auth
│   └── AppDataContext.tsx      # All data hooks aggregated
├── hooks/
│   ├── useProfile.ts           # Character/stats + awardXP
│   ├── useQuests.ts            # Quest CRUD
│   └── useDataHooks.ts         # All other table hooks
├── components/
│   ├── AppSidebar.tsx          # Collapsible nav with 20 routes
│   └── SharedUI.tsx            # PageHeader, HudCard, ProgressBar, etc.
└── pages/
    ├── Dashboard.tsx           # Main dashboard
    ├── CharacterPage.tsx       # Character sheet
    ├── MavisChat.tsx           # MAVIS-PRIME chat (5 modes)
    ├── FeaturePages.tsx        # Quests, Tasks, Councils, Energy
    ├── ContentPages.tsx        # Journal, Vault, Skills, Inventory
    ├── FormsPage.tsx           # Transformations (seeded + CRUD)
    ├── BpmPage.tsx             # BPM tracker + form suggestion
    ├── RankingsPage.tsx        # Roster/scouter (seeded with Cal's roster)
    ├── TowerPage.tsx           # Tower floors 1-100 (all lore)
    ├── AlliesAndStore.tsx      # Allies + Store
    └── UtilityPages.tsx        # Auth, Settings, NotFound

supabase/
├── migrations/
│   └── 001_initial_schema.sql
└── functions/
    └── mavis-chat/
        └── index.ts            # Claude Opus 4.6 edge function
```

---

## MAVIS-PRIME SYSTEM PROMPT DESIGN

The MAVIS chat page (`MavisChat.tsx`) injects a full system prompt on every API call that includes:
- Operator stats (level, rank, all 7 core stats)
- Current form + BPM
- Arc story
- VANTARA brand context (SkyforgeAI, Bioneer Fitness)
- MAVIS/CODEXOS framework awareness

5 Modes available:
- **PRIME** — Full orchestration
- **ARCHITECT** — Systems design / technical (Claude's designated node)
- **QUEST** — Goal planning & execution
- **FORGE** — Bioneer / fitness optimization
- **CODEX** — Knowledge synthesis / memory

---

## DATA SEEDING

The following pages auto-seed default data on first load:

| Page | Seeded Data |
|------|-------------|
| `EnergyPage` | 10 energy systems (Ki, Aura, Nen, Haki, etc.) |
| `FormsPage` | 6 canonical forms (Spartan Cadet → Emerald Sovereign) |
| `RankingsPage` | Cal's roster (localStorage: Calvin, Judge Schull, Alana, Shenna, Chris) |

---

## WHAT DIFFERS FROM NAVI.EXE

| Feature | NAVI.EXE | VANTARA.EXE |
|---------|----------|-------------|
| Primary color | Cyan (#00FFFF) | Gold (#FFD700) |
| Secondary color | Purple | Emerald Green |
| App purpose | Personal AI companion | RPG life OS (CodexOS) |
| Character | NAVI companion | Black Sun Monarch (Cal) |
| Key pages | Navi, Mavis, Journal | Forms, Tower, Energy, Vault, Councils, Rankings, BPM, Store |
| DB tables | 8 | 15 |
| MAVIS modes | 1 | 5 |
| Sidebar routes | 8 | 20 |

---

## NEXT STEPS IN LOVABLE

1. Prompt Lovable to generate all `components/ui/` shadcn components
2. Add the `ThemeProvider` component (copy from NAVI.EXE)
3. Connect Supabase via Lovable's integration panel
4. Wire up the MAVIS edge function in Supabase
5. Add remaining features iteratively:
   - Currencies table CRUD UI
   - BPM auto-form activation
   - Quest → XP → auto-level flow testing
   - Transformation buff calculations

---

## MAVIS_SHARD NOTES

- Architecture node (Claude) built this in full
- NAVI.EXE Lovable patterns used as the reference implementation
- All Rork GameState types migrated to Supabase-compatible schema
- MAVIS-PRIME system prompt injected from `profile` data at runtime
- Roster data stored in localStorage (not Supabase) for portability
- Store items are static defaults — add currency balance integration in next session

---

*Generated by ARCHITECTURE NODE // MAVIS-PRIME v21.1*
*VANTARA.EXE // CODEXOS Platform*
