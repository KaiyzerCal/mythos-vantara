---
name: invest-deep-series
version: "1.0"
owner: Analyst
triggers: ["deep company series", "deep dive series", "write series about", "multi-part analysis", "company series", "understand company deeply", "comprehensive company study"]
requires: ["invest-research", "invest-management", "invest-industry", "invest-data"]
primaryEnv: claude
---

# Skill: invest-deep-series

**Owner:** Analyst

A 3-8 article series that fully dissects a company from every angle. For companies worth long-term study — not a quick pass. Each article stands alone but builds a complete picture together.

## Input

Company name + depth target (3, 5, or 8 articles) + publishing context (internal study / external article series).

## When to Use

When `invest-research` or `invest-team` has already validated a company as worth deep conviction — and you want to build a durable, well-documented understanding for long-term holding.

## Series Architecture

### 3-Article Series (minimum depth)
1. Business Model — How it actually makes money
2. Competitive Position — Moat analysis and durability
3. Investment Verdict — Valuation + risks + decision

### 5-Article Series (standard depth)
1. Business Model — Revenue structure, customer economics, unit economics
2. Competitive Moat — Moat type, evidence, durability, what could erode it
3. Management Quality — Team assessment using invest-management protocol
4. Financial Architecture — Cash flow, capital allocation, balance sheet quality
5. Valuation + Verdict — Full investment thesis, price target, key assumptions

### 8-Article Series (maximum depth — flagship study)
1. Business Overview — What they do, who they serve, why they exist
2. Business Model Deep Dive — Unit economics, pricing power, customer lifetime value
3. Industry Structure — Value chain, competitors, industry economics (invest-industry output)
4. Competitive Moat — Evidence-based moat analysis, sustainability assessment
5. Management Deep Dive — Full 9-step management assessment (invest-management output)
6. Financial Architecture — 10-year financial history, FCF quality, capital allocation
7. Risk Landscape — All failure scenarios (Munger inversion), bear case
8. Investment Verdict — Four-master synthesis, valuation, price targets, buy/hold/sell

## Per-Article Protocol

Each article follows this structure:
1. **Opening question** — What specific question does this article answer?
2. **Evidence base** — What primary sources were used?
3. **Analysis** — Work through the question systematically
4. **Key findings** — 3-5 bullet points (the takeaways)
5. **Implications for the thesis** — How does this change or reinforce the investment view?

Data validation applies to every article: all financial data from ≥2 sources, no mental arithmetic.

## Continuity Rules (across articles in a series)

- Each article's conclusions should be referenced by subsequent articles
- If a later article contradicts an earlier finding → explicitly flag and resolve the contradiction
- The final article must synthesize all prior articles into a unified verdict

## Output Format

```
DEEP SERIES: [Company] — [N]-Article Series

SERIES PLAN:
Article 1: [title] — [one-sentence description]
Article 2: [title] — ...
...

[Then produce each article:]

═══ ARTICLE [N]: [Title] ═══
Opening question: [what this answers]
Sources: [primary sources used]

[Body — 500-2000 words depending on depth]

KEY FINDINGS:
• [finding 1]
• [finding 2]
• [finding 3]

THESIS IMPLICATION: [STRENGTHENS / NEUTRAL / WEAKENS / NEW RISK IDENTIFIED]
═══ END ARTICLE [N] ═══
```

Final article must include:
```
FOUR-MASTER FINAL VERDICT:
• Buffett: [one sentence]
• Munger: [top risk]
• Duan: [business quality]
• Li Lu: [structural trend]

INVESTMENT DECISION: [BUY / HOLD / PASS]
Price target: $[base] / $[bull] / $[bear]
Conviction level: [HIGH / MEDIUM / LOW]
Key assumption to monitor: [the one thing that, if wrong, breaks the thesis]
```

## Rules

- Never start the series without a clear opening question for each article.
- Each article must stand alone — a reader who only reads Article 3 should understand its conclusions.
- Contradiction between articles must be resolved explicitly, not smoothed over.
- The 8-article series produces definitive reference documentation — it is worth taking 2-4 research sessions to complete properly.
