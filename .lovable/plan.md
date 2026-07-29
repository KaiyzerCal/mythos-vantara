## Goal
Agent mode in MAVIS chat should feel as fast as normal chat, stop sitting on "thinking" for long stretches, and stop erroring mid-action.

## What I found (verified in code)

`supabase/functions/mavis-agent/index.ts` runs the tool loop. Four concrete latency/error sources:

1. **Tool results are sent wrong to the default provider.** The loop is written for Anthropic's block format. When the provider is the gateway (`google/gemini-3.6-flash`, the default first provider), `gatewayMessages` flattens the assistant tool-call message with `JSON.stringify(part)` and pushes tool results as a **user** message reading `Tool result for <id>: {...}`. The model never receives a real `role:"tool"` response tied to `tool_call_id`, so it frequently re-calls the same tool or reports the action failed. This is the biggest cause of both wasted iterations (slow) and "errors when executing actions".
2. **The `think` tool burns a full round trip.** The system prompt says "THINK FIRST … don't skip this", and `MAX_ITERATIONS = 4`, so a typical request spends one entire model call producing scratchpad text the user never sees, before any real work — then has only 3 iterations left, often ending in the "I hit the agent time limit" message.
3. **Stall failover is slow.** `fetchWithFailover` waits 20s for response headers before moving to the next provider, and the loop has a hard 55s deadline. One stalled call eats a third of the budget.
4. **Heavy pre-flight before the request even starts.** In `src/pages/MavisChat.tsx`, agent mode awaits `dispatchToSpecialist`, then `buildSystemPromptFromSnapshot` (which itself awaits memory context, provider context, and pattern insights) before any network call to the agent — all while the UI shows "Building context…". The server then independently builds `buildSharedTruth`, so the same ground truth is assembled twice per message.

## Changes

**Correct the OpenAI-compatible message shape (main fix)**
- Map the assistant turn to `{ role: "assistant", tool_calls: [...] }` with the real ids, and each tool result to `{ role: "tool", tool_call_id, content }` instead of the flattened user text.
- Keep the Anthropic block format on the Anthropic branch, converting only at request time per provider.

**Cut a round trip out of the loop**
- Make `think` optional: keep the tool but soften the "THINK FIRST / don't skip" instruction to "use `think` only for genuinely multi-step or ambiguous goals".
- Don't count a pure-`think` turn against the iteration budget, and raise `MAX_ITERATIONS` from 4 to 5 so real tool work isn't starved.

**Tighten timing**
- Drop the header timeout from 20s to 8s (a provider that hasn't sent headers in 8s is stalled), keep the 90s total for legitimate long generations.
- Raise the loop deadline from 55s to 75s, and when it trips, return whatever text/tool results already exist plus a short note, rather than discarding them.

**Trim pre-flight in the client**
- Start the `mavis-agent` request without blocking on `dispatchToSpecialist` when no specialist is active (it currently runs regardless).
- Reuse the already-computed system prompt across consecutive messages in the same conversation instead of rebuilding it per send, invalidating it on `refetchAll`.
- Show a live elapsed indicator with the current tool name in the thinking chip so long tool calls read as progress, not a hang.

**Verify**
- Deploy `mavis-agent`, then run agent-mode requests that (a) need one tool, (b) need two chained tools, and (c) need no tool, checking the function logs for repeated identical tool calls and confirming no "hit the agent time limit" message.

## Technical notes
- Files touched: `supabase/functions/mavis-agent/index.ts`, `src/pages/MavisChat.tsx`, and the system-prompt cache in `src/mavis/buildSystemPrompt.ts`.
- No schema changes, no new tables, no new secrets.
- The `AGENT_STREAMING` env kill switch stays intact.
