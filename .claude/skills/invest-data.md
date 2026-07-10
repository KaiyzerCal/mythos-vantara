---
name: invest-data
version: "1.0"
owner: Analyst
triggers: ["financial data", "verify financial data", "get financials", "data validation", "cross-verify", "where to get data", "financial data sources"]
requires: []
primaryEnv: claude
---

# Skill: invest-data

**Owner:** Analyst

Standards for financial data retrieval, cross-verification, and validation. Every other invest-* skill depends on this. No mental arithmetic. No single-source data. Discrepancy >1% must be flagged.

## Core Rules

1. **No mental arithmetic** — all calculations must be tool-verified or shown step-by-step
2. **Two-source minimum** — every key financial figure requires at least 2 independent sources
3. **≤1% discrepancy tolerance** — if sources disagree by more than 1%, flag it and resolve before proceeding
4. **Primary over secondary** — official filings > financial data aggregators > news articles
5. **Currency clarity** — always state currency, units (thousands/millions/billions), and fiscal year convention

## Source Hierarchy

### Tier 1 — Primary Sources (most reliable)
- **US stocks**: SEC EDGAR (10-K, 10-Q, 8-K) — edgar.sec.gov
- **HK stocks**: HKEx Disclosure of Interests — hkexnews.hk
- **CN A-shares**: CNINFO (巨潮资讯) — cninfo.com.cn
- **Earnings call transcripts**: Company IR page, Seeking Alpha, Motley Fool
- **Annual reports / shareholder letters**: Company IR page directly

### Tier 2 — Aggregators (cross-check against Tier 1)
- **US stocks**: Macrotrends.net, Stock Analysis (stockanalysis.com)
- **HK stocks**: AastocksData.com, Macrotrends
- **CN stocks**: Eastmoney (东方财富), Wind (if available)
- **Global**: Yahoo Finance, Tikr.com, Wisesheets

### Tier 3 — News / Analysis (for context only, not raw data)
- Bloomberg, WSJ, FT, Reuters
- Analyst reports (use for narrative context; never use for raw financial figures)

## Cross-Verification Protocol

For every key metric, record as:
```
Metric: Revenue Q3 2025
Source 1: Company 10-Q (edgar.sec.gov) — $12.35B
Source 2: Macrotrends.net — $12.33B
Discrepancy: 0.16% → WITHIN TOLERANCE → use Source 1 figure
```

If discrepancy >1%:
```
Metric: EPS 2024
Source 1: Yahoo Finance — $4.82
Source 2: Company 10-K — $4.61
Discrepancy: 4.4% → EXCEEDS 1% THRESHOLD
Resolution: Source 2 (10-K) is the primary filing → use $4.61. Yahoo may be using non-GAAP or adjusted figure. Document the difference and what explains it.
```

## Common Data Traps

| Trap | Description | How to Avoid |
|---|---|---|
| Market cap units | Is it thousands, millions, billions? Check company's reporting convention | Always verify: price × shares × declared units |
| GAAP vs Non-GAAP | Non-GAAP can exclude stock comp, restructuring — check the GAAP figure | Always pull both; document the gap |
| Fiscal year offset | Some companies have fiscal year ≠ calendar year | Note FY convention; don't mix years |
| Currency changes | Historical comparisons may cross currency conversion events | Use constant currency where available |
| Diluted vs basic EPS | Diluted is the relevant figure for valuation | Always use diluted shares outstanding |
| FCF definition | Different sources define FCF differently (capex deduction varies) | State your FCF formula explicitly |
| Operating income vs EBIT | May differ due to non-operating items | State which you're using |

## Standard Verification Checks

### Market Cap Verification
```
Market Cap = Share Price × Diluted Shares Outstanding
Expected: $[X]B
Reported: $[Y]B
Discrepancy: [Z%] → [within/exceeds] tolerance
```

### Valuation Metric Verification
```
P/E = Market Cap / Net Income (GAAP, trailing 12m)
P/FCF = Market Cap / Free Cash Flow (LTM)
EV/EBITDA = Enterprise Value / EBITDA
(Where EV = Market Cap + Total Debt - Cash & Equivalents)
```

### FCF Verification
```
FCF = Operating Cash Flow - Capital Expenditures
(Maintenance capex only for normalized FCF — exclude growth capex where identifiable)
```

## Handling Missing Data

If Tier 1 data is unavailable:
- State the reason explicitly
- Use Tier 2 source with label "unverified against primary filing"
- Reduce confidence score for metrics derived from unavailable data
- Add to human verification question list

For private companies or C-grade information richness:
- Use proxy metrics (see invest-private.md)
- Label every figure with confidence: HIGH / MEDIUM / LOW / ESTIMATE
- Do not produce analysis that implies a precision you do not have

## Output Format (Data Block)

When reporting verified financial data in any invest-* skill, use this format:

```
─── FINANCIAL DATA BLOCK ───
Company: [name] | FY: [year] | Currency: [USD/HKD/CNY/etc.]

Revenue: $X.XXB [Source: 10-K, p.42 + Macrotrends.net | Discrepancy: 0.2% ✅]
Gross Margin: XX.X% [___]
Operating Income: $X.XXB [___]
Net Income (GAAP): $X.XXB [___]
Net Income (Non-GAAP): $X.XXB [GAAP gap: $X.XXB — stock comp + restructuring]
Operating Cash Flow: $X.XXB [___]
Capex: $X.XXB [___]
Free Cash Flow: $X.XXB [OCF - Capex]
Net Cash / (Debt): $X.XXB [___]
─── END DATA BLOCK ───
```

## Rules

- Never state a financial figure without its source in formal analysis.
- "I don't have access to this data" is always a valid answer. Never invent or estimate unlabeled.
- GAAP figures are the ground truth. Non-GAAP is supplemental.
- Data block format is required in invest-research, invest-earnings, and invest-team outputs.
