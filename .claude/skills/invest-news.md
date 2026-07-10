---
name: invest-news
version: "1.0"
owner: Analyst
triggers: ["news pulse", "stock moved", "why did stock drop", "why did stock rise", "price movement", "news analysis", "what happened to", "stock news"]
requires: []
primaryEnv: claude
---

# Skill: invest-news

**Owner:** Analyst

Rapid price movement attribution for held or watched positions. Multi-angle team separates signal from noise — distinguishes thesis-relevant events from irrelevant volatility.

## Input

`Company name + movement description` e.g. "BYD down 8% today" or "Nvidia — what's happening"

## Design Philosophy

Most price movements are noise. A 5% drop on earnings miss is very different from a 5% drop on management fraud. This skill forces you to categorize the cause BEFORE deciding whether to act.

## Movement Attribution Framework

Every price movement has one of four root causes:

| Category | Description | Investment Action |
|---|---|---|
| **A — Thesis-relevant** | Factual change that directly affects a key thesis assumption | Review thesis; potential ADD or EXIT |
| **B — Macro/sector** | Market-wide or sector-wide move unrelated to this company | No action unless valuation opportunity |
| **C — Sentiment** | Narrative shift, analyst downgrade, social media, fear | Hold if thesis intact; ADD on dips |
| **D — Technical** | Index rebalancing, forced selling, options expiry, liquidity event | Potential ADD opportunity |

## Steps

### Step 1 — GATHER RECENT NEWS (parallel search)
Search simultaneously:
- Company press releases / IR announcements
- Major financial news sources (WSJ, FT, Bloomberg headlines)
- Regulatory filings (8-K, material events)
- Earnings call / guidance revision
- Sector/competitor news that might be misattributed to this company

### Step 2 — CAUSE CLASSIFICATION
Assign each news item to category A/B/C/D. List the top 3-5 drivers.

For category A items, immediately ask:
- Does this change a key thesis assumption? (Yes → escalate to invest-thesis-tracker)
- Is this permanent or temporary?
- Was this already known/priced in?

### Step 3 — THESIS INTERSECTION CHECK
For any Category A event: map it to the original thesis components.
- Does it affect the moat?
- Does it affect management quality?
- Does it affect the intrinsic value estimate?
- Does it affect the margin of safety?

### Step 4 — SENTIMENT vs. FACT SEPARATION
Common noise patterns to ignore:
- Analyst price target changes (they lag reality)
- Social media / influencer sentiment
- "Sector rotation" narratives
- Macro fear that has no specific connection to this company's business

Common signals to act on:
- Management losing a key contract
- Margin guidance cut driven by structural cost change
- Major customer or supplier defection
- Regulatory enforcement action
- Insider selling at scale (>$10M by non-diversifying insiders)

### Step 5 — VERDICT AND ACTION

**If mostly B/C/D**: Volatility only. If price dropped, this is potentially an ADD opportunity if thesis intact.

**If A events detected**: Run invest-thesis-tracker before deciding. Do not panic-sell or panic-buy without thesis review.

## Output Format

```
NEWS PULSE: [Company] — [movement: +/- X% on date]

NEWS DRIVERS:
1. [A/B/C/D] — [event description] — [source]
2. [A/B/C/D] — [event description] — [source]
3. [A/B/C/D] — [event description] — [source]

PRIMARY CAUSE: [category] — [one sentence explanation]

THESIS IMPACT: [NONE / POSSIBLE / CONFIRMED]
If possible/confirmed: [which thesis assumption is affected]

SIGNAL vs. NOISE:
This movement is: [SIGNAL — thesis-relevant] / [NOISE — ignore]

RECOMMENDED ACTION:
• If holding: [HOLD / ADD / REVIEW THESIS / TRIM]
• If watching: [WATCH / REVIEW THESIS / PASS]
• If not familiar: [run invest-research first]

DO NOT ACT ON: [list noise items to ignore]
```

## Rules

- Classify cause BEFORE deciding action — never act on price movement before understanding cause.
- Analyst price target changes are Category C (sentiment) by default — never act on them alone.
- Category A events require invest-thesis-tracker before any position change.
- Price drop + intact thesis = potential ADD opportunity. Do not conflate "stock dropped" with "thesis is wrong."
