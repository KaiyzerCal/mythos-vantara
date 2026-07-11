# CODEXOS / MAVIS — Capability Shard

**Drop this file into any Claude or MAVIS project folder.**
It is the complete capability map for the CODEXOS operating system — all skills, edge functions, and action types available to Claude and MAVIS. Read it when you need to know what's already built before writing new code or routing a task.

Repo: `KaiyzerCal/mythos-vantara` · Stack: React + Vite + Supabase + Deno edge functions
Operator: Calvin (caljohnathon@gmail.com)

---

## 1 · CLAUDE SKILLS  `.claude/skills/`

Skills are atomic instruction sets that activate on trigger phrases. 57 files total.

### Orchestration
| Skill | Triggers | Does |
|---|---|---|
| `route` | route, who should handle, classify, what specialist | Routes work to the right team specialist |
| `inbox-scan` | inbox-scan, what's in the outbox, check outbox, scan inbox | Scans Outbox/ for queued briefs |
| `pipeline-deliverable` | pipeline, standard deliverable, publish, full pipeline, from research to draft | Runs Researcher→Strategist→Writer→Editor pipeline |
| `pipeline-research` | deep research, deep dive, landscape, competitive analysis, research only | Research-only pipeline |
| `pipeline-recurring` | newsletter, weekly, recurring, every Monday, cadence, regular output | Scheduled recurring content pipeline |
| `hire-specialist` | hire, new specialist, I need someone who, add a role | Creates a new specialist role in Team/ |
| `handoff` | handoff, context transfer, session handoff, hit context limit, switch agents | Cross-session state transfer template |
| `ponytail` | ponytail, minimal code, decision ladder, over-engineering, ponytail-review, ponytail-audit | 6-step ladder to prevent over-engineering; triggers /ponytail-review and /ponytail-audit commands |
| `effective-agent-skills` | write a skill, add skill, skill authoring, skill design, SKILL.md format, skill quality check | Canonical standard for authoring .claude/skills/ files |
| `no-mistakes` | no-mistakes, pre-push validation, git proxy, push validation, validate before push, code quality gate | AI validation pipeline intercepts `git push` and runs quality checks |

### Content Creation
| Skill | Triggers | Does |
|---|---|---|
| `research` | research, find, benchmark, investigate, look into, source | Gathers sources and benchmarks (Researcher role) |
| `draft` | write, draft, post, copy, email, article, caption, thread, script | Creates content on any surface (Writer role) |
| `review` | review, edit, check voice, QA, proofread, quality check, does this sound right | Voice + claim integrity gate (Editor role) |
| `analyze` | analyze, report, metrics, KPIs, data, performance, numbers, what's the trend, dashboard | Data interpretation and KPI reporting (Analyst role) |
| `summarise` | summarise, summarize, condense, tldr, short version, key points, recap | Condenses long content |
| `repurpose` | repurpose, adapt, convert, reformat, turn this into, make a thread, social version | Reformats content for a different surface |
| `aeo` | AEO, LLM citation, optimize for Perplexity, get cited by Claude, E-E-A-T audit, answer engine optimization | Scores and rewrites content to maximize LLM citation frequency |
| `interview-style-doc-building` | interview style doc, build life doc, one question at a time, life priorities doc, SSOT interview, patch not write | Builds authoritative SSOT documents via one-Q-at-a-time Q&A loop |
| `video-production` | video production, make a video, produce video, ai video, video pipeline, explainer video, montage, openmontage | Full AI video pipeline (script→storyboard→voiceover→render) |
| `remotion` | remotion, programmatic video, react video, video from code, data-driven video, render video | Programmatic React video with Remotion |
| `character-animation` | character animation, pixel art, spritesheet, sprite animation, game character, 64x64 sprite | 64×64 pixel-art spritesheet generation for game characters |
| `clone-website` | clone website, reverse engineer website, website cloner, recreate website, copy website design, extract design tokens | AI reverse-engineering of existing websites into React/Tailwind |

