# One fallback order everywhere

Every AI chat path will try providers in this order:

**Groq → Gemini → Claude → OpenAI → Grok → Lovable AI Gateway (last)**

## What changes

1. **MAVIS chat, MavisUI, Council, personas, Telegram** (shared cascade, normal and streaming replies):
   - The step where a mode picks its own provider stays as it is (for example, Claude for ARCH/CODEX or Grok for WATCHTOWER).
   - Everything after that follows the new order: Groq, then Gemini, then Claude (Haiku, then Sonnet), then OpenAI, then Grok, then the gateway.
2. **Agent mode**: each lane keeps the provider it picks first (code and CRUD start with Claude, realtime with Grok, reasoning with OpenAI). The providers after it follow the new order. If you pick a provider by hand, it still goes first. The default lane starts with Groq.
3. The comments describing the order get updated so they match the new order.

## Kept as-is
- Live voice stays Gemini-only, since only Gemini offers a live voice connection.
- Image and video generation chains are not touched.
- A provider that is out of credits or rate-limited is still skipped for a while.

## Technical details
- `_shared/providers.ts`: reorder `callWithFallback` and `callWithFallbackStream`. Leave the primary-mode tier where it is now, and order the remaining tiers groq → gemini → claude-haiku → claude-sonnet → openai → grok → lovable.
- `mavis-agent/index.ts`: each lane keeps its first provider, followed by the rest of `groq, gemini, anthropic, openai, grok`, with `gateway` last.
- Redeploy everything that bundles providers.ts: mavis-chat, mavis-agent, mavis-persona-router, mavis-council-session, telegram-webhook, mavis-task-executor, mavis-telegram-bot.
- Verify with a streamed mavis-chat test, an agent test, and the `[fallback]` log lines to check the order.
