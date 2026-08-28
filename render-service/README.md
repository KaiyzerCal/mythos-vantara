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

## Where job state and the finished file actually live

Only the render itself happens here — Chrome and FFmpeg need a real process
and a real filesystem, and there is no way around that. Everything else lives
outside this process on purpose:

- **Job status** — `render_jobs` in Postgres. Any instance can answer a status
  poll, and a restart mid-render does not erase what happened to a job.
- **The finished video** — Supabase Storage, `vault-media` bucket, same path
  convention as beat narration (`<user_id>/render-jobs/<job_id>.mp4`). The
  Gallery already re-signs any `vault-media` URL it finds expired on read, so
  the video self-heals like every other generated asset.

An earlier version kept both in this process: jobs in an in-memory `Map`,
finished files served from local disk and swept after six hours. That URL was
what three different tables stored as a *permanent* address —
`hyperframes_renders.render_url`, `mavis_video_productions.output_url`,
`vault_media.file_url` — so every finished video was quietly on a clock to go
dead. A restart mid-render was worse: the in-memory job vanished, the status
endpoint started 404ing, and `mavis-hyperframes`'s poll handler treated that
as "no update" and kept reporting `rendering` forever, with nothing to break
that loop. Moving both concerns to Postgres and Storage fixes both, and is
also what makes horizontal scaling or a stateless host (Cloud Run, for
instance) *possible* — there is no longer any per-instance state a second
replica or a fresh container would be missing.

## API

| Route | Auth | Purpose |
|---|---|---|
| `POST /render` | `X-Render-Key` | `{ html, assets?, width?, height?, fps?, user_id }` → `{ job_id }` |
| `GET /render/:id` | `X-Render-Key` | `{ status: queued\|rendering\|done\|error, output_url?, error? }` |
| `GET /health` | none | liveness, queue depth |

`user_id` is required, not optional — it is the first path segment of where
the finished file is written in Storage, validated strictly (must look like a
UUID) since it becomes part of a path. `mavis-hyperframes` supplies it from
whichever user's JWT (or service-role `user_id` body field) authenticated the
original request; nothing else needs to change to satisfy this.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `RENDER_KEY` | yes | Shared secret. The service refuses to start without one. |
| `SUPABASE_URL` | yes | Same project the rest of the app uses. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Bypasses RLS to write `render_jobs` and upload to Storage. Keep it out of any client-facing surface. |
| `PORT` | no | Defaults to 8080; Railway sets this. |
| `RENDER_QUALITY` | no | `draft` \| `standard` \| `high`. Defaults to `standard`. |
| `MAX_CONCURRENT_RENDERS` | no | Defaults to 1. |

Then set two secrets on the Supabase side so `mavis-hyperframes` can reach it:

```
HYPERFRAMES_RENDER_URL = <this service's public base URL>
HYPERFRAMES_API_KEY    = <RENDER_KEY>
```

The `render_jobs` table itself comes from
`supabase/migrations/20260827180000_render_jobs.sql` — applied to the live
database already; see that file's header for why it has no foreign key to
`auth.users`.

## Deploying

**Railway** — already wired: `railway.json` configures the Dockerfile builder,
a `/health` healthcheck, and a restart policy. Connect the repo (or
`railway up` from this directory), set the environment variables above in the
Railway dashboard, and it builds and runs. Railway sets `PORT` itself.

**A plain VPS (Hetzner or anywhere else)** — `docker-compose.yml` +
`Caddyfile` in this directory give a one-command path: copy `.env.example` to
`.env` and fill it in, put your real domain in `Caddyfile` (it needs a DNS A
record pointed at the machine first — that is what Let's Encrypt's HTTP-01
challenge checks), then `docker compose up -d`. Caddy handles TLS
automatically; nothing else to configure. This works identically on any
machine that can run Docker — the Dockerfile itself is host-agnostic, so
Railway and a VPS are running the exact same image.

## Known limitations

**One render at a time by default.** A render saturates CPU; two concurrent
ones on a small container finish later than two sequential ones and invite the
OOM killer to take both. Raise `MAX_CONCURRENT_RENDERS` on a container with
room for it.

**The stale-job reaper has no heartbeat.** A job stuck in `queued` or
`rendering` for more than 20 minutes with no update gets marked `error` — this
is what turns an abandoned job (crash, killed container) into a clean, visible
failure instead of `mavis-hyperframes` polling a status that never changes.
The reaper runs on an interval, not just at boot, so it works across multiple
instances with no coordination between them: "stale" is judged from
Postgres's own `updated_at`, not from which process remembers starting the
job. The tradeoff is real — a single render that legitimately takes close to
20 minutes, on a host under memory or CPU pressure, could be reaped out from
under itself. Nothing in this pipeline should approach that duration today;
if that changes, the fix is a heartbeat that touches `updated_at` while a
render is genuinely still progressing, not a longer timeout (which only makes
a real hang take longer to notice).

**Request-path Postgres calls are capped at 10 seconds.** `GET /render/:id`
and the `POST /render` insert use `.abortSignal(AbortSignal.timeout(...))` so
a Supabase-side network problem fails the request in bounded time instead of
holding the connection open indefinitely. This was verified as a real risk,
not a theoretical one — pointed at an unreachable Supabase URL, an early
version of this file hung a status poll with zero bytes sent until the
*caller's own* 15-second timeout fired, with nothing on this side bounding it
at all.

## Running locally

```bash
cd render-service
npm install
cp .env.example .env   # fill in RENDER_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm start
```

Needs `chromium` and `ffmpeg` on PATH, or use the Dockerfile, which installs
both from Debian rather than via Puppeteer's own download.
