// mavis-gmail-webhook
// Receives Google Pub/Sub push notifications the instant a new email arrives.
// Google POSTs here → we decode the notification → identify the user →
// fetch new messages via Gmail History API → run MAVIS immediately.
//
// This endpoint must be registered as the push subscription endpoint in
// Google Cloud Console (Pub/Sub → Subscriptions → your subscription).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function refreshToken(
  config: Record<string, unknown>,
  adminSb: ReturnType<typeof createClient>,
  userId: string,
): Promise<string> {
  if (typeof config.expires_at === "number" && config.expires_at > Date.now() / 1000 + 300) {
    return config.access_token as string;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     config.client_id as string,
      client_secret: config.client_secret as string,
      refresh_token: config.refresh_token as string,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed");
  const newConfig = { ...config, access_token: data.access_token, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600) };
  await adminSb.from("mavis_user_integrations").update({ config: newConfig }).eq("user_id", userId).eq("provider", "gmail");
  return data.access_token as string;
}

interface NewMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  isImportant: boolean;
}

async function fetchNewMessages(
  userId: string,
  config: Record<string, unknown>,
  newHistoryId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<NewMessage[]> {
  const lastHistoryId = String(config.gmail_history_id ?? newHistoryId);
  const token = await refreshToken(config, adminSb, userId);

  // Use History API — only fetches changes since last known historyId
  const histRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${lastHistoryId}&historyTypes=messageAdded&labelId=INBOX`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  );

  if (!histRes.ok) return [];
  const histData = await histRes.json();

  // Update stored historyId so next call is incremental
  await adminSb.from("mavis_user_integrations").update({
    config: { ...config, gmail_history_id: newHistoryId },
  }).eq("user_id", userId).eq("provider", "gmail");

  const addedMessages: { message: { id: string } }[] = [];
  for (const record of histData.history ?? []) {
    for (const msg of record.messagesAdded ?? []) {
      addedMessages.push(msg);
    }
  }

  if (addedMessages.length === 0) return [];

  // Fetch metadata for each new message (max 5)
  const messages = await Promise.allSettled(
    addedMessages.slice(0, 5).map(async ({ message: { id } }) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
      );
      if (!msgRes.ok) return null;
      const msg = await msgRes.json();
      const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
      const get = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
      const labels: string[] = msg.labelIds ?? [];
      return {
        id,
        from:        get("From"),
        subject:     get("Subject"),
        snippet:     (msg.snippet ?? "").slice(0, 250),
        isImportant: labels.includes("IMPORTANT") || labels.includes("STARRED"),
      } satisfies NewMessage;
    }),
  );

  return messages
    .filter((r): r is PromiseFulfilledResult<NewMessage | null> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value as NewMessage);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Google sends POST with Pub/Sub message body
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const body = await req.json().catch(() => null);
    if (!body?.message?.data) {
      // Google sends empty notifications to validate the endpoint — return 200
      return new Response("ok", { status: 200 });
    }

    // Decode base64 Pub/Sub message
    let notification: { emailAddress?: string; historyId?: string } = {};
    try {
      notification = JSON.parse(atob(body.message.data));
    } catch {
      return new Response("ok", { status: 200 }); // malformed — ack and ignore
    }

    const { emailAddress, historyId } = notification;
    if (!emailAddress || !historyId) return new Response("ok", { status: 200 });

    // Find the user by their connected Gmail email
    const { data: integrations } = await adminSb
      .from("mavis_user_integrations")
      .select("user_id, config")
      .eq("provider", "gmail")
      .eq("status", "active");

    const match = ((integrations ?? []) as { user_id: string; config: Record<string, unknown> }[])
      .find((r) => r.config?.email === emailAddress || r.config?.connected_email === emailAddress);

    if (!match) {
      // Acknowledge to prevent retry — just not our user
      return new Response("ok", { status: 200 });
    }

    const { user_id: userId, config } = match;

    // Fetch the new messages using History API (incremental — only what's new)
    const newMessages = await fetchNewMessages(userId, config, historyId, adminSb);

    if (newMessages.length === 0) {
      return new Response("ok", { status: 200 }); // notification was for something non-inbox (sent, etc.)
    }

    // Build context and run MAVIS immediately
    const emailContext = newMessages
      .map((m) => `• From: ${m.from}\n  Subject: ${m.subject}\n  Preview: ${m.snippet}${m.isImportant ? " [IMPORTANT]" : ""}`)
      .join("\n");

    const goal = `You are MAVIS. A new email just arrived for the operator — real-time notification.

NEW EMAIL${newMessages.length > 1 ? `S (${newMessages.length})` : ""}:
${emailContext}

React immediately:
- If it needs a response, draft a reply (queue for approval)
- If it creates a task, create it (auto-executed)
- If it mentions a meeting, check the calendar and flag conflicts
- If it's a newsletter/marketing/automated email, ignore it
- Be decisive — one sentence per action, no rambling`;

    // Fire and don't await — we must return 200 to Google quickly (< 10s)
    // to prevent Pub/Sub retry. Agent runs async.
    const agentPromise = fetch(`${SUPABASE_URL}/functions/v1/mavis-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ user_id: userId, goal, mode: "REALTIME_EMAIL" }),
      signal: AbortSignal.timeout(120_000),
    }).then(async (res) => {
      const data = res.ok ? await res.json() : {};
      // Log the real-time trigger
      await adminSb.from("mavis_trigger_log").insert({
        user_id:         userId,
        trigger_types:   ["new_email"],
        context_summary: emailContext.slice(0, 500),
        agent_response:  (data.content ?? "").slice(0, 1000),
        actions_auto:    0,
        actions_queued:  data.actionsQueued ?? 0,
      });
    }).catch((err) => console.error("[gmail-webhook] agent error:", err));

    // Use waitUntil if available (Deno Deploy / Supabase Edge)
    if ("waitUntil" in req) {
      (req as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(agentPromise);
    }

    // Must return 200 within ~10s or Google retries
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[mavis-gmail-webhook]", err);
    // Still return 200 to prevent Pub/Sub retry flood
    return new Response("ok", { status: 200 });
  }
});
