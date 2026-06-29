# Team Roster

The Orchestrator reads this before every dispatch. When you add a specialist, update this file.

---

## Active Specialists

| Specialist | Folder | Skills | Routing Keywords |
|---|---|---|---|
| **Researcher** | `Team/Researcher/` | research, pipeline-research | research, investigate, find, background, benchmark, competitor, source, what does X look like |
| **Strategist** | `Team/Strategist/` | strategy | strategy, framework, brief, positioning, how should I think, what's the play, segment, channel |
| **Writer** | `Team/Writer/` | draft, repurpose, summarise | write, draft, post, copy, email, article, thread, long-form, talking points |
| **Editor** | `Team/Editor/` | review | review, edit, check voice, QA, does this sound right, voice compliance, claims |
| **Analyst** | `Team/Analyst/` | analyze | analyze, report, metrics, KPIs, coverage, sentiment, performance, how many, share of voice |
| **HR** | `Team/HR/` | hire-specialist | hire, new specialist, I need someone who, add a role, new team member |

---

## Pipeline Chains

| Pipeline | Chain | Trigger |
|---|---|---|
| Standard deliverable | Researcher → Strategist → Writer → Editor | Any content output |
| Recurring cadence | (Strategist) → Writer → Editor | Newsletters, weekly briefs |
| Pure research | Researcher only (deep) | Investigation-only requests |

---

## Hand-off Protocol

Each specialist defines what they hand off and to whom in their persona file. The Orchestrator routes; specialists produce; the Editor clears or returns annotated output.

---

## Adding a New Specialist

1. Ask HR to draft the persona file.
2. HR creates `Team/<NewRole>/persona.md`.
3. HR updates this ROSTER.md.
4. Orchestrator can immediately dispatch to the new role.
