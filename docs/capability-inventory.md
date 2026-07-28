# MAVIS Capability Inventory

Generated: 2026-07-27, Execution Blueprint Stage B (session 1, continued).
Static analysis only — live `cron.job` table, live Supabase secrets, and
live deploy status remain unverified pending Supabase MCP access. Where
this table says "not verified," that's the reason.

**How to read the table**: `Frontend?`/`Other functions?` are grep-verified
call sites (see methodology below — false positives filtered, dynamic call
sites resolved by hand where possible). `Cron/webhook?` marks `cron` (a real
`cron.schedule()` target found in migrations) or `webhook` (`verify_jwt =
false` in `config.toml`) or `-` (neither). `Compiles clean?` is a real,
verified fact — every one of the 314 functions was esbuild-bundled this
session with zero failures (catches syntax errors and broken imports,
not Deno-runtime-only issues). `Env vars set?` is **not verified** for any
row — that requires live Supabase secrets access, which is blocked.

**Status legend**: `ACTIVE` (has a real frontend or backend caller) ·
`CRON-ONLY` (cron target, no other caller) · `WEBHOOK` (verify_jwt=false,
webhook-shaped name, no other caller) · `WEBHOOK?` (verify_jwt=false but
not obviously webhook-named — needs a human look, not a firm verdict) ·
`ORPHANED` (no frontend/backend caller, not a cron target, requires JWT —
genuinely no invocation path found) · `NEEDS-DECISION` (`mavis-yamete`,
per the blueprint's explicit instruction — untouched, flagged only).

**Status counts**: 276 ACTIVE · 13 ORPHANED · 10 WEBHOOK · 8 CRON-ONLY ·
6 WEBHOOK? · 1 NEEDS-DECISION (314 total). (Corrected post-publish:
`mavis-attachment-process` was a false negative in the automated caller
sweep — genuinely called from `useChatAttachments.ts`, moved from
WEBHOOK? to ACTIVE.)

---

## Key findings (read this before the table)

### 1. Two real security gaps found and already fixed this session
- **`mavis-stripe-webhook` had zero signature verification** — any POST to
  its URL with a fake `invoice.paid`/`payment_intent.succeeded` body would
  be accepted as real revenue and trigger the client welcome sequence, with
  an arbitrary `user_id`. Fixed: added the same HMAC-SHA256 check
  `stripe-widget-webhook` already used, gated on `STRIPE_WEBHOOK_SECRET`.
- **`mavis-gumroad-webhook`'s seller-ID check silently no-op'd** when
  `GUMROAD_SELLER_ID` wasn't set. Gumroad's own Ping webhooks don't support
  HMAC signing (unlike Stripe) so seller-ID comparison genuinely is the
  best verification available — but the silent skip violated the "no
  silent fallback" ground rule. Now logs `fallback_triggered` to
  `mavis_events` when skipped, so a missing secret doesn't stay invisible.
- Both committed and pushed already (`929bd8a`).

### 2. Three more webhook-shaped functions look genuinely dead
`mavis-gmail-webhook`, `mavis-inbound-webhook`, `mavis-webhook-calendar` —
all three: named as inbound webhook receivers, **no** frontend or backend
caller found anywhere, **and** `verify_jwt = true` (which would reject a
real external webhook POST, since external services can't supply a
Supabase user JWT). Read together, this pattern says "abandoned/superseded
receiver," not "secure by default" — worth Stage D triage rather than
leaving alone. (`mavis-webhook-dispatcher` was in the same raw list but is
a false alarm — it's internally called by `mavis-task-executor` and its
name means it *sends* outbound webhook calls, not receives them, so
requiring a JWT is correct there.)

### 3. cron.schedule() reconciliation — 0 dead targets, but real scheduling issues
Every literal `functions/v1/<name>` target across all migrations resolves
to a real function directory — no renamed/deleted function is still being
cron-targeted. But:
- **`20260625000002_trigger_engine_5min.sql`** (the current 5-minute
  `mavis-trigger-engine` job) looks up a vault secret named
  `SERVICE_ROLE_KEY`, while the 10-minute job it replaced used
  `SUPABASE_SERVICE_ROLE_KEY`. If the vault secret is actually named
  `SUPABASE_SERVICE_ROLE_KEY` (which is the name used everywhere else in
  this codebase), the 5-minute registration silently never happened. A
  later migration (`20260720112103`) separately registered a third,
  differently-named job for the same function (`mavis-trigger-engine`,
  every 10 minutes, anon-key auth) — so the pathway is likely still
  running, just at half the intended frequency with weaker auth than
  every other cron-triggered internal function. **Fixed**:
  `supabase/migrations/20260728000000_fix_trigger_engine_cron.sql`
  consolidates all three possible job-name variants down to one, correct,
  5-minute, service-role-authenticated registration. Not yet applied —
  same caveat as below.
- **`mavis-proactive-nudge` has two different schedules registered through
  two different mechanisms**: a real, working `cron.schedule()` at
  `0 12 * * *`, and a separate `mavis_cron_config` table row intending
  `0 */4 * * *` — see next finding for why the second one likely never
  fired, but if it ever does get activated there'd be two competing
  schedules for the same function.
- **A whole parallel scheduling tier silently never activated — now fixed.**
  A `mavis_cron_config` table (seeded across 8 migrations) was meant to be
  turned into real `cron.job` entries by `mavis-cron-setup` calling an RPC
  (`cron_schedule`) that **did not exist until `20260720000000`**. Six
  functions were confirmed to have *only* ever been scheduled through this
  table-driven path, with no direct `cron.schedule()` anywhere else:
  `mavis-capability-audit`, `mavis-health-monitor`, `mavis-learning-engine`,
  `mavis-archivist`, `mavis-goal-judge`, `mavis-user-model-refresh` — these
  have likely never run on a schedule at all, silently, this whole time.
  (`mavis-so-curator`, `mavis-proactive-nudge`, `mavis-goal-review`, and
  `mavis-autonomous-engine` also had table-driven entries, but all four
  turned out to have a separate, real `cron.schedule()` registration
  elsewhere too, so they're fine.) **Fixed**: `supabase/migrations/
  20260728000001_activate_stranded_cron_jobs.sql` registers all six
  directly, using each one's originally-intended schedule/payload. Not yet
  applied to the live project — needs `supabase db push` (or however
  migrations reach this project) and, ideally, a live confirmation once
  Supabase MCP access is unblocked.

### 4. mavis-goal-review's triple-definition conflict — resolved statically
Chronological reconstruction (full detail in `EXECUTION-PROGRESS.md`
findings log): the 2026-05-16 definition was a commented-out template
(never ran); the 2026-06-02 definition went through the broken
`mavis_cron_config` path above (never activated); a same-named-but-
functionally-different `mavis-goal-review-seed` job from 2026-06-16 is a
task-queue seeder, not this function, and isn't actually the same job
despite the confusing shared name. **The real, currently-live registration
is the latest one, `20260720112103`**: Monday 09:00 UTC, calling
`POST /functions/v1/mavis-goal-review`. One more oddity worth flagging:
that registration authenticates with the **anon key**, not the
service-role key — every other `net.http_post`-based cron job in the repo
uses the service-role key. Not necessarily broken (the function may accept
anon-key calls deliberately), but inconsistent enough to be worth a
deliberate look rather than assuming it's fine. Live `cron.job` table
confirmation still needed to be certain this is what's actually running.

### 5. mavis_tasks seeded task types — clean, no mismatch
All 6 types ever seeded by a migration (`daily_brief`, `check_idle_quests`,
`demand_scan`, `nora_tweet`, `revenue_snapshot`, `goal`) have a matching
handler in `mavis-task-executor`'s `HANDLERS` dispatch object. No
silently-failing seeded pathway exists at this level. (Correcting one
assumption baked into the blueprint's own wording: the executor's
top-level dispatch is a `HANDLERS` lookup object, not a `switch` — the
`switch` in the file only handles goal-plan *sub-steps*, a different,
narrower thing.)

### 6. Autonomy/proactive pathway classification
| Pathway | Classification |
|---|---|
| mavis-goal-review | CONNECTED |
| mavis-autonomous-engine | CONNECTED |
| mavis-trigger-engine | CONNECTED |
| mavis-signal-watcher | CONNECTED |
| mavis-proactive-agent | **PARTIAL/BROKEN** — despite the name, has no cron/autonomous trigger anywhere; only reachable via a manual dashboard button or a chat keyword match. Not actually autonomous today. |
| mavis-proactive-nudge | CONNECTED |
| mavis-streak-alerts | CONNECTED, but no outcome record (fires a Telegram message and nothing else — no row anywhere records that it ran) |
| mavis-quest-nudge | CONNECTED, same no-outcome-record caveat as streak-alerts |
| Standing orders (`mavis-so-scheduler` → `mavis-task-executor`'s `handleStandingOrder`) | CONNECTED — the best-instrumented pathway found: real trigger → queue → execute → outcome state on both ends |

### 7. The self-improvement loop is not actually connected to outcomes
`mavis_outcome_events` (the table the whole outcome-tracking/self-evolution
system is meant to learn from) **has no producer anywhere in the
codebase.** Its only write path (`action: "record"`) is never called by
anything. The one frontend caller that exists sends a different,
non-matching payload shape and silently falls through to a no-op check
instead. In practice this table is always empty. `mavis-self-evolve` does
genuinely query it (real code, real intent) but gets nothing back — one
broken leg on an otherwise-real function, not a fake system. `mavis-goal-
review` and `mavis-proactive-agent` output isn't read by
outcome-tracker/self-reflect/self-improve/self-evolve at all — the
intended "act → observe outcome → learn" loop is not wired, despite every
individual piece existing in code.

---

## Full function table

| Function | Frontend? | Other functions? | Cron/webhook? | Compiles clean? | Env vars set? | Status |
|---|---|---|---|---|---|---|
| agent-telegram-gateway | No | No | webhook | Yes | not verified | **WEBHOOK?** |
| embed-and-search | Yes: proactiveRecall.ts | No | - | Yes | not verified | **ACTIVE** |
| local-mesh-proxy | No | No | webhook | Yes | not verified | **WEBHOOK?** |
| mavis-a2a-gateway | No | No | webhook | Yes | not verified | **WEBHOOK?** |
| mavis-a2a | No | No | - | Yes | not verified | **ORPHANED** |
| mavis-achievement-check | Yes: index.ts | Yes: mavis-chat | webhook | Yes | not verified | **ACTIVE** |
| mavis-action-executor | Yes: AgentDashboardPage.tsx | Yes: mavis-agent, mavis-telegram-bot, telegram-webhook | - | Yes | not verified | **ACTIVE** |
| mavis-actions | Yes: GoalsPage.tsx, Inbox.tsx, MavisChat.tsx, MavisDemo.tsx | Yes: mavis-a2a, mavis-agent, mavis-chat, mavis-council-heartbeat, mavis-director, mavis-heartbeat, mavis-mcp, mavis-persona-router, mavis-task-executor, mavis-webhook, telegram-webhook | - | Yes | not verified | **ACTIVE** |
| mavis-agent-builder | Yes: AgentBuilderSection.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-agent-identity | No | No | - | Yes | not verified | **ORPHANED** |
| mavis-agent-reach | Yes: AgentReachPage.tsx, specialistDispatcher.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-agent-serve | Yes: AgentBuilderSection.tsx | Yes: mavis-agent-builder, prymal-widget-loader | webhook | Yes | not verified | **ACTIVE** |
| mavis-agent | Yes: AgentConsole.tsx, FeaturePages.tsx, PersonaChat.tsx, chatService.ts | Yes: mavis-campaign-runner, mavis-gmail-webhook, mavis-goal-agent, mavis-mcp-server, mavis-orchestrator, mavis-telegram-bot, mavis-trigger-engine, telegram-webhook | - | Yes | not verified | **ACTIVE** |
| mavis-airtable-agent | Yes: AirtablePage.tsx, index.ts | Yes: mavis-agent, mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-ambient-monitor | Yes: SystemHealthPage.tsx | No | cron | Yes | not verified | **ACTIVE** |
| mavis-announce | Yes: index.ts | Yes: mavis-task-executor | webhook | Yes | not verified | **ACTIVE** |
| mavis-api-gateway | Yes: ApiKeysPage.tsx | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-apify | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-archivist | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-article-extractor | Yes: NotebookPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-arxiv | Yes: KnowledgeGraph.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-attachment-process | Yes: useChatAttachments.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-auto-journal | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-autonomous-actions | No | No | cron | Yes | not verified | **CRON-ONLY** |
| mavis-autonomous-engine | No | Yes: mavis-autonomy-orchestrator | webhook | Yes | not verified | **ACTIVE** |
| mavis-autonomous-runner | Yes: SystemHealthPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-autonomy-orchestrator | Yes: AutonomyPage.tsx, MavisChat.tsx | No | - | Yes | not verified | **ACTIVE** |
| mavis-avatar-video | Yes: AvatarStudioPage.tsx, index.ts | Yes: mavis-actions, mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-beehiiv-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-blotato | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-booking | Yes: index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-brain-consolidate | Yes: index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-brand-voice | Yes: index.ts, specialistDispatcher.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-browser-agent | Yes: AgentConsole.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-browser | Yes: index.ts, stagehandPlugin.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-calendar-agent | Yes: index.ts | Yes: mavis-booking, mavis-heartbeat, mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-calendar-manage | No | Yes: mavis-director | - | Yes | not verified | **ACTIVE** |
| mavis-calendar-sync | Yes: HealthPage.tsx, index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-calendly-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-campaign-runner | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-capability-audit | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-causal-engine | Yes: SystemHealthPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-chain-builder | Yes: ContentPages.tsx, FeaturePages.tsx, GoalsPage.tsx, index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-chat | Yes: CodeStudioPage.tsx, FeaturePages.tsx, Inbox.tsx, SystemSettingsPage.tsx, _registry.ts, chatService.ts, commandMesh.ts, index.ts, useInlineCompose.ts | Yes: mavis-api-gateway, mavis-autonomous-engine, mavis-finance, mavis-skill-catalog, mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-code-agent | Yes: CodeStudioPage.tsx, MavisChat.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-code-delegate | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-code-deploy | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-code-exec | Yes: AgentConsole.tsx, CodeStudioPage.tsx, index.ts, specialistDispatcher.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-comfyui | No | Yes: mavis-action-executor, mavis-telegram-bot | webhook | Yes | not verified | **ACTIVE** |
| mavis-comic-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-competitor-monitor | Yes: CompetitorIntelPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-compound-learning | Yes: SystemHealthPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-computer-use | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-consolidate | No | Yes: mavis-task-executor | cron | Yes | not verified | **ACTIVE** |
| mavis-contact-enrich | No | Yes: mavis-telegram-bot | - | Yes | not verified | **ACTIVE** |
| mavis-content-pipeline | Yes: index.ts, specialistDispatcher.ts | Yes: mavis-director | - | Yes | not verified | **ACTIVE** |
| mavis-context-scout | Yes: MavisChat.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-council-heartbeat | No | Yes: telegram-webhook | cron | Yes | not verified | **ACTIVE** |
| mavis-council-session | Yes: CouncilGroupVoice.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-crew-orchestrator | Yes: AgentConsole.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-critic-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-crm-agent | Yes: index.ts, specialistDispatcher.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-crm-nudge | No | No | cron | Yes | not verified | **CRON-ONLY** |
| mavis-cron-setup | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-daily-notes | Yes: index.ts | Yes: telegram-webhook | cron | Yes | not verified | **ACTIVE** |
| mavis-data-export | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-deep-research | Yes: chatService.ts, index.ts | Yes: mavis-chat | - | Yes | not verified | **ACTIVE** |
| mavis-demand-scan | Yes: index.ts | Yes: mavis-task-executor, telegram-webhook | webhook | Yes | not verified | **ACTIVE** |
| mavis-demo | No | No | webhook | Yes | not verified | **WEBHOOK?** |
| mavis-deploy | Yes: WebsiteBuilderPage.tsx, index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-design-engine | Yes: designEngine.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-design-system-gen | Yes: DesignStudio.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-device-bridge | No | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-director | Yes: index.ts | Yes: mavis-autonomous-runner | - | Yes | not verified | **ACTIVE** |
| mavis-discord-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-discourse-runner | Yes: CouncilBoard.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-doc-extract | Yes: ContentPages.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-dream | No | No | cron | Yes | not verified | **CRON-ONLY** |
| mavis-e2b-sandbox | Yes: index.ts | Yes: mavis-code-agent | - | Yes | not verified | **ACTIVE** |
| mavis-email-inbound | No | No | webhook | Yes | not verified | **WEBHOOK** |
| mavis-email-send | Yes: EmailPage.tsx, index.ts | Yes: mavis-director, mavis-task-executor, mavis-workflow-run | - | Yes | not verified | **ACTIVE** |
| mavis-email-triage | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-emotion-engine | Yes: index.ts, usePersona.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-emotion-tag | Yes: index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-entity-graph | Yes: SystemHealthPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-eval | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-event-dispatcher | No | No | cron | Yes | not verified | **CRON-ONLY** |
| mavis-event-router | No | No | - | Yes | not verified | **ORPHANED** |
| mavis-exa-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-expense-categorize | Yes: FinancePage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-finance | Yes: specialistDispatcher.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-fine-tune-export | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-firecrawl-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-flashcard-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-flowise | Yes: MavisChat.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-form-submit | Yes: index.ts | Yes: mavis-web-builder | webhook | Yes | not verified | **ACTIVE** |
| mavis-galaxy-ring | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-gcontacts-sync | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-gdrive-sync | Yes: index.ts | Yes: mavis-workflow-run | cron | Yes | not verified | **ACTIVE** |
| mavis-github-sync | Yes: index.ts | Yes: mavis-workflow-run | cron | Yes | not verified | **ACTIVE** |
| mavis-gmail-sync | Yes: index.ts | Yes: mavis-workflow-run | webhook | Yes | not verified | **ACTIVE** |
| mavis-gmail-watch | No | No | cron | Yes | not verified | **CRON-ONLY** |
| mavis-gmail-webhook | No | No | - | Yes | not verified | **ORPHANED** |
| mavis-gmb-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-goal-agent | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-goal-engine | Yes: index.ts | Yes: mavis-actions, mavis-autonomous-engine | - | Yes | not verified | **ACTIVE** |
| mavis-goal-judge | Yes: index.ts | Yes: mavis-chat | webhook | Yes | not verified | **ACTIVE** |
| mavis-goal-loop | Yes: MavisChat.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-goal-review | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-google-agent | Yes: index.ts | Yes: mavis-memory-agent, mavis-reddit-agent, mavis-security-scanner, mavis-task-executor, mavis-webhook-calendar | - | Yes | not verified | **ACTIVE** |
| mavis-google-oauth | Yes: IntegrationsPage.tsx | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-google-tasks-sync | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-gumroad-webhook | No | No | webhook | Yes | not verified | **WEBHOOK** |
| mavis-gumroad | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-health-check | Yes: SystemHealthPage.tsx | No | - | Yes | not verified | **ACTIVE** |
| mavis-health-monitor | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-health-protocol | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-heartbeat | Yes: SystemHealthPage.tsx | Yes: mavis-task-executor | cron | Yes | not verified | **ACTIVE** |
| mavis-heygen-agent | Yes: index.ts | Yes: mavis-actions, mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-heygen | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-higgsfield | Yes: GalleryPage.tsx, index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-hn-digest | Yes: index.ts | Yes: mavis-workflow-run | cron | Yes | not verified | **ACTIVE** |
| mavis-home | No | No | - | Yes | not verified | **ORPHANED** |
| mavis-hyperframes | No | Yes: mavis-chat | - | Yes | not verified | **ACTIVE** |
| mavis-identity-bootstrap | No | No | - | Yes | not verified | **ORPHANED** |
| mavis-image-gen | Yes: GalleryPage.tsx, MavisChat.tsx, index.ts, specialistDispatcher.ts | Yes: mavis-chat, mavis-web-builder, telegram-webhook | - | Yes | not verified | **ACTIVE** |
| mavis-import | Yes: ImportPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-inbound-webhook | No | No | - | Yes | not verified | **ORPHANED** |
| mavis-ingest-url | Yes: ContentPages.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-ingest | No | Yes: telegram-webhook | - | Yes | not verified | **ACTIVE** |
| mavis-instagram-agent | Yes: index.ts | Yes: mavis-instagram-trends, mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-instagram-trends | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-khanmigo | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-knowledge | Yes: KnowledgeGraph.tsx, index.ts | Yes: mavis-api-gateway, mavis-attachment-process, mavis-chat, mavis-ingest, telegram-webhook | - | Yes | not verified | **ACTIVE** |
| mavis-lead-gen | Yes: LeadGenPage.tsx, index.ts, specialistDispatcher.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-learning-engine | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-letta | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-linear-agent | Yes: index.ts | Yes: mavis-sentry-agent, mavis-slack-bot, mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-live-voice | Yes: VoiceChatOverlay.tsx, index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-llm-router | Yes: NotebookPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-logo-gen | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-maps | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-market-data | No | No | - | Yes | not verified | **ORPHANED** |
| mavis-market-radar | Yes: FinancePage.tsx, SystemHealthPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-mcp-server | No | No | webhook | Yes | not verified | **WEBHOOK?** |
| mavis-mcp | No | No | - | Yes | not verified | **ORPHANED** |
| mavis-media-analyst | Yes: ProductionIntelligence.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-meeting-brief | No | No | cron | Yes | not verified | **CRON-ONLY** |
| mavis-meeting-notes | Yes: MeetingNotesPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-meeting-prep | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-meeting-transcribe | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-mem0 | Yes: index.ts, proactiveRecall.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-memory-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-memory-consolidate | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-memory-embed | Yes: SystemHealthPage.tsx | Yes: mavis-capability-audit | cron | Yes | not verified | **ACTIVE** |
| mavis-mini-agent | Yes: AgentWidget.tsx, index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-modelslab | No | Yes: mavis-agent, mavis-telegram-bot | webhook | Yes | not verified | **ACTIVE** |
| mavis-morning-brief | Yes: Dashboard.tsx, SystemHealthPage.tsx, index.ts | Yes: mavis-autonomous-engine, telegram-webhook | cron | Yes | not verified | **ACTIVE** |
| mavis-morning-digest | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-multi-provider | Yes: ProvidersPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-music-gen | Yes: index.ts, useMediaPoller.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-narrative-engine | Yes: SystemHealthPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-netlify | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-nora-discord | Yes: PersonasPage.tsx, index.ts | Yes: mavis-action-executor | webhook | Yes | not verified | **ACTIVE** |
| mavis-nora-engage | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-nora-instagram | Yes: PersonasPage.tsx, index.ts | Yes: mavis-action-executor, mavis-task-executor | webhook | Yes | not verified | **ACTIVE** |
| mavis-nora-linkedin | Yes: PersonasPage.tsx, index.ts | Yes: mavis-action-executor, mavis-task-executor | webhook | Yes | not verified | **ACTIVE** |
| mavis-nora-post | Yes: PersonasPage.tsx, index.ts | Yes: mavis-action-executor, mavis-social-scheduler, mavis-task-executor | webhook | Yes | not verified | **ACTIVE** |
| mavis-nora-tiktok | Yes: index.ts | Yes: mavis-action-executor, mavis-task-executor | webhook | Yes | not verified | **ACTIVE** |
| mavis-notebook-embed | Yes: NotebookPage.tsx, index.ts | Yes: mavis-agent | - | Yes | not verified | **ACTIVE** |
| mavis-notebook-podcast | Yes: NotebookPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-notion-agent | Yes: index.ts | Yes: mavis-actions, mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-notion-sync | Yes: index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-obsidian-export | Yes: ExportPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-openai-finetune | Yes: index.ts | Yes: mavis-self-improve | webhook | Yes | not verified | **ACTIVE** |
| mavis-opportunity-scanner | Yes: IntelligencePage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-orchestrator | No | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-oura-sync | Yes: HealthPage.tsx, index.ts | Yes: mavis-workflow-run | cron | Yes | not verified | **ACTIVE** |
| mavis-outcome-tracker | Yes: SystemHealthPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-page-agent | Yes: usePageAgent.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-pattern-insights | Yes: AnalyticsPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-pdf-gen | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-performance-science | Yes: FinancePage.tsx, SystemHealthPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-periodic-review | Yes: index.ts | Yes: telegram-webhook | cron | Yes | not verified | **ACTIVE** |
| mavis-persona-forge | Yes: index.ts, usePersonaForge.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-persona-router | Yes: VoiceChatOverlay.tsx, index.ts, usePersona.ts | Yes: telegram-webhook | - | Yes | not verified | **ACTIVE** |
| mavis-persona-social | Yes: index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-personaplex | Yes: index.ts, useElevenLabsTts.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-phone-call | Yes: PhoneCallsPage.tsx, index.ts | Yes: mavis-action-executor | webhook | Yes | not verified | **ACTIVE** |
| mavis-plaid | Yes: FinancePage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-planner | Yes: PlanBoard.tsx, index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-plans | Yes: index.ts | Yes: mavis-chat, mavis-heartbeat, mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-polymarket | Yes: IntelligencePage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-post-meeting | No | No | cron | Yes | not verified | **CRON-ONLY** |
| mavis-poster-gen | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-predictive-engine | Yes: SystemHealthPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-proactive-agent | Yes: AgentDashboardPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-proactive-nudge | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-product-creator | Yes: index.ts | Yes: mavis-task-executor | webhook | Yes | not verified | **ACTIVE** |
| mavis-profile-updater | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-prompt-vault | Yes: PromptVaultPage.tsx, index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-push-notify | Yes: index.ts | Yes: mavis-ambient-monitor, mavis-predictive-engine, mavis-relationship-intel | - | Yes | not verified | **ACTIVE** |
| mavis-python-exec | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-quality-eval | Yes: chatService.ts, index.ts, specialistDispatcher.ts | Yes: mavis-morning-digest, mavis-self-improve | - | Yes | not verified | **ACTIVE** |
| mavis-quest-calendar | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-quest-nudge | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-readwise-import | Yes: ReadwisePage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-realtime-v2 | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-receptionist-config | Yes: ReceptionistPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-receptionist-inbound | No | No | webhook | Yes | not verified | **WEBHOOK** |
| mavis-receptionist-provision | Yes: ReceptionistPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-reclaim | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-reddit-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-reflection-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-relationship-intel | Yes: SystemHealthPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-repurpose | Yes: RepurposePage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-rss-monitor | Yes: RSSReaderPage.tsx, index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-run-doctor | Yes: SystemSettingsPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-ruview-bridge | No | No | - | Yes | not verified | **ORPHANED** |
| mavis-salesforce | Yes: index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-screenpipe | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-sec-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-security-scanner | Yes: index.ts, specialistDispatcher.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-self-evolve | Yes: AgentConsole.tsx, SelfEvolvePage.tsx, SystemHealthPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-self-improve | Yes: SystemHealthPage.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-self-reflect | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-sentry-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-seo-engine | Yes: index.ts | Yes: mavis-web-builder | - | Yes | not verified | **ACTIVE** |
| mavis-sheets-agent | Yes: index.ts | Yes: mavis-flashcard-agent, mavis-gmb-agent, mavis-google-agent, mavis-reddit-agent, mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-shopify-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-shortform-ingest | Yes: index.ts | Yes: mavis-chat, mavis-telegram-bot | - | Yes | not verified | **ACTIVE** |
| mavis-signal-watcher | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-site-editor | Yes: DesignStudio.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-skill-catalog | Yes: SystemSettingsPage.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-slack-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-slack-bot | No | No | webhook | Yes | not verified | **WEBHOOK** |
| mavis-sleep-coach | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-sms | Yes: SMSPage.tsx, index.ts | Yes: mavis-api-gateway | webhook | Yes | not verified | **ACTIVE** |
| mavis-so-curator | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-so-scheduler | Yes: StandingOrdersWidget.tsx, index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-social-publisher | Yes: index.ts | Yes: mavis-director | - | Yes | not verified | **ACTIVE** |
| mavis-social-scheduler | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-spaced-repetition | Yes: index.ts | Yes: telegram-webhook | cron | Yes | not verified | **ACTIVE** |
| mavis-spotify-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-spotify-control | Yes: MavisDemo.tsx, SpotifyWidget.tsx, index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-spotify-sync | Yes: index.ts | Yes: mavis-workflow-run | webhook | Yes | not verified | **ACTIVE** |
| mavis-stock-analysis | Yes: StockAnalysisPage.tsx, index.ts, specialistDispatcher.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-story-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-strategy-council | Yes: IntelligencePage.tsx, index.ts, specialistDispatcher.ts | Yes: telegram-webhook | webhook | Yes | not verified | **ACTIVE** |
| mavis-strava-sync | Yes: index.ts | Yes: mavis-workflow-run | cron | Yes | not verified | **ACTIVE** |
| mavis-streak-alerts | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-stripe-webhook | No | No | webhook | Yes | not verified | **WEBHOOK** |
| mavis-tacit-prune | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-task-executor | Yes: Inbox.tsx | Yes: mavis-heartbeat, telegram-webhook | cron | Yes | not verified | **ACTIVE** |
| mavis-team | No | No | - | Yes | not verified | **ORPHANED** |
| mavis-telegram-bot | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-terminal | Yes: AgentConsole.tsx, MavisDemo.tsx, index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-transcribe-memo | Yes: VoiceMemo.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-transcribe | Yes: ContentPages.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-translate | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-trigger-engine | No | No | cron | Yes | not verified | **CRON-ONLY** |
| mavis-tts | Yes: CouncilGroupVoice.tsx, NotebookPage.tsx, VoiceChatOverlay.tsx, index.ts, useElevenLabsTts.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-twilio-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-twitter-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-user-model-refresh | Yes: BehavioralModelPage.tsx, SystemHealthPage.tsx, index.ts | Yes: mavis-chat | webhook | Yes | not verified | **ACTIVE** |
| mavis-vapi-webhook | No | No | webhook | Yes | not verified | **WEBHOOK** |
| mavis-vercel-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-video-download | Yes: VideoEditorPage.tsx, index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-video-editor | Yes: VideoEditorPage.tsx, index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-video-gen | Yes: GalleryPage.tsx, index.ts | Yes: mavis-actions, mavis-higgsfield | - | Yes | not verified | **ACTIVE** |
| mavis-video-narrator | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-video-render | Yes: VideoEditorPage.tsx, index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-vision-agent | Yes: index.ts | Yes: mavis-chat, mavis-task-executor, mavis-telegram-bot | - | Yes | not verified | **ACTIVE** |
| mavis-voice-session | Yes: MavisRealtimeVoice.tsx, index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-voicebox | Yes: index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-vtube-studio | No | Yes: mavis-telegram-bot | webhook | Yes | not verified | **ACTIVE** |
| mavis-wearable-overlay | Yes: index.ts, wearableAdapters.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-weather | Yes: index.ts | Yes: mavis-workflow-run | - | Yes | not verified | **ACTIVE** |
| mavis-web-builder | Yes: WebsiteBuilderPage.tsx, index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-web-crawler | Yes: index.ts | Yes: mavis-director | - | Yes | not verified | **ACTIVE** |
| mavis-web-scraper | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| mavis-webhook-calendar | No | No | - | Yes | not verified | **ORPHANED** |
| mavis-webhook-dispatch | No | No | webhook | Yes | not verified | **WEBHOOK** |
| mavis-webhook-dispatcher | No | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-webhook | No | No | webhook | Yes | not verified | **WEBHOOK** |
| mavis-website-qa | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-weekly-retro | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| mavis-whoop-sync | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-widget-api | No | Yes: mavis-widget-gen | webhook | Yes | not verified | **ACTIVE** |
| mavis-widget-gen | Yes: WidgetBuilderPage.tsx, index.ts | Yes: mavis-actions | - | Yes | not verified | **ACTIVE** |
| mavis-widget-plugin | Yes: WidgetBuilderPage.tsx | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-wordpress | Yes: index.ts | Yes: mavis-actions, mavis-web-builder | - | Yes | not verified | **ACTIVE** |
| mavis-workflow-run | Yes: WorkflowsPage.tsx, index.ts | Yes: mavis-autonomous-engine | - | Yes | not verified | **ACTIVE** |
| mavis-world-model | Yes: IntelligencePage.tsx, SystemHealthPage.tsx, index.ts | Yes: mavis-event-router | cron | Yes | not verified | **ACTIVE** |
| mavis-worldmonitor | Yes: WorldMonitorPage.tsx, index.ts | Yes: mavis-actions, mavis-chat | - | Yes | not verified | **ACTIVE** |
| mavis-wpcom-oauth | Yes: WebsiteBuilderPage.tsx, WpcomCallbackPage.tsx | No | webhook | Yes | not verified | **ACTIVE** |
| mavis-yamete | No | No | webhook | Yes | not verified | **NEEDS-DECISION** |
| mavis-youtube-agent | Yes: index.ts | Yes: mavis-task-executor | - | Yes | not verified | **ACTIVE** |
| mavis-youtube-ingest | Yes: index.ts | Yes: mavis-chat, mavis-telegram-bot | - | Yes | not verified | **ACTIVE** |
| mcp | No | No | - | Yes | not verified | **ORPHANED** |
| navi-finetune-check | Yes: index.ts, usePersona.ts | No | webhook | Yes | not verified | **ACTIVE** |
| navi-finetune-pipeline | Yes: index.ts, usePersona.ts | No | webhook | Yes | not verified | **ACTIVE** |
| navi-heartbeat | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| navi-memory-consolidator | Yes: index.ts | No | webhook | Yes | not verified | **ACTIVE** |
| prymal-approval-flow | Yes: index.ts | Yes: prymal-brand-agent, prymal-google-agent | - | Yes | not verified | **ACTIVE** |
| prymal-brand-agent | Yes: index.ts | Yes: prymal-approval-flow | - | Yes | not verified | **ACTIVE** |
| prymal-google-agent | Yes: index.ts | Yes: prymal-approval-flow | - | Yes | not verified | **ACTIVE** |
| prymal-intel-agent | Yes: index.ts | No | cron | Yes | not verified | **ACTIVE** |
| prymal-onboard | Yes: index.ts | No | - | Yes | not verified | **ACTIVE** |
| prymal-widget-loader | Yes: AgentBuilderSection.tsx | Yes: mavis-agent-builder | - | Yes | not verified | **ACTIVE** |
| stripe-widget-webhook | No | No | webhook | Yes | not verified | **WEBHOOK** |
| telegram-sender | No | Yes: mavis-director | - | Yes | not verified | **ACTIVE** |
| telegram-setup | No | No | webhook | Yes | not verified | **WEBHOOK?** |
| telegram-webhook | No | No | webhook | Yes | not verified | **WEBHOOK** |