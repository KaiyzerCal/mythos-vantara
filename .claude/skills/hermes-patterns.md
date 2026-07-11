# Hermes Agent Patterns — Multi-Platform Messaging & ACP

**Triggers:** `["hermes", "acp", "agent communication protocol", "multi-platform bot", "telegram gateway", "self-improving agent"]`

## What It Is

Hermes is a self-improving Python/FastAPI agent framework with: ACP (Agent Communication Protocol) for multi-agent delegation, a Telegram/Discord/WhatsApp/Signal gateway, procedural memory that grows from experience, cron scheduling, and a skill manifest system.

**GitHub:** `KaiyzerCal/hermes-agent` | **Stack:** Python 3.11+ / FastAPI | **License:** MIT

## ACP — Agent Communication Protocol

ACP enables structured delegation between agents. Pattern: MAVIS receives a request → delegates a subtask to a specialist agent → receives structured result.

```python
# ACP message schema
{
  "from": "mavis",
  "to": "research-agent",
  "intent": "deep_research",
  "payload": {
    "query": "...",
    "depth": "comprehensive",
    "output_format": "markdown"
  },
  "callback_url": "https://<supabase>/functions/v1/mavis-acp-callback"
}
```

Apply this pattern when building new MAVIS edge functions that delegate to sub-agents. Always include a `callback_url` so async results land back in the MAVIS pipeline.

## Telegram Gateway Design

Hermes's Telegram gateway handles what VANTARA already has, but its channel abstraction is the useful pattern:

```python
class Channel:
    name: str          # "telegram" | "discord" | "whatsapp" | "signal"
    send: Callable     # unified send interface
    on_message: Event  # unified receive event

# MAVIS already implements this for Telegram — extend to Discord/WhatsApp
# by following the same channel abstraction used in hermes-agent's gateway/
```

## Skill Manifest Schema

Hermes defines agent capabilities in a `skills.yaml` manifest:

```yaml
skills:
  - name: research
    description: "Deep research on any topic"
    trigger_keywords: ["research", "find", "look up", "what is"]
    parameters:
      - name: query
        type: string
        required: true
    timeout_seconds: 60

  - name: summarize
    description: "Summarize a document or URL"
    trigger_keywords: ["summarize", "tldr", "brief"]
    parameters:
      - name: source
        type: string
        required: true
```

Apply this schema when adding new MAVIS capabilities — document each one in a manifest format so the routing logic can be made declarative rather than a growing switch statement.

## Procedural Memory — Self-Improvement Loop

After each interaction, Hermes stores an episode:

```python
{
  "input": "user message",
  "output": "agent response",
  "outcome": "success|failure|correction",
  "feedback": "optional correction text",
  "timestamp": "...",
}
```

MAVIS already has `mavis_tacit` for corrections. The Hermes pattern adds: episode replay during fine-tuning, outcome tagging, and automatic skill weight adjustment. Apply this by adding `outcome` tracking to `mavis_memory` rows.

## Cron Scheduling Pattern

```python
@agent.cron("0 8 * * *")  # 8am daily
async def morning_routine(agent: HermesAgent):
    brief = await agent.run_skill("morning_brief")
    await agent.send("telegram", brief)
```

MAVIS already has Supabase crons for dreaming/consolidation. Use the same 30-minute stagger pattern (Hermes recommends this) to avoid DB contention between cron jobs.
