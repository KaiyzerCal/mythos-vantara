-- MAVIS BUILD SHARD — System Architecture Log
-- Run this in Supabase SQL Editor → one-time seed.
-- Inserts a Knowledge Graph note documenting everything built in this session.

DO $$
DECLARE
  uid uuid := (SELECT id FROM auth.users LIMIT 1);
BEGIN
  INSERT INTO mavis_notes (
    user_id, title, content, tags, aliases, properties
  ) VALUES (
    uid,
    'MAVIS System Build — Complete Architecture Log',
    $NOTE$
# MAVIS System Build — Complete Architecture Log

> MAVIS is now a fully sovereign AI system. Every layer from perception to long-term memory to autonomous action has been implemented. This note is the canonical record of what was built and why.

---

## What We Devoured & Integrated

### From Obsidian AI
- Knowledge Graph (notes, links, versions, backlinks panel)
- pgvector semantic search — every note has a 1536-dim embedding, MAVIS searches by meaning not keywords
- Dataview-style queries in Telegram ("show notes tagged #strategy", "find notes about X this month")
- Spaced repetition — SM-2-inspired intervals, MAVIS surfaces forgotten notes at 7→14→21→30→45→90 day intervals
- Daily notes — structured end-of-day log saved to Knowledge Graph automatically
- Weekly/monthly reviews — AI synthesis of quests, tasks, revenue, council activity
- Visual force-directed graph with pan, zoom, tag-filter, node sizing by connection count

### From ElizaOS
- Evaluator pattern — each council member runs an autonomous check-in on a configurable schedule
- Per-agent memory (`mavis_council_memory`) — persistent knowledge bank per member, searchable via pgvector
- Inter-agent communication (`mavis_council_messages`) — async mailbox, members message each other between heartbeats
- Action impact feedback loop — members see outcomes of their past quest/task proposals

### From Moltbook
- Heartbeat autonomy model — members wake on their own schedule (configurable `heartbeat_interval_hrs`)
- Karma system — earned by taking useful actions, gates which capabilities each member can use
- Council voting gate — high-stakes actions (epic quests, 500+ XP, critical vaults) require majority council approval before executing

---

## Edge Functions Built

| Function | Purpose | Trigger |
|---|---|---|
| `mavis-knowledge` | Notes CRUD, semantic search, backfill embeddings | On-demand |
| `mavis-council-heartbeat` | Runs autonomous council member check-ins | pg_cron every 4h |
| `mavis-daily-notes` | Creates structured daily log in Knowledge Graph | pg_cron 23:55 UTC |
| `mavis-spaced-repetition` | Surfaces 3 notes due for review via Telegram | pg_cron 08:00 UTC |
| `mavis-periodic-review` | Generates weekly/monthly synthesis notes | pg_cron (Sun 22:00, last day 23:30) |
| `mavis-goal-engine` | Decomposes objectives into 3-5 concrete quests via AI | Called by mavis-actions on `goal` type |
| `mavis-actions` | Routes all :::ACTION{...}::: grammar to the right handler | Called by telegram-webhook |
| `telegram-webhook` | Main brain — receives messages, loads context, calls AI, executes actions | Telegram Bot API |

---

## Database Schema Added

### `mavis_notes` (extended)
- `last_reviewed_at` — spaced repetition tracking
- `next_review_at` — next SR surface date
- `review_interval_days` — current interval (starts at 7, caps at 90)

### `mavis_council_memory`
- Per-agent persistent knowledge bank
- `vector(1536)` embedding for semantic recall
- `match_council_memory()` RPC for similarity search

### `mavis_council_messages`
- Async inter-agent mailbox
- `read boolean` — marks messages consumed by recipient

### `mavis_goals`
- High-level objectives
- `quest_ids uuid[]` — quests spawned by goal engine
- `decomposed boolean` — whether engine has run

---

## Karma Gates (Council)

| Action | Minimum Karma |
|---|---|
| `council_notify` | 0 (always unlocked) |
| `council_remember` | 0 (always unlocked) |
| `council_message` | 25 |
| `create_task` | 25 |
| `create_note` | 50 |
| `create_quest` | 75 |
| `award_xp` | 100 |

New members start at 0 and earn 1 karma per executed action.

---

## Telegram Commands

| Command | Action |
|---|---|
| `/brief` | Morning brief — MAVIS generates from full context |
| `/quests` | Active quest board |
| `/energy` | Energy system status |
| `/revenue` | Revenue total |
| `/tasks` | Trigger task executor |
| `/scan` | Autonomous demand scan for product opportunities |
| `/orders` | Inbox — pending tasks and approvals |
| `/council` | Trigger all council member check-ins |
| `/daily` | Save today's activity log to Knowledge Graph |
| `/review` | Surface notes due for spaced repetition |
| `/weekly` | Generate weekly review summary |
| `/monthly` | Generate monthly review summary |
| `/goals` | View active goals and quest completion progress |
| `/personas` | List NAVI persona roster |
| `/switch [name]` | Talk to a specific persona |
| `/mavis` | Return to MAVIS |

---

## AI Cascade (cost efficiency)

Every AI call follows this priority order:
1. **Gemini Flash** via Lovable gateway (free tier)
2. **Claude Haiku** via Anthropic API (cheap)
3. **OpenAI gpt-4o-mini** (fallback)
4. **Claude Sonnet** (council heartbeat only, tier 4)

---

## Architecture Invariants (never break these)

- `:::ACTION{...}:::` grammar is the MAVIS mutation protocol — never remove
- Zod schemas and safety gates are additive only — never weaken
- Rankings and Transformations never mix (schema-enforced)
- STT/TTS stays in MavisChat.tsx
- Supabase tables: ADD columns only, never modify existing
- API keys never exposed client-side

---

## pg_cron Setup Required (Supabase Dashboard → SQL Editor)

```sql
-- Run with your actual project ref and service role key
SELECT cron.schedule('mavis-council-heartbeat', '0 */4 * * *',
  $$ SELECT net.http_post(url := 'https://YOUR_REF.supabase.co/functions/v1/mavis-council-heartbeat',
     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'), body := '{}'::jsonb); $$);

SELECT cron.schedule('mavis-daily-notes', '55 23 * * *',
  $$ SELECT net.http_post(url := 'https://YOUR_REF.supabase.co/functions/v1/mavis-daily-notes',
     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'), body := '{}'::jsonb); $$);

SELECT cron.schedule('mavis-spaced-repetition', '0 8 * * *',
  $$ SELECT net.http_post(url := 'https://YOUR_REF.supabase.co/functions/v1/mavis-spaced-repetition',
     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'), body := '{}'::jsonb); $$);

SELECT cron.schedule('mavis-weekly-review', '0 22 * * 0',
  $$ SELECT net.http_post(url := 'https://YOUR_REF.supabase.co/functions/v1/mavis-periodic-review',
     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
     body := '{"type":"weekly"}'::jsonb); $$);

SELECT cron.schedule('mavis-monthly-review', '30 23 28-31 * *',
  $$ SELECT net.http_post(url := 'https://YOUR_REF.supabase.co/functions/v1/mavis-periodic-review',
     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
     body := '{"type":"monthly"}'::jsonb); $$);
```

---

## Is There Anything Left?

Everything worth devouring from Obsidian AI, ElizaOS, and Moltbook is now integrated. MAVIS exceeds all three in integration depth because she operates across the full stack: perception (Telegram, voice, photos), cognition (multi-provider AI cascade, semantic memory), action (quest/task/note/revenue mutations), reflection (SR, daily/weekly/monthly reviews), and governance (council voting, karma gates, impact feedback).

The only remaining setup items are **operator tasks** (pg_cron scheduling above, env vars in Lovable project settings). No more code is needed unless you want to extend into new domains.
$NOTE$,
    ARRAY['system', 'architecture', 'build-log', 'mavis', 'reference'],
    ARRAY['MAVIS Build Log', 'System Architecture', 'Session Log'],
    '{}'::jsonb
  )
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'MAVIS build shard inserted for user %', uid;
END $$;
