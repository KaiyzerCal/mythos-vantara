/**
 * mavis-inbound-webhook — Event-driven proactive trigger gateway.
 *
 * Receives webhooks from external services (GitHub, Stripe, Gmail, etc.) and
 * converts them into autonomous MAVIS tasks that run in the next cron cycle.
 * This makes MAVIS reactive to the world without polling.
 *
 * Usage:
 *   POST /functions/v1/mavis-inbound-webhook?user_id=<uuid>&source=github
 *   Headers:
 *     X-Webhook-Token: <MAVIS_INBOUND_WEBHOOK_SECRET>   (if secret is set)
 *     X-GitHub-Event: push                               (GitHub sends this automatically)
 *
 * Supported sources: github, stripe, gmail, generic (fallback)
 *
 * Response: 202 Accepted immediately — task is queued for the next runner cycle.
 *
 * Required Supabase secrets:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MAVIS_INBOUND_WEBHOOK_SECRET   (optional but recommended — shared secret for all integrations)
 *
 * config.toml (note only — do not edit):
 *   [functions.mavis-inbound-webhook]
 *   verify_jwt = false
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("MAVIS_INBOUND_WEBHOOK_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-token, " +
    "x-webhook-source, x-github-event, x-stripe-signature, x-hub-signature-256",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Event normalizers ─────────────────────────────────────────────────────────

interface NormalizedEvent {
  goal: string;
  event_type: string;
  metadata: Record<string, unknown>;
}

function normalizeGitHub(
  payload: Record<string, unknown>,
  githubEventHeader: string,
): NormalizedEvent {
  const repo =
    (payload.repository as Record<string, unknown>)?.full_name ?? "unknown repo";
  const action = String(payload.action ?? "");
  let goal = `Analyze GitHub ${githubEventHeader} event on ${repo} and take appropriate action`;

  if (githubEventHeader === "push") {
    const commits = (payload.commits as unknown[])?.length ?? 0;
    const ref = String(payload.ref ?? "").replace("refs/heads/", "");
    const pusher =
      (payload.pusher as Record<string, unknown>)?.name ?? "someone";
    const commitMsgs = (
      (payload.commits as Array<Record<string, unknown>>) ?? []
    )
      .slice(0, 3)
      .map((c) => String(c.message ?? "").split("\n")[0])
      .join("; ");
    goal =
      `${pusher} pushed ${commits} commit${commits !== 1 ? "s" : ""} to ${repo}/${ref}` +
      (commitMsgs ? `: "${commitMsgs}"` : "") +
      `. Review the push and update my knowledge base about ${repo}.`;
  } else if (githubEventHeader === "pull_request") {
    const pr = payload.pull_request as Record<string, unknown>;
    const title = String(pr?.title ?? "");
    const user =
      (pr?.user as Record<string, unknown>)?.login ?? "someone";
    const body = String(pr?.body ?? "").slice(0, 200);
    goal =
      `GitHub PR ${action}: "${title}" by ${user} in ${repo}. ` +
      (body ? `Description: ${body}. ` : "") +
      "Review and summarize this PR for me.";
  } else if (githubEventHeader === "issues") {
    const issue = payload.issue as Record<string, unknown>;
    const title = String(issue?.title ?? "");
    const user =
      (issue?.user as Record<string, unknown>)?.login ?? "someone";
    goal = `GitHub issue ${action}: "${title}" by ${user} in ${repo}. Analyze and summarize.`;
  } else if (githubEventHeader === "release") {
    const release = payload.release as Record<string, unknown>;
    const tagName = String(release?.tag_name ?? "");
    const relBody = String(release?.body ?? "").slice(0, 300);
    goal =
      `GitHub release ${tagName} published in ${repo}. ` +
      (relBody ? `Notes: ${relBody}. ` : "") +
      "Update my knowledge about this release.";
  } else if (githubEventHeader === "workflow_run") {
    const run = payload.workflow_run as Record<string, unknown>;
    const status = String(run?.conclusion ?? run?.status ?? "unknown");
    const workflowName = String(run?.name ?? "workflow");
    goal = `GitHub workflow "${workflowName}" in ${repo} finished with status: ${status}. Log this in my knowledge base.`;
  }

  return {
    goal,
    event_type: `github.${githubEventHeader}${action ? "." + action : ""}`,
    metadata: { repo, action, github_event: githubEventHeader },
  };
}

function normalizeStripe(payload: Record<string, unknown>): NormalizedEvent {
  const type = String(payload.type ?? "stripe.event");
  const data =
    ((payload.data as Record<string, unknown>)?.object as Record<string, unknown>) ?? {};

  let goal = `Process Stripe event: ${type} and update my financial records accordingly.`;

  if (type.startsWith("payment_intent")) {
    const amount = Number(data.amount ?? 0) / 100;
    const currency = String(data.currency ?? "usd").toUpperCase();
    const status = String(data.status ?? "");
    goal = `Stripe payment ${status}: ${currency} ${amount.toFixed(2)}. Log this transaction in my finance tracker and update running totals.`;
  } else if (type.startsWith("customer.subscription")) {
    const subscriptionStatus = String(data.status ?? "");
    const action = type.split(".").pop() ?? "updated";
    goal = `Stripe subscription ${action}: status is now "${subscriptionStatus}". Update my subscription records and notify me of any important changes.`;
  } else if (type.startsWith("invoice")) {
    const amount = Number(data.amount_paid ?? 0) / 100;
    const currency = String(data.currency ?? "usd").toUpperCase();
    const invoiceStatus = type.split(".").pop() ?? "updated";
    goal = `Stripe invoice ${invoiceStatus}: ${currency} ${amount.toFixed(2)}. Log in finance tracker.`;
  } else if (type === "customer.created") {
    goal = `New Stripe customer created. Log this in my CRM records.`;
  }

  return {
    goal,
    event_type: type,
    metadata: { stripe_object_id: String(data.id ?? ""), stripe_type: type },
  };
}

function normalizeGmail(payload: Record<string, unknown>): NormalizedEvent {
  const emailAddress = String(
    (payload.emailAddress as string) ??
      (payload.message as Record<string, unknown>)?.data ??
      "your Gmail",
  );
  const historyId = payload.historyId ?? (payload.message as Record<string, unknown>)?.messageId;

  return {
    goal:
      `New Gmail activity detected for ${emailAddress} (history ID: ${historyId}). ` +
      "Check my recent emails, summarize any important ones, flag action items, and update my knowledge base.",
    event_type: "gmail.message.new",
    metadata: { emailAddress, historyId: String(historyId ?? "") },
  };
}

function normalizeCalendar(payload: Record<string, unknown>): NormalizedEvent {
  const channelId = String(payload.channelId ?? "");
  const resourceId = String(payload.resourceId ?? "");

  return {
    goal:
      "Google Calendar was updated. Review my upcoming schedule for any new events or changes, " +
      "and update my time tracking records.",
    event_type: "google.calendar.change",
    metadata: { channelId, resourceId },
  };
}

function normalizeGeneric(
  payload: Record<string, unknown>,
  source: string,
): NormalizedEvent {
  const preview = JSON.stringify(payload).slice(0, 400);
  return {
    goal:
      `Incoming webhook from ${source}: ${preview}. ` +
      "Analyze this event and take any appropriate actions. Log it in my knowledge base.",
    event_type: `${source}.webhook`,
    metadata: { source, preview },
  };
}

function normalizePayload(
  payload: Record<string, unknown>,
  source: string,
  githubEventHeader?: string,
): NormalizedEvent {
  switch (source.toLowerCase()) {
    case "github":
      return normalizeGitHub(payload, githubEventHeader ?? String(payload.action ?? "event"));
    case "stripe":
      return normalizeStripe(payload);
    case "gmail":
    case "google-gmail":
      return normalizeGmail(payload);
    case "google-calendar":
    case "gcal":
      return normalizeCalendar(payload);
    case "activepieces":
    case "ap": {
      // Activepieces flows POST here after completing so MAVIS can react to external events.
      // The flow payload should include: flowName, triggerEvent, data, summary (optional).
      const flowName = String(payload.flowName ?? payload.flow_name ?? "Activepieces flow");
      const triggerEvent = String(payload.triggerEvent ?? payload.trigger_event ?? payload.event ?? "completed");
      const summary = String(payload.summary ?? payload.result ?? "").slice(0, 400);
      const goal = summary
        ? `Activepieces: "${flowName}" completed (${triggerEvent}). Result: ${summary}. Log this and take any follow-up actions.`
        : `Activepieces: "${flowName}" completed (${triggerEvent}). Log this event and notify me with any relevant follow-ups.`;
      return {
        goal,
        event_type: `activepieces.${triggerEvent}`,
        metadata: { flowName, triggerEvent, summary },
      };
    }
    default:
      return normalizeGeneric(payload, source);
  }
}

// ── GitHub HMAC verification ──────────────────────────────────────────────────

async function verifyGitHubSignature(
  secret: string,
  body: string,
  signature: string,
): Promise<boolean> {
  if (!signature.startsWith("sha256=")) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex =
    "sha256=" +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  return hex === signature;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id") ?? "";
  const source =
    url.searchParams.get("source") ??
    req.headers.get("X-Webhook-Source") ??
    "generic";

  if (!userId) return json({ error: "user_id query param is required" }, 400);

  // Read raw body text for signature verification
  const rawBody = await req.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // ── Auth: token or GitHub HMAC ────────────────────────────────────────────
  if (WEBHOOK_SECRET) {
    const token =
      req.headers.get("X-Webhook-Token") ?? url.searchParams.get("token") ?? "";
    const githubSig = req.headers.get("X-Hub-Signature-256") ?? "";

    if (source === "github" && githubSig) {
      // Prefer GitHub HMAC over plain token for GitHub sources
      const valid = await verifyGitHubSignature(WEBHOOK_SECRET, rawBody, githubSig).catch(
        () => false,
      );
      if (!valid) return json({ error: "GitHub signature verification failed" }, 401);
    } else if (token !== WEBHOOK_SECRET) {
      return json({ error: "Invalid webhook token" }, 401);
    }
  }

  const githubEventHeader = req.headers.get("X-GitHub-Event") ?? undefined;
  const normalized = normalizePayload(payload, source, githubEventHeader);

  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  // ── Create an autonomous task for this event ──────────────────────────────
  // Tasks are processed in the next cron cycle (≤2 min). This ensures the
  // webhook responds immediately with 202 while work happens asynchronously.
  const { data: newTask, error: taskErr } = await sb
    .from("mavis_autonomous_tasks")
    .insert({
      user_id: userId,
      goal: normalized.goal,
      status: "pending",
      plan: [],
      current_step: 0,
      context: {
        goal: normalized.goal,
        steps_completed: [],
        reasoning: [],
        search_results: [],
        source: "webhook",
        webhook_source: source,
        event_type: normalized.event_type,
        ...normalized.metadata,
      },
    })
    .select("id")
    .single();

  if (taskErr) {
    console.error("[inbound-webhook] Failed to create task:", taskErr.message);
    return json({ error: "Failed to queue task", detail: taskErr.message }, 500);
  }

  // ── Log to action queue for visibility in the Intel Feed ─────────────────
  await sb
    .from("mavis_action_queue")
    .insert({
      user_id: userId,
      action_type: "webhook_event",
      title: `${source} → ${normalized.event_type}`,
      description: normalized.goal,
      status: "pending",
      autonomy_tier: "auto",
      payload: {
        source,
        event_type: normalized.event_type,
        task_id: newTask?.id,
        metadata: normalized.metadata,
      },
    })
    .catch((e) => console.warn("[inbound-webhook] Failed to log action:", e));

  console.log(
    `[inbound-webhook] Queued task ${newTask?.id} for user ${userId} from ${source} (${normalized.event_type})`,
  );

  return json(
    {
      ok: true,
      queued: true,
      task_id: newTask?.id,
      event_type: normalized.event_type,
      message: "Event queued — MAVIS will process it within 2 minutes",
    },
    202,
  );
});
