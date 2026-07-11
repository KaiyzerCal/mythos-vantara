# AEO — Answer Engine Optimization (LLM Citation)

**Triggers:** `["AEO", "AEO audit", "LLM citation", "optimize for Perplexity", "get cited by Claude", "E-E-A-T audit", "answer engine optimization", "citation frequency", "cited by AI"]`

## What It Is

Optimizes content to be cited by LLMs (Perplexity, ChatGPT, Claude, Gemini) using an E-E-A-T scoring framework (Experience, Expertise, Authoritativeness, Trustworthiness). Unlike SEO (targets click-through rankings), AEO targets citation frequency across AI answer engines.

**Source:** `KaiyzerCal/claude-skills` → `aeo/` (MIT, based on alirezarezvani/aeo-box)

## Three Tools

### 1. Content Audit
- Input: URL or content text
- Output: E-E-A-T composite score 0-100 + per-dimension breakdown
- Industry profiles: `healthcare`/`finance` (strict thresholds), `saas`/`e-commerce` (standard)

### 2. Content Optimization
Three modes:
- **Conservative**: minimal edits, preserve voice, tighten structure only
- **Balanced**: structural reorganization + citation density enhancement
- **Aggressive**: restructure + rewrite + schema injection + fact-forward composition

Key techniques applied:
- Fact-forward composition (lead with specifics, not context)
- Schema.org markup injection (Article, FAQPage, HowTo)
- Named citation density (proper nouns, specific sources, data points)
- Semantic clustering (co-occurrence of related terms AI systems look for)

### 3. Citation Tracking Ledger
Local ledger tracking which of your URLs get cited, by which LLM, answering which query. No telemetry, local storage only. Exports velocity metrics (citation rate over time).

## E-E-A-T Dimensions

| Dimension | What Increases Score |
|---|---|
| **Experience** | First-hand signals, specific examples, personal detail, "I tested this" |
| **Expertise** | Accurate claims, credentials mentioned, depth of coverage, no vague hedging |
| **Authoritativeness** | Named citations, primary sources, backlinks, institutional references |
| **Trustworthiness** | Factual accuracy, source transparency, no manipulative framing |

## MAVIS Content Strategy

Apply AEO to any content Calvin publishes that should appear in AI search results:
- Product pages for CODEXOS/Mavis → optimize for "personal AI operating system" queries
- LinkedIn posts / long-form content → audit before publish
- Any URL the Mavis social posting pipeline outputs → run audit pass first

Industry profile for MAVIS content: **saas** (standard thresholds).

## Quick Scoring Heuristic

Content likely to be cited:
- Opens with a specific claim or data point (not a question or context)
- Has at least one named primary source per major claim
- Includes exact numbers, not approximations ("73% of users" not "most users")
- Uses consistent, specific terminology (AI systems pattern-match on exact phrases)
