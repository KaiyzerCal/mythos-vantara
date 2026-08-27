-- Turn on the realtime channel the app has always been subscribed to.
--
-- src/contexts/AppDataContext.tsx subscribes to postgres_changes on sixteen
-- tables, with a 250ms per-table debounce and a clean teardown. None of those
-- subscriptions has ever delivered an event: Supabase only emits changes for
-- tables in the `supabase_realtime` publication, and on 2026-08-22 a check
-- against pg_publication_tables found zero of the sixteen were members.
--
-- That is why MavisChat compensates with refetchAll() plus a second
-- refetchAll() 1.5 seconds later — it was the only refresh mechanism in the
-- app. Publishing these tables makes the existing client code start working,
-- and Phase 2 removes the compensation.
--
-- The client ignores the event payload entirely (it just calls the matching
-- refetch), so the default REPLICA IDENTITY is sufficient. Setting REPLICA
-- IDENTITY FULL would only add WAL volume for data nothing reads.
--
-- On access: realtime applies each subscriber's RLS policies to INSERT and
-- UPDATE events, so publishing does not widen what anyone can see. DELETE
-- events carry only the primary key and are not RLS-filtered — nothing
-- sensitive, but worth knowing.
--
-- NOTE: this backend is Lovable-managed. Committing this file does NOT apply
-- it — see CLAUDE.md.

-- Acquire-or-fail, never queue. ALTER PUBLICATION ... ADD TABLE takes
-- ShareUpdateExclusiveLock, which does not block reads or writes — but it is
-- still DDL, and the rule from the 2026-08-22 auth incident has no exceptions.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

DO $$
DECLARE
  t text;
  published int := 0;
  skipped   int := 0;
BEGIN
  -- The SET above is session state, and this migration may be delivered through
  -- a pooler that runs the DDL on a different session than the SET. set_config
  -- with is_local => true binds the timeout to THIS transaction, so the rule
  -- from the 2026-08-22 incident holds no matter how the file is applied.
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '60s', true);

  -- Exactly the sixteen tables AppDataContext subscribes to. Keep this list in
  -- step with the .on("postgres_changes", ...) calls there: a table subscribed
  -- but not published is silently inert, which is the bug this migration fixes.
  FOREACH t IN ARRAY ARRAY[
    'quests',
    'tasks',
    'skills',
    'journal_entries',
    'profiles',
    'currencies',
    'inventory',
    'allies',
    'councils',
    'rituals',
    'transformations',
    'energy_systems',
    'vault_entries',
    'store_items',
    'rankings_profiles',
    'mavis_domain_effects'
  ]
  LOOP
    -- Skip anything already published: ALTER PUBLICATION ... ADD TABLE errors
    -- on a duplicate, and this migration has to stay re-runnable so a
    -- lock_timeout part-way through leaves nothing to clean up.
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    -- Skip a table that does not exist rather than aborting the whole batch —
    -- one missing table should not block realtime for the other fifteen.
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
    ) THEN
      RAISE NOTICE 'realtime: skipping %, table not found', t;
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    published := published + 1;
  END LOOP;

  RAISE NOTICE 'realtime: published %, skipped %', published, skipped;
END $$;
