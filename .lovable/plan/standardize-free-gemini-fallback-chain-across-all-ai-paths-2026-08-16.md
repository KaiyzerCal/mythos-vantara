# Standardize Free Gemini Fallback Chain Across All AI Paths

## Goal
Make the free Gemini/Groq/Lovable credit fallback chain apply to **every** AI call in the edge functions, not just chat/text. Right now image and video generation call providers directly without a free-tier cascade.

## Current State
- `supabase/functions/_shared/providers.ts` has a robust text/chat cascade (free Gemini 2.0 Flash → Flash Lite → Groq → Lovable Gateway → paid tiers).
- `mavis-image-gen` and `mavis-video-gen` bypass that cascade: they fetch providers directly (FLUX, ModelsLab, Imagen 4, OpenAI, PromptChan, fal.ai, Kling, Runway, etc.) and fail hard if keys are missing or credits exhausted.
- Vision, audio, and embedding functions may still have direct provider calls too.

## Scope
1. Audit all media and non-chat AI functions:
   - `mavis-image-gen`
   - `mavis-video-gen`
   - Any vision functions (e.g., `mavis-vision`, `mavis-ocr`, `mavis-file-analysis`)
   - Any audio/TTS/STT functions
   - Embedding functions (`embed-and-search` already uses gateway; verify consistency)
2. Extend `supabase/functions/_shared/providers.ts` with media-specific helpers:
   - `generateImageCascade(prompt, opts)` — returns `{ url, provider }` trying free/gateway tiers first.
   - `generateVideoCascade(prompt, opts)` — returns `{ url, provider, request_id? }` with free/gateway tiers first.
   - Keep explicit provider override (`provider: "flux"`, `provider: "promptchan"`, etc.) so the UI picker still works.
3. Refactor `mavis-image-gen` and `mavis-video-gen` to delegate generation to the shared cascade while preserving the existing provider selection UI and NSFW-capable paths.
4. Ensure every helper returns a `provider` string and notes array so the frontend can display which provider produced the result.

## Technical Approach
- Add free image/video lanes to `_shared/providers.ts`:
  - Lovable AI Gateway image/video endpoints (`google/gemini-3.1-flash-image`, `google/veo-3.1-lite`, etc.) as the first credit-backed tier.
  - Free Gemini/Imagen when a direct `GEMINI_API_KEY` is present.
  - Pollinations free image fallback as a zero-cost safety net.
  - Existing paid keys (FLUX, ModelsLab, OpenAI, fal.ai, Kling, Runway, PromptChan) as the final tier.
- Each tier throws `ProviderUnavailableError` on 401/402/403/429 so the cascade can continue.
- Preserve `provider` request body field: if the user picks a specific provider, the cascade skips straight to that provider instead of trying free tiers first.
- Keep NSFW/explicit paths explicitly opt-in (`nsfw: true` or `provider: "promptchan"`) and do not silently route ordinary requests there.
- Maintain async polling/polling URLs for video providers that need them.

## Deployment
- Redeploy any refactored edge functions after changes.
- Verify each function still returns the expected response shape and `provider` field.

## Verification
- Generate an image with `provider: "auto"` and confirm it succeeds via a free/gateway tier.
- Generate a video with `provider: "auto"` and confirm it falls through correctly.
- Explicitly pick FLUX, PromptChan, and OpenAI providers and confirm they still work.
- Confirm no regressions in the chat/text cascade.
