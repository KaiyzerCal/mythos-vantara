# Skill Security Auditor — Pre-Install Gate for .claude/skills/

**Triggers:** `["audit skill", "scan skill for security", "skill security check", "before adding skill", "skill supply chain"]`

## What It Is

A static-analysis scanner that evaluates AI agent skills for security vulnerabilities before you add them to `.claude/skills/`. Produces PASS / WARN / FAIL verdicts with line-level findings.

**Source:** `KaiyzerCal/claude-skills` → `engineering/skill-security-auditor/` (MIT)

## Scanning Categories

| Category | What It Checks |
|---|---|
| Code execution | `os.system`, `subprocess(shell=True)`, `eval`, `exec`, `__import__`, base64/hex obfuscation |
| Network exfiltration | `requests`, `urllib`, `socket` calls in skill scripts |
| Credential harvesting | SSH config reads, AWS credential file access |
| Prompt injection | SKILL.md text that overrides system instructions, hijacks roles, bypasses safety |
| Supply chain | Unpinned dependency versions, typosquatted package names, suspicious behavior |
| Filesystem | Boundary violations, hidden files, unexpected binaries, malicious symlinks |

## Usage

```bash
# Audit a local skill directory
python3 scripts/skill_security_auditor.py /path/to/skill-name/

# Audit from a GitHub repo
python3 scripts/skill_security_auditor.py https://github.com/user/repo --skill skill-name

# Strict mode: treat warnings as failures (good for CI)
python3 scripts/skill_security_auditor.py /path/to/skill/ --strict

# JSON output for automation
python3 scripts/skill_security_auditor.py /path/to/skill/ --json
```

## Verdict Meanings

- **PASS** — No findings. Safe to add.
- **WARN** — Suspicious patterns that may be false positives. Review before adding.
- **FAIL** — High-confidence dangerous patterns. Do not add without manual review.

## Limitations

Static analysis only — does not execute code. Cannot detect all obfuscation techniques or logic bombs. Complement with manual review for skills from untrusted sources.

## MAVIS Protocol

Before adding any new skill file to `.claude/skills/`:
1. Run the auditor on the source SKILL.md and any scripts it references.
2. Only add on PASS or reviewed WARN.
3. Skills from `KaiyzerCal/*` forks are pre-vetted (Calvin's own repos), but third-party sources require a PASS verdict.
