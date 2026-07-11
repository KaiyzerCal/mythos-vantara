# Env & Secrets Manager — Dotenv Hygiene + Rotation

**Triggers:** `["secrets audit", "env hygiene", "secret leak", "rotate secret", "dotenv check", "supabase secrets", "gitleaks", "credential rotation"]`

## What It Is

Patterns for managing `.env` files, detecting secret leaks, and rotating credentials. Directly applicable to MAVIS's Supabase vault secrets and local dev env files.

**Source:** `KaiyzerCal/claude-skills` → `engineering/env-secrets-manager/` (MIT)

## Quick Audit

```bash
# Scan repo for likely secret leaks (offline, no API calls)
python3 scripts/env_auditor.py /path/to/repo

# JSON output for CI
python3 scripts/env_auditor.py /path/to/repo --json
```

Severity levels: `critical` → `high` → `medium` → `low`. Fix critical/high first.

## Pre-Commit Detection

```bash
# gitleaks (recommended for MAVIS dev workflow)
brew install gitleaks
# Add to .git/hooks/pre-commit:
gitleaks git --pre-commit --staged
```

```yaml
# .pre-commit-config.yaml (alternative)
repos:
  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.5.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
```

## MAVIS Secrets Inventory

| Secret | Location | Rotation Cadence |
|---|---|---|
| `ANTHROPIC_API_KEY` | Supabase vault | On compromise or quarterly |
| `TELEGRAM_BOT_TOKEN` | Supabase vault | On compromise |
| `SUPABASE_SERVICE_ROLE_KEY` | Vault + edge function env | On compromise |
| `APIFY_API_KEY` | Supabase vault | Quarterly |
| `OPENAI_API_KEY` | Supabase vault | Quarterly |
| `.env.local` (dev) | Local only, git-ignored | Never commit |

## Rotation Workflow

1. Generate new credential at the provider.
2. Deploy to all consumers (Supabase vault → `supabase secrets set KEY=value`).
3. Verify edge functions respond correctly.
4. Revoke old credential only after all consumers confirmed healthy.
5. Update `created_at` metadata in a rotation log.

**Never** rotate in Supabase dashboard alone — also update any `vault.decrypted_secrets` references in cron SQL and edge functions that read them.

## Anti-Patterns

- Committing real values in `.env.example` (use placeholder syntax: `KEY=your_key_here`)
- Rotating one system but missing downstream consumers (edge functions, crons)
- Logging secrets during incident response debugging
- Using `SUPABASE_SERVICE_ROLE_KEY` in client-side code

## CI Secret Injection (GitHub Actions)

```yaml
# Use repository secrets, never hardcode
- uses: actions/checkout@v4
- name: Deploy
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
  run: supabase functions deploy
```

Prefer OIDC federation over long-lived access keys wherever the provider supports it.
