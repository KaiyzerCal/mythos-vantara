-- Migration: 20260613000002_mavis_capabilities
-- Creates and seeds the mavis_capabilities table — the self-referencing capability
-- manifest that allows MAVIS to answer "what can I do?" with structured data.

CREATE TABLE IF NOT EXISTS mavis_capabilities (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  action_type    text        NOT NULL UNIQUE,
  category       text        NOT NULL,
  description    text        NOT NULL,
  example_params jsonb       DEFAULT '{}',
  requires_secrets text[]    DEFAULT '{}',
  edge_function  text,
  is_active      boolean     DEFAULT true,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE mavis_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_authenticated"
  ON mavis_capabilities
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_mavis_cap_category ON mavis_capabilities(category);
CREATE INDEX IF NOT EXISTS idx_mavis_cap_action   ON mavis_capabilities(action_type);

-- ---------------------------------------------------------------------------
-- RPG / CHARACTER
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('update_profile', 'rpg', 'Update operator profile fields (name, stats, rank, arc story, aura, sync %)', '{"field":"stat_str","value":75}', '{}', NULL),
  ('award_xp', 'rpg', 'Award XP to the operator (triggers level-up if threshold crossed)', '{"amount":500,"reason":"Completed major milestone"}', '{}', NULL),
  ('log_bpm_session', 'rpg', 'Log a BPM (beats per minute) training session', '{"bpm":142,"duration_minutes":45,"session_type":"training"}', '{}', NULL),
  ('create_transformation', 'rpg', 'Create a new form/transformation (Full Cowl, Titan Shift, etc.)', '{"name":"Full Cowl 100%","description":"Unleashed form","power_multiplier":10,"active_buffs":["Speed x10"],"passive_buffs":["Aura visible"]}', '{}', NULL),
  ('update_transformation', 'rpg', 'Update an existing transformation by ID or name', '{"transformation_id":"<id>","is_active":true}', '{}', NULL),
  ('delete_transformation', 'rpg', 'Delete a transformation by ID', '{"transformation_id":"<id>"}', '{}', NULL),
  ('self_reflect', 'rpg', 'Trigger a MAVIS self-reflection session — generates insight from recent activity, patterns, and goals', '{"question":"What patterns do you see in my last 30 days?","context":"Focus on output and energy","tags":["productivity","patterns"]}', '{}', 'mavis-self-reflect')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- QUESTS & TASKS
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('create_quest', 'quests', 'Create a new quest (major objective with XP reward)', '{"title":"Launch Prymal Season 2","description":"Full campaign rollout","xp_reward":500,"priority":"high","status":"active"}', '{}', NULL),
  ('update_quest', 'quests', 'Update a quest''s status, title, or description', '{"quest_id":"<id>","status":"completed"}', '{}', NULL),
  ('complete_quest', 'quests', 'Mark a quest as complete and award XP automatically', '{"quest_id":"<id>"}', '{}', NULL),
  ('delete_quest', 'quests', 'Delete a quest by ID', '{"quest_id":"<id>"}', '{}', NULL),
  ('create_task', 'quests', 'Create a task (subtask under a quest or standalone)', '{"title":"Write campaign copy","quest_id":"<id>","priority":"high","due_date":"2025-07-01"}', '{}', NULL),
  ('create_ritual', 'quests', 'Create a recurring ritual (daily/weekly habit protocol)', '{"name":"Morning Protocol","description":"5AM activation sequence","frequency":"daily","xp_per_completion":50}', '{}', NULL),
  ('update_ritual', 'quests', 'Update a ritual', '{"ritual_id":"<id>","is_active":true}', '{}', NULL),
  ('complete_ritual', 'quests', 'Mark a ritual as completed and award XP', '{"ritual_id":"<id>"}', '{}', NULL),
  ('delete_ritual', 'quests', 'Delete a ritual', '{"ritual_id":"<id>"}', '{}', NULL),
  ('autonomous_goal', 'quests', 'Submit a goal to the MAVIS autonomous goal engine for background pursuit', '{"goal":"Reach 10k followers on Instagram by August","deadline":"2025-08-01","priority":"critical"}', '{}', 'mavis-goal-engine')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- GOALS
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('create_mavis_goal', 'goals', 'Create a tracked goal with timeline and metrics', '{"title":"Revenue: $50k MRR","description":"Monthly recurring target","target_date":"2025-12-31","metric":"revenue_mrr","target_value":50000}', '{}', NULL),
  ('update_goal', 'goals', 'Update a goal''s progress or status', '{"goal_id":"<id>","current_value":12500,"status":"active"}', '{}', NULL),
  ('add_goal', 'goals', 'Add a quick goal entry', '{"title":"Finish brand deck","due_date":"2025-06-30"}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- MEMORY & NOTES
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('create_note', 'memory', 'Create a new note', '{"title":"Strategy note","content":"Key insight about the market...","tags":["strategy","market"]}', '{}', NULL),
  ('update_note', 'memory', 'Update an existing note by ID or title', '{"note_id":"<id>","content":"Updated content..."}', '{}', NULL),
  ('delete_note', 'memory', 'Delete a note', '{"note_id":"<id>"}', '{}', NULL),
  ('link_notes', 'memory', 'Link two notes together', '{"note_id":"<id>","target_note_id":"<id2>"}', '{}', NULL),
  ('unlink_notes', 'memory', 'Remove a link between two notes', '{"note_id":"<id>","target_note_id":"<id2>"}', '{}', NULL),
  ('create_journal', 'memory', 'Create a journal entry', '{"title":"Day 47","content":"Today I...","mood":"focused","energy_level":8}', '{}', NULL),
  ('update_journal', 'memory', 'Update a journal entry', '{"journal_id":"<id>","content":"Updated..."}', '{}', NULL),
  ('delete_journal', 'memory', 'Delete a journal entry', '{"journal_id":"<id>"}', '{}', NULL),
  ('create_vault', 'memory', 'Create a Vault Codex entry (permanent knowledge record)', '{"title":"Core Principle #1","content":"Never break the chain...","category":"principles","tags":["discipline"]}', '{}', NULL),
  ('update_vault', 'memory', 'Update a vault entry', '{"vault_id":"<id>","content":"Updated content"}', '{}', NULL),
  ('delete_vault', 'memory', 'Delete a vault entry', '{"vault_id":"<id>"}', '{}', NULL),
  ('youtube_ingest', 'memory', 'Ingest a YouTube video — transcribes it and saves to notes or vault', '{"url":"https://youtube.com/watch?v=...","save_as":"note"}', '{}', 'mavis-youtube-ingest')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- SKILLS & INVENTORY
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('create_skill', 'skills', 'Create a new skill node', '{"name":"Cold Email Mastery","description":"B2B outreach at scale","category":"business","max_level":5}', '{}', NULL),
  ('update_skill', 'skills', 'Upgrade or update a skill', '{"skill_id":"<id>","current_level":3}', '{}', NULL),
  ('delete_skill', 'skills', 'Delete a skill', '{"skill_id":"<id>"}', '{}', NULL),
  ('create_subskill', 'skills', 'Add a subskill under a parent skill', '{"name":"Personalization","parent_skill_id":"<id>","description":"Deep research per prospect"}', '{}', NULL),
  ('create_inventory_item', 'skills', 'Add an item to inventory', '{"name":"Strategy Playbook","type":"artifact","description":"Core system doc","stat_effects":[{"label":"INT","value":10,"unit":""}],"is_equipped":false}', '{}', NULL),
  ('update_inventory_item', 'skills', 'Update an inventory item (equip, rename, change stats)', '{"item_id":"<id>","is_equipped":true}', '{}', NULL),
  ('delete_inventory_item', 'skills', 'Remove an inventory item', '{"item_id":"<id>"}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- PERSONAS & ALLIES
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('forge_persona', 'social', 'Create a new AI persona via the persona forge (full character build)', '{"name":"Nora Vale","archetype":"Creator","personality":"Bold, witty, magnetic","voice":"Confident and casual"}', '{}', 'mavis-persona-forge'),
  ('create_persona', 'social', 'Create a persona record directly', '{"name":"Nora Vale","description":"Content creator persona","archetype":"Creator"}', '{}', NULL),
  ('delete_persona', 'social', 'Delete a persona', '{"persona_id":"<id>"}', '{}', NULL),
  ('create_ally', 'social', 'Add an ally to the network', '{"name":"Marcus Chen","role":"Investor","notes":"Met at Web Summit 2024"}', '{}', NULL),
  ('update_ally', 'social', 'Update ally info', '{"ally_id":"<id>","notes":"Now a portfolio company"}', '{}', NULL),
  ('delete_ally', 'social', 'Remove an ally', '{"ally_id":"<id>"}', '{}', NULL),
  ('create_council_member', 'social', 'Add a council member (AI advisor persona)', '{"name":"The Strategist","role":"advisor","personality":"Cold logic, first-principles","domain":"business_strategy"}', '{}', NULL),
  ('update_council_member', 'social', 'Update council member', '{"member_id":"<id>","is_active":true}', '{}', NULL),
  ('delete_council_member', 'social', 'Remove council member', '{"member_id":"<id>"}', '{}', NULL),
  ('council_notify', 'social', 'Send a message to a council member for their response', '{"member_id":"<id>","message":"Should we launch this product now?"}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- CONTACTS & CRM
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('create_contact', 'crm', 'Create a new contact record', '{"name":"Sarah Johnson","email":"sarah@company.com","company":"Acme Corp","role":"CEO","tags":["lead","warm"]}', '{}', NULL),
  ('update_contact', 'crm', 'Update contact details', '{"contact_id":"<id>","status":"client"}', '{}', NULL),
  ('log_interaction', 'crm', 'Log an interaction with a contact (call, meeting, email)', '{"contact_id":"<id>","type":"call","notes":"Discussed partnership","next_action":"Send proposal"}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- CALENDAR & TIME
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('create_calendar_event', 'calendar', 'Create a calendar event (ISO 8601 timestamps)', '{"title":"Strategy Session","start_time":"2025-07-01T10:00:00Z","end_time":"2025-07-01T11:00:00Z","description":"Q3 planning"}', '{}', NULL),
  ('update_calendar_event', 'calendar', 'Update a calendar event', '{"event_id":"<id>","start_time":"2025-07-01T14:00:00Z"}', '{}', NULL),
  ('delete_calendar_event', 'calendar', 'Delete a calendar event', '{"event_id":"<id>"}', '{}', NULL),
  ('log_time', 'calendar', 'Log a time-tracking entry', '{"description":"Deep work — brand strategy","duration_minutes":120,"category":"work","project":"Prymal"}', '{}', NULL),
  ('create_meeting_note', 'calendar', 'Create meeting notes with action items', '{"title":"Investor Call","attendees":["Sarah","Marcus"],"summary":"Discussed Series A timeline","action_items":["Send deck by Friday"]}', '{}', NULL),
  ('update_meeting_note', 'calendar', 'Update meeting notes', '{"meeting_id":"<id>","action_items":["Send deck","Follow up Monday"]}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- HEALTH & WELLNESS
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('log_health_metric', 'health', 'Log a health metric (weight, sleep, HRV, steps, calories)', '{"metric":"sleep_hours","value":7.5,"date":"2025-06-13","notes":"Deep sleep was low"}', '{}', NULL),
  ('health_log', 'health', 'Log multiple health metrics at once', '{"weight_kg":82,"sleep_hours":7,"hrv":45,"steps":8200,"calories":2100}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- FINANCE
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('log_expense', 'finance', 'Log a financial expense', '{"amount":299,"currency":"USD","category":"software","description":"Notion subscription","date":"2025-06-13"}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- INTELLIGENCE
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('create_competitor', 'intelligence', 'Add a competitor to track', '{"name":"Notion","website":"notion.so","category":"productivity","notes":"Main comparison target"}', '{}', NULL),
  ('update_competitor', 'intelligence', 'Update competitor intel', '{"competitor_id":"<id>","notes":"Launched AI features in v3"}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('send_notification', 'notifications', 'Send an in-app notification', '{"title":"Quest Complete!","body":"You''ve completed the launch quest.","type":"success"}', '{}', NULL),
  ('push_notification', 'notifications', 'Send a push notification via web push', '{"title":"MAVIS Alert","body":"Your morning brief is ready","url":"/mavis"}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- SMART HOME / IoT
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('smart_home', 'iot', 'Control smart home devices via Home Assistant or Hue', '{"action":"turn_on","entity_id":"light.living_room"}', '{"HOME_ASSISTANT_URL"}', 'mavis-home'),
  ('iot_control', 'iot', 'Generic IoT device control', '{"device":"thermostat","action":"set_temp","value":72}', '{"HOME_ASSISTANT_URL"}', 'mavis-home')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- AUTOMATION
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('create_workflow', 'automation', 'Create a multi-step automated workflow (can run immediately or on schedule)', '{"name":"Daily Quest Brief","trigger_type":"schedule","trigger_config":{"cron":"0 9 * * *"},"steps":[],"is_active":true}', '{}', 'mavis-workflow-run'),
  ('run_workflow', 'automation', 'Run an existing workflow or ad-hoc steps', '{"workflow_id":"<id>"}', '{}', 'mavis-workflow-run'),
  ('create_webhook', 'automation', 'Register an outbound webhook to Zapier/Make/n8n', '{"name":"Zapier Hook","endpoint_url":"https://hooks.zapier.com/...","event_types":["quest.completed"],"active":true}', '{}', NULL),
  ('plan_execute', 'automation', 'AI-planned multi-step execution for complex goals', '{"goal":"Build a full outreach campaign","context":"B2B SaaS targeting mid-market","auto_create_quests":true}', '{}', 'mavis-planner')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- CODE EXECUTION
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('execute_code', 'code', 'Execute JavaScript/TypeScript code in a sandbox and return result', '{"language":"javascript","code":"const nums = [1,2,3]; return nums.reduce((a,b)=>a+b,0);"}', '{}', 'mavis-code-exec')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- CONTENT & MEDIA
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('generate_image', 'content', 'Generate an AI image', '{"prompt":"Cyberpunk cityscape at dusk, neon reflections","style":"photorealistic","size":"1024x1024"}', '{"REPLICATE_API_KEY"}', NULL),
  ('generate_video', 'content', 'Generate an AI video clip', '{"prompt":"Epic cinematic drone shot of a futuristic city","duration":5}', '{"REPLICATE_API_KEY"}', 'mavis-video-gen'),
  ('video_status', 'content', 'Check status of a video generation job', '{"job_id":"<id>"}', '{}', 'mavis-video-gen'),
  ('analyze_video', 'content', 'Analyze a video file or URL for content insights', '{"url":"https://...","questions":["What is the main message?","List all speakers"]}', '{}', NULL),
  ('generate_clips', 'content', 'Generate short clips from a longer video', '{"video_id":"<id>","clip_count":5,"clip_duration":30}', '{}', 'mavis-video-editor'),
  ('render_clip', 'content', 'Render/export a video clip', '{"project_id":"<id>","format":"mp4","quality":"1080p"}', '{}', 'mavis-video-render'),
  ('create_website', 'content', 'Generate a full AI website for a business', '{"client_name":"Prymal Media","business_type":"agency","style":"modern","color_scheme":"purple"}', '{}', 'mavis-web-builder'),
  ('publish_webpage', 'content', 'Publish a page to an existing website', '{"project_id":"<id>","page_type":"about","title":"About Us","content_brief":"Focus on our mission..."}', '{}', 'mavis-web-builder'),
  ('create_widget', 'content', 'Generate an embeddable widget (chat, lead capture, FAQ)', '{"widget_type":"lead_capture","business_name":"Prymal","primary_color":"#7C3AED"}', '{}', 'mavis-widget-gen'),
  ('generate_pdf', 'content', 'Generate a downloadable PDF document from HTML content', '{"title":"Q2 Report","content_html":"<h1>Report</h1><p>...</p>"}', '{}', 'mavis-pdf-gen'),
  ('repurpose_content', 'content', 'Transform long-form content into platform-optimized social variants', '{"content":"[article text]","platforms":["twitter","linkedin","instagram","youtube"]}', '{}', 'mavis-repurpose')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- Note: youtube_ingest appears in both 'memory' and 'content' categories per the spec.
-- The 'memory' insert above owns the canonical row. The content variant is a no-op on conflict.
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('youtube_ingest', 'content', 'Transcribe and ingest a YouTube video into notes or vault', '{"url":"https://youtube.com/watch?v=...","save_as":"note"}', '{}', 'mavis-youtube-ingest')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- SOCIAL MEDIA / NORA
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('nora_tweet', 'nora', 'Post a tweet as the Nora Vale persona', '{"content":"Just shipped something that changes everything. 🧵","generate":false}', '{"TWITTER_NORA_ACCESS_TOKEN"}', 'mavis-nora-post'),
  ('nora_linkedin', 'nora', 'Post to LinkedIn as Nora Vale (manual content or AI-generated)', '{"content":"3 things I learned building an AI OS from scratch...","generate":false}', '{"LINKEDIN_NORA_ACCESS_TOKEN"}', 'mavis-nora-linkedin'),
  ('nora_instagram', 'nora', 'Post to Instagram as Nora Vale', '{"content":"The caption for this post","image_url":"https://...","generate":false}', '{"INSTAGRAM_NORA_ACCESS_TOKEN"}', 'mavis-nora-instagram')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- COMMUNICATION
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('send_email', 'communication', 'Send an email via Resend (write manually or AI-generate the body)', '{"to":"client@example.com","subject":"Follow-up","body":"Hi Sarah..."}', '{"RESEND_API_KEY"}', 'mavis-email-send'),
  ('send_sms', 'communication', 'Send an SMS via Twilio', '{"to":"+15551234567","message":"Your appointment is tomorrow at 2pm"}', '{"TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN"}', 'mavis-sms'),
  ('send_whatsapp', 'communication', 'Send a WhatsApp message via Twilio', '{"to":"+15551234567","message":"Hey, following up on our meeting"}', '{"TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN"}', 'mavis-sms'),
  ('speak', 'communication', 'Convert text to speech using ElevenLabs or Kokoro TTS', '{"text":"Operator, your morning brief is ready.","gender":"female","voice_id":"mavis"}', '{"ELEVENLABS_API_KEY"}', 'mavis-tts'),
  ('phone_call', 'communication', 'Initiate an outbound AI phone call via VAPI to accomplish a real-world task', '{"to":"+15551234567","purpose":"Reserve a table at La Piazza for tonight at 7pm for 2 people","caller_name":"MAVIS"}', '{"VAPI_API_KEY","VAPI_PHONE_NUMBER_ID"}', 'mavis-phone-call'),
  ('slack_message', 'communication', 'Send a message to Slack', '{"channel":"#general","text":"MAVIS reporting in: all systems nominal."}', '{"SLACK_BOT_TOKEN"}', 'mavis-slack-bot')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- WEB & RESEARCH
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('deep_research', 'research', 'Multi-step web research synthesis — searches, fetches sources, synthesizes a cited report', '{"query":"Latest AI regulations in the EU 2025","depth":3}', '{}', 'mavis-deep-research'),
  ('translate', 'research', 'Translate text to any language (auto-detects source)', '{"text":"Bonjour","target":"en"}', '{}', 'mavis-translate'),
  ('get_market_data', 'research', 'Real-time stock and crypto prices (no API key needed)', '{"type":"crypto","symbols":["BTC","ETH","SOL"]}', '{}', 'mavis-market-data'),
  ('get_weather', 'research', 'Current weather and forecast for any location', '{"location":"Tokyo, Japan"}', '{}', 'mavis-weather'),
  ('maps', 'research', 'Location services — geocode, directions, nearby places (OpenStreetMap, no API key)', '{"action":"nearby","address":"Times Square, NYC","amenity":"coffee"}', '{}', 'mavis-maps'),
  ('arxiv_search', 'research', 'Search academic papers on arXiv', '{"query":"multimodal large language models","category":"cs.AI","max_results":5}', '{}', 'mavis-arxiv')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- DOMAIN EFFECTS
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('create_domain_effect', 'domain', 'Create an active domain/curse/terrain effect that modifies character stats', '{"name":"Unlimited Void","effect_type":"domain","stat_modifiers":[{"label":"INT","value":30,"unit":""}],"area_effects":["All techniques nullified"],"is_active":true}', '{}', NULL),
  ('update_domain_effect', 'domain', 'Update a domain effect (toggle active, change modifiers)', '{"effect_id":"<id>","is_active":false}', '{}', NULL),
  ('delete_domain_effect', 'domain', 'Remove a domain effect', '{"effect_id":"<id>"}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- INTEGRATIONS
-- ---------------------------------------------------------------------------
-- Note: arxiv_search also appears in 'research'. The canonical row is owned by that block.
-- This insert updates only if the row doesn't exist yet; the ON CONFLICT clause keeps
-- whichever description was most recently applied.
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('gumroad_action', 'integrations', 'Create or list Gumroad products', '{"action":"create","title":"The Operator Playbook","description":"A system for building your own AI OS","price_cents":4700}', '{"GUMROAD_ACCESS_TOKEN"}', 'mavis-gumroad')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- arxiv_search duplicate — updates description/params to the integrations variant if it was
-- already inserted by the research block (last write wins, which is fine for idempotency).
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('arxiv_search', 'integrations', 'Search and retrieve academic papers', '{"query":"transformer attention mechanisms","max_results":10,"sort_by":"submittedDate"}', '{}', 'mavis-arxiv')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- RANKINGS
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('create_ranking', 'rankings', 'Create a new ranking system', '{"name":"Power Level","description":"Overall operator power rating","category":"rpg"}', '{}', NULL),
  ('add_to_rankings', 'rankings', 'Add an entry to a ranking', '{"ranking_id":"<id>","entity_name":"Calvin","score":9250}', '{}', NULL),
  ('update_ranking', 'rankings', 'Update a ranking entry', '{"ranking_id":"<id>","score":9800}', '{}', NULL),
  ('delete_ranking', 'rankings', 'Delete a ranking', '{"ranking_id":"<id>"}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- SYSTEM
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('list_capabilities', 'system', 'List all MAVIS capabilities, optionally filtered by category', '{"category":"communication"}', '{}', NULL),
  ('search_capabilities', 'system', 'Search capabilities by keyword', '{"query":"email"}', '{}', NULL),
  ('propose_action', 'system', 'Propose a new action or system enhancement', '{"title":"Add sleep tracking","description":"Integrate Oura ring data into health logs"}', '{}', NULL),
  ('propose_product', 'system', 'Propose a product idea to log for future development', '{"title":"Mavis Mobile App","description":"Native iOS companion"}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;
