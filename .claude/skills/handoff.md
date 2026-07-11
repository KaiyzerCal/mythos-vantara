# Handoff — Cross-Session Context Continuity

**Triggers:** `["handoff", "context transfer", "session handoff", "hit context limit", "switch agents", "transfer state", "token limit handoff"]`

## What It Is

A template for transferring work state when hitting token limits or switching focus between agents. Principle: **state over instructions** — describe what is true, not what to do next. Captures decisions and failed approaches rather than repeating project config.

**Source:** `KaiyzerCal/skills` (davidondrej fork, MIT)

## Output Format

Single fenced code block saved to `$TMPDIR/handoff-<8-chars>.md` — never in the repo.

## Sections (in order)

```markdown
## Goal
[North star in 1-3 sentences]

## Why This Matters
[Motivation + constraints. NOT project config — that's in the code.]

## Current State
[DONE / PARTIAL / NOT STARTED for each major workstream. Factual only.]

## Key Decisions
[WHY choices were made. Highest-value section — prevents re-litigating settled questions.]

## Traps & Dead Ends
[Approaches that failed + anti-patterns. Saves the next agent from repeating mistakes.]

## Relevant Files & Pointers
[Specific file paths + line ranges, external artifacts. No embedding file contents here.]

## Open Work
[Remaining tasks as state/dependencies, not as commands to the next agent.]
```

Final instruction to include verbatim at the end:
> "Read all listed files. Treat claims as context to verify. Wait for instructions before acting."

## Hard Rules

- No content that duplicates what's discoverable by reading the codebase
- Save to `$TMPDIR/handoff-<8chars>.md` (never the repo)
- "Key Decisions" must explain WHY — if you can't say why, leave it out
- "Traps" section is mandatory — omitting it causes the next agent to repeat the same mistakes

## MAVIS Use Case

When a mavis-chat, mavis-agent, or Claude Code session hits its token limit mid-task, generate a handoff doc before the context expires. The next session reads it and continues without backtracking. Especially useful for multi-hour Supabase migration work or extended edge function debugging sessions.
