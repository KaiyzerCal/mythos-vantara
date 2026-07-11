# Delegating to Agents — Routing Matrix & TUI Prompt Rules

**Triggers:** `["delegate to agent", "which agent", "route to codex", "route to pi", "agent routing", "TUI prompt rules", "send to agent", "cmux prompt"]`

## What It Is

A routing matrix for deciding which AI coding agent handles which task class, plus precise rules for sending prompts to TUI agents without formatting bugs.

**Source:** `KaiyzerCal/skills` (davidondrej fork, MIT)

## Agent Routing Matrix

| Task Type | Agent | Notes |
|---|---|---|
| Complex/long SWE tasks | Codex CLI | Multi-file refactors, architecture changes |
| Most other tasks | Pi Agent (claude-opus-4-8-fast via OpenRouter, xhigh) | Fast, high-quality |
| Frontend / UI / design | Pi | Beats Codex on UI work |
| Heavy multi-step orchestration | Claude Code (this session) | Orchestrator role |
| Cost-sensitive batch tasks | OpenClaude + DeepSeek | See openclaude.md |
| Local/offline | OpenClaude + Ollama | |

## TUI Prompt Rules (Critical — violations cause silent failures)

In a TUI agent, **a newline character submits immediately**. Multi-line prompts must use inline separators.

```bash
# CORRECT: single-line, period-space separator
cmux send --surface surface:N "Fix the auth bug in mavis-agent. Check supabase/functions/mavis-agent/index.ts. Add retry logic for 429s."

# WRONG: newlines cause premature submission
cmux send --surface surface:N "Fix the auth bug.
Check the file."

# For long instructions: write to file first
echo "Your long multi-line instruction..." > /tmp/task.md
cmux send --surface surface:N "Read /tmp/task.md and follow it"

# Quote rules:
# - Wrap in plain double quotes ONLY
# - NEVER escaped quotes (\") inside prompt
# - Avoid apostrophes inside prompt (write "dont", "wont")
# - Avoid literal double quotes inside prompt

# Commands that exist:
cmux send --surface surface:N "prompt"
cmux send-key --surface surface:N enter

# Commands that do NOT exist (don't use):
# cmux send-surface, cmux send-key-surface
```

## Polling Pattern

After sending to a TUI agent, poll at 3-5 second intervals:

```bash
sleep 3
# Check agent output
cmux capture --surface surface:N
# Report one-line status to user: what agent is doing + on track Y/N
# Continue polling until done
```

Do NOT sleep 30+ seconds between checks. TUI agents often complete within seconds.

## Remote VPS Agent Pattern

```bash
# CORRECT: SSH first, then launch agent on the VPS
ssh user@vps.example.com
codex --yolo "deploy the new edge function"

# WRONG: run agent locally, have it SSH for every step
# (causes permission prompts, slow round-trips, context loss)
```

## MAVIS Multi-Agent Delegation

When MAVIS needs to parallelize work across sessions:
1. Use Claude Code (this session) as orchestrator
2. Spawn Codex or Pi agents for specific subtasks
3. Write subtask briefs to `/tmp/task-<id>.md`
4. Collect results via shared Supabase table or temp files
5. Synthesize in this session

See `agentsmesh.md` for the full Go/gRPC fleet approach when N > 3 parallel agents.
