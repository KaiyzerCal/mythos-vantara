# Archived edge functions

Moved here rather than deleted, per the Execution Blueprint's "archive,
don't delete" ground rule. Each entry keeps the full original code —
safe to revive by moving the directory back up a level if a decision
here turns out to be wrong. Not deployed: `.github/workflows/deploy-
mavis-functions.yml` explicitly skips this directory.

- **`mavis-a2a-gateway`** (archived 2026-07-28) — an A2A protocol JSON-RPC
  server. Superseded by `mavis-a2a`, the later rewrite: `mavis-a2a-gateway`'s
  `tasks/send` only ever inserted a row into `a2a_tasks` with
  `status: "submitted"` and returned — nothing anywhere in the codebase ever
  reads `a2a_tasks` again, so every task submitted through it sat unfinished
  forever. `mavis-a2a` actually executes tasks via `mavis-actions` and
  persists a real result. Found via Execution Blueprint Stage D triage.

- **`mavis-inbound-webhook`** (archived 2026-07-28) — a generic inbound
  webhook normalizer (GitHub/Stripe/Gmail/Calendar/Activepieces →
  `mavis_autonomous_tasks`). Redundant with `mavis-webhook`, which does the
  same job, is correctly configured (`verify_jwt = false`), and is actually
  wired in — referenced by `mavis-chat`, `mavis-task-executor`, and
  `mavis-autonomous-runner` as the real generic external-webhook receiver
  for Zapier/Make/n8n. This one also had no `config.toml` entry (its own
  header comment claimed `verify_jwt = false` but that was never applied —
  stale/aspirational), so it was doubly broken even before the duplication.
  Found via Execution Blueprint Stage D triage.

- **`mavis-mcp`** (archived 2026-07-28) — a third Model Context Protocol
  server implementation. Superseded by `mavis-mcp-server`, which is more
  complete (15 real tools vs. a partial subset), better secured (SHA-256-
  hashed API key lookup vs. accepting any non-empty bearer token), and
  documented for real external clients (a literal Claude Desktop config
  snippet in its own file header). `mavis-mcp`'s own `route_event` tool also
  mapped to an action type `mavis-actions` never implemented. Found via
  Execution Blueprint Stage D triage.

- **`mavis-webhook-calendar`** (archived 2026-07-28) — an inbound webhook
  that parsed freeform text into a calendar event via
  `mavis-google-agent`'s `schedule_from_text`. No `config.toml` entry
  (would have rejected every real external caller anyway), and no evidence
  any external tool was ever registered against it — no setup script, no
  cron renewal, nothing referencing its URL anywhere, unlike the genuinely
  wired-in webhooks (Gmail, RuView) found in the same triage pass. The
  underlying capability (`schedule_from_text`) is already reachable through
  the normal chat/action pipeline. Easy to revive if a real external
  calendar-scheduling webhook is ever wanted. Found via Execution Blueprint
  Stage D triage.
