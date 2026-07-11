# Effective Agent Skills — Skill Authoring Standard

**Triggers:** `["write a skill", "add skill", "skill authoring", "skill design", "skill description rules", "SKILL.md format", "skill quality check"]`

## What It Is

The canonical reference for writing `.claude/skills/` files that trigger correctly and produce high-quality output. The `description` field is a routing contract — most skill failures come from treating it as a summary of the workflow.

**Source:** `KaiyzerCal/skills` → `effective-agent-skills/` (MIT)

## The #1 Rule: Description ≠ Workflow Summary

**Description = routing contract:**
- Include: WHAT it does + WHEN to use + DIFFERENTIATOR + trigger phrases
- NEVER include: step-by-step summary of how it works

Why: if the description contains the workflow, the model follows the description and never loads the skill body.

Pattern: `"X via Y. Use for [situations]. [Differentiator: no Z / faster than W]"`

## Two Skill Types

**A. Capability Primitive** — thin wrapper over a deterministic CLI/script
- Use when: Claude CAN'T do X at all without it
- Length: 30-80 lines
- Body: exact commands + output format

**B. Process Primitive** — encodes methodology
- Use when: Claude's output quality or process is wrong without it
- Length: 80-200 lines
- Body: forcing questions, anti-patterns, specific decision rules

## Body Design Principles

- **Bash-first**: concrete command examples beat prose explanations
- **Push determinism into code** (scripts), judgment stays in prompts
- **State-check before action**: verify state, then branch — never assume
- **Build validation loops explicitly**: verify → fix → re-verify
- **Just-in-time loading**: "For [edge case], read references/edge-cases.md first"
- **One skill = one concern**: never bundle two unrelated workflows

## Anti-Patterns

| Anti-pattern | Why it fails |
|---|---|
| Re-teaching what the model already knows | Wastes tokens, adds noise |
| Vague description | Triggers wrong or never |
| Monolithic mega-skill | Hard to trigger precisely |
| Happy-path only | No failure mode docs |
| Absolute paths | Breaks on other machines |
| Time-sensitive info ("as of Q4 2024") | Rots immediately |
| Summarizing full workflow in description | Model skips the body |

## Ship Checklist

- [ ] File name matches the trigger phrase pattern (kebab-case)
- [ ] Description = what + when + differentiator (NO workflow summary)
- [ ] At least one Bash/code example in the body
- [ ] Validation loop documented (how to verify it worked)
- [ ] Output format documented (what does success look like)
- [ ] Tested with a weak model (strong models forgive vague skills)
- [ ] One concern per skill (if you hesitated, it's two skills)

## Progressive Disclosure Pattern

```
Level 1 (startup, ~100 tokens): triggers in description only
Level 2 (matched, full body loaded): detailed workflow
Level 3 (edge cases): "read references/X.md for [scenario]"
```

Only load Level 3 files when that edge case is actually needed. Referenced files keep the main skill body short and fast.
