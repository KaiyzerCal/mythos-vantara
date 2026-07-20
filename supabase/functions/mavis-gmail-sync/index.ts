import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSb = createClient(supabaseUrl, serviceRoleKey);

    // Auth → uid
    let uid: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const userSb = createClient(supabaseUrl, token);
      const { data: { user } } = await userSb.auth.getUser();
      uid = user?.id ?? null;
    }
    if (!uid) uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? null;
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

      // Parse structured fields for the gmail_messages table.
      const labelIds: string[] = Array.isArray(msgData.labelIds) ? msgData.labelIds : [];
      const isRead   = !labelIds.includes("UNREAD");
      const fromEmail = (from.match(/<(.+?)>/)?.[1] ?? from.match(/(\S+@\S+)/)?.[1] ?? "").toLowerCase();
      const fromName  = from.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() ?? "";
      const receivedAt = msgData.internalDate
        ? new Date(Number(msgData.internalDate)).toISOString()
        : (date ? new Date(date).toISOString() : new Date().toISOString());

      // Upsert structured message (read by email-triage + ambient priority scan).
      await Promise.resolve(adminSb.from("gmail_messages").upsert(
        {
          id:          String(msg.id),
          user_id:     uid,
          thread_id:   msg.threadId ?? null,
          subject:     subject.slice(0, 500),
          from_email:  fromEmail,
          from_name:   fromName || null,
          snippet:     String(msgData.snippet ?? "").slice(0, 500),
          body:        body.slice(0, 4000),
          labels:      labelIds,
          is_read:     isRead,
          received_at: receivedAt,
        },
        { onConflict: "id" },
      )).catch((e: any) => console.error("[mavis-gmail-sync] gmail_messages upsert error:", e?.message ?? e));

      // Upsert into mavis_notes
      await adminSb.from("mavis_notes").upsert(
        {
          user_id: uid,
          title: `[Email] ${subject.slice(0, 100)}`,
          content: `From: ${from}\nDate: ${date}\n\n${body.slice(0, 1000)}`,
          tags: ["email", "gmail", "intel"],
          properties: { source: "gmail", from, subject, date, thread_id: msg.threadId },
          importance: from.includes("@") && !from.toLowerCase().includes("noreply") && !from.toLowerCase().includes("no-reply") ? 6 : 3,
        },
        { onConflict: "user_id,title" },
      );
      count++;

      // Extract contact from "from" field
      const emailMatch = from.match(/<(.+?)>/) ?? from.match(/(\S+@\S+)/);
      const nameMatch = from.match(/^"?([^"<]+)"?\s*</);
      if (emailMatch?.[1]) {
        await adminSb
          .from("contacts")
          .upsert(
            {
              user_id: uid,
              name: nameMatch?.[1]?.trim() ?? emailMatch[1],
              email: emailMatch[1].toLowerCase(),
              source: "gmail",
            },
            { onConflict: "user_id,email" },
          )
          .catch(() => {/* contacts table may have diff schema */});
        contactCount++;
      }
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
