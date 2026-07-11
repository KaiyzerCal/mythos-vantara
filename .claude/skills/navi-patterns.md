# NAVI.EXE Patterns — Predecessor App Archaeology

**Triggers:** `["navi patterns", "navi.exe", "predecessor app", "component archaeology", "vantara schema reference"]`

## What It Is

`KaiyzerCal/NAVI.EXE-lovable` is the direct predecessor to VANTARA.EXE — same stack (React + TypeScript + Vite + Supabase + Tailwind + shadcn + Bun + Capacitor), 439 commits deep. Mining it before building new features prevents re-inventing wheels Calvin already solved.

## Key Pages to Reference

| Page | File | What to mine |
|---|---|---|
| AI Chat | `MavisChat.tsx` | Chat UX patterns, streaming, message state |
| Quests | `QuestsPage.tsx` | Quest CRUD, XP awarding, status transitions |
| Journal | `JournalPage.tsx` | Entry editor, tag system, vault integration |
| Dashboard | `Dashboard.tsx` | Widget layout, data aggregation patterns |
| Character | `CharacterPage.tsx` | Stats display, progression, form system |
| Guild | `GuildPage.tsx` | Multi-user social layer (if expanding) |
| Stats | `StatsPage.tsx` | Analytics, streak tracking, charts |
| Upgrade | `UpgradePage.tsx` | Stripe checkout, subscription tier gating |

## Infrastructure Already Solved

- **Stripe checkout** — working subscription billing flow, tier gates
- **Sentry error monitoring** — already integrated, `.env.sentry` patterns
- **Capacitor** — iOS/Android mobile bridge already configured
- **Supabase RLS patterns** — per-table policy templates for all game-layer tables

## How to Use

When building a new VANTARA feature, check NAVI.EXE first:

```
1. Search NAVI.EXE-lovable for the concept (e.g., "streak", "XP", "vault")
2. Read the relevant component/migration
3. If the pattern is solid, adapt it to VANTARA's current schema
4. Don't copy-paste — re-implement with improvements
```

## What's Better in VANTARA

NAVI.EXE lacks: MAVIS AI chat, TELOS life context, DA Identity traits, ISA quest schema, council voting, knowledge graph, Telegram bot, dreaming/consolidation, and LifeOS freshness grading. Don't backport — only mine forward.
