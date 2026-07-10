---
name: inbox-scan
version: "1.0"
owner: Orchestrator
triggers: ["inbox-scan", "what's in the outbox", "check outbox", "scan inbox", "what's queued"]
requires: ["route"]
primaryEnv: claude
---

# Skill: inbox-scan

Scans `Outbox/` for queued briefs and routes them.

## When to Run

- Session start (after reading journal.md)
- When Calvin says "inbox-scan" or "what's in the outbox"

## Steps

1. List all files in `Outbox/`.
2. For each file:
   a. Read the brief.
   b. Classify it using the route skill.
   c. Route to the correct specialist.
   d. Append to `journal.md`.
3. After processing all items, confirm:
   ```
   Outbox cleared. [N] briefs routed: [list of what went where].
   ```

## Rules

- Do not delete files from `Outbox/` — Calvin clears them.
- If a brief is ambiguous, route with a note: "Routed as [X] — confirm if [Y] was intended."
- If `Outbox/` is empty, say so. Don't fabricate items.
