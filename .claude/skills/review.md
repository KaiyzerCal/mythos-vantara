# Skill: review

**Owner:** Editor

Reviews a draft against the brief, brand voice, and prohibited language.

## Input

A draft from `Projects/[brief-name]/drafts/`.

## Steps

1. Read the brief the Writer worked from.
2. Read `context/brand/voice-profile.md`.
3. Read `context/brand/prohibited-language.md`.
4. Review the draft across four dimensions:
   - Voice compliance
   - Claim integrity
   - Structural soundness
   - Brief compliance
5. Output: CLEARED or RETURNED with annotations.

## Annotation Format

```
[VOICE] "[quote]" → [violation]. Suggest: [fix]
[CLAIM] "[quote]" → unsubstantiated. Remove or source.
[STRUCTURE] [section] → [structural issue]. Move [X].
[BRIEF] [element] → does not execute the brief's stated [message/audience/format].
```

## Output

**If CLEARED:** Place in `Projects/[brief-name]/review/` with status: CLEARED. Orchestrator moves to `Inbox/`.  
**If RETURNED:** Return to Writer with annotations. Do not produce a new draft yourself.
