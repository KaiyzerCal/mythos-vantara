# Agent Self-Scheduling — Unattended Run Patterns

**Triggers:** `["schedule agent", "cron agent", "unattended run", "background agent", "heartbeat pattern", "agent scheduling", "schedule claude code"]`

## What It Is

Implementation patterns for scheduling unattended agent runs — covering Camp A (Claude Code, Codex: execute once + exit, requires external scheduler) and Camp B (Hermes: built-in 60-second ticker with zero-token mode).

**Source:** `KaiyzerCal/skills` (davidondrej fork, MIT)

## Camp A: Claude Code / Codex — External Scheduling

```bash
# crontab -e (minimum interval: 1 minute)
*/5 * * * * /path/to/claude --dangerously-skip-permissions -p "$(cat /tmp/task.md)" >> /tmp/agent.log 2>&1

# Or via Supabase cron (for MAVIS edge functions):
SELECT cron.schedule('my-job', '*/15 * * * *', $$SELECT net.http_post(...)$$);
```

**Constraints for Camp A:**
- Pre-approve all tool permissions before scheduling — no interactive prompts
- Use JSON output format for reliable parsing across sessions
- Stateless: each run must re-read all context from disk or Supabase
- No persistent memory between runs unless explicitly loaded

## Camp B: Hermes — Built-in Scheduler

- Gateway ticks every 60 seconds
- Zero-token mode available for lightweight state checks (no LLM call)
- Job chaining supported
- **NEVER** schedule recursive jobs from within a scheduled Hermes session

## Three Common Failure Modes

1. **Permission prompt blocks execution** — pre-approve everything or use `--dangerously-skip-permissions`
2. **Stateless run loses context** — load context from Supabase/file at run start; never rely on in-memory state
3. **Inadequate verification** — always assert outcome, don't just trust the run completed

## Heartbeat Pattern (recommended for Camp A)

```
Fast tick (every 1 min): check a condition flag in Supabase
  → if flag set: do work
  → if no flag: exit immediately (zero LLM cost)

Slow work (triggered by flag):
  1. Load context
  2. Do task
  3. Write result to Supabase
  4. Clear flag
  5. Exit
```

This pattern minimizes LLM API calls during idle periods while still reacting quickly when needed.

## Verification Checklist After Setup

- [ ] Log growth confirmed: `tail -f /path/to/agent.log`
- [ ] Scheduled job visible: `crontab -l` or `supabase db execute "SELECT * FROM cron.job"`
- [ ] Permission flags validated (dry run succeeds)
- [ ] Quiet behavior confirmed when no tasks are due (no spurious runs)

## MAVIS Use Case

MAVIS's Supabase crons already use this pattern (mavis-dream at 03:30, goal-agent every 4h, etc.). When adding new scheduled behaviors, always use the heartbeat pattern: a cron that checks a `mavis_scheduled_tasks` flag first, runs only when flagged, and clears the flag on completion. This avoids wasted LLM tokens on empty runs.