### Developer Tools
| Skill | Triggers | Does |
|---|---|---|
| `design-md` | design.md, design tokens, design system for agents, agent-friendly design system, wcag contrast, dtcg tokens | Agent-readable design token format; DTCG spec with WCAG contrast validation |
| `dependency-auditor` | dependency audit, scan dependencies, license compliance, CVE scan, vulnerable packages, npm audit, pip audit | Multi-language CVE + license compliance + upgrade planning (npm/Python/Go/Rust/Ruby/Java) |
| `security-pretooluse-hook` | add security hook, block unsafe code, detect command injection, prevent SQL injection, pretooluse security | PreToolUse hook scans Edit/Write before execution — catches 12 dangerous patterns |
| `skill-security-auditor` | audit skill, scan skill for security, skill security check, before adding skill, skill supply chain | PASS/WARN/FAIL security scan before adding a new .claude/skills/ file |
| `env-secrets-manager` | secrets audit, env hygiene, secret leak, rotate secret, dotenv check, supabase secrets, gitleaks, credential rotation | Supabase secrets inventory, gitleaks setup, rotation workflow |
| `delegating-to-agents` | delegate to agent, which agent, route to codex, route to pi, agent routing, TUI prompt rules, cmux prompt | Routing matrix for AI coding agents + TUI prompt rules (newline=submit, use period-space separator) |
| `agent-self-scheduling` | schedule agent, cron agent, unattended run, background agent, heartbeat pattern, schedule claude code | Patterns for scheduled/unattended Claude Code runs via cron + heartbeat |
| `agentsmesh` | agentsmesh, multi-agent orchestration, parallel agents, agent fleet, pod fleet, worktree agents | Control plane for dozens of parallel AI agents (Go + gRPC + worktree isolation) |
| `openclaude` | openclaude, multi-provider, model routing, grpc agent, cheap agents, ollama routing, deepseek routing | Multi-provider Claude Code fork; routes tasks to DeepSeek/Ollama/OpenAI by cost tier |
| `deepapi` | deepapi, scrape linkedin, scrape github profile, scrape x twitter, deep research api, people search api, email via deepapi | Web scraping + people search + email via DeepAPI (LinkedIn/GitHub/X/YouTube) |
| `hermes-patterns` | hermes, acp, agent communication protocol, multi-platform bot, telegram gateway, self-improving agent | Python/FastAPI multi-agent delegation via ACP protocol + Telegram gateway |
| `open-notebook` | open-notebook, notebooklm, knowledge ingestion, pdf ingestion, research synthesis, multi-speaker podcast | Self-hosted NotebookLM alternative (PDF/video/web → podcast/summary/Q&A) |
| `ruview-integration` | ruview, presence detection, vitals sensing, esp32, ambient intelligence, through-wall sensing | ESP32 WiFi sensing for presence/breathing/heart rate without cameras |
| `navi-patterns` | navi patterns, navi.exe, predecessor app, component archaeology, vantara schema reference | Component archaeology for NAVI.EXE (predecessor to VANTARA.EXE) — schema/type reference |
| `openjarvis-patterns` | openjarvis, jarvis, module archetypes, morning digest, agent module patterns | Stanford OpenJarvis module archetypes (morning digest, memory consolidation, task tracking) |
| `inbox-zero` | inbox zero, email management, ai email, email assistant, organize inbox, reply drafting, bulk unsubscribe | AI email management — rules, drafting, bulk triage, cold-email blocking |

### Investment Research (Berkshire Council)
All 19 invest-* skills belong to the Analyst role and power the 4-member Berkshire council (Buffett / Munger / Duan Yongping / Li Lu).

| Skill | Triggers |
|---|---|
| `invest-research` | investment research, research company, analyze stock, should I buy, investment thesis, company analysis |
| `invest-data` | financial data, verify financial data, get financials, data validation, financial data sources |
| `invest-checklist` | investment checklist, pre-purchase checklist, should I buy this, stock checklist, before I buy |
| `invest-quality` | quality screen, quality screening, is this a quality company, screen companies, quick quality check |
| `invest-management` | management deep dive, analyze management, assess CEO, leadership quality, is management good |
| `invest-earnings` | earnings review, read earnings, financial report, 10-K, 10-Q, quarterly results, earnings analysis |
| `invest-earnings-team` | earnings team, deep earnings analysis, earnings deep dive, team earnings, publish earnings |
| `invest-industry` | industry research, sector analysis, industry landscape, sector deep dive, understand this industry |
| `invest-industry-funnel` | industry funnel, screen industry, find best stocks, narrow down companies, investment funnel |
| `invest-team` | investment team, four masters, parallel analysis, council analysis, berkshire team, multi-agent invest |
| `invest-thesis-tracker` | thesis tracker, track thesis, investment thesis, monitor position, is my thesis still valid |
| `invest-thesis-drift` | thesis drift, detect drift, has my thesis drifted, am I rationalizing, confirmation bias check |
| `invest-news` | news pulse, stock moved, why did stock drop, price movement, news analysis, what happened to |
| `invest-portfolio` | portfolio review, review my portfolio, portfolio analysis, position sizing, rebalance portfolio |
| `invest-private` | private company research, private company analysis, unlisted company, pre-IPO, startup research |
| `invest-deep-series` | deep company series, deep dive series, write series about, multi-part analysis, comprehensive company study |
| `invest-bottleneck` | bottleneck hunter, supply chain bottleneck, find bottleneck, chokepoint investing |
| `invest-dyp-ask` | dyp ask, duan yongping, duan framework, ask duan, business quality check, what would duan think, stop doing list |
| `invest-article` | investment article, write investment post, publish investment analysis, investment content, investment write-up |

---

## 2 · MAVIS EDGE FUNCTIONS  `supabase/functions/`

303 Deno edge functions (verified against repo 2026-07-11). Core functions are fail-fast deployed on every `git push main`; all others deploy in parallel.

### Chat & Council
| Function | Purpose |
|---|---|
| `mavis-chat` | Primary LLM gateway — streaming SSE, multi-provider waterfall (Gemini→Groq→OpenAI→Claude→Grok), ReAct agentic loop, 30+ tool types, memory recall, web search |
| `mavis-council-session` | Structured 3-round council debate (POSITION→CHALLENGE→SYNTHESIS) — streams each member's LLM response live |
| `mavis-council-heartbeat` | Keeps council session alive; triggers proactive nudges from council members |
| `mavis-discourse-runner` | Multi-member group discourse — routes each message to all relevant members in parallel |
| `mavis-strategy-council` | 5-advisor panel + Claude Opus synthesis with 20K thinking budget |

