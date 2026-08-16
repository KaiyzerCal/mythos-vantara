# Standardize free Gemini/provider fallback chain across all edge functions

## Goal
Make every AI call in the backend degrade gracefully through a free/cheap provider cascade instead of failing on a single 402/429/403/500. The canonical order is: free Gemini 2.0 Flash → Gemini 2.0 Flash Lite → Groq Llama 3.3 70B → paid Gemini 2.5 Flash → Claude/OpenAI/Grok.

## Current state
- Only `mavis-chat` uses the shared `_shared/providers.ts` `callWithFallback` / `callWithFallbackStream` cascade.
- `telegram-webhook` has its own hand-rolled cascade that already matches the same intent.
- Many chat/completion functions (`mavis-persona-router`, `mavis-emotion-engine`, `mavis-agent`, `mavis-council-session`, `mavis-council-heartbeat`, `mavis-director`, `mavis-archivist`, `navi-memory-consolidator`, `navi-heartbeat`, `mavis-daily-notes`, `mavis-goal-engine`, `mavis-goal-review`, `mavis-persona-forge`, `mavis-periodic-review`, `mavis-self-reflect`, `mavis-worldmonitor`, `mavis-tacit-prune`, `mavis-ingest`, `agent-telegram-gateway`) call the Lovable AI Gateway directly with a single model and no fallback.
- Some non-chat functions (`mavis-image-gen`, `mavis-video-gen`) already have their own cascades but are inconsistent with the shared provider chain.
- Several functions still call direct provider APIs with no fallback (`mavis-article-extractor`, `mavis-attachment-process`, `mavis-vision-agent`, `mavis-repurpose`, `mavis-demand-scan`, `mavis-calendar-sync`, `mavis-contact-enrich`, `mavis-composio-agent`, etc.).

## Plan

### Phase 1 — Audit
1. Enumerate every edge function that makes an AI call (text chat, image, video, audio, embeddings, extraction, vision).
2. Classify each into one of:
   - already uses shared cascade
   - uses Lovable AI Gateway single-shot
   - uses direct provider API with no fallback
   - has a custom cascade
3. Note which calls require special capabilities (thinking, tool-calling, image generation, large context, structured JSON) that the free tier cannot satisfy.

### Phase 2 — Shared provider upgrade
1. Keep `_shared/providers.ts` as the single source of truth for text chat.
2. Add optional Lovable AI Gateway tier 0 (uses `LOVABLE_API_KEY`) so functions can still prefer workspace credits when configured, but fall back to the project's own free keys if the gateway returns 402/429.
3. Normalize error handling so all provider adapters throw `ProviderUnavailableError` on 401/402/403/429/400 and other errors bubble as 500 only after the cascade is exhausted.
4. Add a non-streaming helper `callWithFallback` and a streaming helper `callWithFallbackStream` (already exist; ensure they are exported and documented).

### Phase 3 — Refactor chat/completion functions
1. For each chat/completion function identified in the audit, replace direct Lovable AI Gateway fetches or single-provider calls with `callWithFallback` / `callWithFallbackStream`.
2. Preserve special behavior:
   - DEEP/thinking modes skip free Gemini 2.0 and go to Gemini 2.5 Flash / Claude.
   - WATCHTOWER/GROUNDED modes keep search grounding.
   - Tool-calling paths (`mavis-agent`) keep the existing tool dispatch; only the underlying model call uses the cascade.
3. Ensure system prompts and message formatting are passed through unchanged.

### Phase 4 — Non-chat fallback cascades
1. **Image generation**: keep `mavis-image-gen` provider picker but guarantee the free/cheap cascade (Lovable Gemini image → direct Gemini Imagen → Pollinations) is always available.
2. **Video generation**: verify `mavis-video-gen` has a free/cheap fallback and add one if missing.
3. **Embeddings**: keep `embed-and-search` on Lovable `google/gemini-embedding-001` with a degraded no-embedding fallback if credits are out.
4. **Article extraction / attachment processing / vision**: add a direct Gemini API fallback before Claude/OpenAI.
5. **Repurpose, demand scan, contact enrich, finance, etc.**: add the shared chat cascade where applicable, or at minimum a Gemini direct fallback.

### Phase 5 — Secrets and environment
1. Verify project secrets/env vars:
   - `GEMINI_API_KEY` (free tier first hop)
   - `GROQ_API_KEY` (free Llama fallback)
   - `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY` (paid fallbacks)
   - `LOVABLE_API_KEY` (optional tier 0)
2. Request any missing secrets via `add_secret` before deployment.

### Phase 6 — Deploy and verify
1. Deploy all modified edge functions.
2. Test key endpoints by forcing a failure (e.g., temporarily invalid Lovable key, rate-limit) and confirm the cascade returns a response instead of 500.
3. Run existing tests and typecheck to ensure no regressions.

## Success criteria
- A single provider failure (402, 429, 403, 401) does not cause a user-facing 500.
- Free Gemini and Groq are attempted before any paid provider in text-chat paths.
- All chat surfaces (MAVIS, personas, council, agent mode, Telegram) share the same resilient fallback behavior.

## Risks / notes
- Some capabilities (thinking, image gen, tool calling) require specific models; the cascade must route those to the correct tier rather than forcing free Gemini 2.0 Flash.
- Lovable AI Gateway usage is currently credit-based; adding it as tier 0 keeps current behavior while the new fallback chain protects against credit exhaustion.
- Streaming endpoints need careful handling so fallback can switch providers mid-response without corrupting the SSE stream.
