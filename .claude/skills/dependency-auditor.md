# Dependency Auditor — Multi-Language Security & License Scan

**Triggers:** `["dependency audit", "scan dependencies", "license compliance", "CVE scan", "vulnerable packages", "upgrade plan", "npm audit", "pip audit", "license check"]`

## What It Is

Offline, deterministic dependency security and license compliance scanning across 8+ package ecosystems. Three tools: vulnerability scan, license compliance, upgrade planning. Complements live advisory services (`npm audit`, `pip-audit`) — does not replace them.

**Source:** `KaiyzerCal/claude-skills` → `engineering/dependency-auditor/` (MIT)

## Ecosystems Covered

`package.json`, `package-lock.json`, `pnpm-lock.yaml` (npm/pnpm/yarn) · `requirements.txt`, `pyproject.toml` (Python) · `go.mod` (Go) · `Cargo.toml`, `Cargo.lock` (Rust) · `Gemfile.lock` (Ruby) · `pom.xml`, `build.gradle` (Java) · `composer.lock` (PHP) · `*.csproj` (NuGet/.NET)

## Tool 1: Vulnerability Scan

```bash
python3 scripts/dep_auditor.py /path/to/repo
python3 scripts/dep_auditor.py /path/to/repo --json  # CI gate output
```

Offline pattern matching against CVE signatures. Severities: critical → high → medium → low. Fix critical/high before shipping.

Supplement with live advisories after:
```bash
npm audit          # Node
pip-audit          # Python
cargo audit        # Rust
govulncheck ./...  # Go
```

## Tool 2: License Compliance

| License Class | Examples | Action Required |
|---|---|---|
| **Permissive** (safe) | MIT, Apache 2.0, BSD-2/3 | None |
| **Copyleft** (review) | LGPL, MPL | Case-by-case |
| **Strong copyleft** (warn legal) | GPL-2/3, AGPL-3 | Legal review if shipping |
| **AGPL-3** (highest risk) | — | Treat as must-replace in SaaS |

AGPL and GPL trace contamination through the full dependency chain — a single AGPL transitive dep can taint the whole product.

## Tool 3: Upgrade Planning

Output is risk-ordered:
1. **Patches** (e.g. 1.2.3 → 1.2.9) — lowest risk, apply first
2. **Minor versions** (1.2.3 → 1.5.0) — test + apply
3. **Major versions** (1.x → 2.0) — dedicated review + testing checklist

After applying upgrades: re-run vulnerability scan and assert 0 high-severity findings before closing the audit.

## Recommended Cadence

- **Per commit**: run vulnerability scan as CI gate (fast, offline)
- **Monthly**: license audit
- **Quarterly**: comprehensive review (all three tools)

## MAVIS Project Scan

Key files to watch in mythos-vantara:
- `package.json` / `pnpm-lock.yaml` (React frontend)
- `supabase/functions/*/deno.json` or `import_map.json` (Deno edge functions)
- Any `requirements.txt` if Python scripts added

AGPL watch: avoid `langchain`, `mirofish`, any GPL-based LLM tools in a SaaS-distributed product.
