-- Semantic search over skills, for automatic quest -> skill linking.
--
-- ~1,400 skills (1,312 of them Beyonder pathway/sequence/ability rows) are
-- too many for a chat model to pick from reliably by scanning a prompt dump,
-- and most quest-creation paths (digest, council heartbeats, goal engine,
-- task executor, meeting transcripts) never see the skill list at all.
-- mavis-actions' create_quest now retrieves candidates by meaning through
-- match_skills and has a small model pick the relevant ones — see
-- _shared/skillLinker.ts.
--
-- Same rules as 20260830190000: transaction-local lock_timeout, nothing
-- references auth.users, re-runnable, ADD COLUMN with no default is
-- catalogue-only. No vector index — a sequential scan over ~1,400 rows is
-- instant. mavis-embed-backfill (scope "all", every 5 minutes) fills the
-- column once "skills" is in EMBEDDABLE_TABLES.

BEGIN;
SELECT set_config('lock_timeout', '3s', true);
SELECT set_config('statement_timeout', '60s', true);

ALTER TABLE public.skills ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE OR REPLACE FUNCTION public.match_skills(
  p_user_id uuid, p_query vector(1536), p_count int DEFAULT 30
)
RETURNS TABLE (id uuid, name text, category text, description text,
               parent_skill_id uuid, tier int, similarity double precision)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.name, s.category, s.description, s.parent_skill_id, s.tier,
         1 - (s.embedding <=> p_query) AS similarity
  FROM public.skills s
  WHERE s.user_id = p_user_id AND s.embedding IS NOT NULL
  ORDER BY s.embedding <=> p_query
  LIMIT p_count;
$$;

COMMIT;
