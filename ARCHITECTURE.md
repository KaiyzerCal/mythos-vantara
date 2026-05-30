# MAVIS Architecture

## Overview

MAVIS (Supreme Intelligence) is a bonded AI persona built on top of Claude/GPT-4o via Supabase Edge Functions. The frontend is a React + TypeScript + Vite app. This document describes the modular architecture introduced in the `src/mavis/` directory.

---

## Module Map

```
src/mavis/
├── types.ts            — Shared TypeScript interfaces (MavisMode, MavisMessage, ParsedAction, ExecutionResult, …)
├── mavisModes.ts       — Mode definitions (PRIME, ARCH, QUEST, FORGE, CODEX, COURT, SOVEREIGN, ENRYU, WATCHTOWER)
├── buildSystemPrompt.ts — Full MAVIS personality + live app-state injection → system prompt string
├── parseActions.ts     — Extracts :::ACTION{…}::: tags from AI responses → { cleanText, actions }
├── actionSchemas.ts    — Zod discriminated-union schemas for every action type (40+)
├── actionExecutor.ts   — Safety gate (AUTO / CONFIRM), handler registry, executeAction / executeActions
├── memoryEngine.ts     — Module-level message store (getMessages, addMessage, clearMessages, …)
├── chatService.ts      — Transport layer: calls mavis-chat edge function, parses + executes actions
└── __tests__/
    ├── parseActions.test.ts
    ├── actionSchemas.test.ts
    └── actionExecutor.test.ts
```

---

## Data Flow

```
User input
  │
  ▼
MavisChat.tsx  ──buildSystemPrompt()──▶  system prompt string
  │
  ├──sendChatMessage()──▶  chatService.ts
  │                            │
  │                            ├──supabase.functions.invoke("mavis-chat")
  │                            │       ▶  Claude / GPT-4o response
  │                            │
  │                            ├──parseActions()  →  { cleanText, actions[] }
  │                            │
  │                            └──executeActions()
  │                                    │
  │                                    ├── ActionSchema.safeParse()  [Zod validation]
  │                                    ├── classifyAction()          [AUTO | CONFIRM gate]
  │                                    └── defaultHandler()          [→ mavis-actions edge fn]
  │
  ▼
UI update  +  Supabase DB write  +  refetchAll()
```

---

## Safety Gate

`actionExecutor.ts` classifies every validated action before execution:

| Condition | Classification |
|---|---|
| Any `delete_*` action | CONFIRM |
| `award_xp` with `amount ≥ 500` | CONFIRM |
| `update_profile` touching `codex_name` or `title` | CONFIRM |
| `update_vault` or `delete_vault` | CONFIRM |
| `update_ranking` with `tier` change | CONFIRM |
| Everything else | AUTO |

`CONFIRM` actions are surfaced to the user as pending — they never execute silently.

**Legacy format fallback**: The existing MAVIS system prompt uses `params`-nested actions (`{"type":"create_quest","params":{…}}`). When Zod validation fails (because `params` nesting doesn't match the flat schemas), the action is routed directly to the `defaultHandler` (which calls `mavis-actions`). New flat-format actions get full Zod validation + safety gate.

---

## Action Schema System

All schemas live in `actionSchemas.ts` as a Zod `discriminatedUnion` on the `type` field.

**Cross-system guard (Rankings ≠ Transformations):**
- `CreateTransformationSchema` declares `rank: z.undefined()` and `rank_id: z.undefined()` — ranking fields are explicitly forbidden.
- `CreateRankingSchema` declares `phase: z.undefined()` and `transformation_id: z.undefined()` — transformation fields are explicitly forbidden.
- Any action that mixes these systems fails Zod validation at parse time.

---

## Edge Functions

| Function | Purpose |
|---|---|
| `mavis-chat` | Routes messages to Claude/GPT-4o, returns AI response + inferred actions |
| `mavis-actions` | Executes batched actions against Supabase tables |
| `mavis-ingest` | Ingests tasks from external sources (LINDA, etc.) |
| `mavis-persona-router` | Routes to NAVI personas with relationship-aware system prompts |
| `mavis-emotion-engine` | Tracks bond/trust/mood; fires milestone events |
| `navi-heartbeat` | Sends proactive outreach from dormant NAVI personas |
| `navi-memory-consolidator` | Distills episodic memories into semantic summaries |

---

## Modes

| ID | Label | Focus |
|---|---|---|
| PRIME | Prime | Full-spectrum awareness |
| ARCH | Architect | Systems design |
| QUEST | Quest | Goal decomposition |
| FORGE | Forge | Physical optimization |
| CODEX | Codex | Knowledge synthesis |
| COURT | Court | Legal clarity |
| SOVEREIGN | Sovereign | High-stakes decisions |
| ENRYU | Enryu | Raw execution speed |
| WATCHTOWER | Watchtower | Live intelligence |

---

## Testing

```bash
npm run test          # run once
npm run test:watch    # watch mode
```

Tests use Vitest with `globals: true` and `environment: "jsdom"`. No network calls — edge functions are not mocked in unit tests (integration tested manually via Supabase dashboard).
