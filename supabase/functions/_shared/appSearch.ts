// Search anything in the app, for every surface that talks to the operator.
//
// MAVIS, council members and personas all needed to reach the operator's real
// data, and each was blocked differently:
//
//   MAVIS     multi-turn, has tools — but its prompt only carried the 5 most
//             recent journal/vault entries, and it had no way to reach past
//             that until search_journal/search_vault existed.
//   personas  mavis-persona-router is SINGLE-TURN: actions are parsed and run
//             after the model has already replied, so a tool it calls can
//             never inform the answer it is giving. Anything the reply depends
//             on must be in the prompt before the LLM runs.
//   council   routes through mavis-chat. It used to be excluded from the tool
//             path entirely, so retrieval was the only thing that reached it;
//             council members are now in the pre-pass on the same terms as
//             everyone else, and retrieval still runs for them regardless.
//
// So the mechanism that actually serves all three is retrieval into the
// prompt, not a tool. The tool is the extra that multi-turn surfaces can use
// to dig further. Both run off this one registry.
//
// The registry's column names are not guesses — they were read out of
// information_schema against the live database, because they are genuinely
// inconsistent (title vs name vs objective; content vs description vs notes
// vs summary) and a wrong name is a silent empty result, not an error.

import {
  buildTsQuery,
  buildTsQueryAll,
  extractTerms,
  rankEntries,
  termOccurs,
} from "./entrySearch.ts";

export interface SearchableTable {
  /** Scope name the model uses, and the label shown on a hit. */
  key: string;
  table: string;
  /** The name-ish column. Every table has one; it is what a hit is called. */
  titleCol: string;
  /** The prose column, when the table has one distinct from the title. */
  bodyCol?: string;
  /** Extra columns worth returning for context. Verified to exist. */
  extraCols?: string[];
  /** Not universal — inventory and calendar_events have no created_at. */
  hasCreatedAt?: boolean;
  /**
   * Searched on every message without being asked. Kept to the tables that
   * actually hold prose the operator writes, because this runs on every turn
   * of every conversation and each table costs two queries.
   */
  auto?: boolean;
  /**
   * True for the long tail added to make literally every table reachable.
   * Every OTHER scope is named individually in every prompt catalog — the
   * whole point of doing that was so a model would think to ask for it by
   * name — but doing that for 128 tables at once would mean spelling out
   * 128 names in every system prompt this registry feeds, which taxes every
   * turn to serve lookups that come up rarely. These are reached instead
   * through scope:"all", which every catalog already documents as searching
   * everything; a model narrowing to a specific scope name still works if it
   * guesses right (SEARCHABLE_KEYS are stable, guessable words), it just
   * isn't taught the exact spelling. See the "every scope is advertised"
   * describe block in appSearch.test.ts for the enforcement this trades off.
   */
  longTail?: boolean;
}

