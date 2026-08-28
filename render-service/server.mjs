/**
 * Vantara render service — HTML compositions to MP4.
 *
 * This is the piece DEPLOYMENT.md describes as "the wrapper you write":
 * mavis-hyperframes is only a proxy, and HyperFrames' own rendering needs
 * headless Chrome, a real FFmpeg binary and a persistent process — none of
 * which a Supabase Deno edge function can host.
 *
 * It exists because the two sides speak different protocols. mavis-hyperframes
 * posts a composition as HTML and polls for a job; @hyperframes/producer
 * renders a project *directory* and blocks until it is done. This bridges them:
 *
 *   POST /render        { html, assets?, width?, height?, fps?, user_id } -> { job_id }
 *   GET  /render/:id    -> { status: queued|rendering|done|error, output_url?, error? }
 *   GET  /health        -> { ok, active, queued, in_flight }
 *
 * Both /render routes require the shared secret in X-Render-Key.
 *
 * ── Why job state and the finished file both live outside this process ──────
 *
 * The first version of this service kept every job in an in-memory Map and
 * served the finished MP4 from local disk at /file/:token, swept after six
 * hours. That URL is what mavis-hyperframes stored as
 * hyperframes_renders.render_url, what mavis-video-asset-worker copied into
 * mavis_video_productions.output_url, and what landed permanently in
 * vault_media.file_url — three layers treating a six-hour-lived local file as
 * a permanent address. Every finished video was on a clock to go dead.
 * Separately, a restart mid-render lost the job outright: mavis-hyperframes's
 * status poll got a 404 and kept returning the last known "rendering" status
 * forever, with no automatic recovery.
 *
 * Both problems had the same fix: stop treating this process as the durable
 * home of anything. The finished file goes to Supabase Storage (vault-media,
 * same bucket and path convention as beat narration — see beatAudioPath in
 * _shared/videoAssets.ts), and a signed URL is what gets handed back — the
 * Gallery's existing repairVaultUrls already re-signs any vault-media URL on
 * read, so this file self-heals exactly like every other generated asset.
 * Job status moves into Postgres (render_jobs), so ANY instance can answer a
 * status poll, a restart does not erase what a job's outcome was, and a
 * stale-job reaper (not just a boot-time sweep — see reapStaleJobs) turns an
 * abandoned job into a clean, actionable "error" instead of a silent hang,
 * regardless of which process created it.
 *
 * What is still local, and deliberately so: the render itself. Chrome and
 * FFmpeg need a real process and a real filesystem, and there is no way
 * around that short of not running this service at all. The `jobs` Map below
 * exists only for this process's own in-flight bookkeeping (which local temp
 * directory belongs to which job, so it can be cleaned up) — it is never
 * consulted to answer a status query. Postgres is the only source of truth
 * anything outside this process reads.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createClient } from "@supabase/supabase-js";
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";
import { mkdtemp, writeFile, mkdir, rm, readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 8080);
const RENDER_KEY = process.env.RENDER_KEY ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const QUALITY = process.env.RENDER_QUALITY ?? "standard";
// One at a time by default: a render saturates CPU, and two concurrent ones on
// a small container are slower than two sequential ones and risk the OOM
// killer taking both.
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_RENDERS ?? 1);
// Bounds every Postgres call made ON a request path (status polls, job
// creation) so a Supabase-side network problem fails a request in bounded
// time instead of holding the connection open indefinitely. Verified this
// was a real risk, not a theoretical one: GET /render/:id against an
// unreachable Supabase URL hung with zero bytes sent until the *caller's*
// timeout fired — nothing here was bounding it from this side at all.
const DB_CALL_TIMEOUT_MS = 10_000;

if (!RENDER_KEY) {
  console.error("RENDER_KEY is not set — refusing to start an unauthenticated render service.");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — this service can no longer " +
    "start without them: job status lives in Postgres and the finished file goes to Storage, " +
    "not local disk. There is no reduced mode to fall back to.",
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const STORAGE_BUCKET = "vault-media";
// 30 days, matching the narration convention in mavis-video-asset-worker. The
// Gallery re-signs any vault-media URL it finds expired on read, so this TTL
// only bounds how long the FIRST link (hyperframes_renders.render_url,
// mavis_video_productions.output_url) stays live before that copy goes stale —
// the vault_media row the asset worker writes on completion is what the
// operator actually browses, and that one heals itself.
const OUTPUT_URL_TTL_SECONDS = 60 * 60 * 24 * 30;

function outputStoragePath(userId, jobId) {
  // The vault-media bucket's RLS keys off the first path segment being the
  // user id — see beatAudioPath's comment and the bug it was fixed for.
  return `${userId}/render-jobs/${jobId}.mp4`;
}

/**
 * Jobs abandoned by a crash or a killed container. Not boot-only: a fixed
 * interval means any of N instances can reap a job left behind by ANY
 * instance, including one that never comes back — no inter-instance
 * coordination needed, because "stale" is judged from Postgres's own
 * updated_at, not from which process remembers starting it.
 *
 * 20 minutes is comfortably longer than a render of the kind this pipeline
 * produces should ever take. The tradeoff: a genuinely slower render than
 * that, running on one instance while a second instance's reaper fires,
 * could be marked errored out from under it — there is no heartbeat to
 * prevent that. Known limit, not a defect; see the README.
 */
