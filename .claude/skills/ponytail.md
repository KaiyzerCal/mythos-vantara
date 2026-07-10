---
name: ponytail
version: "1.0"
owner: Analyst
triggers: ["ponytail", "minimal code", "decision ladder", "over-engineering", "code audit", "ponytail-review", "ponytail-audit", "ponytail-debt"]
requires: []
primaryEnv: claude
---

# Skill: ponytail

**Owner:** Analyst

Enforces minimal-code discipline via a decision ladder before any new code is written. "He says nothing. He writes one line. It works." Claims ~54% less code and ~20% cheaper token execution across codebases that apply it consistently.

## The Decision Ladder

Before writing any new code, work through this ladder top-to-bottom. Stop at the first match.

```
1. Is code even needed?
   → Could this be handled by a config option, environment variable, or existing flag?

2. Does this already exist in the codebase?
   → Search before writing. Use Grep/Glob. Duplicate code is a bug.

3. Is it in the standard library?
   → If the runtime has it built in, use that. No import required.

4. Is it a native platform feature?
   → Web: DOM APIs, CSS, browser storage. Node: fs, http, crypto. Deno: fetch, Deno.cron.

5. Is it in an already-installed dependency?
   → Check package.json / go.mod / Cargo.toml. Use what's there.

6. Is it a single import away from an established package?
   → If adding a well-maintained dep solves it cleanly, do that.

7. Only then: write new code.
   → Write the minimum that makes it work. No scaffolding for hypothetical future use.
```

## Commands

### `/ponytail-review` — Diff audit
Review the current diff for over-engineering. For each block of new code, check:
- Does it pass the decision ladder? (Did the author exhaust options above it?)
- Is there dead code (paths that can never run)?
- Are there abstractions with only one caller?
- Is there scaffolding for features that don't exist yet?

Output:
```
PONYTAIL REVIEW
Lines added: X | Lines that pass ladder: Y | Waste detected: Z

FINDINGS:
[file:line] — [what it does] → [why it fails the ladder] → [what to use instead]

VERDICT: CLEAN / OVER-ENGINEERED
```

### `/ponytail-audit` — Full repo audit
Apply the review to the entire codebase, not just the diff. Focus on:
- Functions called in only one place that should be inlined
- Wrapper classes/types with no added behavior
- Utility files with one function
- Duplicate logic across files
- Dependencies that do what the stdlib already does

Output: ranked list of waste by file, estimated lines to delete.

### `/ponytail-debt` — Track deferred optimizations
When a code review finds an issue but the fix isn't in scope for the current PR, log it here:
```
PONYTAIL DEBT
File: [path:line]
Issue: [what's over-engineered]
Ladder rung: [what should replace it]
Priority: HIGH/MEDIUM/LOW
Added: [date]
```

## Rules

- Failing the ladder is a bug, not a style issue. Treat it accordingly.
- "But we might need it later" is not a justification. Cross that bridge when you reach it.
- Abstractions with one caller should be inlined unless they're genuinely complex.
- Never add a dependency to do something the stdlib handles.
- `/ponytail-review` should run on every PR before merge.
