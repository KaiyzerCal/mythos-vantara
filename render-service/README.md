# Vantara render service

Turns an HTML composition into an MP4. This is the piece the video pipeline
waits on — `mavis-hyperframes` is only a proxy, and HyperFrames' rendering
needs headless Chrome, a real FFmpeg binary and a persistent process, none of
which a Supabase Deno edge function can host.

## Why this exists rather than calling HyperFrames directly

`DEPLOYMENT.md` says HyperFrames "ships as a CLI/library, not a server". That
is out of date — `@hyperframes/producer` does export `createProducerApp` and
`startServer`. But its server does not speak the protocol `mavis-hyperframes`
was written against, in two ways that matter:

- its `POST /render` takes a **`projectDir`**, not posted HTML;
- its `POST /render` **blocks** until the render finishes, where the proxy
  expects `{ job_id }` back immediately and polls `GET /render/:job_id`.

So this service is a genuine adapter, not redundant scaffolding: it accepts
HTML, materialises it as a project directory, drives `createRenderJob` /
`executeRenderJob` in the background, and exposes the async job protocol the
proxy already implements.

## API

| Route | Auth | Purpose |
|---|---|---|
| `POST /render` | `X-Render-Key` | `{ html, assets?, width?, height?, fps? }` → `{ job_id }` |
| `GET /render/:id` | `X-Render-Key` | `{ status: queued\|rendering\|done\|error, output_url?, error? }` |
| `GET /file/:token.mp4` | none — unguessable token | the finished MP4 |
| `GET /health` | none | liveness, queue depth |

`/file` is deliberately unauthenticated. The finished video is fetched by the
operator's browser and stored by the app, neither of which holds the shared
key; the 192-bit token in the path is what protects it. This mirrors the
producer's own `/outputs/:token`.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `RENDER_KEY` | yes | Shared secret. The service refuses to start without one. |
| `PUBLIC_URL` | yes | This service's own public base URL, used to build `output_url`. |
| `PORT` | no | Defaults to 8080; Railway sets this. |
| `RENDER_QUALITY` | no | `draft` \| `standard` \| `high`. Defaults to `standard`. |
| `MAX_CONCURRENT_RENDERS` | no | Defaults to 1. |
| `JOB_TTL_MS` | no | How long a finished file stays fetchable. Defaults to 6h. |

Then set two secrets on the Supabase side so `mavis-hyperframes` can reach it:

```
HYPERFRAMES_RENDER_URL = <PUBLIC_URL>
HYPERFRAMES_API_KEY    = <RENDER_KEY>
```

## Known limitations

**Jobs live in memory.** A restart loses in-flight renders. The caller polls
and can resubmit, so this is a deliberate trade against adding a database to a
service whose only state is "is this finished yet". If renders start being
lost to deploys, that is the thing to revisit first.

**One render at a time by default.** A render saturates CPU; two concurrent
ones on a small container finish later than two sequential ones and invite the
OOM killer to take both.

**Local disk.** Finished files are served from the container's filesystem, so
they do not survive a restart either. The pipeline copies the MP4 into Supabase
storage once it fetches it, so the durable copy lives there — this service is
not an archive.

## Running locally

```bash
cd render-service
npm install
RENDER_KEY=dev PUBLIC_URL=http://localhost:8080 npm start
```

Needs `chromium` and `ffmpeg` on PATH, or use the Dockerfile, which installs
both from Debian rather than via Puppeteer's own download.
