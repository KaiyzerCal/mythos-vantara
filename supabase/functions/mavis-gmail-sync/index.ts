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

/** One normalised message -> gmail_messages (read by triage and the ambient scan), mavis_notes, and contacts.
 *  Shared by the direct Google path and the Composio path.
 *
 *  Written against the LIVE tables: gmail_messages is (user_id, gmail_id)-keyed with from_address / body_text, and
 *  mavis_notes / contacts only have PARTIAL unique indexes, which ON CONFLICT cannot target, so those two are
 *  look-up-then-insert. Every write's result is checked: the first version of this wrote columns that do not exist,
 *  swallowed the errors, and still reported "synced: N". */
async function ingest(adminSb: any, uid: string, m: Ingest): Promise<{ contact: boolean; error?: string }> {
  const fromEmail = (m.from.match(/<(.+?)>/)?.[1] ?? m.from.match(/(\S+@\S+)/)?.[1] ?? "").toLowerCase();
  const fromName  = m.from.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() ?? "";
  const errors: string[] = [];

  const g = await adminSb.from("gmail_messages").upsert(
    {
      user_id: uid, gmail_id: m.id, thread_id: m.threadId, from_address: m.from, subject: m.subject.slice(0, 500),
      snippet: m.snippet.slice(0, 500), body_text: m.body.slice(0, 4000), labels: m.labelIds,
      is_read: !m.labelIds.includes("UNREAD"), received_at: m.receivedAt,
      metadata: { from_email: fromEmail, from_name: fromName || null, source: "gmail" },
    },
    { onConflict: "user_id,gmail_id" },
  );
  if (g.error) errors.push(`gmail_messages: ${g.error.message}`);

  const sourceUrl = `gmail:${m.id}`;
  const note = await adminSb.from("mavis_notes").select("id").eq("user_id", uid).eq("source_url", sourceUrl).maybeSingle();
  if (!note.data) {
    const ins = await adminSb.from("mavis_notes").insert({
      user_id: uid,
      title: `[Email] ${m.subject.slice(0, 100)}`,
      content: `From: ${m.from}\nDate: ${m.date}\n\n${m.body.slice(0, 1000)}`,
      tags: ["email", "gmail", "intel"],
      properties: { source: "gmail", from: m.from, subject: m.subject, date: m.date, thread_id: m.threadId },
      source_url: sourceUrl,
    });
    if (ins.error) errors.push(`mavis_notes: ${ins.error.message}`);
  }

  // A contact per real sender; automated senders are not contacts.
  let contact = false;
  if (fromEmail && !/(^|[._-])(no-?reply|donotreply|do-not-reply|notifications?|mailer-daemon|alerts?|news(letter)?)([._-]|@)/.test(fromEmail)) {
    const have = await adminSb.from("contacts").select("id").eq("user_id", uid).eq("email", fromEmail).maybeSingle();
    if (!have.data) {
      const ins = await adminSb.from("contacts").insert({ user_id: uid, name: fromName || fromEmail, email: fromEmail, source: "gmail" });
      if (ins.error) errors.push(`contacts: ${ins.error.message}`);
      else contact = true;
    }
  }
  return { contact, error: errors[0] };
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
      // Gmail is authorized through Composio. Primary tab only (what the direct path's q=category:primary did): Composio's
      // `query` argument is not applied to this tool, but Gmail labels the Primary tab CATEGORY_PERSONAL, so filter on that.
      const data = await composioRun(uid, "GMAIL_FETCH_EMAILS", {
        max_results: Math.min(max, 30), label_ids: ["INBOX", "CATEGORY_PERSONAL"], verbose: true, include_payload: false,
      });
      const primary = (data?.messages ?? []) as any[];
      let count = 0, contactCount = 0;
      const errors: string[] = [];
      for (const m of primary) {
        const text = String(m.messageText ?? m.preview?.body ?? "");
        const got = await ingest(adminSb, uid, {
          id: String(m.messageId), threadId: m.threadId ?? null, subject: String(m.subject ?? ""), from: String(m.sender ?? ""),
          date: String(m.messageTimestamp ?? ""), body: text.slice(0, 1000), snippet: text.slice(0, 200),
          labelIds: Array.isArray(m.labelIds) ? m.labelIds : [],
          receivedAt: m.messageTimestamp ? new Date(m.messageTimestamp).toISOString() : new Date().toISOString(),
        });
        if (got.error) errors.push(got.error); else count++;
        if (got.contact) contactCount++;
      }
      return new Response(JSON.stringify({ synced: count, contacts_added: contactCount, errors: [...new Set(errors)].slice(0, 3), source: "composio" }),
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
    const errors: string[] = [];

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
      if (got.error) errors.push(got.error); else count++;
      if (got.contact) contactCount++;
    }

    return new Response(
      JSON.stringify({ synced: count, contacts_added: contactCount, errors: [...new Set(errors)].slice(0, 3) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
