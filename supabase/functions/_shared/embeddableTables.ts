// Single source of truth for which tables carry an embedding column and
// which columns feed it. Extracted out of mavis-embed-backfill/index.ts,
// which used to be the only reader — reembedRow.ts (write-time hooks) needs
// the exact same title/body/idCol/dims/bodyIsJson mapping, and duplicating
// it there would be a fourth place (after this, the migrations, and
// appSearch.ts's EMBEDDED_SCOPES) these could silently drift apart. One map,
// two readers.

export interface Backfillable {
  table: string;
  /** Omitted where the table has no name-ish column — memory rows are prose only. */
  titleCol?: string;
  bodyCol: string;
  /**
   * The width the column declares. Not decoration: Postgres rejects a vector
   * of the wrong length outright, so getting this wrong fails every row.
   */
  dims?: number;
  /**
   * Default "id". mavis_user_profile is one row per operator, keyed by
   * user_id, with no id column at all — selecting/updating on "id"
   * unconditionally 400s on that table specifically.
   */
  idCol?: string;
  /**
   * bodyCol is jsonb, not text. Two things change: the blank-row filter
   * can't use a regex match (`jsonb ~ text` doesn't exist as an operator —
   * found this by running the backfill against mavis_calls.transcript, which
   * failed outright rather than just embedding nothing), so it falls back to
   * an IS NOT NULL check instead; and the value arrives as a parsed object,
   * not a string, so it needs JSON.stringify rather than embeddableText's
   * plain concatenation (which would otherwise embed the literal text
   * "[object Object]").
   */
  bodyIsJson?: boolean;
}

export const EMBEDDABLE_TABLES: Record<string, Backfillable> = {
  journal:       { table: "journal_entries", titleCol: "title", bodyCol: "content" },
  vault:         { table: "vault_entries",   titleCol: "title", bodyCol: "content" },
  quests:        { table: "quests",          titleCol: "title", bodyCol: "description" },
  meeting_notes: { table: "meeting_notes",   titleCol: "title", bodyCol: "summary" },
  notebooks:     { table: "notebooks",       titleCol: "title", bodyCol: "description" },

  // The memory system. Older tables, built against different models, so their
  // vectors are narrower — see _shared/embedding.ts. mavis-memory-embed was
  // meant to fill these using Supabase's built-in gte-small, but its cron was
  // never created and the model exhausts the edge worker's memory
  // (WORKER_RESOURCE_LIMIT) when invoked.
  //
  // Which table the *memory* search reads is not obvious from the names:
  // search_memories_hybrid, search_memories_semantic and match_agent_memory
  // all query mavis_agent_memories (768), never mavis_memory.
  //
  // mavis_memory holds 2633 rows of conversation history and was reachable by
  // nothing at all. It is now searched through match_operator_entries with
  // everything else, which is why its column was widened from 384 to 1536 —
  // one query embedding then serves every table rather than needing a second
  // call at a second width.
  memory:         { table: "mavis_memory",         bodyCol: "content" },
  agent_memories: { table: "mavis_agent_memories", bodyCol: "content", dims: 768 },

  // Curated tier — see the 20260830190000 migration for why these 28 and not
  // the rest of the app. mavis_persona_memory and mavis_council_memory
  // already have active writers (mavis-chat, mavis-council-heartbeat); an
  // entry here only catches whatever those miss, same resumable semantics
  // as every other row in this map.
  mavis_telos: { table: "mavis_telos", titleCol: "mission", bodyCol: "current_state" },
  mavis_narrative: { table: "mavis_narrative", titleCol: "identity_summary", bodyCol: "narrative" },
  mavis_user_model: { table: "mavis_user_model", titleCol: "personality_summary", bodyCol: "raw_synthesis" },
  mavis_user_profile: { table: "mavis_user_profile", titleCol: "profile_md", bodyCol: "key_context", idCol: "user_id" },
  mavis_plans: { table: "mavis_plans", titleCol: "title", bodyCol: "summary" },
  mavis_playbooks: { table: "mavis_playbooks", titleCol: "name", bodyCol: "description" },
  mavis_strategy_memos: { table: "mavis_strategy_memos", titleCol: "question", bodyCol: "synthesis" },
  mavis_crew_runs: { table: "mavis_crew_runs", titleCol: "goal", bodyCol: "synthesis" },
  mavis_council_discourse: { table: "mavis_council_discourse", titleCol: "topic", bodyCol: "synthesis" },
  mavis_relationship_health: { table: "mavis_relationship_health", titleCol: "contact_name", bodyCol: "notes" },
  mavis_leads: { table: "mavis_leads", titleCol: "company_name", bodyCol: "research_summary" },
  mavis_outreach_drafts: { table: "mavis_outreach_drafts", titleCol: "contact_name", bodyCol: "drafted_message" },
  mavis_meeting_preps: { table: "mavis_meeting_preps", titleCol: "event_title", bodyCol: "prep_brief" },
  mavis_insights: { table: "mavis_insights", titleCol: "title", bodyCol: "content" },
  mavis_predictions: { table: "mavis_predictions", titleCol: "title", bodyCol: "content" },
  mavis_causal_chains: { table: "mavis_causal_chains", titleCol: "cause", bodyCol: "description" },
  mavis_thought_chains: { table: "mavis_thought_chains", titleCol: "goal", bodyCol: "conclusion" },
  mavis_outcome_events: { table: "mavis_outcome_events", titleCol: "prediction_text", bodyCol: "actual_outcome" },
  watchtower_briefs: { table: "watchtower_briefs", titleCol: "summary", bodyCol: "content" },
  mavis_daily_briefs: { table: "mavis_daily_briefs", bodyCol: "brief_text" },
  mavis_agent_briefs: { table: "mavis_agent_briefs", bodyCol: "summary" },
  mavis_calls: { table: "mavis_calls", titleCol: "purpose", bodyCol: "transcript", bodyIsJson: true },
  receptionist_calls: { table: "receptionist_calls", titleCol: "summary", bodyCol: "transcript" },
  video_segments: { table: "video_segments", bodyCol: "transcript_text" },
  chat_attachments: { table: "chat_attachments", titleCol: "file_name", bodyCol: "extracted_text" },
  mavis_persona_memory: { table: "mavis_persona_memory", titleCol: "role", bodyCol: "content" },
  mavis_council_memory: { table: "mavis_council_memory", bodyCol: "content" },
  persona_memories: { table: "persona_memories", titleCol: "memory_type", bodyCol: "content" },
};
