---
name: invest-bottleneck
version: "1.0"
owner: Analyst
triggers: ["bottleneck hunter", "supply chain bottleneck", "find bottleneck", "choke point", "supply constraint", "who controls the supply chain", "chokepoint investing"]
requires: ["invest-industry", "invest-data"]
primaryEnv: claude
---

# Skill: invest-bottleneck

**Owner:** Analyst

Identifies supply chain chokepoints — the single points of control in a global production chain where a company has pricing power because the alternative is supply disruption. Chokepoint companies often have the highest and most durable moats.

## Core Concept

In any global supply chain, value does not distribute evenly across steps. It concentrates at chokepoints: steps where:
1. There are few suppliers (oligopoly or monopoly)
2. The input is irreplaceable (no close substitutes)
3. Switching costs are high (qualification time, capital, technical complexity)
4. Demand is growing regardless of price

Companies at chokepoints can raise prices with almost no customer loss. They are the hidden compounders.

## Input

Supply chain / industry name. e.g. "AI chip supply chain", "EV battery supply chain", "semiconductor lithography", "rare earth processing"

## Steps

### Step 1 — MAP THE FULL VALUE CHAIN
From raw material to end product, list every production step:
- Step 1: [raw material] → Step 2: [processing] → Step 3: [component] → ... → End product

For each step, record:
- Who are the producers? (list companies + country)
- How many viable suppliers globally?
- What share does the top 3 producers control?
- What is the technical barrier to entry for a new supplier?

### Step 2 — IDENTIFY CHOKEPOINT CANDIDATES
Flag any step where:
- Top 3 suppliers control >60% of global supply, AND
- No viable substitute exists in the short-to-medium term (3-7 years), AND
- Demand is growing or inelastic

Each flagged step is a chokepoint candidate.

### Step 3 — CHOKEPOINT QUALITY SCORING
For each candidate, score 1-5 on:

| Factor | Description | Score |
|---|---|---|
| Concentration | How few suppliers control this step? | 1-5 |
| Substitutability | How hard is it to replace this input? | 1-5 |
| Switching cost | Time + capital + qualification required to switch? | 1-5 |
| Demand growth | Is demand for this step growing with industry tailwinds? | 1-5 |
| Moat durability | How long does this chokepoint advantage persist? | 1-5 |

Total score ≥20: Tier-1 chokepoint. 15-19: Tier-2. <15: Not a real chokepoint.

### Step 4 — CHOKEPOINT COMPANY ANALYSIS
For the Tier-1 and Tier-2 chokepoints, identify the controlling companies and run abbreviated 4-master analysis:

**Buffett lens**: Does the chokepoint translate to durable pricing power? Evidence in gross margin history?

**Munger lens**: What could break the chokepoint? (Government action, technology substitution, new supplier qualification, cartel formation by customers)

**Duan lens**: Is the company's business model honest and sustainable, or is it extractive in a way that motivates customers to fund alternatives?

**Li Lu lens**: Is this chokepoint on the right side of a 20-year trend? Is government policy protecting or threatening it?

### Step 5 — INVESTMENT THESIS PER CHOKEPOINT COMPANY
For each Tier-1 company:
- What is the pricing power evidence? (gross margin trend vs. industry)
- What is the ROIC trend? (should be high and rising at a real chokepoint)
- What is the key risk that breaks the chokepoint? (specific, not vague)
- Is current valuation pricing in the chokepoint premium, or is it still underappreciated?

## Output Format

```
BOTTLENECK HUNT: [Industry/Supply Chain]

FULL VALUE CHAIN:
[Step 1] → [Step 2] → ... → [End Product]

CHOKEPOINT ANALYSIS:
| Step | Suppliers | Concentration | Score | Tier |
|---|---|---|---|---|

TIER-1 CHOKEPOINTS:
[Step name]: [who controls it] — [why it's a chokepoint]

CHOKEPOINT COMPANY ASSESSMENTS:
Company A:
• Buffett: [pricing power evidence]
• Munger: [break scenario]
• Duan: [sustainability]
• Li Lu: [trend alignment]
• Preliminary verdict: [INVESTIGATE / PASS]

INVESTMENT OPPORTUNITY RANKING:
1. [Company] — [chokepoint description] — [why now]
2. [Company] — ...

RISKS TO THE CHOKEPOINT THESIS:
• [technology substitution risk]
• [customer consortium risk]
• [government intervention risk]

NEXT STEP: run invest-research or invest-team on top-ranked company
```

## Rules

- A true chokepoint requires ALL three conditions: concentration + no substitute + inelastic demand. Two out of three is not enough.
- Never confuse market share leadership with a chokepoint. A 30% market share in a competitive market is not a chokepoint.
- The break scenario (Munger lens) is mandatory — every chokepoint has one; name it explicitly.
- Validate chokepoint thesis with pricing power evidence: gross margin should be above-industry and stable or rising.
