---
name: research
version: "1.0"
owner: Researcher
triggers: ["research", "find", "benchmark", "what does X look like", "investigate", "look into", "source"]
requires: []
primaryEnv: claude
---

# Skill: research

**Owner:** Researcher

Gathers background, sources, and structured findings on a given topic.

## Input

A research question or topic from the Orchestrator.

## Steps

1. Identify what's already known vs. what needs to be found.
2. Gather from primary sources first; secondary sources if primary unavailable.
3. Attribute every fact.
4. Flag any source conflicts.
5. Identify gaps — what we still don't know.
6. Produce a structured research brief.

## Output Format

```
TOPIC: [subject]
WHAT WE KNOW:
- [fact] (source)
- ...
WHAT WE DON'T KNOW:
- [gap]
CONFLICTS:
- [source A] says X; [source B] says Y. Assessment: [weight toward X/Y because...]
SIGNALS:
- [pattern or observation worth the Strategist's attention]
```

Place in `Projects/[brief-name]/research/`.

## Rules

- No synthesis. That's the Strategist's job.
- No opinions. Surface facts.
- If you can't find primary sources, say so explicitly.
