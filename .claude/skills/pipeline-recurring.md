---
name: pipeline-recurring
version: "1.0"
owner: Orchestrator
triggers: ["newsletter", "weekly", "recurring", "every Monday", "on a schedule", "cadence", "regular output"]
requires: ["draft", "review"]
primaryEnv: claude
---

# Pipeline: Recurring Deliverable

For cadence-driven outputs — newsletters, weekly briefs, anything on a schedule.

## When to Use

- Weekly summaries
- Newsletter issues
- Recurring content formats (e.g. "every Monday, a thread on CODEXOS progress")

## Chain

```
(Strategist) → Writer → Editor → Inbox/
```

The Strategist step is often skipped for recurring formats because the brief is already established in the first run and reused each cycle.

## Setup (First Run Only)

1. Strategist writes a master brief for the recurring format. Save in `templates/`.
2. Writer reads the master brief + current-cycle inputs (data, events, Calvin's notes).
3. Writer produces the draft.
4. Editor clears or returns.

## Subsequent Runs

1. Writer reads the master brief (same as always) + current-cycle inputs.
2. Writer produces draft referencing the format established in prior runs.
3. Editor reviews against the master brief (not against each individual draft).
4. Cleared → `Inbox/`.

## Notes

- Master brief should be updated quarterly or when the format changes.
- Don't let the format drift issue to issue — the Editor flags format drift as a structural issue.