### Action Execution
| Function | Purpose |
|---|---|
| `mavis-actions` | Primary action router — reads `body.actions[]` array, executes create/update/delete across all CODEXOS tables |
| `mavis-action-executor` | Google Workspace direct executor (Drive/Sheets/Tasks) with OAuth token management |
| `mavis-autonomous-actions` | Queues actions that require operator approval before execution |
| `mavis-autonomous-engine` | Background autonomous decision loop — evaluates standing orders, triggers proactive actions |
| `mavis-autonomous-runner` | Scheduled autonomous run executor; fires from cron, executes queued plans |

### Agent Systems
| Function | Purpose |
|---|---|
| `mavis-agent` | ReAct tool-use agent (Gemini Pro) — web search, code exec, file ops, API calls |
| `mavis-agent-builder` | Creates new AI agents dynamically from a description |
| `mavis-agent-identity` | Manages agent persona identity files (agent_folders: identity/ops/refs/evals) |
| `mavis-agent-reach` | Dispatches a task to a remote agent or persona over HTTP |
| `mavis-agent-serve` | Serves agent capabilities over a REST endpoint (A2A pattern) |
| `mavis-crew-orchestrator` | CrewAI-style multi-agent orchestration |
| `mavis-director` | High-level director agent — decomposes goals into sub-agent tasks |
| `mavis-mini-agent` | Lightweight single-task agent for Google, social, and task routing |
| `mavis-orchestrator` | Main routing orchestrator — classifies intent and dispatches to specialist functions |
| `mavis-a2a` | Agent-to-Agent protocol endpoint |
| `mavis-a2a-gateway` | A2A gateway — routes cross-agent calls with auth |

### Memory & Learning
| Function | Purpose |
|---|---|
| `mavis-dream` | Nightly 3-phase memory processing: Light (dedup) → REM (cross-session patterns → mavis_knowledge) → Deep (importance decay + archive). Cron: 03:30 UTC |
| `mavis-memory-embed` | Embeds text into vector memory (pgvector) for semantic recall |
| `mavis-memory-agent` | Conversational interface for querying and managing memory |
| `mavis-memory-consolidate` | Merges related memories, removes redundancy |
| `mavis-brain-consolidate` | Deep memory consolidation — extracts durable knowledge from episodic memories |
| `mavis-consolidate` | General-purpose consolidation runner |
| `mavis-knowledge` | Stores and retrieves structured knowledge facts |
| `mavis-archivist` | Long-term archival — moves low-importance memories to cold storage |
| `mavis-tacit-prune` | Prunes redundant tacit learning entries |
| `mavis-compound-learning` | Extracts compound learning patterns across sessions |
| `mavis-spaced-repetition` | Surfaces memories and notes on spaced-repetition schedule |
| `mavis-learning-engine` | Identifies learning opportunities from conversation history |
| `mavis-user-model-refresh` | Rebuilds the user model from recent interactions |

### Triggers & Autonomy
| Function | Purpose |
|---|---|
| `mavis-heartbeat` | Keep-alive cron — checks flag table, triggers LLM work only when flagged (fast/cheap pattern) |
| `mavis-trigger-engine` | Event-based trigger evaluation — fires functions when conditions are met |
| `mavis-event-dispatcher` | Dispatches events to subscribed handlers |
| `mavis-event-router` | Routes events by type to the correct function |
| `mavis-signal-watcher` | Monitors signals (RSS, webhooks, APIs) for trigger conditions |
| `mavis-proactive-agent` | Proactively messages Calvin when conditions warrant (standing orders, streak breaks, goal blockers) |
| `mavis-proactive-nudge` | Sends a targeted nudge based on current state |
| `mavis-push-notify` | Sends push notifications via web push or FCM |
| `mavis-announce` | Broadcasts system announcements |
| `mavis-cron-setup` | Registers and manages Supabase cron jobs |

### Persona & Identity
| Function | Purpose |
|---|---|
| `mavis-persona-forge` | Creates a new AI persona (name/archetype/personality/voice) and stores agent_folders |
| `mavis-persona-router` | Routes a message to the appropriate persona based on context |
| `mavis-persona-social` | Persona-driven social content generation |
| `mavis-emotion-engine` | Analyzes emotional state from conversation; updates relationship_states |
| `mavis-emotion-tag` | Tags memories and journal entries with emotional context |
| `mavis-narrative-engine` | Generates narrative arcs and story continuity for personas |
| `mavis-personaplex` | Multi-persona management and switching |
| `mavis-letta` | Letta (MemGPT) integration for persistent persona memory |
| `mavis-mem0` | Mem0 memory layer for personas |
| `mavis-receptionist-inbound` | Handles inbound calls/messages and routes to correct persona |
| `mavis-receptionist-config` | Configures receptionist persona settings |
| `mavis-receptionist-provision` | Provisions a new receptionist endpoint |

