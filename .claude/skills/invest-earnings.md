---
name: invest-earnings
version: "1.0"
owner: Analyst
triggers: ["earnings review", "read earnings", "financial report", "10-K", "10-Q", "quarterly results", "annual report", "earnings analysis"]
requires: ["invest-data"]
primaryEnv: claude
---

# Skill: invest-earnings

**Owner:** Analyst

Deep single-agent earnings report analysis. Reads primary sources — not summaries. Eight-step protocol that produces a verdict on whether the earnings changed the investment thesis.

## Input

`Company name + period` e.g. "Nvidia 2025Q4" or "BYD 2024 annual"

## Pre-Check: Information Richness Grade

| Grade | Condition | Impact |
|---|---|---|
| A | Full original filing obtained (10-K/10-Q/annual report + earnings call transcript) | Full 8-step protocol |
| B | Partial original or third-party summary | Flag "non-primary source"; reduce footnote analysis weight |
| C | News only, no filings | Limit to core data changes; skip footnotes; label "insufficient primary source" |

## Steps

### Step 1 — GET PRIMARY SOURCES (parallel fetch)
Fetch in parallel:
- Full filing (SEC EDGAR for US; HKEX for HK; CNINFO for CN)
- Earnings call transcript (Seeking Alpha, company IR, Snowball)
- Prior-period management commitments (for Step 5 comparison)

All financial calculations via tool — no mental arithmetic. Cross-verify from ≥2 sources; flag >1% discrepancy.

### Step 2 — CORE FINANCIAL EXTRACTION
Build comparison table (this period vs prior period vs YoY):
- Revenue (total + segment breakdown)
- Gross margin + operating margin + net margin (GAAP and non-GAAP; document the gap)
- Operating cash flow vs net income ratio (target >100%; flag if <80%)
- Free cash flow = operating cash flow – capex
- Capex: maintenance vs expansion breakdown
- Buybacks + dividends
- Cash/debt position change

### Step 3 — PROFIT QUALITY TESTS (anomaly detection)
Flag any of these:
- [ ] Accounts receivable growth > revenue growth → channel stuffing?
- [ ] Inventory growth > revenue growth → demand slowdown?
- [ ] Operating cash flow < net income (widening gap) → accrual earnings?
- [ ] Capitalized expense spike → smoothing profits?
- [ ] Non-recurring income > 15% of net income → earnings quality concern

### Step 4 — MANAGEMENT DISCUSSION (MD&A) — tone reading
This is where Buffett and Li Lu spend the most time. Tag every paragraph:
- 🟢 Candid signal — management admits specific problems with causes
- 🟢 Clear signal — concrete targets with numbers and timelines
- 🔴 Vague signal — "we believe," "long-term," no substance
- 🔴 Deflection — answers a different question than asked
- 🔴 Externalization — blames macro/competition/everything else

### Step 5 — COMMITMENT TRACKING
Pull 3-5 specific commitments from prior period's call. Compare to this period's actuals:

| Commitment | Actual | Grade | Pattern |
|---|---|---|---|

Duan Yongping: "The easiest way to check if management is trustworthy is whether they did what they said they'd do."

### Step 6 — FOOTNOTE MINING (A-grade only)
Check these footnotes: related-party transactions, stock comp dilution (strike prices), contingent liabilities, accounting policy changes, segment profit differences, customer/supplier concentration.

### Step 7 — HISTORICAL TREND (4 quarters minimum)
Put key metrics in time series. Identify:
- Margin trend: improving or eroding?
- Revenue growth: accelerating or decelerating?
- FCF quality: improving or deteriorating?

### Step 8 — VERDICT
Answer four questions explicitly:
1. Beat / meet / miss expectations? (No "broadly in line" hedging)
2. Investment thesis: STRENGTHENED / UNCHANGED / WEAKENED / BROKEN
3. Next catalyst to watch?
4. For holders: ADD / HOLD / TRIM / SELL?

## Output Format

```
EARNINGS: [Company] [Period] — Grade [A/B/C]

CORE DATA:
• Revenue: $X (+Y% YoY) vs est $Z → [beat/miss/meet]
• FCF: $X | OCF/NI ratio: X%
• Gross margin: X% (vs X% prior) → [expanding/contracting]
• Non-GAAP adj: $X ($Y GAAP gap — [widening/stable])

PROFIT QUALITY: [CLEAN / WATCH / CONCERN] — [flag if any]

MD&A TONE: [Candid / Neutral / Defensive] — key signal: [quote]

COMMITMENT TRACKING: [X/Y delivered] — pattern: [reliable/slipping]

FOOTNOTE FLAGS: [none / description]

VERDICT:
• Result: [BEAT / MEET / MISS]
• Thesis: [STRENGTHENED / UNCHANGED / WEAKENED / BROKEN]
• Reason: [one sentence]
• Next catalyst: [what to watch]
• Action: [ADD / HOLD / TRIM / SELL]
```

## Rules

- Primary sources first — never substitute summaries if originals are accessible.
- Profit quality tests are mandatory (Step 3).
- Commitment tracking requires the actual prior-period quotes.
- Verdict must be a single word for each question — no hedging.
