-- mavis_persona_memory.embedding was vector(384) — a legacy width from before
-- this table was reachable through match_operator_entries at all. Found by
-- running the backfill against it: every attempt failed with 0 embedded / 1
-- failed on its one row, because embedText() refuses to write a vector whose
-- length doesn't match the width it was asked to produce, and nothing here
-- was asking for 384.
--
-- match_operator_entries takes one query embedding at 1536 and reuses it
-- across every UNION branch — the same reasoning the original semantic
-- search migration widened mavis_memory for ("one query embedding then
-- serves every table rather than needing a second call at a second width").
-- A branch left at 384 does not degrade gracefully: pgvector's <=> raises a
-- dimension mismatch at the row where it actually runs, not a type error at
-- CREATE FUNCTION time, so this stays silent — WHERE embedding IS NOT NULL
-- currently excludes every row in this table — right up until the first row
-- successfully embeds, at which point every scope:"all" semantic search
-- starts failing (semanticHits() catches the RPC error and degrades to no
-- semantic results at all, for every table, not just this one).
--
-- DROP + ADD rather than ALTER TYPE, same reasoning as the original
-- migration's memory branch: a type change rewrites the table under an
-- exclusive lock; dropping a column and adding a nullable one with no
-- default are both catalogue-only in PG11+. Zero rows currently hold a real
-- 384-dim vector here (the one row that exists never successfully embedded),
-- so nothing is lost.

BEGIN;
SELECT set_config('lock_timeout', '3s', true);
SELECT set_config('statement_timeout', '60s', true);

ALTER TABLE public.mavis_persona_memory DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.mavis_persona_memory ADD COLUMN IF NOT EXISTS embedding vector(1536);

COMMIT;
