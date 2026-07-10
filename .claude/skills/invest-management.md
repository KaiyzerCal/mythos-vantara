---
name: invest-management
version: "1.0"
owner: Analyst
triggers: ["management deep dive", "analyze management", "assess CEO", "leadership quality", "management quality", "is management good"]
requires: []
primaryEnv: claude
---

# Skill: invest-management

**Owner:** Analyst

Systematic 9-step management quality assessment. "Buying a stock is buying a person." — Duan Yongping. Character is primary; competence is secondary.

## Input

Company name, CEO name (optional), specific concern (optional).

## The 9-Step Assessment

### Step 1 — IDENTIFY DECISION MAKERS
- Who is the actual controlling authority? (may differ from title)
- Distinguish: nominal CEO vs. controlling shareholder vs. board chair
- Map the power structure: who has final say on capital allocation?

### Step 2 — STRATEGIC VISION TRACK RECORD
- Find 3 major strategic predictions management made 3-5 years ago
- Verify actual outcome vs. prediction
- Grade accuracy: >70% accurate = strong, 40-70% = average, <40% = poor

### Step 3 — EXECUTION TRACK RECORD
- List 5 major commitments made to investors in the past 3 years
- Did they deliver on each? (Yes / Partial / No)
- Pattern of missed targets? → Red flag

### Step 4 — INTEGRITY UNDER PRESSURE
- Has the company faced a crisis? How did management respond?
- Did they communicate honestly with investors during bad news?
- Any history of: earnings restatements, misleading guidance, related-party abuse, regulatory violations?
- HARD STOP: Any confirmed integrity failure → REJECT regardless of other qualities

### Step 5 — CAPITAL ALLOCATION QUALITY
- ROIC over 10 years: consistent >WACC? (best proxy for capital allocator quality)
- Acquisition track record: did past M&A create or destroy value?
- Buyback timing: did they buy back at value prices or at peaks?
- Dividend policy: appropriate for the business lifecycle?

### Step 6 — GOVERNANCE STRUCTURE
- Ownership: what % does management own? (Real shares, not options)
- Are there dual-class shares? If yes, are they justified by founder alignment?
- Related-party transactions: any payments to connected entities?
- Compensation: is pay tied to long-term value creation or short-term metrics?

### Step 7 — LATERAL VERIFICATION (non-management sources)
- Employee reviews (Glassdoor pattern over 3+ years)
- Customer reviews and NPS trends
- Supplier and partner testimonials
- Former employee/executive interviews or press quotes
- Industry reputation: what do competitors say?

### Step 8 — SUCCESSION & DEPENDENCY RISK
- Is the business dependent on a single individual?
- Is there a documented succession plan?
- What happened the last time a key person left?
- Could the business be "run by a fool"? (Buffett's test)

### Step 9 — THREE-QUESTION FINAL TEST (Duan Yongping)
1. **Integrity**: "Would I be comfortable lending this person a significant amount of money based on their character alone?"
2. **Capability**: "Would I hire this person to run a business I owned?"
3. **Alignment**: "Do I believe this person is thinking about what's best for shareholders 10 years from now?"

All three YES → strong management. Any NO → articulate the specific concern.

## Output Format

```
MANAGEMENT ASSESSMENT: [Company] — [CEO/Key Executive]

Step 1 — Power Structure: [who really controls]
Step 2 — Vision Track Record: [grade: strong/avg/poor] — [example]
Step 3 — Execution: [X/5 commitments met] — [pattern note]
Step 4 — Integrity: [CLEAN / RED FLAG: description]
Step 5 — Capital Allocation: ROIC vs WACC [trend] | M&A verdict: [value/neutral/destroy]
Step 6 — Governance: Ownership [%] | Compensation alignment: [good/poor]
Step 7 — Lateral Verification: Employee [grade] | Customer [grade] | Industry [grade]
Step 8 — Succession Risk: [LOW / MEDIUM / HIGH — reason]

THREE-QUESTION TEST:
Integrity: [YES / NO / UNCERTAIN — note]
Capability: [YES / NO / UNCERTAIN — note]
Alignment: [YES / NO / UNCERTAIN — note]

VERDICT: [STRONG / ADEQUATE / WEAK / REJECT]
Key risk: [one-sentence management concern to monitor]
```

## Rules

- Integrity check is non-negotiable. Any confirmed breach = REJECT.
- Character over competence — a competent person with bad character is more dangerous than an honest person with average competence.
- Lateral verification (Step 7) must include at least one non-company source.
- The three-question test requires explicit YES/NO — "probably yes" counts as NO.
