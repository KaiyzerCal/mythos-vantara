---
name: invest-industry
version: "1.0"
owner: Analyst
triggers: ["industry research", "sector analysis", "industry landscape", "sector deep dive", "understand this industry", "industry deep dive"]
requires: ["invest-data"]
primaryEnv: claude
---

# Skill: invest-industry

**Owner:** Analyst

Full industry landscape scan using the 4-master framework. Maps the value chain, identifies structural winners, and produces individual company assessments within the sector context.

## Input

Industry/sector name. Optional: specific angle (e.g. "EV battery supply chain", "AI infrastructure", "China consumer").

## Steps

### Step 1 — INDUSTRY STRUCTURE MAP
Produce a full value chain map:
- Who are the suppliers? (upstream)
- Who manufactures / produces?
- Who distributes?
- Who is the end customer?
- At which stage is value being captured? (highest margin = most power)

Identify the structural winner tier: companies at the highest-value point in the chain with the most durable position.

### Step 2 — INDUSTRY ECONOMICS
- What is the typical gross margin at each stage of the value chain?
- Is the industry capital-light or capital-heavy? (FCF quality implications)
- What are the key cost drivers? Are they stable, rising, or declining?
- What is the typical business cycle length? How deep are downturns?
- Is pricing power concentrated or fragmented?

### Step 3 — COMPETITIVE DYNAMICS (Munger lens)
- How many players are in each tier? Concentrated or fragmented?
- What are the barriers to entry? (capital intensity, regulation, technology, brand, network effects)
- Is competition on price or value? (Price competition = commoditized = avoid)
- Who has been gaining share over the last 5 years? Who has been losing?
- What is the most likely source of disruption? (technology, regulation, new business model)

### Step 4 — STRUCTURAL TREND ASSESSMENT (Li Lu lens)
- What is the 10-20 year secular direction? (growing, mature, declining)
- What tailwinds are currently underappreciated by the market?
- What headwinds are being overestimated?
- Is this industry on the right or wrong side of technological change?
- Policy direction: what is government doing to, for, or against this industry?

### Step 5 — INDIVIDUAL COMPANY MATRIX
For the top 5-8 companies in the sector, produce a comparative matrix:

| Company | Value Chain Position | Moat Type | ROE 5yr | FCF Margin | Market Share Trend | Master Score |
|---|---|---|---|---|---|---|

Apply a condensed 4-master lens to each:
- Buffett: Is the moat real and durable?
- Munger: What's the failure scenario?
- Duan: Is the product/service genuinely better?
- Li Lu: Is this company on the right side of the trend?

### Step 6 — INVESTMENT OPPORTUNITIES
Based on the industry map, identify:
- **Category A** — structural winners with durable moats (buy and hold candidates)
- **Category B** — cyclical plays at trough valuations (tactical opportunities)
- **Category C** — avoid (structural losers, commoditized, or policy risk)

For each Category A company: preliminary thesis and information richness grade (A/B/C) for further research.

## Output Format

```
INDUSTRY RESEARCH: [Sector]

VALUE CHAIN MAP:
[Upstream] → [Production] → [Distribution] → [End Customer]
Value capture: [tier with highest margins] — [why]

INDUSTRY ECONOMICS:
Gross margin range: [X%–Y%] | Capital intensity: [light/moderate/heavy]
Business cycle: [length and depth] | Pricing power: [concentrated/fragmented]

COMPETITIVE DYNAMICS:
Barriers to entry: [list]
Competition basis: [value/price/hybrid]
Gaining share: [companies] | Losing share: [companies]
Disruption risk: [tech/regulation/model] — probability [low/medium/high]

STRUCTURAL TREND:
10-20yr direction: [growing/mature/declining]
Key tailwind: [description]
Policy direction: [favorable/neutral/hostile]

COMPANY MATRIX:
[table]

INVESTMENT MAP:
Category A (structural winners): [list]
Category B (cyclical plays): [list]
Category C (avoid): [list]

RECOMMENDED NEXT STEP:
Deep research on: [company] via invest-research or invest-team
```

## Rules

- Value chain map must be produced before any individual company analysis.
- All financial data (ROE, FCF margin) cross-verified from ≥2 sources.
- Category C companies should have a clear reason stated — not just "I don't like them."
- Disruption risk must be assessed even for companies that currently look strong.
