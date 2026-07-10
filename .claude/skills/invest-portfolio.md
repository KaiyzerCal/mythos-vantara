---
name: invest-portfolio
version: "1.0"
owner: Analyst
triggers: ["portfolio review", "review my portfolio", "portfolio analysis", "portfolio management", "position sizing", "rebalance portfolio", "portfolio health"]
requires: ["invest-thesis-tracker", "invest-data"]
primaryEnv: claude
---

# Skill: invest-portfolio

**Owner:** Analyst

Portfolio-level review. Moves beyond "is this company good?" to "is this portfolio well-constructed?" Covers concentration, position sizing, thesis integrity, correlation, and overall risk posture.

## Input

List of holdings with position sizes. Optionally: target allocation, risk tolerance, time horizon.

## Steps

### Step 1 — PORTFOLIO MAP
Build a structured view of the current portfolio:
- Holdings list with position size ($ or %) and cost basis
- Group by: sector, geography, business stage (early/mature/turnaround)
- Identify: top 5 positions as % of total — are they your highest-conviction ideas?

### Step 2 — CONCENTRATION ANALYSIS
Buffett target: 5-8 positions for full conviction; up to 15 for broader exposure.
- How many positions? (>20 suggests insufficient conviction or closet indexing)
- What % is in the top 3 positions?
- Is concentration in your best ideas or your oldest ones?

Flag: if the largest positions are NOT the highest-conviction ones → rebalancing signal.

### Step 3 — THESIS INTEGRITY CHECK (per position)
For each holding, answer:
1. Is the original investment thesis still intact?
2. What has changed since purchase? (business facts, price, macro)
3. Has the business met or missed its core milestones since purchase?
4. What is the current margin of safety at today's price?

Run `invest-thesis-tracker` for any position where the thesis hasn't been reviewed in >90 days.

### Step 4 — CORRELATION & RISK CONCENTRATION
- Which positions are correlated? (same sector, same macro driver, same customer base)
- If one major macro event hit (rate spike, China policy change, USD strength), which positions would all move together?
- Is there a single macro bet hidden in the portfolio that you didn't intend to make?

### Step 5 — PERFORMANCE ATTRIBUTION
For the review period:
- Which positions drove gains? Why (multiple expansion, earnings growth, narrative)?
- Which positions hurt? Was the thesis wrong, or just timing?
- Are you being rewarded for the right things? (Fundamental improvement, not just momentum)

### Step 6 — ACTION CHECKLIST

For each position, assign one of:
- **ADD** — thesis intact, more room to size up, price attractive
- **HOLD** — thesis intact, position appropriately sized
- **TRIM** — thesis intact but position too large relative to conviction; or price appreciated beyond intrinsic value
- **REVIEW** — thesis needs re-examination; pending new data
- **EXIT** — thesis broken, or position no longer adds to portfolio quality

No "maybe" or "waiting to see" — each position gets a decision.

### Step 7 — PORTFOLIO GRADE

Score the portfolio overall (1-10) on:
- Quality (weighted average of individual company quality scores)
- Concentration discipline (appropriate for conviction level)
- Thesis currency (all positions have been reviewed in the last 90 days)
- Valuation (weighted average margin of safety)

## Output Format

```
PORTFOLIO REVIEW — [Date]

HOLDINGS MAP:
[Position table: company, %, cost basis, current price, gain/loss, sector, thesis date]

CONCENTRATION:
Total positions: [N] | Top 3: [X%]
Highest conviction = largest positions? [YES / NO — mismatch: ___]

THESIS INTEGRITY:
[Position: INTACT / WEAKENED / BROKEN — brief note]

CORRELATION RISK:
Hidden macro bet detected: [description or NONE]
Correlated cluster: [companies and shared risk]

PERFORMANCE:
Gains driven by: [fundamental / multiple expansion / both]
Losses: [thesis wrong? / timing? / external shock?]

ACTIONS:
ADD: [positions]
HOLD: [positions]
TRIM: [positions]
REVIEW: [positions]
EXIT: [positions]

PORTFOLIO GRADE: [X/10]
Priority action: [one thing to do this week]
```

## Rules

- Every position must get an ADD/HOLD/TRIM/REVIEW/EXIT decision — no neutral.
- Thesis integrity check is mandatory for positions >90 days since last review.
- "I haven't reviewed it recently" is not a reason to grade a position HOLD — it's a reason to grade it REVIEW.
- Concentration above 15 positions must be justified or reduced.
