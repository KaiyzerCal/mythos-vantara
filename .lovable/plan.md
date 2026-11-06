# One fallback order everywhere

Every AI chat path will try providers in this order:

**Groq → Gemini → Claude → OpenAI → Grok → Lovable AI Gateway (last)**

## What changes

1. **MAVIS chat, MavisUI, Council, personas, Telegram** (shared cascade, normal and streaming replies):
   - The step where a mode picks its own provider stays as it is (for example, Claude for ARCH/CODEX or Grok for WATCHTOWER).
   - Everything after that follows the new order: Groq, then Gemini, then Claude (Haiku, then Sonnet), then OpenAI, then Grok, then the gateway.
2. **Agent mode**: each lane keeps the provider it picks first (code and CRUD start with Claude, realtime with Grok, reasoning with OpenAI). The providers after it follow the new order. If you pick a provider by hand, it still goes first. The default lane starts with Groq.
3. The comments describing the order get updated so they match the new order.

4. **Live voice backups** (voice overlay):
   - Gemini live voice is tried first.
   - If Gemini fails to connect or drops, the overlay switches to OpenAI live voice.
   - If OpenAI also fails, it falls back to turn-by-turn voice: your speech becomes text, the reply comes through the normal fallback order above (Groq, Gemini, Claude, OpenAI, Grok, gateway), and the reply is read aloud.
   - A small label shows which voice mode is active.

## Kept as-is
- Image and video generation chains are not touched.
- A provider that is out of credits or rate-limited is still skipped for a while.

## Technical details
- `_shared/providers.ts`: reorder `callWithFallback` and `callWithFallbackStream`. Leave the primary-mode tier where it is now, and order the remaining tiers groq → gemini → claude-haiku → claude-sonnet → openai → grok → lovable.
- `mavis-agent/index.ts`: each lane keeps its first provider, followed by the rest of `groq, gemini, anthropic, openai, grok`, with `gateway` last.
- `mavis-live-voice`: add an OpenAI Realtime path (OPENAI_API_KEY, gpt-4o-realtime, PCM16) when the Gemini socket errors or closes during setup. `VoiceChatOverlay`: on a final socket failure, switch to record → existing speech-to-text → mavis-chat stream → mavis-tts.
- Redeploy mavis-live-voice, plus everything that bundles providers.ts: mavis-chat, mavis-agent, mavis-persona-router, mavis-council-session, telegram-webhook, mavis-task-executor, mavis-telegram-bot.
- Verify with a streamed mavis-chat test, an agent test, and the `[fallback]` log lines to check the order.
