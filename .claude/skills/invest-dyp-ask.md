---
name: invest-dyp-ask
version: "1.0"
owner: Analyst
triggers: ["dyp ask", "duan yongping", "duan framework", "ask duan", "segment yongping", "business quality check", "what would duan think", "stop doing list"]
requires: []
primaryEnv: claude
---

# Skill: invest-dyp-ask

**Owner:** Analyst

Applies Duan Yongping's decision-making framework to any investment or business question. DYP thinks about businesses differently — product integrity first, culture second, financials third. He holds for decades.

## Background

Duan Yongping (段永平) founded the OPPO/vivo ecosystem and has an exceptional long-term investment track record. His framework differs from Buffett's primarily in its emphasis on product and culture quality as primary moat determinants — before financials.

His most famous tool: the "Stop Doing List" and the "DYP-Ask" framework.

## Input

Company name or business decision to analyze. Optionally: specific question (e.g. "Is this moat real?", "Should I invest?", "What's the business quality?").

## The DYP-Ask Framework

For every key element of the business, ask: **"What would happen if the company stopped doing this?"**

If stopping this activity would:
- **Destroy the business** → it is CORE. Protect it and understand it deeply.
- **Improve the business** → it is a DISTRACTION. Red flag for management quality.
- **Make no difference** → it is WASTE. Red flag for operational discipline.

Apply this to: core product, marketing approach, pricing model, key partnerships, management incentives, R&D investment, geographic expansion, M&A activity.

## Questions DYP Would Ask

### On Business Model
1. "If this company couldn't advertise tomorrow, would customers still choose its product?" (Tests genuine product pull)
2. "If prices rose 20%, would customers stay?" (Tests pricing power without leverage)
3. "Who benefits most when this company does well — customers, employees, or shareholders?" (Tests stakeholder balance)
4. "Is this business easy to understand to its customers?" (DYP values simplicity as a quality signal)

### On Management
5. "Does management say what they mean and mean what they say?" (Commitment tracking)
6. "Has management ever chosen the right long-term decision over the easy short-term one, at cost to themselves?" (Character test)
7. "What has management stopped doing in the past 5 years? Why?" (Stop-doing list discipline)
8. "Would you trust this person with your money if the business didn't exist?" (DYP's character test)

### On Competitive Position
9. "Is this company making the best product/service in its category, or just a profitable one?" (Quality-first thinking)
10. "If a well-funded competitor entered tomorrow with unlimited marketing budget, could they take this market?" (Moat stress test)
11. "Are customers loyal because they love the product, or because switching is annoying?" (Genuine affinity vs. switching cost)
12. "Does the company's culture reinforce doing the right thing, or optimizing metrics?" (Culture health)

### On Investment Decision
13. "Would you be comfortable owning this business for 10 years without checking the price?" (Long-term conviction test)
14. "If the stock disappeared from trading tomorrow, would the business still be worth owning?" (Business vs. stock distinction)
15. "What would make you sell this?" (Pre-commit exit criteria)

## DYP Business Quality Framework

Rate each dimension 1-5:

| Dimension | What to Assess | Score |
|---|---|---|
| Product honesty | Does the product do what it claims? Is it genuinely better? | 1-5 |
| Culture integrity | Does management do right when it costs them something? | 1-5 |
| Stop-doing discipline | Are there things the company has wisely stopped? | 1-5 |
| Long-horizon thinking | Does management speak and act for 10 years out? | 1-5 |
| Customer love | Do customers recommend this without being asked? | 1-5 |

Score ≥20: A+ business (DYP would hold for 20+ years)
15-19: B business (good but not exceptional)
10-14: C business (pass unless cheap)
<10: AVOID

## Output Format

```
DYP ANALYSIS: [Company]

STOP-DOING TEST:
If they stopped [core activity]: [what happens — CORE / DISTRACTION / WASTE]
If they stopped [marketing approach]: [___]
If they stopped [geographic expansion]: [___]

DYP KEY QUESTIONS:
Q1 (product pull): [answer + evidence]
Q4 (simplicity): [answer + evidence]
Q6 (character test): [specific example or UNKNOWN]
Q11 (loyalty type): [genuine affinity / switching cost / mixed]

BUSINESS QUALITY SCORE:
Product honesty: [X/5] — [evidence]
Culture integrity: [X/5] — [evidence]
Stop-doing discipline: [X/5] — [evidence]
Long-horizon thinking: [X/5] — [evidence]
Customer love: [X/5] — [evidence]
TOTAL: [X/25] — [A+/B/C/AVOID]

DYP VERDICT: [Would DYP hold this for 10+ years?]
One-sentence reason: [___]
Red flags: [list any DYP-style concerns]
```

## Rules

- Answer DYP questions with specific evidence, not impressions.
- "Unknown" is a valid answer — it means human verification is needed.
- DYP would rather hold cash than own a B-quality business at a fair price. Don't round up quality scores.
- Culture integrity (dimension 2) cannot be inferred from press releases — it requires behavioral evidence (what management did in a crisis, during a downturn, when it cost them something).
