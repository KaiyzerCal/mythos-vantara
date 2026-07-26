# Full App Audit & Polish — MAVIS Ultimate Copilot

Goal: end-to-end sweep so the app runs smooth, feels premium, and every surface earns its place as your personal AI copilot.

## Track 1 — Health & Stability Audit (read-only first)
- Map every route in `src/App.tsx` → confirm each page mounts, has data wiring, loading/empty/error states, and no dead links.
- Sidebar audit (`AppSidebar.tsx`): remove stale entries, group by domain (Command, Intelligence, Studio, Ops, Settings), add icons + section labels.
- Console + network sweep on each major page; log runtime errors, 404s, RLS denials, slow edge calls.
- Edge function health: ping the 12 most-used functions (`mavis-chat`, `mavis-agent`, `mavis-actions`, `mavis-image-gen`, `mavis-video-gen`, `mavis-autonomy-orchestrator`, `mavis-persona-router`, `mavis-telegram-bot`, `mavis-health-check`, `mavis-a2a-gateway`, `mavis-llm-router`, `mavis-action-executor`). Fix any 4xx/5xx.
- Type/build check across the project; resolve any remaining TS noise.

## Track 2 — UX Polish Sweep (consistent, premium feel)
- Global primitives everywhere: `LoadingState`, `EmptyState`, `ErrorState`, `ScrollKit` — replace every raw `Loader2` / "Loading…" / bare error toast.
- Card system: unify padding, radius, border, hover elevation. Kill hardcoded `zinc-*`, `text-white`, `bg-black`; enforce semantic tokens.
- Typography rhythm: Orbitron for section headers, Rajdhani body, Share Tech Mono for data — audit for accidental default sans.
- Motion pass: `animate-fade-in` on route mount, `hover-scale` on interactive cards, subtle `pulse-glow` on live/streaming indicators, `scan` overlay only on hero HUD panels (not everywhere).
- Light-mode contrast pass on all pages — anything reported invisible in light theme gets a token fix.
- Mobile pass: sidebar sheet, 44px tap targets, `h-dvh` for full-height views.
- Focus states + keyboard nav on primary CTAs.

## Track 3 — Command Surface Upgrades
- **MavisChat**: message actions (copy/retry/branch) via AI Elements `MessageResponse`, tool-call accordions, slash-command palette (`/autonomy`, `/persona`, `/council`, `/image`, `/video`, `/search`), sticky composer with attachment tray already present — polish spacing + focus retention.
- **Dashboard**: reorder to Today → Autonomy pulse → Inbox digest → Streaks → Quick actions. Replace static tiles with live counts.
- **Autonomy**: add plan progress bars, step-level status chips, "approve/pause/cancel" inline controls, empty state that offers a starter goal.
- **Command Palette** (`Cmd+K`): ensure it lists every route + top actions; wire fuzzy search across personas, councils, quests.

## Track 4 — Intelligence & Studio Polish
- **IntelligencePage**: convert stat tiles to sparkline cards; group by domain (Signals / World Model / Patterns / Health).
- **Gallery / Creative Studio**: masonry grid, hover overlay with prompt + provider badge, one-click "remix" and "animate this image", provider fallback status chip.
- **Avatar Studio**: template gallery hero, generation queue side rail.
- **Personas / Councils**: hero avatar strip, unread badge, last-message preview, realtime typing indicator.

## Track 5 — Ops & Safety
- Verify RLS + grants on any table touched during audit; run linter, resolve warnings.
- Confirm all persistence: Mavis chat, personas, councils, quests, inventory, forms, gallery, autonomy — reload each and verify data survives.
- Verify Telegram bridge round-trip for MAVIS, personas, councils.

## Deliverable
- Short audit report at the end (what was found + fixed).
- All fixes shipped in the same run — no half-done tracks.

## Non-goals
- No NSFW capabilities.
- No new backend features beyond what's needed to fix broken wiring.
- No framework/library swaps.

## Notes
Executed as one continuous sweep. If a track uncovers a bigger issue (e.g. a broken edge function), it gets fixed inline, not deferred.
