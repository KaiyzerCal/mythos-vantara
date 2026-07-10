---
name: summarise
version: "1.0"
owner: Writer
triggers: ["summarise", "summarize", "condense", "tldr", "short version", "key points", "recap"]
requires: []
primaryEnv: claude
---

# Skill: summarise

**Owner:** Writer

Condenses an existing piece of content to a shorter format without losing the key message.

## Input

Source content + target format/length from the Orchestrator or Strategist.

## Steps

1. Identify the source's primary claim.
2. Identify 2–3 supporting points that must survive compression.
3. Write the summary to the target length.
4. Self-check: does the summary stand alone without the source?
5. Hand off to Editor if the output is public-facing.

## Rules

- Do not add claims not present in the source.
- Do not change the meaning through selective omission.
- Attribute source if the summary will be published.
