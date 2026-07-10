---
name: invest-checklist
version: "1.0"
owner: Analyst
triggers: ["investment checklist", "pre-purchase checklist", "should I buy this", "buying checklist", "stock checklist", "before I buy"]
requires: ["invest-data"]
primaryEnv: claude
---

# Skill: invest-checklist

**Owner:** Analyst

Six-gate pre-purchase checklist. Any gate failure → REJECT immediately. No partial credit. Enforces the Buffett principle: "The first rule of investing is don't lose money."

## Input

Company name/ticker. Optionally: current price, your thesis in one sentence.

## The Six Gates

### Gate 1 — CIRCLE OF COMPETENCE
"Can I explain this business model clearly in two sentences?"
- PASS: Clear, simple explanation possible right now
- FAIL: Cannot explain it simply → outside circle of competence → DO NOT INVEST
- Hard stop: If you fail Gate 1, do not proceed. Come back when you understand the business.

### Gate 2 — BUSINESS QUALITY
Key metrics — must meet at least 4 of 5:
- [ ] ROE >15% (10-year average, without excessive leverage)
- [ ] Gross margin stable or expanding over 5 years
- [ ] Free cash flow positive in 8 of last 10 years
- [ ] Pricing power visible (margins didn't collapse when costs rose)
- [ ] Revenue growth >5% CAGR over 5 years (organic, not acquisition-driven)

### Gate 3 — MOAT DURABILITY
Pick at least one and justify it with evidence:
- [ ] Brand moat — customers pay premium willingly (evidence: gross margin premium vs. competitors)
- [ ] Switching cost moat — customers are locked in (evidence: churn rate, contract length, customer lifetime)
- [ ] Network effect — product more valuable with more users (evidence: growth acceleration without proportional cost increase)
- [ ] Cost advantage — structurally cheaper to produce (evidence: COGS% advantage vs. peers)
- [ ] Regulatory moat — license or patent protection (evidence: regulatory filings)
FAIL: Cannot identify a specific, evidence-backed moat → REJECT

### Gate 4 — MANAGEMENT QUALITY
Must pass all three:
- [ ] **Integrity**: No history of misleading investors, restatements, or related-party abuse
- [ ] **Competence**: Capital allocation track record — ROIC consistently >WACC
- [ ] **Alignment**: Significant equity ownership (not just options); insider buying pattern
FAIL: Any management concern → REJECT. Character problems cannot be modeled away.

### Gate 5 — VALUATION + SAFETY MARGIN
- [ ] Intrinsic value estimated (owner earnings method or DCF at conservative growth)
- [ ] Current price is at least 25% below intrinsic value (Margin of Safety)
- [ ] NOT priced for perfection (implied growth rate is realistic, not optimistic)
FAIL: No meaningful margin of safety → WATCH, not BUY. Wait for price.

### Gate 6 — DECISION DISCIPLINE
Anti-emotion checklist:
- [ ] Am I buying because of FOMO (stock up recently)? → REJECT this emotion
- [ ] Am I anchoring on the price I missed vs. current intrinsic value? → Reset analysis
- [ ] Have I held this idea for at least 2 weeks before acting? (Prevents reactive buying)
- [ ] Can I name the top 3 risks WITHOUT looking them up? (Tests genuine conviction)

## Mirror Test (required before final decision)
Write the full investment thesis in 200 words or fewer. Include:
- What the business does and why it's good
- Why it's cheap
- What could go wrong
If you cannot write this clearly in 200 words → you do not know the investment well enough. WAIT.

## Multi-Company Comparison (optional)
If comparing multiple candidates, run gates 1-5 for each and compare:
| Company | G1 | G2 | G3 | G4 | G5 | Margin of Safety | Winner? |
|---|---|---|---|---|---|---|---|

## Output Format

```
CHECKLIST: [COMPANY] at $[price]

Gate 1 — Circle: [PASS / FAIL]
Gate 2 — Quality: [X/5 metrics] → [PASS / FAIL]
Gate 3 — Moat: [type identified] → [PASS / FAIL]
Gate 4 — Management: [PASS / FAIL — concern if any]
Gate 5 — Valuation: IV $[range], Margin of Safety [%] → [PASS / FAIL]
Gate 6 — Discipline: [PASS / FAIL — emotion flags if any]

MIRROR TEST: [200-word thesis]

RESULT: [ALL PASS → APPROVED TO BUY / FAILED GATE [N] → REJECTED]
Next action: [buy at $X / wait for $X / need more data on: ___]
```

## Rules

- Gate failures are non-negotiable. No buying with a failed gate "because the thesis is so strong."
- Valuation gate failure → WATCH list. Never stretch valuation.
- All financial data cross-verified from 2 sources before Gate 2.
