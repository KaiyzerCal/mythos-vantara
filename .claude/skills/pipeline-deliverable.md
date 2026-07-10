---
name: pipeline-deliverable
version: "1.0"
owner: Orchestrator
triggers: ["pipeline", "standard deliverable", "publish", "content output", "full pipeline", "from research to draft"]
requires: ["research", "draft", "review"]
primaryEnv: claude
---

# Pipeline: Standard Deliverable

The default chain for any content output that goes public or to a client.

## Chain

```
Researcher → Strategist → Writer → Editor → Inbox/
```

## Steps

### 1. Researcher
- Trigger: Orchestrator provides topic + audience + deadline.
- Output: `Projects/[name]/research/brief.md`
- Hand-off signal: "Research complete. Brief in `research/`."

### 2. Strategist
- Reads: research brief
- Produces: `Projects/[name]/strategy/brief.md` (see template in `Team/Strategist/persona.md`)
- Hand-off signal: "Strategy brief ready. In `strategy/`."

### 3. Writer
- Reads: strategy brief + research brief
- Produces: `Projects/[name]/drafts/v1.md`
- Hand-off signal: "Draft v1 in `drafts/`. Sending to Editor."

### 4. Editor
- Reads: draft + strategy brief
- Produces: CLEARED or RETURNED with annotations
- If CLEARED: Orchestrator moves file to `Inbox/[name].md`
- If RETURNED: returns to Writer; Writer produces v2; Editor re-reviews

## Human-in-the-Loop Checkpoints

- After Researcher: Calvin reviews before Strategist proceeds (optional for fast work)
- After Editor clears: Calvin reviews before publishing

## Notes

- Run this pipeline via: "Run standard deliverable pipeline for [project name]"
- Project folder must exist in `Projects/` before pipeline starts
