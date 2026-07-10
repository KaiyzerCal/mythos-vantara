---
name: no-mistakes
version: "1.0"
owner: HR
triggers: ["no-mistakes", "pre-push validation", "git proxy", "push validation", "ai validation pipeline", "validate before push", "code quality gate"]
requires: []
primaryEnv: claude
---

# Skill: no-mistakes

**Owner:** HR

A local Git proxy that intercepts pushes and runs an AI-driven validation pipeline in a disposable worktree before forwarding to the real remote and auto-opening a PR. Non-blocking — local branch is never touched.

## What It Does

When `git push` is intercepted:
1. Creates a disposable worktree (never touches your local branch)
2. Runs the validation pipeline: review → test → docs → lint
3. Applies safe mechanical fixes automatically
4. Escalates judgment calls (refactors, architecture changes) to human
5. Forwards the push and opens a PR when all checks are green

## Validation Pipeline

### Stage 1 — Review
AI code review in the worktree. Checks:
- Logic bugs and off-by-one errors
- Security issues (injection, credential exposure, OWASP top 10)
- Ponytail decision ladder violations (over-engineering)
- Missing error handling at system boundaries

### Stage 2 — Test
Run existing test suite. If tests fail:
- AI diagnoses root cause
- Applies fix if mechanical (missing assertion, wrong expected value)
- Escalates if architectural

### Stage 3 — Docs
Check that new public interfaces have documentation.
- Generates missing docstrings/JSDoc for exported functions
- Updates changelog if significant feature

### Stage 4 — Lint
Run configured linters (ESLint, tsc, ruff, etc.).
- Auto-fixes all auto-fixable issues
- Blocks on non-auto-fixable violations

## Agent Backends Supported

- Claude Code (recommended for this project)
- GitHub Copilot CLI
- Codex
- OpenCode

## Entry Points

1. **Git push** — automatic interception (requires hook install)
2. **Interactive TUI** — `no-mistakes run` for manual trigger
3. **Skill** — `/no-mistakes` from Claude Code CLI

## Using This Skill

When invoked as `/no-mistakes`, run the four-stage pipeline on the current diff:

```
NO-MISTAKES PIPELINE RUN

Stage 1: Review
[findings → auto-fixed or flagged for human]

Stage 2: Test
[test run result → fixes applied or escalated]

Stage 3: Docs
[missing docs → generated]

Stage 4: Lint
[lint results → auto-fixed or blocking]

RESULT: PASS / FAIL
Safe to push: YES / NO — [reason if NO]
```

## Rules

- Never skip a stage. All four must pass before the push proceeds.
- Auto-fix only mechanical changes (whitespace, imports, missing assertions, formatting).
- Any change that affects behavior must be escalated to human review.
- The worktree is always disposable — local branch state is never modified.
- If the AI agent itself introduces a bug in a fix, the next review stage will catch it.
