# Interview-Style Doc Building — SSOT Files via Q&A Loop

**Triggers:** `["interview style doc", "build life doc", "one question at a time", "life priorities doc", "life vision", "quarterly review doc", "SSOT interview", "patch not write"]`

## What It Is

Builds authoritative single-source-of-truth documents (life priorities, life vision, principles, ranked lists, quarterly reviews) through a strict one-question-at-a-time loop where Claude asks and patches but never proposes content. The user's own words are the content.

**Source:** `KaiyzerCal/skills` (davidondrej fork, MIT)

## The Loop

1. Create file with skeleton + "to be filled in" placeholders — **single `write_file`**
2. Ask **ONE** question (concise, single-faceted, open-ended)
3. Wait for answer — do NOT ask the next question yet
4. **`patch`** the file in the correct section — NEVER `write_file` to existing doc
5. Update file BEFORE asking next question: answer → patch → next question
6. Repeat until complete

## Hard Rules

- **ONE question at a time** — even asking two violates the rule
- **Patch, don't overwrite** after skeleton exists
- **Update file BEFORE next question**: answer → patch → next question (in that order)
- Lists from the user are **unordered sets** — never infer rank from the order they typed items
- No AI-generated content — sections stay empty until the user provides it
- Never propose answers, never suggest what Calvin "might" believe

## Forcing-Question Framing

Use these openers to surface true priorities:
- "What wins against everything else?" (not "Is X #1?")
- "What's the thing that, if true, makes the rest obvious?" (engine-move framing)
- "If everything else was equal, what would you protect last?" (last-resort framing)

For ranked lists, confirm one rank at a time:
```
"You mentioned Business, Health, Relationships, and Craft. 
 Which one wins when everything else is equal?"
→ patch rank #1
"Of the remaining three, which is next?"
→ patch rank #2
...
```

## Skeleton Template (life priorities example)

```markdown
# Life Priorities

_Last updated: [date]_

## North Star
[to be filled in]

## Priority Stack
1. [to be filled in]
2. [to be filled in]
3. [to be filled in]
4. [to be filled in]

## What I'm Optimizing For This Quarter
[to be filled in]

## What I'm Explicitly Not Optimizing For
[to be filled in]

## Non-Negotiables
[to be filled in]
```

## MAVIS Use Case

Use this skill when Calvin asks MAVIS to help build or update any authoritative life-context document. Key documents this applies to: `context/user.md`, personal life priorities, quarterly review files, or any document in `Projects/` that captures Calvin's own beliefs and values. These files feed into MAVIS's `authoritativeContext` — they must be in Calvin's words, not AI-generated.
