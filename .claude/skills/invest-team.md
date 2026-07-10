---
name: invest-team
version: "1.0"
owner: Analyst
triggers: ["investment team", "four masters", "parallel analysis", "council analysis", "berkshire team", "multi-agent invest"]
requires: ["invest-research", "invest-data"]
primaryEnv: claude
---

# Skill: invest-team

**Owner:** Analyst

Runs the full 4-master parallel analysis team on a company. Four independent specialist agents — each embodying one master's methodology — analyze simultaneously, then a team lead synthesizes with a forced conclusion.

## Input

Company name/ticker + research question or angle.

## Pre-Run Check

Confirm WebSearch access is available before launching. Without live search, agents will degrade to training knowledge only — flag this explicitly as "KNOWLEDGE ONLY — not current research."

## Team Structure

| Agent | Master | Lens | Focus |
|---|---|---|---|
| Business Analyst | Duan Yongping | Product & culture | Business model integrity, stop-doing list |
| Financial Analyst | Warren Buffett | Capital allocation | Owner earnings, moat, ROE, margin of safety |
| Industry Researcher | Charlie Munger | Inversion & models | Failure scenarios, competitive dynamics, mental models |
| Risk Assessor | Li Lu | Structural trends | Secular tailwinds, owner-operator, policy risk |

## Steps

### Round 1 — INFORMATION RICHNESS GRADE (team lead)
Grade the target A/B/C before dispatching agents. Adjust task scope accordingly.

### Round 2 — PARALLEL DISPATCH (all 4 agents simultaneously)
Each agent independently:
1. Searches for latest financials, filings, news, competitor data
2. Applies their master's methodology (see invest-research.md for each lens)
3. Produces: evidence summary + 3 key findings + preliminary verdict
4. Flags any data they could NOT verify

### Round 3 — CROSS-CHALLENGE (agents challenge each other's findings)
- Business Analyst challenges Financial Analyst's moat assessment with product quality evidence
- Industry Researcher challenges the secular trend thesis with competitive risk data
- Risk Assessor challenges the bull case with policy and structural failure scenarios
- Financial Analyst challenges qualitative claims with quantitative evidence

### Round 4 — SYNTHESIS (team lead)
Team lead synthesizes across all 4 perspectives:
- Where do all 4 masters agree? → Highest conviction signal
- Where do they disagree? → Name the core dispute; state which view has stronger evidence
- Forced conclusion: one clear recommendation

### DATA VALIDATION (before finalizing)
- Cross-check all financial figures from at least 2 independent sources
- Flag any discrepancy >1%
- Confidence weighting: A-grade = full weight, B-grade = 70%, C-grade = 30% + human verification required

## Output Format

```
═══ INVESTMENT TEAM REPORT: [COMPANY] ═══
Information Richness: [A/B/C]
Analysis Confidence: [%]

AGENT FINDINGS:
────────────────────────────────────
Business Analyst (Duan): [key finding + verdict]
Financial Analyst (Buffett): [key finding + verdict]  
Industry Researcher (Munger): [key finding + verdict]
Risk Assessor (Li Lu): [key finding + verdict]

CONSENSUS ZONES (all 4 agree):
• [point 1]
• [point 2]

DISPUTED ZONE (agents disagree):
• Issue: [description]
• Evidence for: [agent + reasoning]
• Evidence against: [agent + reasoning]
• Resolution: [team lead judgment]

FINAL VERDICT: [STRONG BUY / BUY / WATCH / PASS / REJECT]
Price Target: $[base] — [confidence %]
Entry Level: $[price] (implies [X]% margin of safety)
One-liner: [5 words max — the single defining reason]
═══ END REPORT ═══
```

## Rules

- All 4 agents must report before synthesis — no skipping an agent.
- Forced conclusion required. "It depends" is not a verdict.
- Disputed zones must be named explicitly, not smoothed over.
- If WebSearch is unavailable, prepend "KNOWLEDGE ONLY" to the full report.
