# Open Notebook — Self-Hosted Knowledge Ingestion for MAVIS

**Triggers:** `["open-notebook", "notebooklm", "knowledge ingestion", "pdf ingestion", "research synthesis", "multi-speaker podcast"]`

## What It Is

Open Notebook is a self-hosted, privacy-first NotebookLM alternative. Upload PDFs, videos, audio, and web pages — then query them with AI (18+ providers including Claude). Generates multi-speaker podcasts from research materials. Has a full REST API and an MCP server.

**GitHub:** `KaiyzerCal/open-notebook` | **Stack:** Python/FastAPI + Next.js + SurrealDB | **License:** MIT

## Docker Setup

```bash
git clone https://github.com/KaiyzerCal/open-notebook
cd open-notebook
cp .env.example .env
# Set ANTHROPIC_API_KEY, OPENAI_API_KEY (for embeddings), etc.
docker compose up -d

# REST API: http://localhost:8000/docs
# Web UI:   http://localhost:3000
```

## REST API — Key Endpoints

```bash
# Create a notebook
POST /api/notebooks
{ "title": "MAVIS Research", "description": "..." }

# Add a source (PDF, URL, text, audio, video)
POST /api/notebooks/{notebook_id}/sources
{ "type": "url", "content": "https://..." }
{ "type": "file", "file": <binary>, "filename": "report.pdf" }
{ "type": "text", "content": "raw text..." }

# Query a notebook
POST /api/notebooks/{notebook_id}/query
{ "question": "What are the key risks?", "model": "claude-sonnet-4-6" }

# Generate podcast
POST /api/notebooks/{notebook_id}/podcast
{ "style": "debate", "length": "medium" }
```

## MCP Server Config (Claude Code)

```json
{
  "mcpServers": {
    "open-notebook": {
      "command": "python",
      "args": ["-m", "open_notebook.mcp"],
      "env": { "NOTEBOOK_API_URL": "http://localhost:8000" }
    }
  }
}
```

## MAVIS Integration Pattern

**Telegram → ingest → query loop:**

```typescript
// When Calvin forwards a PDF or URL to the Telegram bot:
// 1. POST to open-notebook to add it as a source
// 2. MAVIS references that notebook in subsequent conversations

// In telegram-webhook/index.ts document handler:
async function ingestToNotebook(content: string, type: "url" | "text" | "file") {
  const NOTEBOOK_URL = Deno.env.get("OPEN_NOTEBOOK_URL")!;
  const notebookId   = Deno.env.get("MAVIS_NOTEBOOK_ID")!;
  
  await fetch(`${NOTEBOOK_URL}/api/notebooks/${notebookId}/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, content }),
  });
}

// In loadKnowledgeContext():
async function queryNotebook(question: string): Promise<string> {
  const NOTEBOOK_URL = Deno.env.get("OPEN_NOTEBOOK_URL")!;
  const notebookId   = Deno.env.get("MAVIS_NOTEBOOK_ID")!;
  
  const res = await fetch(`${NOTEBOOK_URL}/api/notebooks/${notebookId}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, model: "claude-sonnet-4-6" }),
  });
  const data = await res.json();
  return data.answer ?? "";
}
```

## Use Cases for MAVIS

- `/ingest [url]` → adds article to MAVIS research notebook automatically
- Forward a PDF to Telegram → MAVIS can answer questions about it in the same session
- Research deep-dive: compile 10 sources, generate a podcast overview
- Weekly review: ingest week's notes → AI synthesis → audio summary
