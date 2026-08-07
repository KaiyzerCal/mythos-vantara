---
name: mavis-assistant
description: Use Calvin's real Gmail, Google Calendar, Drive, Docs, Sheets, Slides, Contacts, and Google Business Profile through the mavis-action-executor MCP server. Use when asked to check email, schedule something, find or edit a file, manage tasks, or touch any of these connected tools.
---

# Mavis Assistant — Calvin's personal tool server

This skill documents the MCP server exposed by
`supabase/functions/mavis-action-executor/index.ts` in the mythos-vantara
repo. It's operator-only — every tool call executes against **Calvin's own**
connected Google account, not a generic user's. There is no multi-tenant
concept here; treat every call as high-trust and irreversible unless it's
obviously a read (list/get/search).

## Connecting

Endpoint: the deployed `mavis-action-executor` function URL, using the
Streamable HTTP MCP transport (plain JSON-RPC 2.0 over POST — no SSE
required for single-response calls). Auth: `Authorization: Bearer <token>`
where the token is Calvin's own Supabase access token (same one the app
itself uses to sign in) — the server resolves the calling user from it
and only that user's connected integrations are reachable.

Standard handshake: `initialize` → `tools/list` → `tools/call`.

## Tool categories and when to reach for them

- **Gmail** (`draft_email` — despite the name, sends immediately;
  `get_emails`, `get_email_thread`, `archive_email`, `delete_email`,
  `mark_email`, label tools): treat `delete_email` and `draft_email` as
  irreversible the moment you call them — there's no queue/approval step
  on this path, unlike the app's own in-UI action-approval flow. Confirm
  intent in the conversation before calling either if there's any
  ambiguity about recipient or content.
- **Calendar** (`schedule_event`, `update_event`, `delete_event`,
  `get_availability`, `schedule_meet`): always check `get_availability`
  before proposing a new event time if the user hasn't given an exact
  time — don't guess a slot that conflicts with something already on the
  calendar.
- **Tasks** (`create_task`, `complete_google_task`, `update_google_task`,
  `list_google_tasks`): lightweight, low-risk, safe to use liberally.
- **Drive / Docs / Sheets / Slides**: `trash_file` and `delete_document`
  are real deletes. `share_file` grants real access to a real email
  address — double check the address before calling it.
- **Contacts**: `delete_contact` is permanent. Everything else is safe.
- **Google Business Profile**: `respond_to_review` and
  `create_business_post` are public-facing the moment they're called —
  there's no draft/preview step, so get the wording right before calling.
- **generate_image / generate_video / make_call**: real cost per call
  (image/video generation, actual phone calls). Don't call speculatively
  or to "try something out" — only when the user has actually asked for
  the output.

## General rules

- Never fabricate a tool result. If a call errors, surface the actual
  error message rather than guessing what probably happened.
- If a required field is missing (e.g. no recipient for an email), ask
  rather than inventing a plausible-sounding value — every action here
  touches Calvin's real accounts.
- Prefer the most specific read tool before a write: e.g. `get_emails`
  or `search_contacts` to confirm you have the right target before
  `delete_email` or `update_contact`.