### Goals & Quests
| Function | Purpose |
|---|---|
| `mavis-goal-engine` | Core goal processing — evaluates active goals, calculates progress |
| `mavis-goal-loop` | Scheduled goal loop — runs nightly goal assessments |
| `mavis-goal-agent` | Conversational goal-setting and refinement agent |
| `mavis-goal-judge` | Judges whether a goal completion criterion has been met |
| `mavis-goal-review` | Generates weekly goal review report |
| `mavis-achievement-check` | Checks for unlocked achievements and awards XP |
| `mavis-streak-alerts` | Fires alerts when streaks are at risk or broken |
| `mavis-quest-nudge` | Nudges Calvin toward active quests based on context |
| `mavis-quest-calendar` | Syncs quests to calendar as time blocks |

### Telegram
| Function | Purpose |
|---|---|
| `telegram-webhook` | Primary Telegram interface — handles all messages, inline queries, callback buttons, approval flows |
| `telegram-setup` | Registers the Telegram webhook URL with BotFather API |
| `mavis-telegram-bot` | Alternative Telegram bot handler (streaming path) |
| `telegram-sender` | Sends outbound Telegram messages without handling inbound |
| `agent-telegram-gateway` | Routes agent outputs to Telegram |

### Email & Gmail
| Function | Purpose |
|---|---|
| `mavis-gmail-webhook` | Receives Gmail push notifications via Cloud Pub/Sub |
| `mavis-gmail-sync` | Syncs Gmail inbox to local tables |
| `mavis-gmail-watch` | Registers Gmail push watch subscription |
| `mavis-email-inbound` | Processes inbound emails from any provider |
| `mavis-email-send` | Sends emails with approval gate |
| `mavis-email-triage` | AI-powered email triage — categorizes and prioritizes inbox |

### Calendar
| Function | Purpose |
|---|---|
| `mavis-calendar-agent` | Conversational calendar management |
| `mavis-calendar-manage` | CRUD for calendar events |
| `mavis-calendar-sync` | Bidirectional Google Calendar sync |
| `mavis-reclaim` | Reclaim.ai integration for AI time blocking |
| `mavis-calendly-agent` | Calendly booking management |
| `mavis-booking` | General booking and scheduling |

### Voice
| Function | Purpose |
|---|---|
| `mavis-voicebox` | Primary TTS endpoint — routes to ElevenLabs or Cartesia |
| `mavis-tts` | Text-to-speech synthesis |
| `mavis-live-voice` | WebRTC live voice session handler |
| `mavis-voice-session` | Manages voice session state and history |
| `mavis-transcribe` | Audio transcription via Whisper |
| `mavis-transcribe-memo` | Transcribes voice memos and saves to journal |
| `mavis-phone-call` | Outbound phone call via Twilio |
| `mavis-vapi-webhook` | VAPI voice AI webhook handler |

### Google Integrations
| Function | Purpose |
|---|---|
| `mavis-google-oauth` | OAuth flow for Google services |
| `mavis-google-agent` | Conversational Google Workspace agent |
| `mavis-gdrive-sync` | Google Drive file sync |
| `mavis-gcontacts-sync` | Google Contacts sync |
| `mavis-sheets-agent` | Google Sheets read/write agent |
| `mavis-google-tasks-sync` | Google Tasks bidirectional sync |
| `mavis-github-sync` | GitHub repo sync and monitoring |

### Social Media
| Function | Purpose |
|---|---|
| `mavis-nora-post` | NORA social post generator |
| `mavis-nora-engage` | NORA engagement responses (replies/comments) |
| `mavis-nora-linkedin` | LinkedIn-specific content and engagement |
| `mavis-nora-instagram` | Instagram content and engagement |
| `mavis-nora-tiktok` | TikTok content strategy |
| `mavis-nora-discord` | Discord community engagement |
| `mavis-social-publisher` | Multi-platform social publishing |
| `mavis-social-scheduler` | Schedules social content across platforms |
| `mavis-twitter-agent` | X/Twitter agent |
| `mavis-instagram-agent` | Instagram agent |
| `mavis-instagram-trends` | Instagram trend monitoring |
| `mavis-blotato` | Blotato social media management integration |
| `mavis-persona-social` | Posts as a specific persona |

### Media Generation
| Function | Purpose |
|---|---|
| `mavis-image-gen` | Image generation (DALL-E / Flux / Stability) |
| `mavis-video-gen` | Video generation orchestrator |
| `mavis-video-editor` | AI video editing |
| `mavis-video-narrator` | Adds AI narration to video |
| `mavis-video-render` | Renders final video output |
| `mavis-video-download` | Downloads video from URL |
| `mavis-heygen` | HeyGen avatar video generation |
| `mavis-heygen-agent` | HeyGen agent with conversational interface |
| `mavis-higgsfield` | Higgsfield AI video generation |
| `mavis-avatar-video` | Talking avatar video synthesis |
| `mavis-music-gen` | Music generation via Suno/Udio |
| `mavis-logo-gen` | Logo generation |
| `mavis-poster-gen` | Marketing poster generation |
| `mavis-comic-agent` | Comic/graphic novel generation |

