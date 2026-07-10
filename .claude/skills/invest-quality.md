---
name: invest-quality
version: "1.0"
owner: Analyst
triggers: ["quality screen", "quality screening", "is this a quality company", "screen companies", "quick quality check", "eliminate bad companies"]
requires: ["invest-data"]
primaryEnv: claude
---

# Skill: invest-quality

**Owner:** Analyst

Seven-criteria rapid elimination screen. Finds non-first-class companies fast so you don't waste deep research time on them. Any failed criterion → ELIMINATE. No partial credit.

## Input

Company name/ticker or a list of companies to screen.

## Design Philosophy

"Eliminating bad choices is easier than finding the best choice." — Munger

Most investment mistakes come from buying mediocre businesses at OK prices. This screen kills them quickly using objective, verifiable criteria before any qualitative research begins.

## The Seven Criteria

All data must come from ≥2 independent sources. Flag any discrepancy >1%.

### Criterion 1 — ROE CONSISTENCY
- Requirement: ROE >15% in ≥8 of the last 10 years
- Without excessive leverage: D/E <1.5 for non-financial companies
- Logic: sustained high ROE with low debt = genuine competitive advantage
- FAIL if: ROE is inconsistent, dependent on leverage, or declining trend over 5 years

### Criterion 2 — FREE CASH FLOW RELIABILITY
- Requirement: Positive FCF in ≥8 of the last 10 years
- FCF = Operating cash flow – maintenance capex (not total capex)
- Logic: A business that doesn't generate real cash isn't really profitable
- FAIL if: FCF is persistently negative, erratic, or diverges significantly from net income trend

### Criterion 3 — GROSS MARGIN STABILITY
- Requirement: Gross margin stable or expanding over 5 years
- Target: gross margin ≥30% (lower threshold acceptable for distribution/retail with high volume)
- Logic: Declining gross margin = pricing power erosion = moat weakening
- FAIL if: gross margin declining >3 percentage points over 5 years without structural explanation

### Criterion 4 — DEBT DISCIPLINE
- Requirement: Total debt / EBITDA <3x for cyclical industries; <4x for defensive industries
- Or: Net cash position (company has more cash than debt)
- Logic: Excessive debt limits the company's ability to invest through downturns and creates permanent loss risk
- FAIL if: leverage ratio is concerning AND trending upward

### Criterion 5 — REVENUE GROWTH QUALITY
- Requirement: Revenue CAGR >5% over 5 years
- Must be organic (not acquisition-driven): check if growth continued post-acquisition periods
- Must be profitable growth: not buying revenue at a loss
- FAIL if: growth is flat, declining, or entirely dependent on M&A / price increases on declining volumes

### Criterion 6 — MANAGEMENT CAPITAL ALLOCATION
- Requirement: ROIC consistently above WACC over 5 years (target ROIC >12%)
- Or: Management track record of buying back shares at value prices (not peaks)
- Logic: A management team that destroys capital on M&A or buybacks at peaks will eventually destroy your returns
- FAIL if: ROIC < WACC for 3+ consecutive years, or clearly value-destructive M&A track record

### Criterion 7 — NO INTEGRITY RED FLAGS
- Requirement: Zero confirmed integrity failures in the last 10 years
- Check: earnings restatements, SEC/regulator enforcement, misleading investor guidance, related-party abuse, executive fraud
- This criterion is BINARY — one confirmed failure = ELIMINATE, regardless of all other metrics
- Logic: Character cannot be modeled away. A competent management team with ethics issues is more dangerous than a mediocre honest one.

## Multi-Company Screen Format

Run all 7 criteria for each company and present side-by-side:

| Criterion | Company A | Company B | Company C |
|---|---|---|---|
| ROE consistency | ✅ | ✅ | ❌ |
| FCF reliability | ✅ | ❌ | ✅ |
| Gross margin | ✅ | ✅ | ✅ |
| Debt discipline | ✅ | ❌ | ✅ |
| Revenue quality | ✅ | ✅ | ❌ |
| Capital allocation | ✅ | ❌ | ✅ |
| Integrity | ✅ | ✅ | ✅ |
| **RESULT** | **PASS** | **FAIL (2)** | **FAIL (2)** |

## Output Format

```
QUALITY SCREEN: [Company or list]
Data sources: [source 1] + [source 2]

RESULTS:
[Company A]: PASS — all 7 criteria met. Advance to invest-checklist.
[Company B]: FAIL — Criteria 2, 4. FCF negative 4 of 10 years; D/E 4.2x. Do not proceed.
[Company C]: FAIL — Criterion 7 (integrity). 2023 SEC enforcement action. Permanent exclude.

SURVIVORS: [list]
Next step: run invest-checklist on survivors.
```

## Rules

- Criterion 7 (integrity) failures are permanent eliminates — do not revisit.
- All financial data from ≥2 sources before scoring.
- "Partial pass" does not exist — each criterion is binary.
- Companies that fail ≥2 criteria are not "watch list" material — ELIMINATE.
