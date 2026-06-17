// mavis-discord-agent
// Discord server management via Bot API — send to channels, read history,
// list servers/channels, create threads, react, DM users.
// Requires: DISCORD_BOT_TOKEN
//
// Discord message limits: 2000 chars (MAVIS enforces 1900 for safety).
// Format guidance: use **bold**, *italic*, `code`, ```blocks```, > quotes, :emoji:
//
// Actions: send_message | send_dm | list_guilds | list_channels | get_messages
//          delete_message | create_thread | add_reaction | pin_message
//          get_channel | send_embed

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK         = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISCORD_TOKEN  = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const DISCORD_API    = "https://discord.com/api/v10";
const MAX_CHARS      = 1900;

function requireDiscord() {
  if (!DISCORD_TOKEN) throw new Error("Discord not configured. Set DISCORD_BOT_TOKEN in Supabase secrets.");
}

async function dReq(path: string, method = "GET", body?: unknown): Promise<any> {
  requireDiscord();
  const res = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bot ${DISCORD_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return { success: true };
  if (res.status === 404) throw new Error(`Discord 404: resource not found at ${path}`);

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Discord error (${res.status}): ${(data as any).message ?? JSON.stringify(data).slice(0, 200)}`);
  return data;
}

/** Truncate to Discord's safe limit, appending a note if cut */
function safe(text: string, limit = MAX_CHARS): string {
  if (text.length <= limit) return text;
  const cutNote = "\n\n*[truncated — message too long]*";
  return text.slice(0, limit - cutNote.length) + cutNote;
}

/** Split long content into chunks that fit Discord's limit */
function chunk(text: string, limit = MAX_CHARS): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    // Try to break at a newline
    let cut = limit;
    if (remaining.length > limit) {
      const nl = remaining.lastIndexOf("\n", limit);
      cut = nl > limit * 0.5 ? nl : limit;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  return chunks;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body      = await req.json().catch(() => ({}));
    const action    = String(body.action ?? "");
    const channelId = body.channel_id ? String(body.channel_id) : "";
    const guildId   = body.guild_id   ? String(body.guild_id)   : "";

    switch (action) {

      // ── Messaging ───────────────────────────────────────────

      case "send_message": {
        if (!channelId) return json({ error: "channel_id required" }, 400);
        const content    = safe(String(body.content ?? body.message ?? body.text ?? ""));
        const messageRef = body.reply_to ? String(body.reply_to) : undefined;

        if (!content.trim()) return json({ error: "content required" }, 400);

        const payload: Record<string, any> = { content };
        if (messageRef) payload.message_reference = { message_id: messageRef };
        if (body.tts)   payload.tts = true;

        const msg = await dReq(`/channels/${channelId}/messages`, "POST", payload);
        return json({ message_id: msg.id, channel_id: msg.channel_id, content: msg.content });
      }

      case "send_chunked": {
        // Sends long content split across multiple messages
        if (!channelId) return json({ error: "channel_id required" }, 400);
        const content = String(body.content ?? body.text ?? "");
        const chunks  = chunk(content);
        const sent: string[] = [];

        for (const c of chunks) {
          const msg = await dReq(`/channels/${channelId}/messages`, "POST", { content: c });
          sent.push(msg.id);
        }
        return json({ message_ids: sent, chunks_sent: sent.length });
      }

      case "send_embed": {
        if (!channelId) return json({ error: "channel_id required" }, 400);

        const embed: Record<string, any> = {};
        if (body.title)       embed.title       = String(body.title).slice(0, 256);
        if (body.description) embed.description = String(body.description).slice(0, 4096);
        if (body.color)       embed.color       = Number(body.color);
        if (body.url)         embed.url         = String(body.url);
        if (body.thumbnail)   embed.thumbnail   = { url: String(body.thumbnail) };
        if (body.image)       embed.image       = { url: String(body.image) };
        if (body.footer)      embed.footer      = { text: String(body.footer).slice(0, 2048) };
        if (body.author)      embed.author      = { name: String(body.author).slice(0, 256) };
        if (Array.isArray(body.fields)) {
          embed.fields = (body.fields as any[]).slice(0, 25).map((f: any) => ({
            name:   String(f.name ?? "").slice(0, 256),
            value:  String(f.value ?? "").slice(0, 1024),
            inline: Boolean(f.inline ?? false),
          }));
        }

        const payload: Record<string, any> = { embeds: [embed] };
        if (body.content) payload.content = safe(String(body.content));

        const msg = await dReq(`/channels/${channelId}/messages`, "POST", payload);
        return json({ message_id: msg.id, channel_id: msg.channel_id });
      }

      case "send_dm": {
        const userId = String(body.user_id ?? body.to ?? "");
        if (!userId) return json({ error: "user_id required" }, 400);

        // Open DM channel
        const dmChannel = await dReq("/users/@me/channels", "POST", { recipient_id: userId });
        const content   = safe(String(body.content ?? body.message ?? body.text ?? ""));
        if (!content.trim()) return json({ error: "content required" }, 400);

        const msg = await dReq(`/channels/${dmChannel.id}/messages`, "POST", { content });
        return json({ message_id: msg.id, dm_channel_id: dmChannel.id });
      }

      // ── Reading ─────────────────────────────────────────────

      case "get_messages": {
        if (!channelId) return json({ error: "channel_id required" }, 400);
        const limit  = Math.min(Number(body.limit ?? 10), 100);
        const before = body.before ? `&before=${body.before}` : "";
        const after  = body.after  ? `&after=${body.after}`   : "";

        const msgs = await dReq(`/channels/${channelId}/messages?limit=${limit}${before}${after}`);
        return json({
          messages: (Array.isArray(msgs) ? msgs : []).map((m: any) => ({
            id:         m.id,
            content:    m.content,
            author:     m.author?.username,
            author_id:  m.author?.id,
            timestamp:  m.timestamp,
            edited:     m.edited_timestamp,
            pinned:     m.pinned,
            attachments: (m.attachments ?? []).map((a: any) => ({ url: a.url, filename: a.filename })),
          })),
        });
      }

      case "get_channel": {
        const cid = channelId || String(body.id ?? "");
        if (!cid) return json({ error: "channel_id required" }, 400);
        const ch = await dReq(`/channels/${cid}`);
        return json({
          id:         ch.id,
          name:       ch.name,
          type:       ch.type,
          topic:      ch.topic,
          guild_id:   ch.guild_id,
          position:   ch.position,
          nsfw:       ch.nsfw,
          parent_id:  ch.parent_id,
        });
      }

      // ── Discovery ───────────────────────────────────────────

      case "list_guilds": {
        // Returns guilds the bot is a member of
        const guilds = await dReq("/users/@me/guilds");
        return json({
          guilds: (Array.isArray(guilds) ? guilds : []).map((g: any) => ({
            id:   g.id,
            name: g.name,
            icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
          })),
        });
      }

      case "list_channels": {
        if (!guildId) return json({ error: "guild_id required" }, 400);
        const channels = await dReq(`/guilds/${guildId}/channels`);
        const TYPES: Record<number, string> = { 0: "text", 2: "voice", 4: "category", 5: "announcement", 11: "thread", 15: "forum" };

        return json({
          channels: (Array.isArray(channels) ? channels : [])
            .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
            .map((c: any) => ({
              id:         c.id,
              name:       c.name,
              type:       TYPES[c.type] ?? `unknown(${c.type})`,
              topic:      c.topic ?? null,
              category_id: c.parent_id ?? null,
              nsfw:       c.nsfw ?? false,
            })),
        });
      }

      case "list_members": {
        if (!guildId) return json({ error: "guild_id required" }, 400);
        const limit   = Math.min(Number(body.limit ?? 50), 1000);
        const members = await dReq(`/guilds/${guildId}/members?limit=${limit}`);
        return json({
          members: (Array.isArray(members) ? members : []).map((m: any) => ({
            id:       m.user?.id,
            username: m.user?.username,
            nickname: m.nick,
            roles:    m.roles,
            joined:   m.joined_at,
            bot:      m.user?.bot ?? false,
          })),
        });
      }

      // ── Actions ─────────────────────────────────────────────

      case "delete_message": {
        const msgId = String(body.message_id ?? body.id ?? "");
        if (!channelId || !msgId) return json({ error: "channel_id and message_id required" }, 400);
        await dReq(`/channels/${channelId}/messages/${msgId}`, "DELETE");
        return json({ deleted: true, message_id: msgId });
      }

      case "edit_message": {
        const msgId   = String(body.message_id ?? body.id ?? "");
        const content = safe(String(body.content ?? body.text ?? ""));
        if (!channelId || !msgId) return json({ error: "channel_id and message_id required" }, 400);

        const msg = await dReq(`/channels/${channelId}/messages/${msgId}`, "PATCH", { content });
        return json({ message_id: msg.id, content: msg.content });
      }

      case "add_reaction": {
        const msgId = String(body.message_id ?? body.id ?? "");
        const emoji = String(body.emoji ?? "👍");
        if (!channelId || !msgId) return json({ error: "channel_id and message_id required" }, 400);

        const encoded = encodeURIComponent(emoji);
        await dReq(`/channels/${channelId}/messages/${msgId}/reactions/${encoded}/@me`, "PUT");
        return json({ reacted: true, emoji, message_id: msgId });
      }

      case "pin_message": {
        const msgId = String(body.message_id ?? body.id ?? "");
        if (!channelId || !msgId) return json({ error: "channel_id and message_id required" }, 400);
        await dReq(`/channels/${channelId}/pins/${msgId}`, "PUT");
        return json({ pinned: true, message_id: msgId });
      }

      case "create_thread": {
        const msgId = body.message_id ? String(body.message_id) : undefined;
        const name  = String(body.name ?? body.title ?? "Thread");
        if (!channelId) return json({ error: "channel_id required" }, 400);

        let thread: any;
        if (msgId) {
          // Thread from an existing message
          thread = await dReq(`/channels/${channelId}/messages/${msgId}/threads`, "POST", {
            name: name.slice(0, 100),
            auto_archive_duration: Number(body.archive_duration ?? 1440),
          });
        } else {
          // Standalone thread (requires Community server or forum channel)
          thread = await dReq(`/channels/${channelId}/threads`, "POST", {
            name:                  name.slice(0, 100),
            type:                  11,
            auto_archive_duration: Number(body.archive_duration ?? 1440),
          });
        }

        // Optionally send starter message into thread
        if (body.starter_message) {
          await dReq(`/channels/${thread.id}/messages`, "POST", {
            content: safe(String(body.starter_message)),
          });
        }

        return json({ thread_id: thread.id, name: thread.name, channel_id: channelId });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: send_message | send_chunked | send_embed | send_dm | get_messages | get_channel | list_guilds | list_channels | list_members | delete_message | edit_message | add_reaction | pin_message | create_thread`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-discord-agent]", message);
    return json({ error: message }, message.includes("not configured") ? 503 : 500);
  }
});
