Deploy only the edge functions that changed in the most recent local commits.

## What changed

Recent commits touched two edge functions:
- `mavis-agent/index.ts` — modified in HEAD~1 and HEAD~2 (latency fixes, provider fallback).
- `mavis-persona-forge/index.ts` — modified in HEAD~1 (provider fallback when Anthropic key is exhausted).

## Plan

1. **Confirm the diff** — verify the exact files and lines changed in the last two commits so we only deploy the functions that need it.
2. **Syntax sanity check** — do a quick TypeScript/Deno parse on both files to catch any obvious breakage before deployment.
3. **Deploy** — deploy `mavis-agent` and `mavis-persona-forge` via `supabase functions deploy`.
4. **Verify** — tail the edge function logs for both functions and/or invoke a quick health check to confirm they are live and responding.

No other code changes are needed for this request.