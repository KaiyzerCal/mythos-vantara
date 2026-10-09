# Show agent provider routing on every response

## Confirmed current state

- Agent mode already records every provider attempt in backend logs, but the response only returns the final provider and lane.
- The chat client receives that final provider in both streamed and non-streamed responses.
- One agent-mode send path currently drops the provider before rendering, while the other can display only the final provider beside the mode.
- Skipped and failed tiers are not returned to the chat, so the interface cannot show the actual cascade.

## Implementation

1. Collect a small routing trace during each agent loop: provider, outcome (`served`, `failed`, or `skipped`), and HTTP status when available.
2. Return that trace with streamed and non-streamed agent responses, without exposing API keys or full provider error bodies.
3. Carry the trace into the finalized assistant message in both agent-mode send paths.
4. Add a compact label beneath each agent response showing the serving provider and the preceding skipped/failed tiers in cascade order, for example: `GEMINI served · GROQ skipped · ANTHROPIC skipped`.
5. Preserve the label for the current in-memory thread; keep database schema and stored message content unchanged.
6. Add focused tests for cascade ordering and safe response metadata, then deploy `mavis-agent` and verify a real agent response displays the provider path.

## Technical scope

- Change only `mavis-agent`, agent response parsing/types, the MAVIS chat response display, and focused tests.
- Keep provider order, fallback behavior, models, keys, and credit usage unchanged.
- Do not include raw error bodies in the visible label; status codes are sufficient for failed tiers.