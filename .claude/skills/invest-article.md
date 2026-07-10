---
name: invest-article
version: "1.0"
owner: Writer
triggers: ["investment article", "write investment post", "publish investment analysis", "investment content", "write about stock", "investment write-up"]
requires: ["invest-research"]
primaryEnv: claude
---

# Skill: invest-article

**Owner:** Writer

Three-agent collaboration (Author → Editor → Reader Review) to produce a publishable investment analysis article. Takes a research brief or completed invest-research output and produces a readable, credible, actionable article.

## Input

Research brief or completed invest-research output + publishing context (internal note / public article / social post).

## Agent Structure

### Agent 1 — Author
Writes the first draft from the research input. Follows the structure below.

### Agent 2 — Editor
Improves readability without reducing depth. See editing principles below.

### Agent 3 — Reader Review
Reviews as a knowledgeable investor who holds or watches the stock. Scores and provides actionable feedback.

Final: Author incorporates must-fix items and publishes.

## Article Structure

**Opening (100 words max)**
Lead with the single most important finding, not a company description. Bad: "Nvidia is a leading semiconductor company that..." Good: "Nvidia just printed the best FCF quarter in its history — and the market barely reacted. Here's why that might be a signal."

**Three Core Findings** (inverted pyramid)
Lead with the most important change or insight, not the most recent chronologically. For each finding:
- State the fact
- Explain the business significance
- Connect to the investment thesis

**Master Quotes Section**
One insight from each of the 4 masters' perspectives. These are the soul of the article — make each one sharp, memorable, and grounded in evidence:
- Buffett take: moat / FCF quality
- Munger take: risk / what could go wrong
- Duan take: product / culture quality
- Li Lu take: structural trend / long-term position

**Data Section** (concise table, not prose)
Core financial metrics: revenue, margin, FCF, valuation. Label source and period. Keep it tight.

**Verdict + Action**
Must explicitly answer for two audiences:
- "For holders: [HOLD / ADD / TRIM] because ___"
- "For watchers: [LOOK NOW / WAIT / PASS] because ___"

Next catalyst or data point to watch.

## Editing Principles (Agent 2)

**Jargon → Analogy**
Replace financial jargon with concrete analogies for key concepts:
- "FCF/Net income ratio of 80%" → "For every $100 the company earns on paper, $80 actually hits the bank"
- "EV/EBITDA of 15x" → "The market is paying 15 years of current operating profit to own this business"

**Length discipline**
- Short articles (social/newsletter): 500-1000 words
- Standard articles: 1000-2000 words  
- Deep-dive articles: 2000-3000 words
- Never exceed 3000 words — if it's longer, it's an invest-deep-series

**Paragraph discipline**
- No paragraph longer than 4 lines
- No sentence longer than 30 words
- One idea per paragraph

**Rhythm**
- Every 300-400 words: a summary line or transition that lets a skimmer follow the argument
- Tables and bullet points for data; prose for analysis and judgment

## Reader Review Dimensions (Agent 3)

Score 1-10 on:
- **Readability (30%)**: Would a knowledgeable investor skip any section? Which one?
- **Information value (30%)**: Does this add to understanding vs. what's freely available?
- **Credibility (20%)**: Are claims sourced? Are risks acknowledged? Is it balanced?
- **Actionability (20%)**: After reading, do I know what to do?

Output format:
```
READER REVIEW
Score: X/10
Must fix: [list — specific page/section + what to change]
Good: [what worked well]
Missing: [what the reader wanted but didn't get]
```

## Output Format

```
ARTICLE: [Title]
[Subtitle — one sentence that adds info to the title]

[Opening — 100 words]

[Three core findings]

[Master perspectives]

[Data table]

[Verdict + action for holders and watchers]

[Next catalyst]

---
Sources: [list]
Research grade: [A/B/C]
AI confidence: [X%]
```

## Rules

- Never publish without the Reader Review step completed.
- Must-fix items from Reader Review are non-negotiable.
- Every factual claim must be sourced in the research backing the article, even if the source isn't cited inline.
- Verdict section must have explicit action for BOTH holders and watchers — "it depends on your situation" is not a verdict.
- If information richness is C-grade, label the article "preliminary analysis" and append a question list for verification.
