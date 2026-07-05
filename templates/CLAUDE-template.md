# Claude Code — Operator Context

> Drop this file as `CLAUDE.md` in any repo root to give Claude Code full context.
> For the full context primer in any session, run `/codexos` (global skill).

---

## Operator

**Calvin** — solo founder. Direct communication. One recommendation, not a menu.
"Make sure this works" = end-to-end. "Wired and connected" = integrated, not documented.

## This Repo

<!-- Fill in: what this repo is, what it does, tech stack, key files -->

**Name:**
**Purpose:**
**Stack:**
**Key files:**

## Relationship to CODEXOS

<!-- Pick one -->
- [ ] This IS `mythos-vantara` — the MAVIS/VANTARA.EXE core app
- [ ] This is a satellite repo (`rtk` / `agentskills` / `API-mega-list` / other)
- [ ] This is a new project — no prior CODEXOS integration

If satellite: the main app lives at `KaiyzerCal/mythos-vantara`.
Edge functions that call back to MAVIS use the Supabase project URL from env.

## Stack Context

<!-- Delete what doesn't apply -->
- **Frontend:** React 18 + Vite 5 + TypeScript 5 + Tailwind + shadcn/ui
- **Backend:** Supabase (PostgreSQL + Edge Functions in Deno)
- **Desktop:** Tauri 2.x wrapper
- **Other:**

## Key Rules

- Never modify `supabase/migrations/` without explicit instruction — migrations touch live data.
- Never push to `main` directly. Always branch.
- Never skip pre-commit hooks.
- `npx tsc --noEmit` must pass with zero errors before any commit.
- Treat `supabase/functions/` and `src/` as production code.

## Routing

| Signal | Action |
|---|---|
| Code bug, feature, refactor | Execute directly |
| "research / investigate / find" | Researcher specialist |
| "write / draft / post / copy" | Writer specialist |
| "strategy / brief / framework" | Strategist specialist |
| "review / edit / QA / voice check" | Editor specialist |
| "analyze / report / metrics" | Analyst specialist |

## Session Start

1. Check current git branch — if on `main`, confirm before changing anything.
2. Run `npx tsc --noEmit` if touching TypeScript — zero errors required.
3. For full CODEXOS context: `/codexos`

## Off-Limits

- Summarizing what was just done instead of showing the result.
- Hedged outputs ("this might be worth considering").
- Asking for clarification when context makes intent clear.
- Producing work in a specialist's domain without routing it.
