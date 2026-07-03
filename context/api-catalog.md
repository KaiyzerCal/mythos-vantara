# API Catalog — Curated for MAVIS / VANTARA.EXE

Source repos: KaiyzerCal/API-mega-list, KaiyzerCal/rtk

## Apify Actor Catalog (mavis-apify edge function)

All actors callable via `mavis-apify` edge function with `{ actorId, input, timeout }`.
Requires `APIFY_API_KEY` in Supabase secrets vault.

### Research & Intelligence

| Actor ID | Use case | Input fields |
|---|---|---|
| `louisdeconinck/ai-company-researcher-agent` | Full company deep-dive | `{ companyName }` |
| `bala-ceg/ai-company-researcher` | Company research + leadership | `{ query }` |
| `apify/competitive-intelligence-agent` | Competitive landscape (Google Maps + social) | `{ query, location }` |
| `fiery_dream/crypto-intel` | Crypto / DeFi market intelligence | `{ query }` |
| `visita/global-markets-intelligence` | Global markets + sentiment | `{ query }` |
| `louisdeconinck/ai-finance-monitoring-agent` | Public company financial reports | `{ companyTicker }` |
| `fiery_dream/funding-intel` | Grants, regulatory, funding discovery | `{ query }` |
| `bleffoo/cot-report-visualizer` | CFTC COT report positioning data | `{ commodity }` |

### Web & Content Extraction

| Actor ID | Use case | Input fields |
|---|---|---|
| `janbuchar/crawl4ai` | AI web scraper, multi-page, markdown output | `{ startUrls: [{url}], extractionGoal, maxCrawlPages }` |
| `raizen/ai-web-scraper` | Blazing fast Crawl4AI scraper | `{ url, extractionGoal }` |
| `apify/ai-web-agent` | Browser automation via natural language | `{ task, url }` |
| `6sigmag/fast-website-content-crawler` | High-performance bulk site crawler | `{ startUrls, maxCrawlPages }` |

### YouTube & Video

| Actor ID | Use case | Input fields |
|---|---|---|
| `supreme_coder/youtube-transcript-scraper` | YT video transcripts in bulk | `{ videoUrls: [url] }` |
| `dz_omar/youtube-transcript-metadata-extractor` | Transcript + metadata | `{ videoUrl }` |
| `agentx/video-transcript` | Multi-platform video to text (YT, TikTok, etc.) | `{ videoUrl }` |
| `starvibe/youtube-scraper` | Channel/keyword video metadata | `{ keyword, channelUrl }` |
| `nextapi/youtube-video-downloader` | Download or get video info | `{ url }` |

### Social Media Intelligence

| Actor ID | Use case | Input fields |
|---|---|---|
| `apify/influencer-discovery-agent` | TikTok influencer discovery | `{ query, platform }` |
| `hypebridge/influencer-discovery-agent-instagram-tiktok` | IG + TikTok influencer search | `{ query }` |
| `apify/comments-analyzer-agent` | Social comment sentiment analysis | `{ url, platform }` |
| `nextapi/reddit-user-analyzer` | Reddit user profile analysis | `{ username }` |
| `crawlerbros/reddit-mcp-scraper` | Reddit posts + comments | `{ subreddit, query }` |
| `mikolabs/x-scraper` | Twitter/X data (tweets, profiles, lists) | `{ url, query }` |

### Leads & Outreach

| Actor ID | Use case | Input fields |
|---|---|---|
| `code_crafter/leads-finder` | B2B leads (alternative to Apollo/ZoomInfo) | `{ query, industry }` |
| `louisdeconinck/ai-job-search-agent` | Job search + cover letter gen | `{ jobTitle, location }` |
| `daniil.poletaev/backlink-building-agent` | Backlink outreach automation | `{ website, niche }` |
| `clearpath/email-finder-api` | Email finder + verifier | `{ domain, name }` |
| `scraper-mind/all-social-media-email-scraper` | Emails from 40+ platforms | `{ url }` |

### Documents & Data

| Actor ID | Use case | Input fields |
|---|---|---|
| `devaditya/pdf-ai-extractor-mcp` | PDF text + table extraction | `{ pdfUrl }` |
| `parseforge/audio-transcriber` | Audio file transcription | `{ audioUrl }` |
| `valid_headlamp/ai-content-processor` | Summarize, sentiment, NER, translate | `{ text, task }` |
| `louisdeconinck/ai-newsletter-agent` | Auto-generate newsletters | `{ topic }` |

### Financial & Markets

| Actor ID | Use case | Input fields |
|---|---|---|
| `rotas/insider-finance-us-stock-monitoring` | Insider trading data | `{ ticker }` |
| `data_voyager/alphascrape` | Earnings data → stock movement predictions | `{ ticker }` |
| `bleffoo/economics-calendar-scraper` | Economic events calendar | `{}` |
| `red.cars/coinmarketcap-ai-gateway` | Real-time crypto market data | `{ query }` |

