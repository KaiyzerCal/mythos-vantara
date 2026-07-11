# OpenClaude — Multi-Provider Agent CLI with gRPC Server

**Triggers:** `["openclaude", "multi-provider", "model routing", "grpc agent", "cheap agents", "ollama routing", "deepseek routing"]`

## What It Is

OpenClaude is a fork of Claude Code refactored into a multi-provider coding-agent CLI. Supports OpenAI, Gemini, DeepSeek, Ollama, and 200+ models via unified interface. Key addition over Claude Code: gRPC headless server mode for programmatic agent execution.

**GitHub:** `KaiyzerCal/openclaude` | **License:** MIT

## Provider Switching

```bash
# Default (Claude)
openclaude run "fix the bug in index.ts"

# Switch provider on the fly
openclaude --provider ollama --model llama3.2 "quick refactor"
openclaude --provider deepseek --model deepseek-coder "write unit tests"
openclaude --provider openai --model gpt-4o-mini "summarize this file"
```

## Agent Routing Config (`.openclaude.json`)

```json
{
  "default_provider": "anthropic",
  "routing_rules": [
    {
      "task_type": "quick_edit",
      "provider": "deepseek",
      "model": "deepseek-coder",
      "max_tokens": 2048
    },
    {
      "task_type": "architecture",
      "provider": "anthropic",
      "model": "claude-opus-4-8",
      "max_tokens": 8192
    },
    {
      "task_type": "test_generation",
      "provider": "ollama",
      "model": "codellama:7b"
    }
  ]
}
```

Apply this routing pattern inside `telegram-webhook/index.ts` — the `callClaude()` cascade already does something similar but ad-hoc. A declarative routing config makes it maintainable.

## gRPC Headless Server

Run OpenClaude as a persistent server that accepts tasks programmatically:

```bash
# Start the gRPC server
openclaude server --port 50052 --provider anthropic

# Call it from a Deno edge function
```

```typescript
// supabase/functions/mavis-agent/index.ts — delegate lightweight tasks
async function runAgentTask(task: string, tier: "cheap" | "full"): Promise<string> {
  const OPENCLAUDE_URL = Deno.env.get("OPENCLAUDE_GRPC_URL")!;
  const provider = tier === "cheap" ? "deepseek" : "anthropic";
  
  const res = await fetch(`${OPENCLAUDE_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, provider }),
  });
  return (await res.json()).result ?? "";
}
```

## Session Management

```bash
# Fork a session at a decision point
openclaude fork --session-id abc123 --label "approach-A"

# Resume a session
openclaude resume --session-id abc123

# Background execution (returns immediately, streams results via webhook)
openclaude run --background --webhook https://... "long running task"
```

## VS Code Extension

```json
// .vscode/settings.json
{
  "openclaude.provider": "anthropic",
  "openclaude.fallback_provider": "deepseek",
  "openclaude.budget_per_session": 0.50
}
```

## When to Use vs. Native Claude Code

| Scenario | Use |
|---|---|
| Normal MAVIS development | Native Claude Code (this session) |
| Bulk/batch tasks (50+ files) | OpenClaude gRPC server + cheap provider |
| Local/offline work | OpenClaude + Ollama |
| Cost-sensitive background jobs | OpenClaude + DeepSeek |
| Architecture decisions | Native Claude Code (Claude Opus) |
