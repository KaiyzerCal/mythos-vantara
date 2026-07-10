---
name: invest-thesis-tracker
version: "1.0"
owner: Analyst
triggers: ["thesis tracker", "track thesis", "investment thesis", "monitor position", "track investment", "is my thesis still valid"]
requires: []
primaryEnv: claude
---

# Skill: invest-thesis-tracker

**Owner:** Analyst

Post-purchase discipline system. A thesis is not "buy and forget" — it's a set of testable assumptions. This skill tracks whether those assumptions are still holding.

## Input

Company name + original thesis (or key assumptions if thesis was written earlier).

## Core Framework

A thesis has three components:
1. **Why this business is good** (moat, quality, management)
2. **Why it's cheap** (margin of safety, mispricing reason)
3. **What has to happen for it to work** (specific milestones or triggers)

Each component can be: INTACT / WEAKENED / BROKEN.

## Steps

### Step 1 — RECONSTRUCT THE ORIGINAL THESIS
If not written at purchase time, reconstruct now from memory + any notes. Be specific:
- What moat did you believe in? What was the evidence?
- What was your intrinsic value estimate?
- What margin of safety did you have at entry?
- What were the 2-3 key assumptions that had to prove true?

### Step 2 — FACTS THAT HAVE CHANGED (since purchase)
Enumerate only verifiable, factual changes — not narrative changes:
- Earnings results vs. expectations
- Market share data
- Management changes
- Competitive events (new entrant, incumbent collapse, regulatory shift)
- Balance sheet changes (debt increase, buybacks, acquisition)
- Valuation change (price vs. intrinsic value update)

**Critical distinction**: did the FACTS change, or did the STORY change?
- "Competitor launched a similar product" = fact
- "The narrative around this sector shifted" = story (don't sell on story shifts)

### Step 3 — THESIS COMPONENT REVIEW

**Why this business is good:**
- Is the moat still intact? (Evidence for and against)
- Has quality improved, held, or eroded?
- Is management still trustworthy?

**Why it's cheap:**
- What is intrinsic value today (updated estimate)?
- What is current price?
- Is there still a margin of safety? (If price has appreciated to intrinsic value → reassess)

**What has to happen for it to work:**
- List the 2-3 original key assumptions
- For each: MET / ON TRACK / MISSED / NO LONGER RELEVANT
- If any key assumption is MISSED → thesis needs deep review

### Step 4 — OVERALL THESIS STATUS

- **INTACT** — all three components holding; price still attractive → HOLD or ADD
- **WEAKENED** — one component softened but not broken; still investable → HOLD with tighter watch
- **BROKEN** — a key assumption has definitively failed → EXIT plan required
- **PRICE RISK** — thesis intact but margin of safety has disappeared due to price appreciation → TRIM or HOLD (don't add)

### Step 5 — EXIT TRIGGERS

Define specific exit conditions that would force a sell, regardless of emotion:
- "If gross margin falls below X% for 2 consecutive quarters"
- "If management makes an acquisition >$Xbn without explaining the rationale"
- "If key assumption #2 (market share growth) fails for 4 consecutive quarters"

Exit triggers must be specific and pre-committed — not based on "how I feel about it."

## Output Format

```
THESIS TRACKER: [Company]
Original purchase: [date] at $[price]
Last reviewed: [date]

ORIGINAL THESIS (reconstructed):
Why good: [moat + quality + mgmt summary]
Why cheap: [IV $X, entry at $Y, margin of safety X%]
Key assumptions: 1. ___ 2. ___ 3. ___

FACTS CHANGED (since purchase):
• [fact 1] — source + date
• [fact 2] — source + date

THESIS COMPONENTS:
Why good: [INTACT / WEAKENED / BROKEN] — [evidence]
Why cheap: Current IV $X | Current price $Y | Margin of safety [X% / NONE / OVERVALUED]
Assumptions: 1. [MET/ON TRACK/MISSED] 2. [_] 3. [_]

THESIS STATUS: [INTACT / WEAKENED / BROKEN / PRICE RISK]

EXIT TRIGGERS:
1. [specific measurable trigger]
2. [specific measurable trigger]

DECISION: [HOLD / ADD / TRIM / EXIT]
Review due: [date — 90 days max if INTACT; 30 days if WEAKENED]
```

## Rules

- "The thesis has weakened but I still believe in it" is not a decision — HOLD or EXIT are decisions.
- Sell on broken facts, not on story shifts or price drops.
- Price drops with intact thesis → ADD (if margin of safety has widened). Do not panic.
- Price appreciation above intrinsic value → TRIM or HOLD. Do not add on price momentum.
- Re-review every 90 days at minimum; every 30 days if status is WEAKENED.
