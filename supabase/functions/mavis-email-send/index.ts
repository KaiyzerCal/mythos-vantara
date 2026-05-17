// MAVIS Email Send — Sends emails via Resend API.
// Can AI-generate the email body and/or subject before sending.
// Auth: Bearer JWT.
//
// Required env vars:
//   RESEND_API_KEY        — Resend API key
//   ANTHROPIC_API_KEY     — for AI email generation
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const { data } = await adminSb.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Claude email generation ───────────────────────────────────────────────────

async function generateEmailBody(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system:
        "You are a professional email ghostwriter. Write clear, concise, professional emails. Output ONLY the email body text, no subject line.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text: string = data.content?.[0]?.text?.trim() ?? "";
  if (!text) throw new Error("Empty response from Claude");
  return text;
}

async function generateEmailSubject(bodyText: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 20,
      system:
        "You are an email subject line writer. Output ONLY the subject line — no punctuation at the end, no quotes, no explanation.",
      messages: [
        {
          role: "user",
          content: `Write a concise, compelling email subject line for this email body:\n\n${bodyText.slice(0, 500)}`,
        },
      ],
    }),
  });

  if (!res.ok) return "Message from MAVIS";
  const data = await res.json();
  return data.content?.[0]?.text?.trim() ?? "Message from MAVIS";
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const userId = await resolveUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  if (!RESEND_KEY) {
    return json({ success: false, error: "RESEND_API_KEY is not configured" }, 400);
  }

  let input: {
    to?: string;
    subject?: string;
    body?: string;
    generate?: boolean;
    generate_prompt?: string;
    from_name?: string;
  };

  try {
    input = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const to = String(input.to ?? "").trim();
  if (!to) return json({ error: "to (email address) is required" }, 400);

  const shouldGenerate = input.generate === true || !input.body?.trim();
  let body = input.body?.trim() ?? "";
  let subject = input.subject?.trim() ?? "";
  const fromName = input.from_name?.trim() || "MAVIS";

  // Generate body if requested or no body provided
  if (shouldGenerate) {
    if (!ANTHROPIC_KEY) {
      return json({ success: false, error: "ANTHROPIC_API_KEY is not configured for generation" }, 400);
    }
    const prompt = input.generate_prompt?.trim() || "Write a professional email.";
    try {
      body = await generateEmailBody(prompt);
    } catch (err) {
      return json(
        { success: false, error: `Email body generation failed: ${err instanceof Error ? err.message : String(err)}` },
        500,
      );
    }
  }

  if (!body) {
    return json({ success: false, error: "Email body is empty after generation attempt" }, 400);
  }

  // Generate subject if not provided
  if (!subject) {
    if (ANTHROPIC_KEY) {
      try {
        subject = await generateEmailSubject(body);
      } catch {
        subject = "Message from MAVIS";
      }
    } else {
      subject = "Message from MAVIS";
    }
  }

  // Send via Resend
  const resendBody = {
    from: `${fromName} <noreply@resend.dev>`,
    to: [to],
    subject,
    html: `<pre style='font-family:sans-serif;white-space:pre-wrap;line-height:1.6'>${body}</pre>`,
  };

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_KEY}`,
    },
    body: JSON.stringify(resendBody),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error("[mavis-email-send] Resend error:", resendRes.status, errText);
    return json(
      { success: false, error: `Resend API error (${resendRes.status}): ${errText}` },
      500,
    );
  }

  const resendData = await resendRes.json();
  const emailId: string = resendData.id ?? "";

  // Log to email_outbox
  const { error: dbError } = await adminSb.from("email_outbox").insert({
    user_id: userId,
    to_address: to,
    subject,
    body,
    resend_id: emailId,
    status: "sent",
    created_at: new Date().toISOString(),
  });

  if (dbError) {
    console.error("[mavis-email-send] DB insert error:", dbError);
  }

  return json({ success: true, email_id: emailId, subject, body });
});
