---
name: invest-earnings-team
version: "1.0"
owner: Analyst
triggers: ["earnings team", "deep earnings analysis", "earnings deep dive", "team earnings", "publish earnings", "earnings article"]
requires: ["invest-earnings", "invest-data", "invest-article"]
primaryEnv: claude
---

# Skill: invest-earnings-team

**Owner:** Analyst

Six-agent team earnings analysis + publishable article output. Use when you need a comprehensive multi-perspective earnings deep-dive, not a quick read. Three phases: Research → Synthesis → Publish.

## Input

`Company name + period` e.g. "Tencent 2025Q4"

## When to Use

| Skill | Use case |
|---|---|
| `invest-earnings` | Quick single-pass read, one perspective |
| **`invest-earnings-team`** | **Important company, critical quarter — need depth + publishable output** |

## Phase 1 — Research (4 parallel agents)

First: grade information richness (A/B/C). Inform all agents before dispatch.

**Agent 1 — Business Quality Reader (Duan Yongping)**
Core question: Did the business get better or worse this quarter?
- Revenue structure: which segments accelerating/decelerating? Why?
- User/customer value metrics (DAU, ARPU, NPS trends)
- Moat check: gross margin as pricing power proxy; market share as moat proxy
- Management product language: concrete or bureaucratic?
- DYP three conditions: differentiation, pricing power, sustainable advantage — each trending?

**Agent 2 — Financial Quality Auditor (Buffett)**
Core question: Is this company earning real money?
- Full cash flow analysis (operating CF vs net income ratio; FCF; capex breakdown)
- Profit quality tests (all 5 anomaly checks)
- Balance sheet health (net cash/debt trend; working capital quality)
- GAAP vs non-GAAP gap: widening or stable?
- Valuation update: intrinsic value estimate, margin of safety at current price

**Agent 3 — Competitive Dynamics Reader (Munger)**
Core question: What does this report reveal about the competitive landscape?
- Revenue growth vs industry growth (gaining or losing share?)
- Marketing spend rate change (is customer acquisition getting harder?)
- R&D spend pattern (proactive investment or reactive followership?)
- Management discussion of competition (confident or defensive?)
- Munger inversion: what could kill this business — does this report point toward it?

**Agent 4 — Risk Signal Hunter (Li Lu)**
Core question: What is management hiding in this report?
- MD&A tone analysis (tag every paragraph: candid/clear/vague/deflection/externalization)
- Commitment tracking vs prior period (quote and verify each)
- Footnote mining (related-party, dilution, contingent liabilities, accounting changes)
- Earnings call Q&A: top 3-5 sharpest analyst questions + management response quality (1-5)
- Permanent loss risk signals: regulatory, compliance, litigation, irreversible management decisions

## Phase 2 — Synthesis (Team Lead)

After all 4 reports arrive, find intersections and contradictions:

- **Consensus zones** — all 4 agree → highest conviction
- **Disputed zones** — agents disagree → name the dispute explicitly, weight the evidence, give a judgment
- **Blind spots** — what none of the 4 emphasized; is it actually important?

Produce the research report in this structure:
```
1. One-sentence verdict (50-100 words)
2. Three most important changes this quarter
3. Four-master scorecard (tabular)
4. Core data snapshot
5. Deep findings by perspective
6. Management tone + commitment tracking
7. What would each master do? (hold/buy/sell + reason)
8. Conclusion: beat/meet/miss, thesis impact, next catalyst, action
```

## Phase 3 — Publish (2 parallel agents)

**Agent 5 — Editor**
Rewrite the research report as a readable article (≤3000 words):
- Lead with the three most important changes (inverted pyramid)
- Replace jargon with analogies ("OCF < net income by 30%" → "earned $100 but pocketed $70")
- Master quotes are the soul — make each one sharp and memorable
- End with explicit action guidance for holders vs. watchers
- No hedging — every section should help a reader make a decision

**Agent 6 — Reader Review**
Read as a knowledgeable retail investor who holds or watches the stock:
- Readability (30%): would you skip any paragraphs? Which ones?
- Information value (30%): did it add to your understanding? What was new?
- Credibility (20%): sources cited? Both sides represented?
- Actionability (20%): do you know what to do after reading?
- Output: 1-10 score + must-fix list + suggestions + one-sentence summary

Team Lead applies must-fix items, reviews suggestions, finalizes.

## Output Files

```
reports/<company>/
├── <company>-earnings-<period>.md        ← final article
├── <company>-earnings-<period>-research.md  ← synthesis report
├── <company>-earnings-<period>-duan.md
├── <company>-earnings-<period>-buffett.md
├── <company>-earnings-<period>-munger.md
├── <company>-earnings-<period>-lilu.md
└── <company>-earnings-<period>-review.md ← reader review
```

## Rules

- Confirm WebSearch access before dispatching agents. Without it: prepend "KNOWLEDGE ONLY" to all reports.
- All 4 agents must complete before synthesis — no early publishing.
- Disputed zones must be named, not smoothed over.
- Final article must have a clear action recommendation for holders AND watchers.
