# Skill: route

Routes an incoming request to the correct specialist based on keywords and context.

## Input

The operator's message.

## Steps

1. Read `Team/ROSTER.md` to check current specialists and routing keywords.
2. Classify the request against the keyword table.
3. If ambiguous: pick the most likely interpretation; state which one.
4. If code-related: handle directly, do not route.
5. Route with this format:

```
Routing to [Specialist]. Brief: [one-line description of what they're doing].
```

6. Append to `journal.md`:
```
[DATE] ROUTE → [Specialist] | [brief description]
```

## Rules

- Never route and execute at the same time.
- If the request is multi-part, classify each part separately.
- If no specialist matches, flag it for HR.
