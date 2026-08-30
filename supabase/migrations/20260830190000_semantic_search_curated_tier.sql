-- Semantic search, extended to the rest of the operator's substantive prose.
--
-- The previous migration covered journal, vault, quests, meeting_notes,
-- notebooks and mavis_memory — the tables the reported failures actually hit.
-- This covers the next tier: the operator asked for the whole app to be
-- reachable by meaning, not just by shared words. Curated, not exhaustive —
-- see appSearch.ts's SEARCHABLE registry for the reasoning on what a table
-- needs to earn a spot here. The short version: real prose someone would
-- phrase differently on recall (a strategy memo, a call transcript, a
-- meeting prep) earns an embedding; an execution log or a config table does
-- not, because there is nothing in it a paraphrase would ever match.
--
-- Two of the twenty-eight already have an embedding column and an active
-- writer — mavis_persona_memory (mavis-chat inserts role+content on every
-- persona/council turn) and mavis_council_memory (mavis-council-heartbeat
-- embeds content directly). Those get a UNION branch and a defensive
-- backfill entry here, not a new column.
--
-- Same four rules as the previous migration:
--  1. lock_timeout set transaction-locally, not via session-level SET —
--     a session SET can land on a different backend through the pooler.
--  2. Nothing references auth.users.
--  3. Re-runnable: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE.
--  4. ADD COLUMN with no default/NOT NULL is catalogue-only in PG11+ — no
--     table rewrite, so the ACCESS EXCLUSIVE lock is held for microseconds.
--
-- No vector index, same reasoning as before: ivfflat needs training data
-- these tables do not have yet, and a sequential scan over what exists today
-- is already instant. Revisit if any of these reach the tens of thousands.

BEGIN;
SELECT set_config('lock_timeout', '3s', true);
SELECT set_config('statement_timeout', '60s', true);

ALTER TABLE public.mavis_telos ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_narrative ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_user_model ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_user_profile ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_plans ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_playbooks ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_strategy_memos ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_crew_runs ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_council_discourse ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_relationship_health ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_leads ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_outreach_drafts ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_meeting_preps ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_insights ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_predictions ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_causal_chains ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_thought_chains ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_outcome_events ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.watchtower_briefs ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_daily_briefs ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_agent_briefs ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.mavis_calls ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.receptionist_calls ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.video_segments ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.chat_attachments ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.persona_memories ADD COLUMN IF NOT EXISTS embedding vector(1536);
-- mavis_persona_memory and mavis_council_memory already have this column.

COMMIT;

