# AgentsMesh — Multi-Agent Claude Code Orchestration

**Triggers:** `["agentsmesh", "multi-agent orchestration", "parallel agents", "agent fleet", "pod fleet", "worktree agents"]`

## What It Is

AgentsMesh is a control plane for running dozens to hundreds of AI coding agents simultaneously — each in an isolated Git worktree pod. Claude Code is a first-class supported agent type. BYOK (bring your own keys). Self-hostable.

**GitHub:** `KaiyzerCal/AgentsMesh` | **Stack:** Go/gRPC backend, Rust/WASM client, Next.js/Electron/SwiftUI UIs

## When to Use

Use AgentsMesh when MAVIS needs to execute work that exceeds a single Claude session:

- "Refactor all 20 VANTARA edge functions to use the new auth pattern"
- "Research and draft 10 product proposals simultaneously"
- "Run security audit across every file in the codebase"
- Any task decomposable into parallel independent subtasks

## Docker Self-Hosted Setup

```bash
git clone https://github.com/KaiyzerCal/AgentsMesh
cd AgentsMesh
docker compose up -d

# Web UI at http://localhost:3000
# gRPC server at localhost:50051
```

## Register Claude Code as an Agent Type

```json
{
  "agent_type": "claude-code",
  "binary": "claude",
  "args": ["--no-interactive", "--output-format", "json"],
  "env": {
    "ANTHROPIC_API_KEY": "{{ ANTHROPIC_API_KEY }}"
  }
}
```

## Pod Lifecycle

```bash
# Create a pod for a task
curl -X POST http://localhost:3000/api/pods \
  -d '{ "task": "Audit all Supabase RLS policies", "agent": "claude-code", "worktree": true }'

# Pod states: QUEUED → RUNNING → AUTOPILOT → TAKEOVER (human steps in) → DONE
# AUTOPILOT: agent runs until it requests review or completes
# TAKEOVER: you take control of the terminal, then hand back

# Stream pod output
curl http://localhost:3000/api/pods/{id}/stream
```

## MAVIS Delegation Pattern

When MAVIS receives a large goal in Telegram, instead of trying to complete it in one session:

```
1. MAVIS decomposes the goal into N parallel subtasks
2. Each subtask → one AgentsMesh pod (Claude Code agent)
3. Pods run in parallel worktrees — no conflicts
4. Results stream back to MAVIS via webhook
5. MAVIS synthesizes and sends summary to Telegram
```

```typescript
// supabase/functions/mavis-agent/index.ts — delegate to AgentsMesh
async function delegateToAgentsMesh(subtasks: string[]) {
  const MESH_URL = Deno.env.get("AGENTSMESH_URL")!;
  const pods = await Promise.all(subtasks.map(task =>
    fetch(`${MESH_URL}/api/pods`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, agent: "claude-code", worktree: true }),
    }).then(r => r.json())
  ));
  return pods.map(p => p.id);
}
```

## Cost Control

Each pod is one Claude session. Budget: set `max_turns` per pod. Prefer small, well-scoped subtasks over open-ended exploration to keep pod costs predictable.
