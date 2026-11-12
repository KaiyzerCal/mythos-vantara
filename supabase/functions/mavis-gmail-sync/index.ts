import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { composioReady, composioRun } from "../_shared/composio.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveAuthedUid } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshGoogleToken(config: any, adminSb: any, uid: string, provider: string): Promise<string> {
  if (config.expires_at && config.expires_at > Date.now() / 1000 + 300) return config.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      refresh_token: config.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed: " + JSON.stringify(data));
  const newConfig = {
    ...config,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  };
  await adminSb.from("mavis_user_integrations").update({ config: newConfig }).eq("user_id", uid).eq("provider", provider);
  return data.access_token;
}


interface Ingest {
  id: string; threadId: string | null; subject: string; from: string; date: string;
  body: string; snippet: string; labelIds: string[]; receivedAt: string;
}

/** One normalised message -> gmail_messages (read by triage and the ambient scan), mavis_notes, and contacts. Shared by the
 *  direct Google path and the Composio path. Returns whether a sender contact was recorded. */
async function ingest(adminSb: any, uid: string, m: Ingest): Promise<boolean> {
  const fromEmail = (m.from.match(/<(.+?)>/)?.[1] ?? m.from.match(/(\S+@\S+)/)?.[1] ?? "").toLowerCase();
  const fromName  = m.from.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() ?? "";

  await Promise.resolve(adminSb.from("gmail_messages").upsert(
    {
      id: m.id, user_id: uid, thread_id: m.threadId, subject: m.subject.slice(0, 500),
      from_email: fromEmail, from_name: fromName || null, snippet: m.snippet.slice(0, 500),
      body: m.body.slice(0, 4000), labels: m.labelIds, is_read: !m.labelIds.includes("UNREAD"), received_at: m.receivedAt,
    },
    { onConflict: "id" },
  )).catch((e: any) => console.error("[mavis-gmail-sync] gmail_messages upsert error:", e?.message ?? e));

  await adminSb.from("mavis_notes").upsert(
    {
      user_id: uid,
      title: `[Email] ${m.subject.slice(0, 100)}`,
      content: `From: ${m.from}\nDate: ${m.date}\n\n${m.body.slice(0, 1000)}`,
      tags: ["email", "gmail", "intel"],
      properties: { source: "gmail", from: m.from, subject: m.subject, date: m.date, thread_id: m.threadId },
      importance: m.from.includes("@") && !m.from.toLowerCase().includes("noreply") && !m.from.toLowerCase().includes("no-reply") ? 6 : 3,
    },
    { onConflict: "user_id,title" },
  );

  if (!fromEmail) return false;
  await adminSb
    .from("contacts")
    .upsert({ user_id: uid, name: fromName || fromEmail, email: fromEmail, source: "gmail" }, { onConflict: "user_id,email" })
    // Postgrest builders are thenable but don't implement .catch() — calling it directly threw synchronously on every
    // contact, aborting the whole sync.
    .then(() => {}, () => {/* contacts table may have diff schema */});
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSb = createClient(supabaseUrl, serviceRoleKey);

    // Auth → uid (real user JWT, or trusted internal caller via service-role key)
    const uid = await resolveAuthedUid(req, adminSb);
    if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const max = body.max_emails ?? 30;

    // Get Gmail OAuth config
    const { data: integration } = await adminSb
      .from("mavis_user_integrations")
      .select("config")
      .eq("user_id", uid)
      .eq("provider", "gmail")
      .single();

    if (!integration?.config && (await composioReady(uid, "gmail"))) {
      // Gmail is authorized through Composio. Primary inbox only (the direct path's q=category:primary), so ask for
      // extra and drop anything labelled with another category.
      const data = await composioRun(uid, "GMAIL_FETCH_EMAILS", {
        max_results: Math.min(max * 2, 50), label_ids: ["INBOX"], verbose: true, include_payload: false,
      });
      const primary = ((data?.messages ?? []) as any[])
        .filter((m) => !((m.labelIds ?? []) as string[]).some((l) => l.startsWith("CATEGORY_") && l !== "CATEGORY_PERSONAL"))
        .slice(0, max);
      let count = 0, contactCount = 0;
      for (const m of primary) {
        const text = String(m.messageText ?? m.preview?.body ?? "");
        const got = await ingest(adminSb, uid, {
          id: String(m.messageId), threadId: m.threadId ?? null, subject: String(m.subject ?? ""), from: String(m.sender ?? ""),
          date: String(m.messageTimestamp ?? ""), body: text.slice(0, 1000), snippet: text.slice(0, 200),
          labelIds: Array.isArray(m.labelIds) ? m.labelIds : [],
          receivedAt: m.messageTimestamp ? new Date(m.messageTimestamp).toISOString() : new Date().toISOString(),
        });
        count++;
        if (got) contactCount++;
      }
      return new Response(JSON.stringify({ synced: count, contacts_updated: contactCount, source: "composio" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!integration?.config) {
      return new Response(
        JSON.stringify({ error: "Gmail not connected. Add OAuth credentials in Integrations." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const config = integration.config;
    const token = await refreshGoogleToken(config, adminSb, uid, "gmail");

    // List messages
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&labelIds=INBOX&q=category:primary`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const listData = await listRes.json();
    const messages = listData.messages ?? [];

    let count = 0;
    let contactCount = 0;

    for (const msg of messages.slice(0, max)) {
      // Fetch full message
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const msgData = await msgRes.json();
      const payload = msgData.payload ?? {};
      const headers = payload.headers ?? [];

      const getHeader = (headers: any[], name: string) =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

      const subject = getHeader(headers, "subject");
      const from = getHeader(headers, "from");
      const date = getHeader(headers, "date");

      // Extract body
      let body = "";
      const findTextPlain = (part: any): string => {
        if (part.mimeType === "text/plain" && part.body?.data) {
          try {
            return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
          } catch {
            return "";
          }
        }
        for (const p of part.parts ?? []) {
          const result = findTextPlain(p);
          if (result) return result;
        }
        return "";
      };
      body = findTextPlain(payload).slice(0, 1000);

      const labelIds: string[] = Array.isArray(msgData.labelIds) ? msgData.labelIds : [];
      const got = await ingest(adminSb, uid, {
        id: String(msg.id), threadId: msg.threadId ?? null, subject, from, date, body, snippet: String(msgData.snippet ?? ""), labelIds,
        receivedAt: msgData.internalDate
          ? new Date(Number(msgData.internalDate)).toISOString()
          : (date ? new Date(date).toISOString() : new Date().toISOString()),
      });
      count++;
      if (got) contactCount++;
    }

    return new Response(
      JSON.stringify({ synced: count, contacts_updated: contactCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