### Research & Web
| Function | Purpose |
|---|---|
| `mavis-deep-research` | Multi-step research synthesis with web evidence |
| `mavis-exa-agent` | Exa.ai semantic web search |
| `mavis-firecrawl-agent` | Firecrawl web scraping |
| `mavis-web-crawler` | General web crawler |
| `mavis-web-scraper` | Web scraping with structured extraction |
| `mavis-notebook-embed` | Ingests documents into Open Notebook knowledge base |
| `mavis-notebook-podcast` | Generates multi-speaker podcast from notebook content |
| `mavis-arxiv` | ArXiv paper search and summarization |
| `mavis-so-curator` | Stack Overflow knowledge curation |
| `mavis-so-scheduler` | Schedules SO content digests |
| `mavis-worldmonitor` | Monitors world events and news signals |
| `mavis-article-extractor` | Extracts structured content from articles |

### Health & Biometrics
| Function | Purpose |
|---|---|
| `mavis-oura-sync` | Oura ring data sync (sleep/HRV/readiness) |
| `mavis-whoop-sync` | WHOOP data sync |
| `mavis-strava-sync` | Strava activity sync |
| `mavis-health-monitor` | Health metric monitoring and alerts |
| `mavis-health-check` | System health check (not user health) |
| `mavis-health-protocol` | Generates personalized health recommendations from biometrics |
| `mavis-sleep-coach` | Sleep optimization coaching |
| `mavis-performance-science` | Performance science analysis |
| `mavis-wearable-overlay` | Aggregates wearable data across devices |
| `mavis-ruview-bridge` | RuView ESP32 presence/vitals bridge |

### Finance
| Function | Purpose |
|---|---|
| `mavis-finance` | Personal finance management and analysis |
| `mavis-plaid` | Plaid bank account data sync |
| `mavis-stock-analysis` | Stock analysis and screening |
| `mavis-market-data` | Market data fetching (prices, indicators) |
| `mavis-market-radar` | Market signal monitoring |
| `mavis-sec-agent` | SEC filing analysis |
| `mavis-polymarket` | Prediction market monitoring |
| `mavis-gumroad` | Gumroad product and sales management |
| `mavis-gumroad-webhook` | Gumroad event webhook handler |
| `mavis-stripe-webhook` | Stripe payment event handler |
| `mavis-expense-categorize` | Expense categorization from transactions |

### Notes & Knowledge Management
| Function | Purpose |
|---|---|
| `mavis-notion-agent` | Notion database management |
| `mavis-notion-sync` | Notion bidirectional sync |
| `mavis-obsidian-export` | Exports knowledge to Obsidian vault |
| `mavis-readwise-import` | Imports Readwise highlights |
| `mavis-airtable-agent` | Airtable data management |
| `mavis-daily-notes` | Generates daily notes automatically |
| `mavis-auto-journal` | Auto-generates journal entries from context |
| `mavis-meeting-notes` | Extracts and saves meeting notes |
| `mavis-meeting-prep` | Pre-meeting briefing generation |
| `mavis-meeting-transcribe` | Real-time meeting transcription |

### Dev & Code
| Function | Purpose |
|---|---|
| `mavis-code-agent` | AI coding agent with file system access |
| `mavis-code-delegate` | Delegates code tasks to specialized agents |
| `mavis-code-deploy` | Handles deployment pipelines |
| `mavis-code-exec` | Executes code snippets in sandbox |
| `mavis-e2b-sandbox` | E2B code execution sandbox |
| `mavis-python-exec` | Python code execution |
| `mavis-terminal` | Terminal command execution |
| `mavis-browser` | Browser automation (Playwright) |
| `mavis-browser-agent` | Conversational browser agent |
| `mavis-deploy` | General deployment orchestrator |
| `mavis-vercel-agent` | Vercel deployment management |
| `mavis-netlify` | Netlify deployment management |

### CRM & Business
| Function | Purpose |
|---|---|
| `mavis-crm-agent` | CRM data management and queries |
| `mavis-crm-nudge` | CRM follow-up nudge generation |
| `mavis-relationship-intel` | Relationship intelligence — tracks people and interactions |
| `mavis-salesforce` | Salesforce CRM integration |
| `mavis-lead-gen` | Lead generation and qualification |
| `mavis-gmb-agent` | Google My Business management |
| `mavis-maps` | Google Maps data and local search |
| `mavis-booking` | Booking and scheduling management |
| `mavis-calendly-agent` | Calendly scheduling management |

### Infrastructure
| Function | Purpose |
|---|---|
| `mavis-mcp` | MCP protocol server — exposes MAVIS tools to Claude desktop |
| `mavis-mcp-server` | Alternative MCP server endpoint |
| `mavis-api-gateway` | Central API gateway with auth and rate limiting |
| `mavis-multi-provider` | Multi-provider LLM routing (OpenClaude pattern) |
| `mavis-llm-router` | Routes requests to optimal LLM by cost/capability |
| `mavis-webhook` | Generic webhook receiver |
| `mavis-webhook-calendar` | Calendar-specific webhook handler |
| `mavis-webhook-dispatch` | Routes webhooks to correct handlers |
| `mavis-webhook-dispatcher` | Webhook fan-out dispatcher |
| `mavis-flowise` | Flowise flow execution |
| `embed-and-search` | Vector embedding + semantic search |
| `local-mesh-proxy` | Local device mesh network proxy |

