// MAVIS Email Inbound — receives emails via Resend inbound webhook.
// Setup in Resend Dashboard: Domains → Inbound → Webhook URL = this function URL.
// All inbound emails are stored in mavis_inbound_emails and optionally auto-processed.
//
// No JWT auth — this endpoint is called by Resend (add to supabase/config.toml jwt_disabled list).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? ""; // optional HMAC verify

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  try {
    const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

    // Optional signature verification
    if (WEBHOOK_SECRET) {
      const sig = req.headers.get("svix-signature") ?? req.headers.get("x-resend-signature") ?? "";
      if (!sig) {
        return new Response(JSON.stringify({ error: "Missing webhook signature" }), { status: 401 });
      }
      // Basic check — for production, verify HMAC-SHA256 of body against secret
    }

    const payload = await req.json().catch(() => null);
    if (!payload) return new Response("bad payload", { status: 400 });

    // Resend inbound email format
    const from     = String(payload.from ?? payload.sender ?? "");
    const to       = Array.isArray(payload.to) ? payload.to.join(", ") : String(payload.to ?? "");
    const subject  = String(payload.subject ?? "(no subject)");
    const bodyText = String(payload.text ?? payload.plain_text ?? "");
    const bodyHtml = String(payload.html ?? "");
    const headers  = payload.headers as Record<string, string> | undefined;
    const threadId = headers?.["message-id"] ?? headers?.["in-reply-to"] ?? null;

    const attachments = (payload.attachments as unknown[] | undefined)?.map((a: any) => ({
      filename: a.filename,
      content_type: a.content_type ?? a.mimetype,
      size: a.size,
    })) ?? [];

    // Try to match sender email to a user
    const fromEmail = from.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]+/)?.[0] ?? from;
    const fromName  = from.replace(/<[^>]+>/, "").trim().replace(/^"|"$/g, "");

    const { data: emailUser } = await sb.auth.admin.listUsers({ perPage: 1 }).then(() => ({ data: null })).catch(() => ({ data: null }));
    // Simple lookup by email in profiles/users — non-fatal if no match
    const { data: profile } = await sb
      .from("profiles")
      .select("user_id")
      .eq("email", fromEmail)
      .maybeSingle()
      .catch(() => ({ data: null }));

    const userId = profile?.user_id ?? null;

    // Store in mavis_inbound_emails
    const { data: inserted, error: insertErr } = await sb
      .from("mavis_inbound_emails")
      .insert({
        user_id: userId,
        from_email: fromEmail,
        from_name: fromName || null,
        to_email: to,
        subject,
        body_text: bodyText.slice(0, 20000),
        body_html: bodyHtml.slice(0, 50000),
        thread_id: threadId,
        attachments,
        received_at: new Date().toISOString(),
        processed: false,
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[mavis-email-inbound] DB error:", insertErr.message);
    }

    // If we matched a user, also save a mavis_memory entry so MAVIS sees the email
    if (userId && inserted?.id) {
      const memContent = `[EMAIL RECEIVED] From: ${fromEmail} (${fromName})\nSubject: ${subject}\n\n${bodyText.slice(0, 2000)}`;
      await sb.from("mavis_memory").insert({
        user_id: userId,
        role: "system",
        content: memContent,
        importance_score: 6,
        created_at: new Date().toISOString(),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ received: true, id: inserted?.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[mavis-email-inbound]", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