---

## MCP Servers (Apify-hosted, 131 available)

High-value MCP servers that can be added to Claude Code sessions or MAVIS:

| Server | Capability | URL |
|---|---|---|
| Slack MCP | Slack channels, messages, membership | `apify.com/parseforge/slack-mcp` |
| WhatsApp Cloud API MCP | WhatsApp Business messaging | `apify.com/mdbm/whatsapp-cloud-api-mcp` |
| HubSpot MCP | CRM contacts, deals, prospects | `apify.com/anchor/hubspot-apify-mcp-server` |
| Home Assistant MCP | Smart home device control | `apify.com/parseforge/home-assistant-mcp-server` |
| Financial Datasets MCP | Stock market data + financial statements | `apify.com/agentify/financial-datasets-mcp-server` |
| GA4 MCP | Google Analytics 4 reporting | `apify.com/smacient/ga4-mcp-worker` |
| GSC MCP | Google Search Console analytics | `apify.com/smacient/gsc-mcp-worker` |
| SlideSpeak MCP | PowerPoint from natural language | `apify.com/agentify/slidespeak-mcp-server` |
| Mindmap MCP | Markdown → interactive mindmaps | `apify.com/agentify/mindmap-mcp-server` |
| Invoice Collector MCP | Razorpay, PayPal, Stripe invoice automation | `apify.com/devaditya/invoice-collector-mcp` |
| Explorium MCP | Company + contact + market intelligence | `apify.com/agentify/explorium-mcp-server` |
| Exa MCP | Enhanced semantic search | `apify.com/agentify/exa-mcp-server` |
| Discord MCP | Discord channels and messages | `apify.com/bhansalisoft/discord-mcp-server` |
| Firecrawl MCP | Advanced web scraping | `apify.com/agentify/firecrawl-mcp-server` |
| Perplexity Sonar MCP | Real-time web search | `apify.com/agentify/perplexity-sonar-mcp-server` |
| Google Maps MCP | Business search + reviews | `apify.com/crawlerbros/google-maps-mcp` |
| Zendesk MCP | Zendesk ticket management | `apify.com/amaranth_nylon/zendesk-mcp-server-actor` |
| WordPress MCP | WordPress REST API automation | `apify.com/extremescrapes/wordpress-mcp-server` |
| Figma MCP | Figma design → HTML generation | `apify.com/bhansalisoft/figma-mcp-server` |

All MCP servers use Apify's hosted infrastructure. See full list: `KaiyzerCal/API-mega-list/mcp-servers-apis-131/`

---

## RTK — Token Killer

**Repo:** `KaiyzerCal/rtk` | **Language:** Rust | **Token savings:** 60-90%

RTK intercepts CLI commands and compresses output before it reaches the LLM context window.
A 118K-token session becomes ~24K tokens (80% reduction).

**Setup for this project:**
```bash
# Install rtk (after cloning KaiyzerCal/rtk and building)
cargo install --path .

# Initialize Claude Code hooks (creates PreToolUse hooks in ~/.claude/)
rtk init -g

# Verify
rtk --version  # should show 0.28.2+
rtk gain       # shows token savings stats
```

**Usage — prefer rtk prefixes for all dev work:**
```bash
rtk git status        # instead of: git status
rtk git log -10       # instead of: git log -10
rtk ls src/           # instead of: ls src/
rtk grep "pattern" .  # instead of: grep
rtk cargo test        # instead of: cargo test (for rtk development)
rtk pnpm build        # instead of: pnpm build
rtk eslint src/       # instead of: eslint src/
```

**Supported ecosystems:** git/gh, cargo, npm/pnpm/npx, pytest/ruff, jest/vitest/playwright, eslint/tsc, docker/kubectl, aws, prisma

**Token analytics:**
```bash
rtk gain            # total savings to date
rtk gain --history  # per-session breakdown
rtk session         # current session stats
rtk discover        # find more optimization opportunities
```

---

## Recommended Next Integrations

Priority order based on MAVIS use cases:

1. **Slack MCP** — Calvin likely uses Slack; MAVIS should be able to send/monitor Slack
2. **WhatsApp Cloud API** — expand MAVIS beyond Telegram to WhatsApp  
3. **Invoice Collector MCP** — automate invoice collection from Stripe/PayPal
4. **HubSpot MCP** — CRM pipeline management through MAVIS
5. **Financial Datasets MCP** — real-time stock data for stock-research skill
6. **Home Assistant MCP** — smart home control through MAVIS voice/Telegram
7. **SlideSpeak MCP** — MAVIS can generate presentations on demand
