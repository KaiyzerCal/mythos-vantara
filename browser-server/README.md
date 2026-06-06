# MAVIS Browser Server

Self-hosted Playwright/Chromium. Handles three capabilities in one container:
- **Web browsing** — navigate, screenshot, extract text/links/HTML
- **Web scraping** — structured data extraction with CSS selectors  
- **PDF generation** — render HTML templates to print-quality PDFs

## Deploy

```bash
docker build -t mavis-browser .
docker run -d -p 3000:3000 --name mavis-browser \
  --memory=1.5g --shm-size=512m \
  mavis-browser
```

## Configure

```
BROWSER_URL=http://your-server:3000
```

This single env var unlocks in MAVIS:
- `mavis-pdf-gen` — invoice, report, and proposal PDF generation
- `mavis-web-scraper` — scrape any website for research/intel
- `mavis-computer-use` — browse tasks routed locally instead of to OpenAI

## Requirements

- 1.5GB RAM minimum (Chromium is memory hungry)
- `--shm-size=512m` is required to prevent Chromium crashes

## VPS Recommendations

| VPS           | Cost    | RAM  | Notes               |
|---------------|---------|------|---------------------|
| Hetzner CX22  | $4.50/mo| 4GB  | Best value          |
| Fly.io 2x     | ~$5/mo  | 2GB  | Easy deploy         |
| Railway       | ~$5/mo  | 2GB  | Already using       |
