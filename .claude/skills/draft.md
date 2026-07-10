---
name: draft
version: "1.0"
owner: Writer
triggers: ["write", "draft", "post", "copy", "email", "article", "caption", "thread", "script"]
requires: ["research"]
primaryEnv: claude
---

# Skill: draft

**Owner:** Writer

Produces a first draft against a Strategist brief.

## Input

A completed brief from `Team/Strategist/` or directly from Calvin.

## Steps

1. Read the brief in full before writing a word.
2. Check `context/brand/voice-profile.md`.
3. Check `context/brand/prohibited-language.md`.
4. Write the draft.
5. Self-check: does every sentence serve the brief's stated message?
6. Hand off to Editor for review.

## Output

Draft placed in `Projects/[brief-name]/drafts/`.

## Rules

- Do not stray from the brief's stated audience.
- Do not include claims you cannot support from the Researcher's brief or Calvin's stated facts.
- One round of self-review before hand-off.
