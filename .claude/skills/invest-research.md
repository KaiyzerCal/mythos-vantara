---
name: invest-research
version: "1.0"
owner: Analyst
triggers: ["investment research", "research company", "analyze stock", "should I buy", "investment thesis", "company analysis", "value investing research"]
requires: ["invest-data"]
primaryEnv: claude
---

# Skill: invest-research

**Owner:** Analyst

Full company investment research using the 4-master framework (Buffett / Munger / Duan Yongping / Li Lu). Produces a structured report with a forced conclusion.

## Input

Company name/ticker + optional focus (e.g., "Tencent", "NVDA earnings angle", "BYD for EV thesis").

## Steps

### Pre-Check: Information Richness Grade
Rate the target company BEFORE analysis:
- **A-grade**: Rich public data — full annual reports, analyst coverage, earnings calls, management interviews. Run full 7-step protocol.
- **B-grade**: Partial data — some filings, limited coverage. Flag gaps; focus on business model fundamentals.
- **C-grade**: Sparse data — private, emerging market, limited English sources. Do NOT produce a fake complete report. Focus exclusively on first-principles questions: What is the business model? Who are the customers? What is the competitive dynamic? Attach a "one-hand verification question list" for human follow-up.

### Step 1 — MIRROR TEST (do this FIRST)
Write a 5-sentence investment thesis before touching the numbers. If you cannot → the investment idea is not ready. Stop and say so.

### Step 2 — DATA COLLECTION (parallel, cross-verified)
Collect from at least 2 independent sources each:
- Revenue, gross margin, net income, FCF (last 5 years)
- ROE, ROIC, debt ratios
- Market cap, EV, P/E, EV/EBITDA, P/FCF
- Management ownership, recent insider transactions
- Competitors and market share data

All financial calculations via tool — no mental arithmetic. Flag any data discrepancy >1% between sources.

### Step 3 — BUSINESS QUALITY (Buffett lens)
- What is the moat? (brand / switching cost / network effect / cost advantage / regulatory license)
- Can prices be raised without losing customers?
- ROE 10-year average: target >15% without excessive leverage
- Free cash flow conversion: target >80% of net income
- Hard stop: commodity product, single-customer dependency >30%, opaque accounting → REJECT

### Step 4 — MOAT + RISK INVERSION (Munger lens)
- Failure scenarios: list the 3 most realistic ways this investment loses money
- Incentive check: how is management compensated? Does it align with long-term owners?
- Anti-consensus question: what belief do I hold that the market disagrees with?

### Step 5 — MANAGEMENT QUALITY (Duan Yongping lens)
- Is the product/service genuinely better, or just cheaper?
- Has management ever sacrificed short-term profit for long-term trust in a visible way?
- DYP test: "What would happen if the company stopped doing its core thing?" — does the answer reveal genuine value creation?

### Step 6 — STRUCTURAL TREND (Li Lu lens)
- Is this business on the right side of a 20-year secular trend?
- Owner-operator alignment: meaningful founder/management equity stake?
- What is the information asymmetry — why does the market undervalue this?

### Step 7 — VALUATION + VERDICT
- Intrinsic value: owner earnings × multiple or DCF at stated growth rate
- What growth rate is currently priced in?
- Margin of safety: require 25-40% discount to intrinsic value
- Tiered recommendation: STRONG BUY / BUY / WATCH / PASS / REJECT
- Price target (base case): $___
- Conviction level: HIGH / MEDIUM / LOW (tied to information richness grade)

## Output Format

```
COMPANY: [name] ([ticker])
INFORMATION RICHNESS: [A / B / C] — [why]
AI ANALYSIS CONFIDENCE: [%] (based on data quality)
INVESTMENT CERTAINTY: [%] (based on business fundamentals)

MIRROR TEST (5-sentence thesis):
[thesis]

ONE-SENTENCE VERDICT: [APPROVE / REJECT / GRAY AREA]

FOUR-MASTER SUMMARY:
• Buffett: [moat assessment + owner earnings estimate]
• Munger: [top failure scenario + incentive flag]
• Duan: [product/culture quality verdict]
• Li Lu: [structural trend + info asymmetry]

VALUATION:
• Intrinsic value: $[range]
• Current price: $[price]
• Margin of safety: [%]
• Price target: $[base] / $[bull] / $[bear]

RECOMMENDATION: [tier] at $[entry level]
CHECKLIST RESULT: [PASS / FAIL — failed gates: ___]
```

## Rules

- Mirror test is mandatory — no skipping.
- All financials cross-verified from 2 sources.
- Forced conclusion: APPROVE / REJECT / GRAY AREA — no hedging.
- C-grade companies: attach verification question list for human follow-up.
- AI confidence ≠ investment certainty. State both separately.
