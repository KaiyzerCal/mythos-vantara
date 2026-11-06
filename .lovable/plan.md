# One fallback order everywhere

Every AI chat path will try providers in this order:

**Groq → Gemini → Claude → OpenAI → Grok → Lovable AI Gateway (last)**

## What changes

1. **MAVIS chat, MavisUI, Council, personas, Telegram** (shared cascade, normal and streaming replies):
   - Groq moves ahead of Gemini.
   - The "mode picks its own provider first" step goes away (for example, Claude for ARCH/CODEX or Grok for WATCHTOWER), so every mode uses the same order.
   - Claude is tried before OpenAI: Haiku first, then Sonnet, still inside the Claude slot.
   - The gateway stays last.
2. **Agent mode**: all six lanes (default, code, CRUD, realtime, reasoning, generation) switch to the same single order. If you pick a provider by hand, it still goes first and the rest follow this order.
3. The comments describing the order get updated so they match the new order.

## Kept as-is
- Live voice stays Gemini-only, since only Gemini offers a live voice connection.
- Image and video generation chains are not touched.
- A provider that is out of credits or rate-limited is still skipped for a while.

## Technical details
- `_shared/providers.ts`: reorder `callWithFallback` and `callWithFallbackStream`. Drop the `premiumFirst` and primary-mode tiers, and drop Groq's DEEP-mode skip so Groq is always first.
- `mavis-agent/index.ts`: replace each `PROVIDER_LANES` entry with `["groq","gemini","anthropic","openai","grok","gateway"]`.
- Redeploy everything that bundles providers.ts: mavis-chat, mavis-agent, mavis-persona-router, mavis-council-session, telegram-webhook, mavis-task-executor, mavis-telegram-bot.
- Verify with a streamed mavis-chat test, an agent test, and the `[fallback]` log lines to check the order.