-- Extends match_operator_entries from 6 branches to 34. Every branch below
-- the "existing" marker is copied verbatim from the previous migration —
-- nothing about journal/vault/quests/meeting_notes/notebooks/memory changes
-- here, only more UNION ALL arms are added to the same function.
--
-- Column choices for the new branches, where not self-evident:
--   mavis_user_profile has no id column (one row per operator, keyed by
--     user_id) — user_id fills the id position; harmless with one row.
--   mavis_telos and mavis_user_profile have no created_at — updated_at
--     stands in.
--   mavis_insights uses generated_at — the column it actually has.
--   video_segments has no timestamp column at all — NULL::timestamptz.
--   Five titleless tables (mavis_daily_briefs, mavis_agent_briefs,
--     video_segments, and mavis_council_memory) derive a title from their
--     body the same way the memory branch already does: first 80 characters,
--     whitespace collapsed.
CREATE OR REPLACE FUNCTION public.match_operator_entries(
  p_user_id uuid, p_query vector(1536), p_count int DEFAULT 8, p_scope text DEFAULT 'all'
)
RETURNS TABLE (kind text, id uuid, title text, content text,
               category text, created_at timestamptz, similarity double precision)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (
    -- ── existing six, unchanged ──────────────────────────────────────────
    SELECT 'journal'::text AS kind, j.id AS id, j.title AS title, j.content AS content,
           j.category AS category, j.created_at AS created_at,
           1 - (j.embedding <=> p_query) AS similarity
    FROM public.journal_entries j
    WHERE j.user_id = p_user_id AND j.embedding IS NOT NULL AND p_scope IN ('all','journal')
    UNION ALL
    SELECT 'vault'::text, v.id, v.title, v.content, v.category, v.created_at,
           1 - (v.embedding <=> p_query)
    FROM public.vault_entries v
    WHERE v.user_id = p_user_id AND v.embedding IS NOT NULL AND p_scope IN ('all','vault')
    UNION ALL
    SELECT 'quests'::text, q.id, q.title, q.description, q.category, q.created_at,
           1 - (q.embedding <=> p_query)
    FROM public.quests q
    WHERE q.user_id = p_user_id AND q.embedding IS NOT NULL AND p_scope IN ('all','quests')
    UNION ALL
    SELECT 'meeting_notes'::text, m.id, m.title, m.summary, NULL::text, m.created_at,
           1 - (m.embedding <=> p_query)
    FROM public.meeting_notes m
    WHERE m.user_id = p_user_id AND m.embedding IS NOT NULL AND p_scope IN ('all','meeting_notes')
    UNION ALL
    SELECT 'notebooks'::text, n.id, n.title, n.description, NULL::text, n.created_at,
           1 - (n.embedding <=> p_query)
    FROM public.notebooks n
    WHERE n.user_id = p_user_id AND n.embedding IS NOT NULL AND p_scope IN ('all','notebooks')
    UNION ALL
    SELECT 'memory'::text, mm.id,
           '[' || coalesce(mm.role, 'msg') || '] ' || left(regexp_replace(mm.content, '\s+', ' ', 'g'), 80),
           mm.content, NULL::text, mm.created_at,
           1 - (mm.embedding <=> p_query)
    FROM public.mavis_memory mm
    WHERE mm.user_id = p_user_id AND mm.embedding IS NOT NULL AND p_scope IN ('all','memory')
    -- ── curated tier, added here ─────────────────────────────────────────
    UNION ALL
    SELECT 'mavis_telos'::text, t.id, t.mission, t.current_state, NULL::text, t.updated_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_telos t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_telos')
    UNION ALL
    SELECT 'mavis_narrative'::text, t.id, t.identity_summary, t.narrative, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_narrative t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_narrative')
    UNION ALL
    SELECT 'mavis_user_model'::text, t.id, t.personality_summary, t.raw_synthesis, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_user_model t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_user_model')
    UNION ALL
    SELECT 'mavis_user_profile'::text, t.user_id, t.profile_md, t.key_context, NULL::text, t.updated_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_user_profile t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_user_profile')
    UNION ALL
    SELECT 'mavis_plans'::text, t.id, t.title, t.summary, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_plans t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_plans')
    UNION ALL
    SELECT 'mavis_playbooks'::text, t.id, t.name, t.description, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_playbooks t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_playbooks')
    UNION ALL
    SELECT 'mavis_strategy_memos'::text, t.id, t.question, t.synthesis, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_strategy_memos t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_strategy_memos')
    UNION ALL
    SELECT 'mavis_crew_runs'::text, t.id, t.goal, t.synthesis, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_crew_runs t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_crew_runs')
    UNION ALL
    SELECT 'mavis_council_discourse'::text, t.id, t.topic, t.synthesis, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_council_discourse t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_council_discourse')
    UNION ALL
    SELECT 'mavis_relationship_health'::text, t.id, t.contact_name, t.notes, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_relationship_health t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_relationship_health')
    UNION ALL
    SELECT 'mavis_leads'::text, t.id, t.company_name, t.research_summary, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_leads t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_leads')
    UNION ALL
    SELECT 'mavis_outreach_drafts'::text, t.id, t.contact_name, t.drafted_message, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_outreach_drafts t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_outreach_drafts')
    UNION ALL
    SELECT 'mavis_meeting_preps'::text, t.id, t.event_title, t.prep_brief, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_meeting_preps t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_meeting_preps')
    UNION ALL
    SELECT 'mavis_insights'::text, t.id, t.title, t.content, t.category, t.generated_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_insights t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_insights')
    UNION ALL
    SELECT 'mavis_predictions'::text, t.id, t.title, t.content, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_predictions t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_predictions')
    UNION ALL
    SELECT 'mavis_causal_chains'::text, t.id, t.cause, t.description, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_causal_chains t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_causal_chains')
    UNION ALL
    SELECT 'mavis_thought_chains'::text, t.id, t.goal, t.conclusion, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_thought_chains t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_thought_chains')
    UNION ALL
    SELECT 'mavis_outcome_events'::text, t.id, t.prediction_text, t.actual_outcome, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_outcome_events t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_outcome_events')
    UNION ALL
    SELECT 'watchtower_briefs'::text, t.id, t.summary, t.content, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.watchtower_briefs t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','watchtower_briefs')
    UNION ALL
    SELECT 'mavis_daily_briefs'::text, t.id, left(regexp_replace(t.brief_text, '\s+', ' ', 'g'), 80), t.brief_text, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_daily_briefs t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_daily_briefs')
    UNION ALL
    SELECT 'mavis_agent_briefs'::text, t.id, left(regexp_replace(t.summary, '\s+', ' ', 'g'), 80), t.summary, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_agent_briefs t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_agent_briefs')
    UNION ALL
    SELECT 'mavis_calls'::text, t.id, t.purpose, t.transcript, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_calls t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_calls')
    UNION ALL
    SELECT 'receptionist_calls'::text, t.id, t.summary, t.transcript, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.receptionist_calls t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','receptionist_calls')
    UNION ALL
    SELECT 'video_segments'::text, t.id, left(regexp_replace(t.transcript_text, '\s+', ' ', 'g'), 80), t.transcript_text, NULL::text, NULL::timestamptz,
           1 - (t.embedding <=> p_query)
    FROM public.video_segments t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','video_segments')
    UNION ALL
    SELECT 'chat_attachments'::text, t.id, t.file_name, t.extracted_text, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.chat_attachments t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','chat_attachments')
    UNION ALL
    SELECT 'mavis_persona_memory'::text, t.id, t.role, t.content, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_persona_memory t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_persona_memory')
    UNION ALL
    SELECT 'mavis_council_memory'::text, t.id, left(regexp_replace(t.content, '\s+', ' ', 'g'), 80), t.content, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.mavis_council_memory t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','mavis_council_memory')
    UNION ALL
    SELECT 'persona_memories'::text, t.id, t.memory_type, t.content, NULL::text, t.created_at,
           1 - (t.embedding <=> p_query)
    FROM public.persona_memories t
    WHERE t.user_id = p_user_id AND t.embedding IS NOT NULL AND p_scope IN ('all','persona_memories')
  ) hits
  ORDER BY hits.similarity DESC
  LIMIT greatest(p_count, 0);
$$;
