---
name: invest-industry-funnel
version: "1.0"
owner: Analyst
triggers: ["industry funnel", "screen industry", "find best stocks", "narrow down companies", "investment funnel", "filter companies", "which companies in this sector"]
requires: ["invest-quality", "invest-checklist"]
primaryEnv: claude
---

# Skill: invest-industry-funnel

**Owner:** Analyst

Filters an entire industry or sector down to 3 investment candidates worth deep research. Four-stage funnel: industry landscape → rapid eliminate → quality screen → 3 finalists.

## Input

Industry or sector name. Optional: market (US/HK/CN/global), size range (large/mid/small cap).

## Stage 1 — INDUSTRY LANDSCAPE (parallel research)

Run in parallel:
1. List all publicly traded companies in the sector (target: complete, 20-100 names)
2. Identify the top 5-10 by market cap
3. Map the value chain: who captures the most value? (suppliers / manufacturers / distributors / platforms / end-sellers)
4. Identify structural winners vs. structural losers in this industry based on the value chain position
5. Note any regulatory or technological disruption underway

Output: raw list of companies + value chain map + disruption flags.

## Stage 2 — RAPID ELIMINATE (apply in order; any trigger → OUT)

Hard eliminate criteria (check these first — fast):
- [ ] Market cap < $500M (too small for institutional liquidity) — optional threshold
- [ ] IPO < 3 years (insufficient track record)
- [ ] Any confirmed integrity failure (restatement, fraud, enforcement) → permanent exclude
- [ ] Negative FCF for 3+ consecutive years
- [ ] Net debt > 5x EBITDA
- [ ] Declining market share for 4+ consecutive years

After rapid eliminate: target 5-15 companies remaining.

## Stage 3 — QUALITY SCREEN (run invest-quality on survivors)

Apply all 7 criteria from `invest-quality` to each remaining company. Present in comparison table.

After quality screen: target 5-8 companies remaining.

## Stage 4 — RELATIVE RANKING (choose the 3 finalists)

Score each survivor across 5 dimensions (1-5 each):

| Dimension | Weight | What to Assess |
|---|---|---|
| Business quality | 30% | Moat type, moat durability, ROE trend |
| Management quality | 25% | Capital allocation ROIC, integrity, ownership alignment |
| Valuation | 20% | P/FCF vs. 5-year average; margin of safety |
| Structural trend | 15% | Industry tailwind vs. headwind position |
| Information richness | 10% | Can you actually research this well? |

Rank by weighted score. Top 3 advance to deep research.

## Output Format

```
INDUSTRY FUNNEL: [sector] — [market]

STAGE 1 — Landscape:
Total companies identified: [N]
Value chain winner tier: [companies]
Disruption flags: [tech/regulatory/competitive]

STAGE 2 — Rapid Eliminate:
Eliminated: [N companies] — reasons: [list]
Survivors: [list, N companies]

STAGE 3 — Quality Screen:
[Comparison table]
Failed quality screen: [N companies]
Survivors: [list, N companies]

STAGE 4 — Ranking:
| Company | Quality | Mgmt | Value | Trend | Info | Total |
| Finalist 1 | ... |
| Finalist 2 | ... |
| Finalist 3 | ... |

FINALISTS: [Company A], [Company B], [Company C]
Next step: run invest-team or invest-research on each finalist.
```

## Rules

- Stage 2 rapid eliminates are non-negotiable — do not keep companies with hard eliminate triggers "because the thesis is interesting."
- Integrity failures (Stage 2) are permanent — do not revisit.
- The funnel must reduce to exactly 3 finalists. If fewer than 3 survive, report that: "Only N companies passed — proceed with those or expand the universe."
- Information richness grade (A/B/C) should be assessed for each finalist before deep research begins.
