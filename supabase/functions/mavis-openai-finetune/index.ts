// mavis-openai-finetune
// Submits high-quality MAVIS conversation pairs to OpenAI fine-tuning API
// Creates a custom gpt-4o-mini model trained on your actual conversations
// verify_jwt = false (called from mavis-self-improve with service-role key)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

const OPENAI_BASE = "https://api.openai.com/v1";
const BASE_MODEL = "gpt-4o-mini-2024-07-18";

const sb = () => createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ── Upload JSONL to OpenAI Files API ──────────────────────────────────────────

async function uploadTrainingFile(jsonlContent: string, filename: string): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([jsonlContent], { type: "application/json" });
  formData.append("file", blob, filename);
  formData.append("purpose", "fine-tune");

  const res = await fetch(`${OPENAI_BASE}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI file upload failed: ${err}`);
  }

  const data = await res.json();
  return data.id; // file ID like "file-abc123"
}

// ── Start fine-tuning job ─────────────────────────────────────────────────────

async function startFineTuneJob(trainingFileId: string, suffix: string): Promise<{ id: string; status: string }> {
  const res = await fetch(`${OPENAI_BASE}/fine_tuning/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      training_file: trainingFileId,
      model: BASE_MODEL,
      suffix: suffix.slice(0, 18), // OpenAI max suffix length
      hyperparameters: {
        n_epochs: "auto",
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI fine-tune job failed: ${err}`);
  }

  return await res.json();
}

// ── Poll job status ───────────────────────────────────────────────────────────

async function pollJobStatus(jobId: string): Promise<{ status: string; fine_tuned_model?: string; error?: string }> {
  const res = await fetch(`${OPENAI_BASE}/fine_tuning/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
  });

  if (!res.ok) return { status: "failed", error: `HTTP ${res.status}` };
  const data = await res.json();
  return {
    status: data.status,
    fine_tuned_model: data.fine_tuned_model ?? undefined,
    error: data.error?.message ?? undefined,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (!OPENAI_KEY) {
    return json({ error: "OPENAI_API key not configured" }, 503);
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "submit";

  // ── GET: list jobs ─────────────────────────────────────────────────────────
  if (req.method === "GET" && action === "list") {
    const userId = url.searchParams.get("user_id");
    if (!userId) return json({ error: "user_id required" }, 400);

    const { data, error } = await sb()
      .from("mavis_finetune_jobs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) return json({ error: error.message }, 500);
    return json({ jobs: data ?? [] });
  }

  // ── POST ───────────────────────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const userId = String(body.user_id ?? "");
  if (!userId) return json({ error: "user_id required" }, 400);

  // ── poll: check status of all running jobs ─────────────────────────────────
  if (action === "poll" || body.action === "poll") {
    const { data: runningJobs } = await sb()
      .from("mavis_finetune_jobs")
      .select("id, job_id, provider")
      .eq("user_id", userId)
      .in("status", ["pending", "running"])
      .eq("provider", "openai");

    const updates: Array<{ id: string; fine_tuned_model?: string; status: string }> = [];

    for (const job of runningJobs ?? []) {
      if (!job.job_id) continue;
      try {
        const { status, fine_tuned_model, error } = await pollJobStatus(job.job_id);
        const update: Record<string, unknown> = { status };
        if (fine_tuned_model) {
          update.fine_tuned_model = fine_tuned_model;
          update.finished_at = new Date().toISOString();
        }
        if (error) update.error_message = error;
        await sb().from("mavis_finetune_jobs").update(update).eq("id", job.id);
        updates.push({ id: job.id, fine_tuned_model, status });
      } catch { /* non-fatal per job */ }
    }

    return json({ polled: updates.length, updates });
  }

  // ── submit: new fine-tuning job ────────────────────────────────────────────
  const jsonlContent = String(body.jsonl_content ?? "");
  const pairsCount = Number(body.pairs_count ?? 0);
  const jsonlPath = String(body.jsonl_path ?? "");

  if (!jsonlContent || pairsCount < 10) {
    return json({
      skipped: true,
      reason: `Need at least 10 high-quality pairs. Got ${pairsCount}. Keep using MAVIS to build up training data.`,
    });
  }

  // Create DB record first
  const { data: jobRow, error: insertErr } = await sb()
    .from("mavis_finetune_jobs")
    .insert({
      user_id: userId,
      provider: "openai",
      base_model: BASE_MODEL,
      status: "pending",
      pairs_count: pairsCount,
      jsonl_path: jsonlPath,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertErr) return json({ error: insertErr.message }, 500);
  const jobDbId = jobRow.id;

  try {
    // Upload file to OpenAI
    const filename = `mavis-training-${userId.slice(0, 8)}-${Date.now()}.jsonl`;
    const fileId = await uploadTrainingFile(jsonlContent, filename);

    // Start fine-tune job
    const suffix = `mavis-${userId.slice(0, 8)}`;
    const ftJob = await startFineTuneJob(fileId, suffix);

    // Update DB record with job ID
    await sb()
      .from("mavis_finetune_jobs")
      .update({
        job_id: ftJob.id,
        training_file_id: fileId,
        status: "running",
      })
      .eq("id", jobDbId);

    return json({
      success: true,
      job_db_id: jobDbId,
      openai_job_id: ftJob.id,
      training_file_id: fileId,
      base_model: BASE_MODEL,
      pairs: pairsCount,
      message: `Fine-tuning job submitted. OpenAI will train your custom model (${BASE_MODEL}) on ${pairsCount} conversation pairs. Estimated time: 15-60 minutes. MAVIS will use your custom model automatically when ready.`,
    });
  } catch (err: any) {
    await sb()
      .from("mavis_finetune_jobs")
      .update({ status: "failed", error_message: err.message })
      .eq("id", jobDbId);
    return json({ error: err.message }, 500);
  }
});
