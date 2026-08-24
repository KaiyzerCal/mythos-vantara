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
 *   POST /render        { html, assets?, width?, height?, fps? } -> { job_id }
 *   GET  /render/:id    -> { status: queued|rendering|done|error, output_url?, error? }
 *   GET  /file/:token   -> the finished MP4
 *   GET  /health        -> { ok: true }
 *
 * Both /render routes require the shared secret in X-Render-Key. /file does
 * not: the finished video is fetched by the operator's browser and by the app,
 * neither of which holds the key, so the unguessable token in the path is what
 * protects it — the same approach the producer's own /outputs/:token uses.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";
import { mkdtemp, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 8080);
const RENDER_KEY = process.env.RENDER_KEY ?? "";
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
const QUALITY = process.env.RENDER_QUALITY ?? "standard";
// One at a time by default: a render saturates CPU, and two concurrent ones on
// a small container are slower than two sequential ones and risk the OOM
// killer taking both.
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_RENDERS ?? 1);
// Finished files are kept long enough to be fetched and stored by the caller.
const JOB_TTL_MS = Number(process.env.JOB_TTL_MS ?? 6 * 60 * 60 * 1000);

if (!RENDER_KEY) {
  console.error("RENDER_KEY is not set — refusing to start an unauthenticated render service.");
  process.exit(1);
}

/**
 * Jobs live in memory. A restart loses in-flight work, which is acceptable
 * because the caller polls and can resubmit — and is far simpler than adding a
 * database to a service whose only state is "is this render finished yet".
 * The tradeoff is deliberate, not an oversight: see README.
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

function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.created_at < JOB_TTL_MS) continue;
    jobs.delete(id);
    if (job.work_dir) rm(job.work_dir, { recursive: true, force: true }).catch(() => {});
  }
}
setInterval(sweep, 15 * 60 * 1000).unref();

async function render(job, html, width, height, fps) {
  job.status = "rendering";
  const projectDir = await mkdtemp(join(tmpdir(), "vantara-render-"));
  const outputDir = join(projectDir, "out");
  job.work_dir = projectDir;

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
    const { readdir } = await import("node:fs/promises");
    const produced = (await readdir(outputDir)).filter((f) => f.endsWith(".mp4"));
    if (produced.length === 0) throw new Error("the renderer produced no mp4");

    job.file_path = join(outputDir, produced[0]);
    job.status = "done";
    job.output_url = `${PUBLIC_URL}/file/${job.token}.mp4`;
    console.log(`[render] ${job.id} done -> ${job.output_url}`);
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    console.error(`[render] ${job.id} failed: ${job.error}`);
    await rm(projectDir, { recursive: true, force: true }).catch(() => {});
    job.work_dir = null;
  }
}

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, active, queued: queue.length, jobs: jobs.size }));

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

  const width = Math.min(Math.max(Number(body.width) || 1920, 16), 3840);
  const height = Math.min(Math.max(Number(body.height) || 1080, 16), 2160);
  const fps = Math.min(Math.max(Number(body.fps) || 30, 1), 60);

  if (!PUBLIC_URL) {
    // Without this the job would render and then hand back a URL nothing can
    // fetch, which looks like a renderer fault rather than a missing setting.
    return c.json({ error: "PUBLIC_URL is not configured on the render service" }, 500);
  }

  const job = {
    id: randomUUID(),
    token: randomBytes(24).toString("base64url"),
    status: "queued",
    created_at: Date.now(),
    output_url: null,
    error: null,
    file_path: null,
    work_dir: null,
  };
  jobs.set(job.id, job);

  queue.push(() => render(job, html, width, height, fps));
  pump();

  console.log(`[render] ${job.id} queued (${width}x${height} @${fps}fps, ${html.length} bytes)`);
  return c.json({ job_id: job.id, status: "queued" });
});

app.get("/render/:id", (c) => {
  if (c.req.header("X-Render-Key") !== RENDER_KEY) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const job = jobs.get(c.req.param("id"));
  if (!job) return c.json({ error: "job not found" }, 404);
  return c.json({
    status: job.status,
    ...(job.output_url ? { output_url: job.output_url } : {}),
    ...(job.error ? { error: job.error } : {}),
  });
});

app.get("/file/:name", async (c) => {
  const token = c.req.param("name").replace(/\.mp4$/, "");
  const job = [...jobs.values()].find((j) => j.token === token && j.status === "done");
  if (!job?.file_path) return c.json({ error: "not found" }, 404);

  try {
    const info = await stat(job.file_path);
    return new Response(createReadStream(job.file_path), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(info.size),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return c.json({ error: "the rendered file is no longer available" }, 410);
  }
});

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`vantara render service listening on :${PORT} (max ${MAX_CONCURRENT} concurrent)`);
});
