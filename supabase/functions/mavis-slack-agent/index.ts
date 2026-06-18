// mavis-slack-agent
// Send messages, read channels, upload text, manage DMs via Slack API.
// Requires: SLACK_BOT_TOKEN (Bot User OAuth Token — xoxb-...)
//
// Actions: send_message | send_dm | list_channels | read_channel | upload_text | add_reaction

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") ?? "";
const SLACK_API   = "https://slack.com/api";

function requireSlack() {
  if (!SLACK_TOKEN) throw new Error("Slack not configured. Set SLACK_BOT_TOKEN in Supabase secrets.");
}

async function slackCall(method: string, body: Record<string, unknown>): Promise<any> {
  requireSlack();
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SLACK_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`);
  return data;
}

async function slackGet(method: string, params: Record<string, string | number>): Promise<any> {
  requireSlack();
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  ).toString();
  const res = await fetch(`${SLACK_API}/${method}?${qs}`, {
    headers: { "Authorization": `Bearer ${SLACK_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    switch (action) {
      case "send_message": {
        const channel = String(body.channel ?? "");
        const text    = String(body.text ?? body.message ?? "");
        if (!channel || !text) return json({ error: "channel and text required" }, 400);

        const blocks = body.blocks as unknown[] | undefined;
        const payload: Record<string, unknown> = { channel, text };
        if (blocks) payload.blocks = blocks;
        if (body.thread_ts) payload.thread_ts = body.thread_ts;

        const result = await slackCall("chat.postMessage", payload);
        return json({ ts: result.ts, channel: result.channel, ok: true });
      }

      case "send_dm": {
        const userId  = String(body.user_id ?? "");
        const text    = String(body.text ?? body.message ?? "");
        if (!userId || !text) return json({ error: "user_id and text required" }, 400);

        // Open DM channel first
        const dm = await slackCall("conversations.open", { users: userId });
        const channelId = dm.channel.id;

        const result = await slackCall("chat.postMessage", { channel: channelId, text });
        return json({ ts: result.ts, channel: channelId, ok: true });
      }

      case "list_channels": {
        const types  = String(body.types ?? "public_channel,private_channel");
        const limit  = Math.min(Number(body.limit ?? 50), 200);
        const result = await slackGet("conversations.list", { types, limit, exclude_archived: 1 });

        return json({
          channels: (result.channels as any[]).map(c => ({
            id: c.id, name: c.name, is_private: c.is_private,
            num_members: c.num_members, topic: c.topic?.value ?? "",
          })),
        });
      }

      case "read_channel": {
        const channel = String(body.channel ?? "");
        if (!channel) return json({ error: "channel required" }, 400);
        const limit  = Math.min(Number(body.limit ?? 20), 100);
        const result = await slackGet("conversations.history", { channel, limit });

        return json({
          messages: (result.messages as any[]).map(m => ({
            ts: m.ts, user: m.user, text: m.text, type: m.type,
            reactions: m.reactions ?? [],
          })),
        });
      }

      case "upload_text": {
        const channel  = String(body.channel ?? "");
        const content  = String(body.content ?? "");
        const filename = String(body.filename ?? "mavis-output.txt");
        const title    = String(body.title ?? filename);
        if (!channel || !content) return json({ error: "channel and content required" }, 400);

        const result = await slackCall("files.upload", {
          channels: channel, content, filename, title,
          filetype: body.filetype ?? "text",
        });
        return json({ file_id: result.file?.id, permalink: result.file?.permalink, ok: true });
      }

      case "add_reaction": {
        const channel = String(body.channel ?? "");
        const ts      = String(body.ts ?? body.timestamp ?? "");
        const emoji   = String(body.emoji ?? body.name ?? "").replace(/:/g, "");
        if (!channel || !ts || !emoji) return json({ error: "channel, ts, and emoji required" }, 400);

        await slackCall("reactions.add", { channel, timestamp: ts, name: emoji });
        return json({ ok: true });
      }

      default:
        return json({ error: `Unknown action: ${action}. Use: send_message | send_dm | list_channels | read_channel | upload_text | add_reaction` }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-slack-agent]", message);
    const status = message.includes("not configured") ? 503 : 500;
    return json({ error: message }, status);
  }
});