### Ops & Quality
| Function | Purpose |
|---|---|
| `mavis-capability-audit` | Audits MAVIS's available capabilities |
| `mavis-eval` | Evaluates response quality |
| `mavis-quality-eval` | Scores response quality (score < 0.6 → adds critique note) |
| `mavis-run-doctor` | Diagnoses MAVIS system issues |
| `mavis-sentry-agent` | Sentry error monitoring integration |
| `mavis-security-scanner` | Security vulnerability scanning |

### Reviews & Reflection
| Function | Purpose |
|---|---|
| `mavis-morning-brief` | Generates Calvin's morning brief (goals/quests/calendar/health) |
| `mavis-morning-digest` | Abbreviated morning digest |
| `mavis-weekly-retro` | Weekly retrospective and performance review |
| `mavis-periodic-review` | Periodic life review (monthly/quarterly) |
| `mavis-reflection-agent` | Deep reflection and insight generation |
| `mavis-self-reflect` | MAVIS self-reflection on recent performance |
| `mavis-self-improve` | Identifies self-improvement opportunities |
| `mavis-self-evolve` | Applies self-improvement changes autonomously |
| `mavis-outcome-tracker` | Tracks outcome of past decisions and predictions |
| `mavis-pattern-insights` | Detects behavioral patterns across all data |

### NAVI (sub-system)
| Function | Purpose |
|---|---|
| `navi-heartbeat` | NAVI keep-alive |
| `navi-memory-consolidator` | NAVI memory consolidation |
| `navi-finetune-pipeline` | NAVI fine-tune data pipeline |
| `navi-finetune-check` | Checks NAVI fine-tune status |

### Prymal (brand sub-system)
| Function | Purpose |
|---|---|
| `prymal-brand-agent` | Prymal brand voice and content |
| `prymal-intel-agent` | Prymal competitive intelligence |
| `prymal-google-agent` | Prymal Google Workspace agent |
| `prymal-approval-flow` | Prymal content approval flow |
| `prymal-onboard` | Prymal user onboarding |
| `prymal-widget-loader` | Loads Prymal widget on client sites |

---

### Ingestion & Knowledge Intake
| Function | Purpose |
|---|---|
| `mavis-ingest` | URL / text / clip intake pipeline into knowledge base |
| `mavis-ingest-url` | Ingests a web article/page URL into the MAVIS knowledge base |
| `mavis-youtube-ingest` | Extracts YouTube video transcript and ingests it |
| `mavis-shortform-ingest` | Transcribes short-form video (TikTok, Reels, X) and ingests |
| `mavis-doc-extract` | Extracts text from uploaded documents, creates knowledge embeddings |
| `mavis-attachment-process` | Processes chat attachments — doc text extraction, audio/video transcription |
| `mavis-import` | Bulk data import |
| `mavis-data-export` | Exports key tables as JSON to Supabase storage for backup |
| `mavis-entity-graph` | Builds entity relationship graph from knowledge |
| `mavis-website-qa` | Live website crawl-and-answer without external APIs |
| `mavis-context-scout` | SuperContext pattern — scouts relevant context for a task |
| `mavis-prompt-vault` | Stores and retrieves reusable prompts |

### Planning & Autonomous Execution
| Function | Purpose |
|---|---|
| `mavis-planner` | Task/goal planning engine |
| `mavis-plans` | Persistent multi-session goal planning |
| `mavis-task-executor` | The autonomous worker — executes queued tasks |
| `mavis-workflow-run` | Workflow runner |
| `mavis-chain-builder` | AI-powered quest and skill chain linking |
| `mavis-predictive-engine` | Predicts outcomes/needs from patterns |
| `mavis-causal-engine` | Causal reasoning over events and decisions |
| `mavis-world-model` | Maintains world-state model for planning |
| `mavis-critic-agent` | Critiques plans/outputs before execution |
| `mavis-opportunity-scanner` | Scans signals for opportunities |
| `mavis-demand-scan` | Market/demand scanning |
| `mavis-inbound-webhook` | Event-driven proactive trigger gateway |
| `mavis-profile-updater` | Hermes-style user profile synthesis |

### Content, Marketing & Commerce
| Function | Purpose |
|---|---|
| `mavis-content-pipeline` | Autonomous NORA Vale content engine (Genviral/Outstand MCP) |
| `mavis-campaign-runner` | Runs multi-step marketing campaigns |
| `mavis-brand-voice` | Brand voice definition and enforcement |
| `mavis-seo-engine` | SEO analysis and optimization |
| `mavis-competitor-monitor` | Monitors competitors |
| `mavis-repurpose` | Content repurposing across surfaces |
| `mavis-beehiiv-agent` | Beehiiv newsletter management |
| `mavis-product-creator` | Creates digital products |
| `mavis-media-analyst` | Analyzes reference content from HeyGen/Higgsfield/Canva |

