## What I found (verified in the code)

The main `generate_image` handlers are **already** PromptChan-aware — they don't call ModelsLab directly:

- `supabase/functions/mavis-agent/index.ts` → for `txt2img`/`realtime` it POSTs to `mavis-image-gen`.
- `supabase/functions/mavis-actions/index.ts` (`generate_image` / `image_gen` / `create_image`) → POSTs to `mavis-image-gen`, and maps `nsfw:true` or `provider:"promptchan"`.
- `supabase/functions/mavis-image-gen/index.ts` already has `generateWithPromptchan()` hitting `POST {PROMPTCHAN_API_BASE}/api/external/create` with the `x-api-key` header, selectable via `provider:"promptchan"` or `nsfw:true`.

The exact string you saw — `ModelsLab error: You need to be subscribed to a plan to continue` — is only produced in two places:
- `supabase/functions/mavis-modelslab/index.ts` (line 111)
- `supabase/functions/mavis-video-gen/index.ts` (line 210)

And the callers that still reach ModelsLab for **plain images** are in the Telegram bot:
- `supabase/functions/mavis-telegram-bot/index.ts` ~line 2244 — the generation handler routes `txt2img` to `mavis-modelslab` whenever `MODELSLAB_API_KEY` exists, before ComfyUI or anything else.
- `supabase/functions/mavis-telegram-bot/index.ts` ~line 2340 — `handleYamete` (the NSFW command) hardcodes `mavis-modelslab` with NSFW model IDs.

So: if the failing call came from Telegram, that's the cause. If it came from in-app chat/agent, the cause is instead that the request didn't carry `provider:"promptchan"` and the auto-cascade fell into the ModelsLab step.

## Plan

1. **Telegram bot — image path**: change the `txt2img` route so it calls `mavis-image-gen` (full cascade, PromptChan-capable) instead of `mavis-modelslab`. Keep `mavis-modelslab` only for video / img2img / img2vid workflows, which `mavis-image-gen` can't do.
2. **Telegram bot — `handleYamete`**: repoint it at `mavis-image-gen` with `provider:"promptchan"` so the NSFW command uses your PromptChan key rather than ModelsLab NSFW models. Fall back to the cascade if PromptChan errors.
3. **Cascade ordering fix in `mavis-image-gen`**: when ModelsLab fails with a plan/subscription error, that shouldn't be a dead end — it already falls through, but ModelsLab currently sits ahead of OpenAI/Pollinations. Move the ModelsLab attempt to after OpenAI so a subscription-gated account stops shaping results, and surface the failure in `notes`.
4. **PromptChan host**: the function defaults to `PROMPTCHAN_API_BASE=https://prod.aicloudnetservices.com`. You mentioned `https://promptchan.com`. I'll make the default configurable-first and confirm with a live probe of both hosts using the saved key, then keep whichever answers 200.
5. **Deploy** `mavis-telegram-bot` and `mavis-image-gen`, then test one `generate_image` call with `provider:"promptchan"` and one on auto, and report the `provider` field returned.

## Note

No changes to migrations, and nothing else in the media stack is touched.
