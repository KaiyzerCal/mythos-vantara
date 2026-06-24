// mavis-gmail-watch
// Sets up and renews Gmail push notifications via Google Pub/Sub.
// Actions: setup | renew | status
//
// After setup, Google pushes a notification to mavis-gmail-webhook
// the instant a new email arrives — no polling delay.
//
// Prerequisites (one-time, in Google Cloud Console):
//   1. Create a Pub/Sub topic (e.g. "mavis-gmail-push")
//   2. Add gmail-api-push@system.gserviceaccount.com as Publisher on that topic
//   3. Create a push subscription → endpoint: [supabase-url]/functions/v1/mavis-gmail-webhook
//   4. Call this function with action:"setup" and the topic_name

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

async function refreshGoogleToken(
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

async function setupWatch(
  userId: string,
  topicName: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<{ historyId: string; expiration: string }> {
  const { data: integration } = await adminSb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .single();

  if (!integration?.config) throw new Error("Gmail not connected");

  const config = integration.config as Record<string, unknown>;
  const token = await refreshGoogleToken(config, adminSb, userId);

  const watchRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      topicName,
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
    }),
  });

  if (!watchRes.ok) {
    const err = await watchRes.text();
    throw new Error(`Gmail watch failed (${watchRes.status}): ${err}`);
  }

  const watchData = await watchRes.json();
  const { historyId, expiration } = watchData as { historyId: string; expiration: string };

  // Store historyId + watch config on the gmail integration row
  await adminSb.from("mavis_user_integrations").update({
    config: {
      ...config,
      gmail_history_id:     historyId,
      gmail_watch_topic:    topicName,
      gmail_watch_expires:  expiration,
    },
  }).eq("user_id", userId).eq("provider", "gmail");

  return { historyId, expiration };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    let userId = "";

    if (token === SERVICE_ROLE_KEY) {
      const body = await req.json().catch(() => ({})) as Record<string, string>;
      userId = body.user_id ?? "";
    } else {
      const userSb = createClient(SUPABASE_URL, token, { auth: { persistSession: false } });
      const { data: { user } } = await userSb.auth.getUser();
      userId = user?.id ?? "";
    }

    if (!userId) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, string>;
    const action = body.action ?? "status";

    // ── setup: register Gmail watch for a Pub/Sub topic ────────────────────────
    if (action === "setup") {
      const { topic_name } = body;
      if (!topic_name) return json({ ok: false, error: "topic_name required (e.g. projects/my-project/topics/mavis-gmail-push)" }, 400);

      const result = await setupWatch(userId, topic_name, adminSb);
      return json({
        ok: true,
        message: "Gmail push notifications enabled. Emails will now trigger MAVIS instantly.",
        history_id:  result.historyId,
        expires:     new Date(Number(result.expiration)).toISOString(),
        webhook_url: `${SUPABASE_URL}/functions/v1/mavis-gmail-webhook`,
      });
    }

    // ── renew: called by daily cron — refreshes expiring watches ──────────────
    if (action === "renew") {
      const { data: integrations } = await adminSb
        .from("mavis_user_integrations")
        .select("user_id, config")
        .eq("provider", "gmail")
        .eq("status", "active");

      const results = [];
      for (const row of ((integrations ?? []) as { user_id: string; config: Record<string, unknown> }[])) {
        const cfg = row.config ?? {};
        if (!cfg.gmail_watch_topic) continue;

        // Renew if expiring within 24 hours
        const expiresAt = Number(cfg.gmail_watch_expires ?? 0);
        const hoursLeft = (expiresAt - Date.now()) / 3_600_000;
        if (hoursLeft > 24) continue;

        try {
          const r = await setupWatch(row.user_id, cfg.gmail_watch_topic as string, adminSb);
          results.push({ user_id: row.user_id, renewed: true, expires: r.expiration });
        } catch (err) {
          results.push({ user_id: row.user_id, renewed: false, error: String(err) });
        }
      }

      return json({ ok: true, renewed: results.length, results });
    }

    // ── status: check current watch state ─────────────────────────────────────
    if (action === "status") {
      const { data: integration } = await adminSb
        .from("mavis_user_integrations")
        .select("config")
        .eq("user_id", userId)
        .eq("provider", "gmail")
        .maybeSingle();

      const cfg = (integration?.config ?? {}) as Record<string, unknown>;
      const hasWatch = !!cfg.gmail_watch_topic;
      const expires  = cfg.gmail_watch_expires ? new Date(Number(cfg.gmail_watch_expires)).toISOString() : null;

      return json({
        ok: true,
        push_enabled: hasWatch,
        topic:       cfg.gmail_watch_topic ?? null,
        expires,
        history_id:  cfg.gmail_history_id ?? null,
        webhook_url: `${SUPABASE_URL}/functions/v1/mavis-gmail-webhook`,
      });
    }

    // ── stop: cancel the watch ─────────────────────────────────────────────────
    if (action === "stop") {
      const { data: integration } = await adminSb
        .from("mavis_user_integrations")
        .select("config")
        .eq("user_id", userId)
        .eq("provider", "gmail")
        .single();

      if (integration?.config) {
        const cfg = integration.config as Record<string, unknown>;
        const token2 = await refreshGoogleToken(cfg, adminSb, userId);
        await fetch("https://gmail.googleapis.com/gmail/v1/users/me/stop", {
          method: "POST",
          headers: { Authorization: `Bearer ${token2}` },
        }).catch(() => {/* ignore */});

        const { gmail_watch_topic: _t, gmail_watch_expires: _e, gmail_history_id: _h, ...rest } = cfg;
        await adminSb.from("mavis_user_integrations").update({ config: rest }).eq("user_id", userId).eq("provider", "gmail");
      }

      return json({ ok: true, message: "Gmail push notifications stopped. Falling back to 10-minute polling." });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[mavis-gmail-watch]", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