const STALE_AFTER_MS = 20 * 60 * 1000;

async function reapStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { data, error } = await sb
    .from("render_jobs")
    .update({ status: "error", error_message: "abandoned: no update from the render process within 20 minutes" })
    .in("status", ["queued", "rendering"])
    .lt("updated_at", cutoff)
    .select("id")
    .abortSignal(AbortSignal.timeout(DB_CALL_TIMEOUT_MS));
  if (error) {
    console.error(`[render_jobs] reap failed: ${error.message}`);
    return;
  }
  if (data && data.length > 0) {
    console.log(`[render_jobs] reaped ${data.length} stale job(s): ${data.map((r) => r.id).join(", ")}`);
  }
}

/**
 * This process's own in-flight bookkeeping — never read to answer a status
 * query. Only what a running render needs to clean up after itself.
 */
const jobs = new Map();
let active = 0;
const queue = [];

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const run = queue.shift();
    active++;
    run().finally(() => {
      active--;
      pump();
    });
  }
}

async function setJobStatus(id, patch) {
  const { error } = await sb.from("render_jobs").update(patch).eq("id", id);
  if (error) console.error(`[render] ${id} could not update status: ${error.message}`);
}

async function render(id, userId, html, width, height, fps) {
  await setJobStatus(id, { status: "rendering" });

  const projectDir = await mkdtemp(join(tmpdir(), "vantara-render-"));
  const outputDir = join(projectDir, "out");
  jobs.set(id, { work_dir: projectDir });

  try {
    await mkdir(outputDir, { recursive: true });
    // entryFile defaults to index.html; the composition is a fragment, so it
    // gets a document around it with the frame size fixed to the request.
    await writeFile(
      join(projectDir, "index.html"),
      `<!doctype html>\n<html><head><meta charset="utf-8">` +
      `<style>html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:#000}</style>` +
      `</head><body>\n${html}\n</body></html>`,
      "utf8",
    );

    const renderJob = createRenderJob({ fps, quality: QUALITY, format: "mp4" });
    await executeRenderJob(renderJob, projectDir, outputDir);

    // executeRenderJob treats outputPath as a directory and writes the encoded
    // file into it; find whatever landed rather than assuming a filename.
    const produced = (await readdir(outputDir)).filter((f) => f.endsWith(".mp4"));
    if (produced.length === 0) throw new Error("the renderer produced no mp4");

    const localPath = join(outputDir, produced[0]);
    const bytes = await readFile(localPath);
    const storagePath = outputStoragePath(userId, id);

    const { error: upErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, bytes, { contentType: "video/mp4", upsert: true });
    if (upErr) throw new Error(`could not store the finished video: ${upErr.message}`);

    const { data: signed, error: signErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, OUTPUT_URL_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) {
      throw new Error(`stored the video but could not sign a URL for it: ${signErr?.message ?? "no URL returned"}`);
    }

    await setJobStatus(id, {
      status: "done",
      output_path: storagePath,
      output_url: signed.signedUrl,
      error_message: null,
    });
    console.log(`[render] ${id} done -> ${storagePath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[render] ${id} failed: ${message}`);
    await setJobStatus(id, { status: "error", error_message: message.slice(0, 500) });
  } finally {
    // Freed as soon as the upload succeeds or the render fails — not held
    // for hours on the hope a caller will fetch a local file that no longer
    // exists as a concept.
    await rm(projectDir, { recursive: true, force: true }).catch(() => {});
    jobs.delete(id);
  }
}

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, active, queued: queue.length, in_flight: jobs.size }));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.post("/render", async (c) => {
  if (c.req.header("X-Render-Key") !== RENDER_KEY) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const html = typeof body.html === "string" ? body.html.trim() : "";
  if (!html) return c.json({ error: "html is required" }, 400);

  // Required now, not optional: it is the first segment of the storage path
  // the finished file is written to. Validated strictly — this is the one
  // piece of untrusted input that becomes part of a filesystem-adjacent path,
  // so a malformed value is rejected rather than sanitised and used anyway.
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (!UUID_RE.test(userId)) {
    return c.json({ error: "user_id is required and must be a UUID" }, 400);
  }

  const width = Math.min(Math.max(Number(body.width) || 1920, 16), 3840);
  const height = Math.min(Math.max(Number(body.height) || 1080, 16), 2160);
  const fps = Math.min(Math.max(Number(body.fps) || 30, 1), 60);

  const id = randomUUID();
  const { error: insertErr } = await sb
    .from("render_jobs")
    .insert({ id, user_id: userId, status: "queued" })
    .abortSignal(AbortSignal.timeout(DB_CALL_TIMEOUT_MS));
  if (insertErr) {
    console.error(`[render] could not create job row: ${insertErr.message}`);
    return c.json({ error: "could not create the render job" }, 500);
  }

  queue.push(() => render(id, userId, html, width, height, fps));
  pump();

  console.log(`[render] ${id} queued (${width}x${height} @${fps}fps, ${html.length} bytes)`);
  return c.json({ job_id: id, status: "queued" });
});

