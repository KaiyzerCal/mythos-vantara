---
name: analyze
version: "1.0"
owner: Analyst
triggers: ["analyze", "report", "metrics", "KPIs", "data", "performance", "numbers", "what's the trend", "dashboard"]
requires: []
primaryEnv: claude
---

# Skill: analyze

**Owner:** Analyst

Interprets data and surfaces what it means.

## Input

A data set, metric dump, or performance question from the Orchestrator.

## Steps

1. Identify what metric is being measured.
2. Establish baseline (prior period, target, or stated benchmark).
3. Compute the delta.
4. Identify what caused the change (if data supports causation — flag if it's correlation only).
5. Produce a structured report.

## Output Format

```
PERIOD: [date range]
METRIC: [what was measured]
RESULT: [the number]
VS PRIOR: [change and % if available]
SIGNAL: [what this means — one sentence]
CAVEAT: [data quality note if relevant]
RECOMMENDATION: [what this finding suggests the Strategist should consider]
```

## Rules

- Never claim causation without evidence.
- Always state what data is missing.
- If targets don't exist, say so; don't fabricate them.
