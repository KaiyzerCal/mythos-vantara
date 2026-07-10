---
name: invest-thesis-drift
version: "1.0"
owner: Analyst
triggers: ["thesis drift", "detect drift", "has my thesis drifted", "am I rationalizing", "confirmation bias check", "thesis changed"]
requires: ["invest-thesis-tracker"]
primaryEnv: claude
---

# Skill: invest-thesis-drift

**Owner:** Analyst

Detects when an investment thesis has drifted — when the original reasons for holding no longer match the current stated reasons, often due to rationalization or narrative shifting. Distinguishes fact-based evolution from motivated reasoning.

## Input

Original thesis (at purchase) + current stated thesis. Company name.

## The Core Problem

After buying, investors unconsciously update their thesis to match new information that confirms the buy decision. This is not learning — it is motivated reasoning. The result: you think you have conviction, but you are actually rationalizing a position you should have exited.

Signs of thesis drift:
- Your current reason for holding is different from your original reason for buying
- You now cite factors you did not mention at purchase
- You have stopped tracking the original key assumptions
- Every piece of bad news gets "contextualized" while every good news gets "confirmed"

## Steps

### Step 1 — ORIGINAL THESIS RECONSTRUCTION
Retrieve or reconstruct the original thesis at purchase. Be specific about:
- The exact moat you believed in
- The specific margin of safety
- The 2-3 key assumptions you were making

If you cannot reconstruct the original thesis from memory or notes, that itself is a drift signal.

### Step 2 — CURRENT THESIS STATEMENT
Write out your current stated reason for holding. Do this BEFORE reading the Step 3 comparison.

### Step 3 — DRIFT DETECTION (compare original vs. current)

**Legitimate thesis evolution** (acceptable to update thesis):
- New verifiable facts emerged that strengthen the original thesis
- An original assumption was MET and you identified the next assumption
- A known risk was resolved by external event (regulation, competition)
- You found additional evidence that deepens the original thesis

**Thesis drift** (flag these):
- [ ] You are now citing company qualities you did not cite at purchase
- [ ] You are no longer tracking the original key assumptions
- [ ] A key assumption has been missed, but you have "reframed" why it doesn't matter
- [ ] Your confidence increased DESPITE no new positive fundamental evidence (narrative drift)
- [ ] You would not buy this company at today's price if you had no position (Orphan Test)
- [ ] The stock price has dropped and your thesis has mysteriously "deepened" to explain the drop

### Step 4 — THE ORPHAN TEST
"If I did not own this stock and had no history with it, would I buy it today at today's price, based on today's facts?"

- YES → thesis is still real
- NO → you are rationalizing a position, not holding an investment

### Step 5 — THE JOURNALIST TEST
Imagine a business journalist is writing a critical piece about your investment thesis. They have access to all the same information you have. What would they write? What holes would they find in your current thesis?

Write 3-5 sentences from the journalist's perspective. If you cannot write a credible critique, you are not thinking clearly.

### Step 6 — VERDICT + CORRECTIVE ACTION

- **NO DRIFT** — original and current thesis align; current thesis supported by facts → CONTINUE holding
- **LEGITIMATE EVOLUTION** — thesis updated based on new verifiable facts → document the update; continue
- **DRIFT DETECTED** — current thesis substitutes narrative for facts → run invest-thesis-tracker to re-anchor to original assumptions; hold/exit decision required
- **SEVERE DRIFT** — original thesis broken; holding on narrative alone → EXIT plan required

## Output Format

```
THESIS DRIFT CHECK: [Company]

ORIGINAL THESIS (at purchase $[price]):
Key moat: [___]
Margin of safety: [X%]
Key assumptions: 1. ___ 2. ___ 3. ___

CURRENT STATED THESIS:
[as written today]

DRIFT ANALYSIS:
Changed elements: [list what differs]
Drift indicators flagged: [list]
Legitimate evolution? [YES / NO / PARTIAL]

ORPHAN TEST: Would I buy today at $[price]? [YES / NO]
Journalist critique: [3-5 sentences]

VERDICT: [NO DRIFT / LEGITIMATE EVOLUTION / DRIFT / SEVERE DRIFT]
Corrective action: [none / re-anchor to original / exit plan required]
```

## Rules

- Thesis drift detection requires intellectual honesty — it only works if you write the current thesis BEFORE doing the comparison.
- A drifted thesis is not automatically wrong, but it must be explicitly re-anchored to facts.
- The Orphan Test result overrides any amount of narrative reasoning.
- "I still believe in the long-term story" without any factual basis = SEVERE DRIFT.