app.get("/render/:id", async (c) => {
  if (c.req.header("X-Render-Key") !== RENDER_KEY) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const { data: row, error } = await sb
    .from("render_jobs")
    .select("status,output_url,error_message")
    .eq("id", c.req.param("id"))
    .abortSignal(AbortSignal.timeout(DB_CALL_TIMEOUT_MS))
    .maybeSingle();
  if (error || !row) return c.json({ error: "job not found" }, 404);

  // Wire shape unchanged from the pre-Postgres version — mavis-hyperframes
  // reads `error`, not `error_message`; this is the one place that mapping
  // happens.
  return c.json({
    status: row.status,
    ...(row.output_url ? { output_url: row.output_url } : {}),
    ...(row.error_message ? { error: row.error_message } : {}),
  });
});

function reapStaleJobsSafely(label) {
  // .catch() here, not a try/catch inside reapStaleJobs itself: a network
  // failure reaching Supabase — DNS down, the project unreachable, a slow
  // TLS handshake — must never propagate as an unhandled rejection. Verified
  // this concern was real, not theoretical: an early version of this file
  // awaited the initial reap before starting the HTTP server, and pointing it
  // at an unreachable Supabase URL left the process silently hung with
  // nothing listening — not even /health, which touches no database at all.
  reapStaleJobs().catch((err) => {
    console.error(`[render_jobs] ${label} reap failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

function main() {
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`vantara render service listening on :${PORT} (max ${MAX_CONCURRENT} concurrent)`);
  });

  // Background maintenance, independent of whether the server came up
  // cleanly or Postgres is reachable at this instant. Anything this or an
  // earlier boot left mid-flight and never finished is truly gone — Chrome
  // and FFmpeg do not survive a process restart — so this fails those out
  // rather than trying to resume them.
  reapStaleJobsSafely("initial");
  setInterval(() => reapStaleJobsSafely("periodic"), 5 * 60 * 1000).unref();
}

main();
