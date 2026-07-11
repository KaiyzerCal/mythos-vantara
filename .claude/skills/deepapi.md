# DeepAPI — Web Scraping, People Search & Email

**Triggers:** `["deepapi", "scrape linkedin", "scrape github profile", "scrape x twitter", "deep research api", "people search api", "email via deepapi"]`

## What It Is

A web scraping and research API covering LinkedIn, GitHub, X/Twitter, YouTube, job searches, people search, and deep research with web evidence. Also handles email draft/read/send (with approval gate on sends).

**Source:** `KaiyzerCal/skills` (davidondrej fork, MIT)

## Required Env Vars

```bash
DEEPAPI_API_BASE_URL=...
DEEPAPI_API_KEY=...
```

Never log or print `DEEPAPI_API_KEY`.

## Every Request Pattern

```typescript
const res = await fetch(`${DEEPAPI_API_BASE_URL}/v1/scrape/linkedin`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${Deno.env.get("DEEPAPI_API_KEY")}`,
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),  // required — prevents duplicate billing on retry
  },
  body: JSON.stringify({
    url: "https://linkedin.com/in/...",
    maxCostUsd: 0.05,  // always set a cost cap on scraping calls
  }),
});
```

## Async Polling Pattern

Many endpoints return `status: "running"` — poll until complete:

```typescript
async function pollUntilDone(runningResponse: any): Promise<any> {
  let result = runningResponse;
  while (result.status === "running") {
    await new Promise(r => setTimeout(r, result.pollIntervalMs ?? 2000));
    const next = await fetch(result.next, { headers: { Authorization: `Bearer ${apiKey}` } });
    result = await next.json();
  }
  if (result.status === "failed") throw new Error(result.error);
  return result;
}
```

On `HTTP 402`: insufficient credits — surface to Calvin for top-up. On error with `retryAfterSecs`: wait, then retry.

## Available Endpoints

| Endpoint | Purpose |
|---|---|
| `/v1/scrape/website` | General web scraping |
| `/v1/scrape/linkedin` | LinkedIn profile |
| `/v1/scrape/github` | GitHub user profile |
| `/v1/scrape/x` | X/Twitter profile |
| `/v1/scrape/youtube` | YouTube channel |
| `/v1/scrape/youtube/transcript` | Video transcript |
| `/v1/search/jobs` | Job search |
| `/v1/search/people` | People search |
| `/v1/search/posts` | Post search |
| `/v1/research` | Deep research with web evidence |
| `/v1/generate/image` | Image generation |
| `/v1/email/draft` | Draft email (safe) |
| `/v1/email/read` | Read inbox |
| `/v1/email/send` | Send email (**requires Calvin approval**) |

## Email Safety Gate

Default behavior: `send: false` (draft mode). Sending requires:
1. Explicit user approval in the current conversation
2. No attachments
3. No HTML with hidden content
4. Never high-risk direct sends (cold outreach at scale without approval)

## MAVIS Integration Pattern

Route DeepAPI calls through `supabase/functions/mavis-apify/index.ts` or a dedicated `mavis-deepapi` edge function. Store results in `mavis_research` or `mavis_notes` table for future recall. Apply `maxCostUsd` caps in the Supabase secrets vault via `DEEPAPI_MAX_COST_PER_CALL` env var.
