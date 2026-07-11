# Security PreToolUse Hook — Dangerous Pattern Guard

**Triggers:** `["add security hook", "block unsafe code", "detect command injection", "prevent SQL injection", "security warning hook", "pretooluse security"]`

## What It Is

A PreToolUse hook for Claude Code that scans files before Edit/Write/MultiEdit executes. Catches 12 dangerous patterns across Python, JavaScript, shell, and GitHub Actions. Session-state caching prevents duplicate warnings.

**Source:** `KaiyzerCal/claude-skills` → `engineering/security-guidance/` (v2.7.3, MIT, ported from alirezarezvani/aeo-box + Anthropic David Dworken upstream)

## Detected Patterns (12 total)

| Category | Patterns |
|---|---|
| GitHub Actions | `${{ inputs.*}}` expression injection in workflow files |
| Node.js exec | `child_process.exec`, `execSync`, `spawn` with shell |
| JS code injection | `eval()`, `new Function()` |
| React XSS | `dangerouslySetInnerHTML` |
| DOM injection | `innerHTML =`, `document.write(` |
| Python deserialization | `pickle.loads`, `yaml.unsafe_load` |
| Python exec | `os.system(`, `subprocess.call(shell=True)`, `subprocess.Popen(shell=True)` |
| SQL injection | f-string or `%`-format into SQL strings |

## How to Install

Add to `.claude/settings.json` (or `~/.claude/settings.json` for global):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/security_reminder.py"
          }
        ]
      }
    ]
  }
}
```

The hook script lives at `engineering/security-guidance/scripts/security_reminder.py` in the claude-skills repo.

## Behavior

- **Exit code 2** → warning shown, operation blocked until acknowledged
- **Exit code 0** → clean or already-warned-this-session
- **Session cache:** `~/.claude/security_warnings_state_<session>.json` (auto-cleaned after 30 days)
- **Disable:** Set `ENABLE_SECURITY_REMINDER=0` in env for a single verified-safe operation

## MAVIS Applicability

Run on any MAVIS session where you're touching:
- `supabase/functions/` — SQL injection risk (f-strings in SQL queries)
- `src/` — XSS risk (innerHTML, dangerouslySetInnerHTML)
- `.github/workflows/` — Actions expression injection
- Any new edge function that calls `eval()` or subprocess equivalents

This is a dev-machine hook, not a production control. It operates on the author's Claude Code session.
