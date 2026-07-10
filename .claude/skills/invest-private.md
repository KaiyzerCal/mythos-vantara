---
name: invest-private
version: "1.0"
owner: Analyst
triggers: ["private company research", "private company analysis", "unlisted company", "pre-IPO", "startup research", "analyze private company"]
requires: ["invest-management", "invest-data"]
primaryEnv: claude
---

# Skill: invest-private

**Owner:** Analyst

Investment research framework for unlisted/private companies where public filings are unavailable. Data is scarce by definition — this skill focuses on what you CAN verify and forces honesty about gaps.

## Input

Company name + investment context (e.g. "pre-IPO consideration", "angel round", "private placement").

## Key Difference from Public Company Research

Private company research is C-grade by default. The primary rule: **do not fake completeness**. A fake-complete report on a private company is worse than no report — it creates false confidence.

The goal is to surface the critical questions for human verification, not to produce a complete analysis from incomplete data.

## Steps

### Step 1 — SCOPE WHAT'S FINDABLE
Before spending time, assess what is actually publicly available:
- Court/regulatory filings (lawsuits, compliance records)
- Press coverage and interviews with founders
- LinkedIn data (team size, hiring patterns, employee tenure)
- Job postings (reveal tech stack, growth areas, pain points)
- Government contracts or grants (especially for B2G companies)
- Patent filings
- Customer reviews (Trustpilot, G2, AppStore)
- Competitor disclosures that mention this company
- Angel/VC investor statements (if they made public announcements)

Grade what you found: A (multiple sources, cross-verifiable) / B (partial) / C (almost nothing).

### Step 2 — BUSINESS MODEL RECONSTRUCTION
From available sources, reconstruct:
- What does the company actually do? (use DYP-Ask: "what would happen if they stopped doing X?")
- Who are the customers? What job is being done for them?
- How do they make money? (subscription, transaction, one-time, licensing, etc.)
- What makes them harder to replace than the next option?
- Where is the moat, if any?

Label every statement with its source and confidence: HIGH / MEDIUM / LOW / INFERENCE.

### Step 3 — TEAM ASSESSMENT (most important in private companies)
Private company investing is primarily a bet on people. Run full invest-management assessment using:
- LinkedIn profiles, career histories, and team tenure
- Founder interviews, podcasts, public statements
- Prior company performance (if founders have built and exited before)
- Glassdoor reviews (weighted toward longer-tenure employees)
- Reference network (who in your network has worked with or around this team?)

Key Duan Yongping question: "Would you invest in this person's next company regardless of what it was?"

### Step 4 — MARKET SIZE & GROWTH (first principles only)
Do NOT use market size reports at face value. Estimate from first principles:
- How many customers could theoretically use this? (top-down addressable)
- How many currently have this problem and could realistically switch? (bottom-up SAM)
- What is a reasonable revenue per customer per year?
- What market share would this company need to be profitable?

Flag: market size numbers from pitch decks or paid research reports are suspect. State your own estimate.

### Step 5 — FINANCIAL INDICATORS (proxy metrics)
Without financials, look for proxy signals:
- Employee count growth (LinkedIn: rate of hiring vs. rate of departure)
- Funding rounds: size, frequency, valuation step-up, investor quality
- Revenue signals: pricing information, number of enterprise vs. SMB customers, reference accounts
- Burn rate indicators: runway relative to last funding round
- Customer growth: review volume growth, testimonials dating

### Step 6 — RISK MAP
Private company-specific risks to name explicitly:
- Liquidity risk: when/how do you exit?
- Information asymmetry: founders know far more than you
- Dilution risk: future rounds may dilute your position
- Key person risk: is the company one person leaving away from collapse?
- Market timing risk: right idea, wrong time
- Execution risk: difference between "good idea" and "successfully built"

### Step 7 — HUMAN VERIFICATION QUESTION LIST
The output's most important section for C-grade companies. List the 10 questions that must be answered by humans with direct access (founders, employees, customers, investors):

Examples:
1. "What is current MRR/ARR, and what was it 12 months ago?"
2. "What is the net revenue retention rate from existing customers?"
3. "What does the cap table look like — any problematic early investor terms?"
4. "What is the 12-month runway at current burn rate?"
5. "Has any major customer churned in the last 6 months? Why?"

## Output Format

```
PRIVATE COMPANY RESEARCH: [Company]
Research grade: C (private — limited primary sources)
AI confidence: [X%] (deliberately conservative)

WHAT'S FINDABLE:
Sources accessed: [list]
Grade by source type: [A/B/C per source category]

BUSINESS MODEL (reconstructed):
Core activity: [description] [confidence: HIGH/MED/LOW]
Customer: [who] [confidence: ___]
Revenue model: [how] [confidence: ___]
Moat hypothesis: [description] [confidence: ___]

TEAM ASSESSMENT:
[per invest-management abbreviated output]
Key risk: [one sentence]

FINANCIAL INDICATORS (proxies):
[list proxy signals with sources and confidence]

RISK MAP:
Top 3 risks: [list]

HUMAN VERIFICATION REQUIRED:
Priority questions for due diligence:
1. [question]
2. [question]
...10.

PRELIMINARY VERDICT: [INTERESTING / NEEDS MORE DATA / AVOID]
Cannot determine further without: [specific data gaps]
```

## Rules

- Never produce a "complete" analysis on a private company — always attach the verification question list.
- AI confidence on private company research should be stated as lower than public company research.
- Team assessment is the primary determinant of verdict when financials are unavailable.
- "Interesting" verdict requires at least one human verification step before any investment decision.