### Platform Integrations (added)
| Function | Purpose |
|---|---|
| `mavis-spotify-agent` | Spotify conversational agent |
| `mavis-spotify-control` | Spotify playback control |
| `mavis-spotify-sync` | Spotify listening data sync |
| `mavis-slack-agent` | Slack workspace agent |
| `mavis-slack-bot` | Slack bot with HMAC request verification |
| `mavis-discord-agent` | Discord agent |
| `mavis-reddit-agent` | Reddit agent |
| `mavis-youtube-agent` | YouTube channel/content agent |
| `mavis-linear-agent` | Linear issue tracking agent |
| `mavis-shopify-agent` | Shopify store agent |
| `mavis-wordpress` | WordPress publishing |
| `mavis-wpcom-oauth` | WordPress.com OAuth flow |
| `mavis-twilio-agent` | Twilio voice/SMS agent |
| `mavis-sms` | SMS send/receive |
| `mavis-apify` | Apify actor proxy |
| `mavis-weather` | Weather data |
| `mavis-translate` | Translation via LibreTranslate |
| `mavis-hn-digest` | Hacker News digest |
| `mavis-rss-monitor` | Proactive RSS/Atom feed monitoring → mavis_notes |

### Devices, Vision & Ambient
| Function | Purpose |
|---|---|
| `mavis-home` | Smart home / IoT integration |
| `mavis-device-bridge` | Bridges local devices to MAVIS |
| `mavis-galaxy-ring` | Samsung Galaxy Ring biometrics |
| `mavis-screenpipe` | Local desktop lifelogging context capture |
| `mavis-ambient-monitor` | Ambient signal monitoring |
| `mavis-computer-use` | OpenAI Responses API with Computer Use tool |
| `mavis-vision-agent` | Image/vision analysis agent |
| `mavis-realtime-v2` | OpenAI Realtime API v2 WebSocket proxy |

### Web Building & Design (added)
| Function | Purpose |
|---|---|
| `mavis-web-builder` | Builds websites |
| `mavis-site-editor` | Edits any uploaded HTML website file |
| `mavis-page-agent` | Page-level content agent |
| `mavis-design-engine` | Design generation engine |
| `mavis-design-system-gen` | Generates design systems |
| `mavis-pdf-gen` | Renders professional PDFs from templates or raw HTML |
| `mavis-form-submit` | Handles form submissions |

### Widgets
| Function | Purpose |
|---|---|
| `mavis-widget-api` | Widget API with per-widget rate limiting |
| `mavis-widget-gen` | Generates embeddable widgets |
| `mavis-widget-plugin` | Widget plugin loader |
| `stripe-widget-webhook` | Stripe webhook for widget payments |

### Learning & Tutoring
| Function | Purpose |
|---|---|
| `mavis-khanmigo` | Socratic tutoring engine |
| `mavis-flashcard-agent` | Flashcard generation and review |
| `mavis-story-agent` | Story generation agent |

### Fine-Tuning
| Function | Purpose |
|---|---|
| `mavis-fine-tune-export` | Exports MAVIS conversations for Ollama fine-tuning |
| `mavis-openai-finetune` | OpenAI fine-tune job management |

### Misc (added)
| Function | Purpose |
|---|---|
| `mavis-demo` | Demo/response-type classification endpoint |
| `mavis-team` | Manages teams and shared workspaces |
| `mavis-skill-catalog` | Browseable, installable skill catalog (OpenClaw/Hermes pattern) |

---

## 3 · MAVIS ACTION TYPES

MAVIS executes actions via `:::ACTION{...}:::` blocks parsed from LLM output and sent to `mavis-actions`.

```
QUESTS & TASKS
  create_quest         { title, type, description, xp_reward, effort_tier, phase, completion_criteria[] }
  update_quest         { quest_id, status, progress_current, phase }
  complete_quest       { quest_id }
  delete_quest         { quest_id }
  create_task          { title, description, recurrence, status }
  update_task          { task_id, status }
  delete_task          { task_id }

KNOWLEDGE
  create_journal       { title, content, tags[], category, importance, xp_earned }
  create_vault         { title, content, category, importance }
  create_note          { title, content, tags[] }
  recall_memory        { query }  → semantic search across memories

SKILLS & XP
  create_skill         { name, category, tier, energy_type, description }
  update_skill         { skill_id, proficiency, unlocked }
  delete_skill         { skill_id }
  award_xp             { amount, reason }

PROFILE
  update_profile       { current_form, arc_story, stat_str, stat_agi, ... }
  update_energy        { system_id, delta, reason }
  create_ranking       { display_name, rank, level }
  update_ranking       { ranking_id, rank, level, gpr }

COUNCIL & PERSONAS
  create_council_member  { name, role, specialty, class, notes }
  update_council_member  { member_id, notes, personality_prompt }
  delete_council_member  { member_id }
  create_ally            { name, relationship, level, notes }
  update_ally            { ally_id, affinity, notes }
  delete_ally            { ally_id }
  forge_persona          { description }  → creates persona with archetype/voice
  consult_persona        { name, question }  → calls persona's LLM live

INVENTORY
  create_inventory_item  { name, type, rarity, effect, quantity }
  update_inventory_item  { item_id, quantity, is_equipped }
  delete_inventory_item  { item_id }
  create_transformation  { name, tier, energy, form_order, description }

GOOGLE WORKSPACE
  draft_email          { to, subject, body }  → queues for approval
  schedule_event       { title, start, end, description, attendees[] }  → queues for approval
  create_google_task   { title, notes, due }  → auto-executes
  create_drive_file    { name, content, mime_type, folder_id }  → auto-executes
  update_drive_file    { file_id, content }  → auto-executes
  update_sheet         { spreadsheet_id, range, values }  → auto-executes

STANDING ORDERS
  get_standing_orders    {}
  add_standing_order     { order_text }
  remove_standing_order  { order_text }

SYSTEM QUERIES
  get_biometric_state    {}  → returns Oura/WHOOP/presence state
  get_pending_reviews    {}  → spaced-repetition queue
  list_skills            {}

MEDIA
  generate_image       { prompt, style, size }

EXTERNAL
  apify_actor          { actorId, input }  → runs any Apify actor
  local_inference      { prompt, model, max_tokens }  → local Ollama
  web_search           { query }  → Tavily API
```