export const SEARCHABLE: SearchableTable[] = [
  { key: "journal",       table: "journal_entries", titleCol: "title",     bodyCol: "content",     extraCols: ["category", "importance"], hasCreatedAt: true, auto: true },
  { key: "vault",         table: "vault_entries",   titleCol: "title",     bodyCol: "content",     extraCols: ["category", "importance"], hasCreatedAt: true, auto: true },
  { key: "meeting_notes", table: "meeting_notes",   titleCol: "title",     bodyCol: "summary",                                            hasCreatedAt: true, auto: true },
  { key: "quests",        table: "quests",          titleCol: "title",     bodyCol: "description", extraCols: ["category"],               hasCreatedAt: true, auto: true },
  // NOT auto, deliberately. There is no /tasks route and buildSystemPrompt
  // tells every agent "there is no tasks system... create_task/update_task/
  // delete_task are DISABLED". The rows are real operator data so they stay
  // reachable by an explicit search, but injecting them on every message
  // would have agents citing records from a page the app does not have.
  { key: "tasks",         table: "tasks",           titleCol: "title",     bodyCol: "description",                                        hasCreatedAt: true },
  { key: "goals",         table: "mavis_goals",     titleCol: "objective",                                                                hasCreatedAt: true, auto: true },

  // Reachable by explicit search. Not automatic: these are mostly short
  // labels, so they add query cost on every turn for little prose to match.
  { key: "skills",         table: "skills",          titleCol: "name",  bodyCol: "description", extraCols: ["category"], hasCreatedAt: true, auto: true },
  { key: "contacts",       table: "contacts",        titleCol: "name",  bodyCol: "notes",                                hasCreatedAt: true, auto: true },
  { key: "council",        table: "councils",        titleCol: "name",  bodyCol: "notes",       extraCols: ["role", "specialty"], hasCreatedAt: true },
  { key: "allies",         table: "allies",          titleCol: "name",  bodyCol: "notes",       extraCols: ["specialty"], hasCreatedAt: true },
  { key: "transformations",table: "transformations", titleCol: "name",  bodyCol: "description", extraCols: ["category"], hasCreatedAt: true },
  { key: "rituals",        table: "rituals",         titleCol: "name",  bodyCol: "description", extraCols: ["category"], hasCreatedAt: true },
  { key: "store",          table: "store_items",     titleCol: "name",  bodyCol: "description", extraCols: ["category"], hasCreatedAt: true },
  { key: "inventory",      table: "inventory",       titleCol: "name",  bodyCol: "description", extraCols: ["effect"] },
  { key: "calendar",       table: "calendar_events", titleCol: "title", bodyCol: "description" },
  { key: "expenses",       table: "mavis_expenses",  titleCol: "description",                   extraCols: ["category"], hasCreatedAt: true },
  { key: "personas",       table: "personas",        titleCol: "name",  bodyCol: "role",                                 hasCreatedAt: true },

  // Pages that were invisible to every agent until now. Column names and the
  // presence of created_at are taken from the generated Supabase types, not
  // assumed: energy_systems and achievements have no created_at, and asking
  // for one returns nothing rather than erroring.
  //
  // notebook_messages is deliberately absent: it has no user_id column —
  // ownership runs through notebooks.chat_id — so the .eq("user_id", ...)
  // every search applies would match zero rows and look like an empty
  // notebook. The notebook itself is indexed instead.
  { key: "rankings",     table: "rankings_profiles", titleCol: "display_name", bodyCol: "notes",       extraCols: ["rank", "role"], hasCreatedAt: true },
  { key: "energy",       table: "energy_systems",    titleCol: "type",         bodyCol: "description", extraCols: ["status"] },
  { key: "tower",        table: "tower_floors",      titleCol: "name",         bodyCol: "function",    extraCols: ["law"],          hasCreatedAt: true },
  { key: "notebooks",    table: "notebooks",         titleCol: "title",        bodyCol: "description",                              hasCreatedAt: true, auto: true },
  { key: "achievements", table: "achievements",      titleCol: "title",        bodyCol: "description", extraCols: ["category"] },
  { key: "bpm",          table: "bpm_sessions",      titleCol: "form",         bodyCol: "notes",       extraCols: ["mood"],         hasCreatedAt: true },
  { key: "time",         table: "time_logs",         titleCol: "project",      bodyCol: "description",                              hasCreatedAt: true },
  { key: "finance",      table: "plaid_transactions", titleCol: "name",        bodyCol: "merchant_name", extraCols: ["category"],   hasCreatedAt: true },

  // Knowledge Graph, gallery, website builds and widgets — reachable by no
  // surface except mavis-chat's own dedicated match_mavis_notes call for
  // notes specifically. mavis-agent, mavis-actions, mavis-persona-router,
  // mavis-council-session and the client-side council board all search
  // through this same registry, so until these rows existed here those
  // surfaces simply had no way to look any of the four up. Not auto: notes
  // already gets its own semantic pass in mavis-chat (this adds a keyword
  // path for every *other* surface without doubling that one up), and
  // gallery/website/widgets are low-prose, low-row-count tables where a
  // per-message cost isn't worth it — explicit search or scope:"all" reaches
  // them instead.
  { key: "notes",          table: "mavis_notes",         titleCol: "title",        bodyCol: "content",     extraCols: ["tags"],         hasCreatedAt: true },
  { key: "gallery",        table: "mavis_media_library",  titleCol: "title",                                extraCols: ["media_type"],   hasCreatedAt: true },
  { key: "website",        table: "website_projects",    titleCol: "project_name", bodyCol: "description", extraCols: ["business_name"], hasCreatedAt: true },
  { key: "website_pages",  table: "website_pages",       titleCol: "title",        bodyCol: "content_brief", extraCols: ["page_type"],   hasCreatedAt: true },
  { key: "widgets",        table: "widget_instances",    titleCol: "widget_type",  bodyCol: "business_context", extraCols: ["status"],   hasCreatedAt: true },

  // Everything else. The operator asked for the whole app to be reachable —
  // every table that holds something a person actually wrote or that MAVIS
  // generated on their behalf — rather than growing this list one gap report
  // at a time. Every row below was checked against columnsOf() in
  // appSearch.test.ts before being written, the same way the entries above
  // it were: a wrong column name here is a silent empty result, not an
  // error, so nothing here is guessed.
  //
  // Deliberately left OUT, and why:
  //   - Credentials/tokens: mavis_api_keys, org_api_keys, wp_credentials,
  //     mavis_oauth_tokens, whoop_tokens, plaid_accounts, plaid_items (holds
  //     access_token), telegram_linked_accounts, mavis_user_integrations
  //     (holds key_value), mavis_agent_identity (holds a keypair), device
  //     push tokens. These must never land in a prompt.
  //   - System plumbing with no operator-authored prose: every *_log, *_cache,
  //     *_queue, *_cursor, *_config, *_registry, *_session(s) table (job
  //     state, sync cursors, rate limits, cron config, telemetry) — there is
  //     nothing in them a question would ever be "about". A few names that
  //     match that shape but hold real content were kept anyway: council
  //     sessions, tutoring sessions, code delegation sessions.
  //   - Tables with no user_id column at all: profiles (id IS the user id —
  //     already fully covered by authoritativeContext/buildSharedTruth
  //     elsewhere), the prymal_* agency tables (scoped by client_id),
  //     mavis_teams/organizations (scoped by team/org membership),
  //     mavis_note_links/mavis_note_versions/notebook_messages/
  //     quest_chain_items/skill_chain_items (ownership runs through a parent
  //     row's user_id, same reasoning as notebook_messages above), and
  //     widget_leads (scoped by widget_id → widget_instances.user_id). Adding
  //     any of these through the same .eq("user_id", userId) filter every
  //     other row here uses would silently return nothing for every user —
  //     worse than not listing them, since it would look searched.
  //   - Pure numeric/JSON state with nothing to keyword-match: wearable daily
  //     syncs (whoop_daily_data, galaxy_ring_daily_data, health_metrics —
  //     already reachable through the dedicated sync_health tool), quota/
  //     counter/analytics tables, user_roles (authorization, not content).
  { key: "approvals", table: "approvals", titleCol: "action_type", hasCreatedAt: true, longTail: true },
  { key: "artifacts", table: "artifacts", titleCol: "title", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "chat_conversations", table: "chat_conversations", titleCol: "title", hasCreatedAt: true, longTail: true },
  { key: "chat_messages", table: "chat_messages", titleCol: "role", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "council_chat_messages", table: "council_chat_messages", titleCol: "role", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "council_sessions", table: "council_sessions", titleCol: "topic", bodyCol: "summary", hasCreatedAt: true, longTail: true },
  { key: "currencies", table: "currencies", titleCol: "name", hasCreatedAt: true, longTail: true },
  { key: "customer_agents", table: "customer_agents", titleCol: "business_name", hasCreatedAt: true, longTail: true },
  { key: "email_outbox", table: "email_outbox", titleCol: "subject", bodyCol: "body", hasCreatedAt: true, longTail: true },
  { key: "game_master_events", table: "game_master_events", titleCol: "title", hasCreatedAt: true, longTail: true },
  { key: "generated_websites", table: "generated_websites", titleCol: "name", hasCreatedAt: true, longTail: true },
  { key: "gmail_messages", table: "gmail_messages", titleCol: "subject", hasCreatedAt: true, longTail: true },
  { key: "loose_threads", table: "loose_threads", titleCol: "title", bodyCol: "context", hasCreatedAt: true, longTail: true },
  { key: "mavis_agency_conversations", table: "mavis_agency_conversations", titleCol: "role", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "mavis_agent_memories", table: "mavis_agent_memories", titleCol: "memory_type", bodyCol: "content", extraCols: ["importance"], hasCreatedAt: true, longTail: true },
  { key: "mavis_agent_traces", table: "mavis_agent_traces", titleCol: "action_type", bodyCol: "result", hasCreatedAt: true, longTail: true },
  { key: "mavis_approvals", table: "mavis_approvals", titleCol: "action_type", hasCreatedAt: true, longTail: true },
  { key: "mavis_automation_rules", table: "mavis_automation_rules", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_autonomy_settings", table: "mavis_autonomy_settings", titleCol: "action_type", longTail: true },
  { key: "mavis_bookings", table: "mavis_bookings", titleCol: "title", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_campaigns", table: "mavis_campaigns", titleCol: "title", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_competitors", table: "mavis_competitors", titleCol: "name", bodyCol: "notes", hasCreatedAt: true, longTail: true },
  { key: "mavis_council_discourse", table: "mavis_council_discourse", titleCol: "topic", bodyCol: "synthesis", hasCreatedAt: true, longTail: true },
  { key: "mavis_custom_skills", table: "mavis_custom_skills", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_design_projects", table: "mavis_design_projects", titleCol: "project_name", hasCreatedAt: true, longTail: true },
  { key: "mavis_devices", table: "mavis_devices", titleCol: "name", hasCreatedAt: true, longTail: true },
  { key: "mavis_domain_effects", table: "mavis_domain_effects", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_entities", table: "mavis_entities", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_inbound_emails", table: "mavis_inbound_emails", titleCol: "subject", longTail: true },
  { key: "mavis_insights", table: "mavis_insights", titleCol: "title", bodyCol: "content", longTail: true },
  { key: "mavis_journal", table: "mavis_journal", titleCol: "title", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "mavis_knowledge", table: "mavis_knowledge", titleCol: "title", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "mavis_learned_preferences", table: "mavis_learned_preferences", titleCol: "key", bodyCol: "value", longTail: true },
  { key: "mavis_market_intel", table: "mavis_market_intel", titleCol: "headline", bodyCol: "summary", hasCreatedAt: true, longTail: true },
  { key: "mavis_mcp_servers", table: "mavis_mcp_servers", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_meetings", table: "mavis_meetings", titleCol: "title", bodyCol: "summary", hasCreatedAt: true, longTail: true },
  { key: "mavis_opportunities", table: "mavis_opportunities", titleCol: "title", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_persona_memory", table: "mavis_persona_memory", titleCol: "role", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "mavis_plan_steps", table: "mavis_plan_steps", titleCol: "title", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_plans", table: "mavis_plans", titleCol: "title", bodyCol: "summary", hasCreatedAt: true, longTail: true },
  { key: "mavis_playbooks", table: "mavis_playbooks", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_plugins", table: "mavis_plugins", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_predictions", table: "mavis_predictions", titleCol: "title", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "mavis_products", table: "mavis_products", titleCol: "title", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "mavis_rss_feeds", table: "mavis_rss_feeds", titleCol: "name", hasCreatedAt: true, longTail: true },
  { key: "mavis_signal_configs", table: "mavis_signal_configs", titleCol: "name", hasCreatedAt: true, longTail: true },
  { key: "mavis_skill_definitions", table: "mavis_skill_definitions", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_social_personas", table: "mavis_social_personas", titleCol: "display_name", hasCreatedAt: true, longTail: true },
  { key: "mavis_tacit", table: "mavis_tacit", titleCol: "key", bodyCol: "value", extraCols: ["category"], hasCreatedAt: true, longTail: true },
  { key: "mavis_td_connections", table: "mavis_td_connections", titleCol: "name", hasCreatedAt: true, longTail: true },
  { key: "mavis_team_members", table: "mavis_team_members", titleCol: "role", longTail: true },
  { key: "mavis_time_entries", table: "mavis_time_entries", titleCol: "title", hasCreatedAt: true, longTail: true },
  { key: "mavis_vault", table: "mavis_vault", titleCol: "title", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "mavis_vault_entries", table: "mavis_vault_entries", titleCol: "title", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "mavis_video_productions", table: "mavis_video_productions", titleCol: "title", bodyCol: "brief", hasCreatedAt: true, longTail: true },
  { key: "memories", table: "memories", titleCol: "title", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "notebook_chats", table: "notebook_chats", titleCol: "title", hasCreatedAt: true, longTail: true },
  { key: "notebook_notes", table: "notebook_notes", titleCol: "title", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "notebook_sources", table: "notebook_sources", titleCol: "title", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "persona_content", table: "persona_content", titleCol: "title", bodyCol: "body", hasCreatedAt: true, longTail: true },
  { key: "persona_conversations", table: "persona_conversations", titleCol: "role", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "persona_memories", table: "persona_memories", titleCol: "memory_type", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "quest_chains", table: "quest_chains", titleCol: "title", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "receptionist_businesses", table: "receptionist_businesses", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "reclaim_schedule_blocks", table: "reclaim_schedule_blocks", titleCol: "title", longTail: true },
  { key: "rss_feeds", table: "rss_feeds", titleCol: "name", hasCreatedAt: true, longTail: true },
  { key: "skill_chains", table: "skill_chains", titleCol: "title", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "standing_order_templates", table: "standing_order_templates", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "strava_activities", table: "strava_activities", titleCol: "name", hasCreatedAt: true, longTail: true },
  { key: "tower_subareas", table: "tower_subareas", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "tutoring_sessions", table: "tutoring_sessions", titleCol: "subject", hasCreatedAt: true, longTail: true },
  { key: "video_clips", table: "video_clips", titleCol: "title", hasCreatedAt: true, longTail: true },
  { key: "video_projects", table: "video_projects", titleCol: "title", bodyCol: "summary", hasCreatedAt: true, longTail: true },
  { key: "website_clients", table: "website_clients", titleCol: "business_name", bodyCol: "notes", hasCreatedAt: true, longTail: true },
  { key: "workflows", table: "workflows", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "workspaces", table: "workspaces", titleCol: "name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_documents", table: "mavis_documents", titleCol: "content", hasCreatedAt: true, longTail: true },
  { key: "mavis_calls", table: "mavis_calls", titleCol: "purpose", bodyCol: "transcript", extraCols: ["outcome"], hasCreatedAt: true, longTail: true },
  { key: "receptionist_calls", table: "receptionist_calls", titleCol: "summary", bodyCol: "transcript", hasCreatedAt: true, longTail: true },
  { key: "receptionist_messages", table: "receptionist_messages", titleCol: "message", hasCreatedAt: true, longTail: true },
  { key: "watchtower_briefs", table: "watchtower_briefs", titleCol: "summary", bodyCol: "content", hasCreatedAt: true, longTail: true },
  { key: "mavis_council_memory", table: "mavis_council_memory", titleCol: "content", extraCols: ["tags"], hasCreatedAt: true, longTail: true },
  { key: "mavis_council_messages", table: "mavis_council_messages", titleCol: "content", hasCreatedAt: true, longTail: true },
  { key: "council_group_messages", table: "council_group_messages", titleCol: "content", extraCols: ["speaker_name"], hasCreatedAt: true, longTail: true },
  { key: "mavis_agent_messages", table: "mavis_agent_messages", titleCol: "content", hasCreatedAt: true, longTail: true },
  { key: "mavis_world_model", table: "mavis_world_model", titleCol: "summary", hasCreatedAt: true, longTail: true },
  { key: "mavis_strategy_memos", table: "mavis_strategy_memos", titleCol: "question", bodyCol: "synthesis", hasCreatedAt: true, longTail: true },
  { key: "mavis_crew_runs", table: "mavis_crew_runs", titleCol: "goal", bodyCol: "synthesis", hasCreatedAt: true, longTail: true },
  { key: "mavis_daily_briefs", table: "mavis_daily_briefs", titleCol: "brief_text", hasCreatedAt: true, longTail: true },
  { key: "mavis_agent_briefs", table: "mavis_agent_briefs", titleCol: "summary", hasCreatedAt: true, longTail: true },
  { key: "mavis_narrative", table: "mavis_narrative", titleCol: "identity_summary", bodyCol: "narrative", hasCreatedAt: true, longTail: true },
  { key: "mavis_telos", table: "mavis_telos", titleCol: "mission", bodyCol: "current_state", longTail: true },
  { key: "mavis_user_model", table: "mavis_user_model", titleCol: "personality_summary", bodyCol: "raw_synthesis", hasCreatedAt: true, longTail: true },
  { key: "mavis_user_profile", table: "mavis_user_profile", titleCol: "profile_md", bodyCol: "key_context", longTail: true },
  { key: "mavis_relationship_health", table: "mavis_relationship_health", titleCol: "contact_name", bodyCol: "notes", hasCreatedAt: true, longTail: true },
  { key: "mavis_leads", table: "mavis_leads", titleCol: "company_name", bodyCol: "research_summary", hasCreatedAt: true, longTail: true },
  { key: "mavis_outreach_drafts", table: "mavis_outreach_drafts", titleCol: "contact_name", bodyCol: "drafted_message", hasCreatedAt: true, longTail: true },
  { key: "mavis_email_watches", table: "mavis_email_watches", titleCol: "contact_name", bodyCol: "context", hasCreatedAt: true, longTail: true },
  { key: "mavis_meeting_preps", table: "mavis_meeting_preps", titleCol: "event_title", bodyCol: "prep_brief", hasCreatedAt: true, longTail: true },
  { key: "mavis_causal_chains", table: "mavis_causal_chains", titleCol: "cause", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_thought_chains", table: "mavis_thought_chains", titleCol: "goal", bodyCol: "conclusion", hasCreatedAt: true, longTail: true },
  { key: "mavis_outcome_events", table: "mavis_outcome_events", titleCol: "prediction_text", bodyCol: "actual_outcome", hasCreatedAt: true, longTail: true },
  { key: "mavis_instagram_trends", table: "mavis_instagram_trends", titleCol: "hashtag", bodyCol: "generated_caption", hasCreatedAt: true, longTail: true },
  { key: "mavis_social_posts", table: "mavis_social_posts", titleCol: "content", hasCreatedAt: true, longTail: true },
  { key: "contact_interactions", table: "contact_interactions", titleCol: "interaction_type", bodyCol: "notes", hasCreatedAt: true, longTail: true },
  { key: "finance_entries", table: "finance_entries", titleCol: "category", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "mavis_activities", table: "mavis_activities", titleCol: "type", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "computer_use_tasks", table: "computer_use_tasks", titleCol: "task_description", bodyCol: "result", hasCreatedAt: true, longTail: true },
  { key: "mavis_device_commands", table: "mavis_device_commands", titleCol: "command_type", bodyCol: "result", hasCreatedAt: true, longTail: true },
  { key: "mavis_tool_executions", table: "mavis_tool_executions", titleCol: "tool_name", bodyCol: "result", hasCreatedAt: true, longTail: true },
  { key: "mavis_plugin_executions", table: "mavis_plugin_executions", titleCol: "plugin_name", bodyCol: "output", hasCreatedAt: true, longTail: true },
  { key: "mavis_so_executions", table: "mavis_so_executions", titleCol: "template_slug", bodyCol: "result", longTail: true },
  { key: "a2a_tasks", table: "a2a_tasks", titleCol: "input_message", bodyCol: "output_message", hasCreatedAt: true, longTail: true },
  { key: "mavis_response_feedback", table: "mavis_response_feedback", titleCol: "response_preview", hasCreatedAt: true, longTail: true },
  { key: "mavis_distillation_jobs", table: "mavis_distillation_jobs", titleCol: "output_summary", hasCreatedAt: true, longTail: true },
  { key: "mavis_video_beats", table: "mavis_video_beats", titleCol: "on_screen_text", bodyCol: "narration", hasCreatedAt: true, longTail: true },
  { key: "mavis_video_jobs", table: "mavis_video_jobs", titleCol: "prompt", hasCreatedAt: true, longTail: true },
  { key: "stripe_revenue", table: "stripe_revenue", titleCol: "source", hasCreatedAt: true, longTail: true },
  { key: "gumroad_sales", table: "gumroad_sales", titleCol: "product_name", hasCreatedAt: true, longTail: true },
  { key: "mavis_design_components", table: "mavis_design_components", titleCol: "component_name", bodyCol: "performance_notes", hasCreatedAt: true, longTail: true },
  { key: "mavis_standing_orders", table: "mavis_standing_orders", titleCol: "order_text", hasCreatedAt: true, longTail: true },
  { key: "chat_attachments", table: "chat_attachments", titleCol: "file_name", bodyCol: "extracted_text", hasCreatedAt: true, longTail: true },
  { key: "vault_media", table: "vault_media", titleCol: "file_name", bodyCol: "description", hasCreatedAt: true, longTail: true },
  { key: "video_segments", table: "video_segments", titleCol: "transcript_text", longTail: true },
  { key: "wearable_overlay_history", table: "wearable_overlay_history", titleCol: "overlay_type", bodyCol: "content", longTail: true },
  { key: "code_delegation_sessions", table: "code_delegation_sessions", titleCol: "task_description", hasCreatedAt: true, longTail: true },
  { key: "mavis_active_agency_specialists", table: "mavis_active_agency_specialists", titleCol: "agent_name", bodyCol: "spec_content", longTail: true },
  { key: "mavis_council_activity", table: "mavis_council_activity", titleCol: "member_name", bodyCol: "summary", hasCreatedAt: true, longTail: true },

  // Conversation history — by row count the largest thing the operator has,
  // and until now reachable by nothing. Not automatic: 2600+ chat turns would
  // crowd out authored entries on every message, and a passing remark in an
  // old conversation is rarely the answer when a journal entry exists. It is
  // there when asked for, and semantic search reaches it either way.
  //
  // titleCol is the content itself: the table has no name column, so the
  // keyword pass searches the same text it displays.
  { key: "memory",       table: "mavis_memory",      titleCol: "content",                                                            hasCreatedAt: true },
];

export const SEARCHABLE_KEYS = SEARCHABLE.map((t) => t.key);

/** Columns to request. Only ever names verified to exist on that table. */
export function selectFor(t: SearchableTable): string {
  const cols = ["id", t.titleCol];
  if (t.bodyCol) cols.push(t.bodyCol);
  if (t.extraCols) cols.push(...t.extraCols);
  if (t.hasCreatedAt) cols.push("created_at");
  return [...new Set(cols)].join(",");
}

/**
 * Which tables a scope refers to.
 *
 * An unrecognised scope resolves to the automatic set rather than to nothing:
 * a model inventing a scope name should get a slightly-too-broad answer, not
 * a confident "you have nothing about that".
 */
export function resolveScope(scope?: string | null): SearchableTable[] {
  const raw = String(scope ?? "").trim().toLowerCase();
  if (!raw || raw === "auto" || raw === "default") return SEARCHABLE.filter((t) => t.auto);
  if (raw === "all" || raw === "everything" || raw === "*") return SEARCHABLE;

  const wanted = raw.split(/[,\s]+/).filter(Boolean);
  const picked = SEARCHABLE.filter((t) => wanted.includes(t.key) || wanted.includes(t.table));
  return picked.length > 0 ? picked : SEARCHABLE.filter((t) => t.auto);
}

export interface AppSearchHit {
  kind: string;
  id: string;
  title: string;
  excerpt: string;
  category?: string;
  created_at?: string;
}

/**
 * The supabase client, as much of it as this needs.
 *
 * Typed loosely on purpose. A hand-written interface spelling the builder
 * chain out was the honest version and it did not survive contact with the
 * real client: PostgREST's builders are deeply generic and self-referential,
 * so structural checking against them made the compiler unfold types until it
 * gave up (TS2589 "type instantiation is excessively deep"), and the client
 * failed to match the interface anyway (TS2345). Callers pass clients typed
 * different ways — `any` in mavis-actions, a full SupabaseClient in
 * mavis-chat — and none should need a cast at the call site to run a search.
 */
// deno-lint-ignore no-explicit-any
type QueryClient = { from(table: string): any; rpc?: (fn: string, args: Record<string, unknown>) => any };

/** Columns worth having before a row is known to be worth fetching. */
function selectForCandidates(t: SearchableTable): string {
  const cols = ["id", t.titleCol];
  if (t.extraCols?.length) cols.push(t.extraCols[0]);
  if (t.hasCreatedAt) cols.push("created_at");
  return [...new Set(cols)].join(",");
}

/** A row the database matched, before its body has been fetched. */
interface Candidate {
  t: SearchableTable;
  id: string;
  title: string;
  category?: string;
  created_at?: string;
  /** The query terms hit the title. The strongest signal available here. */
  titleHits: number;
  /** The body matched the ORed terms — relevant, but weakly. */
  bodyHit: boolean;
  /** Every term matched at once. Almost always the row being asked about. */
  allHit: boolean;
}

const SCORE_TITLE_TERM = 3;
const SCORE_ALL_TERMS = 5;
const SCORE_BODY = 1;

function scoreCandidate(c: Candidate): number {
  return c.titleHits * SCORE_TITLE_TERM +
    (c.allHit ? SCORE_ALL_TERMS : 0) +
    (c.bodyHit ? SCORE_BODY : 0);
}

/**
 * Full-text search across the operator's own rows.
 *
 * Two phases, and the split is what makes complete coverage affordable.
 *
 * Phase 1 asks which rows match and selects only id, title and a date — the
 * body column is searched but never returned. One vault entry averages 3.7 KB
 * and reaches 28 KB, so fetching bodies just to rank them costs most of a
 * megabyte on every message to produce 300-character excerpts. Without the
 * body in the payload the cap can be high enough to take every match there
 * is, which removes the arbitrary truncation that used to decide the answer:
 * the old code took whatever twenty rows Postgres happened to return, out of
 * forty-one matches, with no ORDER BY.
 *
 * Phase 2 fetches whole rows for the handful that survived ranking.
 *
 * Two queries per table for retrieval (title and body) because PostgREST's
 * .textSearch() targets one column, and building an .or() filter from user
 * text would mean hand-escaping PostgREST's filter grammar. A third asks
 * which rows match every term at once, which is the sharpest ranking signal
 * available without ts_rank (unreachable through PostgREST).
 *
 * A failure on one table never fails the search — a missing column or a
 * permissions edge on some obscure table costs that table's results, not the
 * answer.
 */
export async function searchAppData(
  sb: QueryClient,
  userId: string,
  query: string,
  opts: {
    scope?: string | null;
    limit?: number;
    candidateCap?: number;
    /**
     * Turns on the semantic half of the search.
     *
     * Passed in rather than imported so this module stays runnable in the
     * browser, where there is no embedding key: the council board calls the
     * same function and simply gets keyword results. Server callers hand in
     * embedText from _shared/embedding.ts.
     */
    embed?: (text: string) => Promise<number[] | null>;
  } = {},
): Promise<AppSearchHit[]> {
  const terms = extractTerms(query);
  const orQuery = buildTsQuery(query);
  if (!orQuery) return [];
  const andQuery = buildTsQueryAll(query);

  const tables = resolveScope(opts.scope);
  const limit = opts.limit ?? 8;
  // High enough to cover every row of every table at present sizes, so
  // truncation is not what decides whether the operator's entry is seen.
  const candidateCap = opts.candidateCap ?? 200;

  type Probe = { t: SearchableTable; kind: "title" | "body" | "all"; rows: Record<string, unknown>[] };

  function launchProbes(t: SearchableTable): Promise<Probe>[] {
    const cols = selectForCandidates(t);
    const out: Promise<Probe>[] = [];
    const run = (kind: "title" | "body" | "all", col: string, q: string) => {
      let builder = sb.from(t.table).select(cols).eq("user_id", userId)
        .textSearch(col, q, { type: "websearch" });
      // Deterministic, so a cap that is ever reached cuts the oldest rather
      // than whatever the planner happened to emit.
      if (t.hasCreatedAt) builder = builder.order("created_at", { ascending: false });
      out.push(
        Promise.resolve(builder.limit(candidateCap))
          .then((r: { data?: unknown[] }) => ({
            t, kind, rows: (r.data ?? []) as Record<string, unknown>[],
          }))
          .catch(() => ({ t, kind, rows: [] as Record<string, unknown>[] })),
      );
    };
    run("title", t.titleCol, orQuery);
    if (t.bodyCol) {
      run("body", t.bodyCol, orQuery);
      // Only worth asking when there is more than one term to require.
      if (terms.length > 1) run("all", t.bodyCol, andQuery);
    }
    return out;
  }

  // Started here, beside the keyword probes. It used to run after the
  // shortlist was built, behind an early return taken when keyword search
  // found nothing — which is precisely when semantic search is the only thing
  // that can answer. A question sharing no words with the entry got no
  // results at all, the one case the feature exists for.
  const semanticP = semanticHits(sb, userId, query, opts);

  // Tables are processed in batches rather than one flat Promise.all over
  // every table at once. At the ~30 tables this had before the long tail,
  // firing everything in one wave was at most ~90 simultaneous requests —
  // fine. scope:"all" now spans 160+ tables, up to 3 queries each: one wave
  // would be 450+ simultaneous PostgREST calls from a single edge function
  // invocation, well past what Supabase's connection pooler holds open for
  // one caller, so calls at the back of that pile would queue or time out —
  // scope:"all" would get slower and less reliable exactly when someone
  // deliberately asked to search everything. Batches of 20 tables bound peak
  // concurrency to roughly the same order of magnitude the un-batched search
  // always ran at, independent of how large the registry grows later.
  const BATCH_SIZE = 20;
  const settled: Probe[] = [];
  for (let i = 0; i < tables.length; i += BATCH_SIZE) {
    const batch = tables.slice(i, i + BATCH_SIZE).flatMap(launchProbes);
    settled.push(...await Promise.all(batch));
  }

  const byKey = new Map<string, Candidate>();
  for (const { t, kind, rows } of settled) {
    for (const row of rows) {
      // kind+id, not id: two tables can legitimately hold the same id value.
      const key = `${t.key}:${String(row.id ?? "")}`;
      let c = byKey.get(key);
      if (!c) {
        const title = String(row[t.titleCol] ?? "") || "(untitled)";
        c = {
          t,
          id: String(row.id ?? ""),
          title,
          category: t.extraCols?.length ? String(row[t.extraCols[0]] ?? "") || undefined : undefined,
          created_at: t.hasCreatedAt ? String(row.created_at ?? "") || undefined : undefined,
          titleHits: terms.filter((term) => termOccurs(term, title.toLowerCase())).length,
          bodyHit: false,
          allHit: false,
        };
        byKey.set(key, c);
      }
      if (kind === "body") c.bodyHit = true;
      if (kind === "all") c.allHit = true;
    }
  }

  const shortlist = [...byKey.values()]
    .sort((a, b) => {
      const d = scoreCandidate(b) - scoreCandidate(a);
      if (d !== 0) return d;
      return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    })
    .slice(0, Math.max(0, limit));

  const semantic = await semanticP;
  if (shortlist.length === 0 && semantic.length === 0) return [];

  // Phase 2 — whole rows, only for what survived.
  // May be empty when only the semantic half matched; the loops below simply
  // do nothing and `full` starts from the semantic hits alone.
  const wanted = new Map<string, { t: SearchableTable; ids: string[] }>();
  for (const c of shortlist) {
    const e = wanted.get(c.t.key) ?? { t: c.t, ids: [] };
    e.ids.push(c.id);
    wanted.set(c.t.key, e);
  }

  const fetched = await Promise.all(
    [...wanted.values()].map(({ t, ids }) =>
      Promise.resolve(sb.from(t.table).select(selectFor(t)).eq("user_id", userId).in("id", ids))
        .then((r: { data?: unknown[] }) => ({ t, rows: (r.data ?? []) as Record<string, unknown>[] }))
        .catch(() => ({ t, rows: [] as Record<string, unknown>[] })),
    ),
  );

  const full = fetched.flatMap(({ t, rows }) =>
    rows.map((row) => ({
      id: `${t.key}:${String(row.id ?? "")}`,
      kind: t.key,
      title: String(row[t.titleCol] ?? "") || "(untitled)",
      content: t.bodyCol ? String(row[t.bodyCol] ?? "") : "",
      category: t.extraCols?.length ? String(row[t.extraCols[0]] ?? "") || undefined : undefined,
      created_at: t.hasCreatedAt ? String(row.created_at ?? "") || undefined : undefined,
    })),
  );

  // Semantic hits, merged in. Keyword search finds entries that share words
  // with the question; this finds the ones that share meaning — "my custody
  // case" reaching an entry titled "Joanna's Timesharing Violation", which no
  // amount of stemming will do. The two are complementary, so both run and
  // the union is ranked, rather than one replacing the other.
  //
  // Only journal and vault are embedded today, so this widens what those two
  // can match rather than covering every table.
  for (const hit of semantic) {
    const key = `${hit.kind}:${hit.id}`;
    if (!full.some((f) => f.id === key)) {
      full.push({
        id: key,
        kind: hit.kind,
        title: hit.title,
        content: hit.content,
        category: hit.category,
        created_at: hit.created_at,
      });
    }
  }

  // Final order is body-aware now that the bodies are actually here.
  return rankEntries(full, terms, limit).map((r) => ({
    kind: r.kind,
    id: String(r.id).slice(String(r.kind).length + 1),
    title: r.title,
    excerpt: String(r.content ?? "").slice(0, 300),
    category: r.category,
    created_at: r.created_at,
  }));
}

/**
 * Nearest neighbours for the question, via the match_operator_entries RPC.
 *
 * Returns [] for every failure mode — no embed function, no key, an RPC that
 * does not exist yet, a row whose embedding was never backfilled. Semantic
 * search is an addition to keyword search, never a replacement, so nothing
 * here may cost the caller its keyword results.
 */
// Every scope match_operator_entries actually carries a UNION branch for.
// Kept in step with that function and the backfill's table map — a scope
// named here but absent there returns empty, and one embedded but missing
// here is simply never searched semantically (keyword search still reaches
// it). The original six plus the curated tier added in the
// 20260830190000 migration.
const EMBEDDED_SCOPES = [
  "journal", "vault", "quests", "meeting_notes", "notebooks", "memory",
  "mavis_telos", "mavis_narrative", "mavis_user_model", "mavis_user_profile",
  "mavis_plans", "mavis_playbooks", "mavis_strategy_memos", "mavis_crew_runs",
  "mavis_council_discourse", "mavis_relationship_health", "mavis_leads",
  "mavis_outreach_drafts", "mavis_meeting_preps", "mavis_insights",
  "mavis_predictions", "mavis_causal_chains", "mavis_thought_chains",
  "mavis_outcome_events", "watchtower_briefs", "mavis_daily_briefs",
  "mavis_agent_briefs", "mavis_calls", "receptionist_calls",
  "video_segments", "chat_attachments", "mavis_persona_memory",
  "mavis_council_memory", "persona_memories",
];
const ANY_SCOPE = ["all", "everything", "*", "auto", "default"];

type SemanticHit = { kind: string; id: string; title: string; content: string; category?: string; created_at?: string };

async function semanticHits(
  sb: QueryClient,
  userId: string,
  query: string,
  opts: { scope?: string | null; limit?: number; embed?: (t: string) => Promise<number[] | null> },
): Promise<SemanticHit[]> {
  if (!opts.embed) return [];
  try {
    const vec = await opts.embed(query);
    if (!vec) return [];
    if (typeof sb.rpc !== "function") return [];

    const raw = String(opts.scope ?? "").trim().toLowerCase();
    const wantsAll = !raw || ANY_SCOPE.includes(raw);
    const count = (opts.limit ?? 8) * 2;

    const calls: Promise<SemanticHit[]>[] = [];

    // The 34-table UNION. Runs whenever the scope is broad, or names one of
    // its own branches specifically.
    if (wantsAll || EMBEDDED_SCOPES.includes(raw)) {
      const rpcScope = EMBEDDED_SCOPES.includes(raw) ? raw : "all";
      calls.push(
        sb.rpc("match_operator_entries", { p_user_id: userId, p_query: vec, p_count: count, p_scope: rpcScope })
          .then(({ data }: { data?: unknown[] }): SemanticHit[] => ((data ?? []) as Record<string, unknown>[]).map((r): SemanticHit => ({
            kind: String(r.kind ?? ""),
            id: String(r.id ?? ""),
            title: String(r.title ?? "") || "(untitled)",
            content: String(r.content ?? ""),
            category: String(r.category ?? "") || undefined,
            created_at: String(r.created_at ?? "") || undefined,
          })))
          .catch((): SemanticHit[] => []),
      );
    }

    // Knowledge Graph notes. Its own RPC, its own threshold-based cutoff
    // (match_mavis_notes filters by similarity > 0.45 itself rather than
    // taking a flat top-N like match_operator_entries) — kept as a separate
    // call rather than folded into the UNION so that threshold stays intact.
    if (wantsAll || raw === "notes") {
      calls.push(
        sb.rpc("match_mavis_notes", { query_embedding: vec, match_user_id: userId, match_count: opts.limit ?? 8 })
          .then(({ data }: { data?: unknown[] }): SemanticHit[] => ((data ?? []) as Record<string, unknown>[]).map((r): SemanticHit => ({
            kind: "notes",
            id: String(r.id ?? ""),
            title: String(r.title ?? "") || "(untitled)",
            content: String(r.content ?? ""),
            created_at: undefined,
          })))
          .catch((): SemanticHit[] => []),
      );
    }

    // Crawled/researched web content — embedded at crawl time by
    // mavis-web-crawler, not by the backfill (nothing to backfill: every row
    // already gets its vector when it's written).
    if (wantsAll || raw === "mavis_documents") {
      calls.push(
        sb.rpc("match_documents", { query_embedding: vec, match_user_id: userId, match_count: opts.limit ?? 8 })
          .then(({ data }: { data?: unknown[] }): SemanticHit[] => ((data ?? []) as Record<string, unknown>[]).map((r): SemanticHit => ({
            kind: "mavis_documents",
            id: String(r.id ?? ""),
            title: String(r.content ?? "").slice(0, 80) || "(untitled)",
            content: String(r.content ?? ""),
            created_at: undefined,
          })))
          .catch((): SemanticHit[] => []),
      );
    }

    if (calls.length === 0) return [];
    const settled = await Promise.all(calls);
    return settled.flat();
  } catch {
    return [];
  }
}

/** The prompt block. Empty string when there is nothing worth adding. */
export function formatSearchBlock(hits: AppSearchHit[], hadQuery: boolean): string {
  if (!hadQuery) return "";
  if (hits.length === 0) {
    return "RELEVANT RECORDS: nothing in the operator's data matches this message.\n";
  }
  const lines = hits.map((h) =>
    `  • [${h.kind}] "${h.title}"${h.category ? ` [${h.category}]` : ""}` +
    `${h.created_at ? ` (${h.created_at.slice(0, 10)})` : ""}` +
    `${h.excerpt ? ` — ${h.excerpt}` : ""}`,
  );
  return (
    "RELEVANT RECORDS (matched against what the operator just said, searched across their FULL data — " +
    "not only the recent items listed elsewhere in this prompt):\n" +
    lines.join("\n") + "\n"
  );
}
