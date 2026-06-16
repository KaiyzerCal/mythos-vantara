-- Migration: 20260614000001_mavis_capabilities_update
-- Adds the 28 new action types wired in the capability audit sessions.
-- All inserts are ON CONFLICT DO UPDATE — safe to re-run.

-- ---------------------------------------------------------------------------
-- NORA / SOCIAL
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('nora_tiktok', 'nora', 'Post to TikTok as Nora Vale (video post or AI-generated caption)', '{"content":"POV: you built your own AI OS","video_url":"https://...","generate":false}', '{"TIKTOK_NORA_ACCESS_TOKEN","TIKTOK_NORA_OPEN_ID"}', 'mavis-nora-tiktok'),
  ('schedule_post', 'nora', 'Queue a social post for future publishing (picked up by scheduler cron)', '{"platform":"twitter","content":"Something is coming. You will know when it is time.","scheduled_at":"2025-07-01T09:00:00Z","persona":"nora_vale"}', '{}', NULL)
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- KNOWLEDGE PROCESSING
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('extract_document', 'memory', 'Extract and embed any PDF, DOCX, CSV, JSON, or MD file into the knowledge graph', '{"file_url":"https://...","file_name":"Strategy Brief.pdf","file_type":"pdf"}', '{}', 'mavis-doc-extract'),
  ('process_attachment', 'memory', 'Transcribe, describe, and extract text from uploaded images, audio, video, or PDFs', '{"attachment_id":"<uuid>"}', '{}', 'mavis-attachment-process')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- MEETING INTELLIGENCE
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('prepare_meeting', 'calendar', 'Generate a full meeting brief from notes, journal, and relationship intel for a calendar event', '{"event_title":"Investor Call","event_start":"2025-07-01T10:00:00Z","attendees":["Sarah Chen","Marcus Williams"]}', '{}', 'mavis-meeting-prep'),
  ('transcribe_meeting', 'calendar', 'Transcribe audio — extracts summary, decisions, action items, next steps; optionally creates quests', '{"audio_url":"https://...","meeting_title":"Q3 Strategy Session","participants":["Calvin","Sarah"],"create_quests":true}', '{}', 'mavis-meeting-transcribe')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- HEALTH & PERFORMANCE
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('health_protocol', 'health', 'Generate personalized health recommendations from last 7 days of biometric data', '{"date":"2025-06-14"}', '{}', 'mavis-health-protocol'),
  ('performance_score', 'health', 'Compute daily 0-100 performance score; correlates biometrics, habits, output; identifies optimal work window', '{"date":"2025-06-14"}', '{}', 'mavis-performance-science')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- STRATEGIC REASONING
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('strategy_council', 'automation', 'Assemble 5 AI advisors (Strategist, Devil''s Advocate, Operator, Investor, Visionary) + Claude Opus synthesis for any strategic question', '{"question":"Should I launch Prymal as SaaS or agency first?","context":"$0 revenue, strong portfolio, 3 months runway"}', '{}', 'mavis-strategy-council'),
  ('crew_execute', 'automation', 'Decompose a complex goal into parallel subtasks; assign to specialized sub-agents; synthesize unified result', '{"goal":"Research top 5 MAVIS competitors and produce feature comparison matrix","context":"Focus on AI personal assistants and life OS tools"}', '{}', 'mavis-crew-orchestrator'),
  ('create_agent', 'automation', 'Build and deploy a branded customer AI agent with embedded widget for any business', '{"business_name":"Prymal Media","agent_name":"Aria","capabilities":["answer FAQs","book consultations","qualify leads"],"tone":"professional and warm","brand_color":"#7C3AED"}', '{}', 'mavis-agent-builder'),
  ('plan_execute', 'automation', 'AI-planned multi-step execution for complex goals', '{"goal":"Build a full outreach campaign","context":"B2B SaaS targeting mid-market","auto_create_quests":true}', '{}', 'mavis-planner')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- COMPUTER & TERMINAL
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('computer_use', 'code', 'Full browser/desktop automation via vision loop — give MAVIS a task, it executes step by step', '{"task":"Go to Notion and create a page called Q3 Strategy under the Projects database","url":"https://notion.so"}', '{}', 'mavis-computer-use'),
  ('terminal_exec', 'code', 'Persistent E2B sandbox shell — run any command, chain commands, session persists 30 min', '{"action":"exec","session_id":"<id>","cmd":"python3 analysis.py"}', '{}', 'mavis-terminal')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- CREATIVE & PRODUCTION
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('generate_seo', 'content', 'Generate full SEO package: schema.org JSON-LD, meta tags, OpenGraph, keyword strategy', '{"business_name":"Prymal Media","business_type":"agency","site_url":"prymal.com","location":"New York, NY","description":"AI-powered media agency"}', '{}', 'mavis-seo-engine'),
  ('design_website', 'content', 'Generate complete production-ready React website (8-9 files) via design engine', '{"brief":{"project_name":"Prymal.com","brand":"Prymal Media","project_goal":"Convert agency leads","target_audience":"DTC brands","key_features":["Portfolio","Services","Contact"]}}', '{}', 'mavis-design-engine'),
  ('create_avatar_video', 'content', 'Talking-head AI video: face image + script → lip-synced avatar via ElevenLabs TTS + SadTalker', '{"source_image_url":"https://...","text":"Hey, I just built an AI OS that runs my entire life.","voice_id":"mavis"}', '{"ELEVENLABS_API_KEY"}', 'mavis-avatar-video'),
  ('create_product', 'content', 'Generate premium digital product (guide/prompt pack/course) with infographics as PDF; auto-list on Gumroad/Stripe', '{"title":"The Operator Playbook","description":"A complete system for building your AI-powered life OS","audience":"ambitious founders and builders","category":"guide","price_cents":4700}', '{"GUMROAD_ACCESS_TOKEN"}', 'mavis-product-creator')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- WORLD & MARKET INTELLIGENCE
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('build_world_model', 'intelligence', 'Synthesize all operator data into unified world state with domain scores, trajectory, risks, and opportunities', '{}', '{}', 'mavis-world-model'),
  ('scan_demand', 'intelligence', 'Analyze skills, products, and market signals to surface 3-5 product opportunities with pricing', '{}', '{}', 'mavis-demand-scan'),
  ('hn_digest', 'research', 'Fetch top Hacker News stories + all subscribed RSS feeds; save to knowledge base', '{"max_stories":15}', '{}', 'mavis-hn-digest'),
  ('polymarket_search', 'research', 'Search live Polymarket prediction markets by keyword', '{"query":"AI regulation 2025","limit":5}', '{}', 'mavis-polymarket'),
  ('polymarket_trending', 'research', 'Get trending Polymarket prediction markets by volume', '{"limit":10}', '{}', 'mavis-polymarket'),
  ('polymarket_get', 'research', 'Get full details and current odds for a specific Polymarket market by ID', '{"market_id":"<id>"}', '{}', 'mavis-polymarket')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- SCREEN CONTEXT
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('screenpipe_search', 'intelligence', 'Search OCR + audio transcripts from local Screenpipe daemon', '{"query":"meeting notes from yesterday","limit":10}', '{}', 'mavis-screenpipe'),
  ('screenpipe_context', 'intelligence', 'Pull recent screen activity as context for MAVIS memory window', '{"limit":20}', '{}', 'mavis-screenpipe'),
  ('screenpipe_recent', 'intelligence', 'Get last N captured screen/audio items chronologically', '{"limit":10}', '{}', 'mavis-screenpipe')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;

-- ---------------------------------------------------------------------------
-- LEARNING & OUTCOMES
-- ---------------------------------------------------------------------------
INSERT INTO mavis_capabilities (action_type, category, description, example_params, requires_secrets, edge_function) VALUES
  ('socratic_tutor', 'system', 'Guided learning that never gives direct answers — leads operator to discover solutions through questions', '{"message":"I want to understand how neural networks learn","topic_id":"machine-learning"}', '{}', 'mavis-khanmigo'),
  ('record_outcome', 'system', 'Log a MAVIS prediction for accuracy tracking; feeds the self-evolution loop', '{"source_type":"prediction","prediction_text":"Calvin will complete the pitch deck by June 20","predicted_outcome":"Pitch deck submitted","due_days":7}', '{}', 'mavis-outcome-tracker'),
  ('export_fine_tune_data', 'system', 'Export conversation history as JSONL for model fine-tuning (ChatML / Alpaca / Trajectory format)', '{"format":"openai","min_quality":7,"limit":500}', '{}', 'mavis-fine-tune-export')
ON CONFLICT (action_type) DO UPDATE SET
  description    = EXCLUDED.description,
  example_params = EXCLUDED.example_params;