---

## 4 · KEY ENV VARS (Supabase Vault)

```
ANTHROPIC_API_KEY      Claude (primary LLM for council/analysis)
OPENAI_API_KEY         GPT-4o (image gen, embeddings, primary chat)
GEMINI_API_KEY         Gemini Pro (mavis-agent, council)
GROK_API_KEY           Grok (mavis-chat fallback)
GROQ_API_KEY           Groq/Llama (fast fallback)
TAVILY_API_KEY         Web search (mavis-chat — use this name exactly)
ELEVENLABS_API_KEY     TTS / voice cloning
TELEGRAM_BOT_TOKEN     Telegram bot
TELEGRAM_CHAT_ID       Calvin's Telegram chat ID
APIFY_API_KEY          Apify actor execution
DEEPAPI_API_KEY        DeepAPI scraping/people search
SUPABASE_SERVICE_ROLE_KEY  Edge function service calls
```

---

## 5 · ROUTING RULES (Orchestrator)

```
"research" / "find" / "benchmark"              → Researcher
"strategy" / "framework" / "brief"             → Strategist
"write" / "draft" / "post" / "copy" / "email" → Writer
"review" / "edit" / "QA" / "check voice"       → Editor
"analyze" / "metrics" / "KPIs" / "report"      → Analyst
"hire" / "new specialist" / "I need someone"   → HR
code changes / bug fixes / feature work        → direct execution
investment research / stock analysis           → Berkshire Council (Analyst + 4 masters)
```

Pipelines:
- **Standard deliverable**: Researcher → Strategist → Writer → Editor (`pipeline-deliverable`)
- **Research-only**: Researcher (`pipeline-research`)
- **Recurring content**: Writer → Editor on schedule (`pipeline-recurring`)

---

## 6 · DATA MODEL (key tables)

```
profiles               User stats, level, XP, forms, arc
quests                 ISA schema: current_state/ideal_state/effort_tier/phase/completion_criteria[]
tasks                  Daily/weekly/one-off tasks with recurrence
skills                 Unlockable skills with proficiency %
energy_systems         Custom energy meters (Bloodlust, Ambition, etc.)
transformations        Unlockable forms/modes
inventory              RPG items with stat_effects
rankings               Scouter rankings (self + others tracked)
allies                 Relationship network with affinity/level
councils               Shadow council members with agent_folders JSON
personas               Forged AI personas with voice/archetype/system_prompt
persona_conversations  1-on-1 persona chat history
council_chat_messages  Direct council member chat history
memories               Long-term episodic memory (pgvector embeddings)
mavis_knowledge        Durable factual knowledge from dream cycle
mavis_persona_memory   Key-value memory per user (UNIQUE CONSTRAINT on user_id, key)
mavis_action_queue     Pending actions awaiting approval (approve/reject via Telegram)
standing_orders        Persistent directives MAVIS follows autonomously
journal_entries        Personal journal with mood/category/importance
vault_entries          Sensitive stored documents (legal/business/evidence)
telos                  LifeOS: mission/current_state/ideal_state/problems/challenges/strategies
```

---

## 7 · ARCHITECTURE NOTES

**Chat path**: `mavis-chat` → provider waterfall (Gemini first → Groq → OpenAI → Claude → Grok) → stream SSE → frontend `chatService.ts` → token-by-token render

**Action path**: LLM output → `parseActionBlocks()` → `executeAgentAction()` → `mavis-actions` with `body: { userId, actions: [{ type, params }] }` (plural array — not singular `action`)

**Memory path**: conversation → `mavis-memory-embed` (pgvector) → nightly `mavis-dream` (3-phase consolidation) → `mavis_knowledge` (durable facts)

**Council chat**: `FeaturePages.tsx CouncilChat` → `mavis-chat` with `mode: "COUNCIL"` → `buildCouncilMemberPrompt()` (from `councilPersona.ts`) → streams directly, no PASS filtering

**Telegram path**: message → `telegram-webhook` → `mavis-chat` → action execution via `mavis-actions` → Telegram approval buttons for email/calendar

**Deploy**: GitHub Actions → `.github/workflows/deploy-mavis-functions.yml` → 26 core functions fail-fast → all remaining in parallel (`xargs -P 8`)

**Skills standard**: `.claude/skills/` files have YAML frontmatter (`name`, `version`, `owner`, `triggers[]`) or Markdown `**Triggers:**` line. Claude Code matches trigger phrases to skill files and injects the skill body.
