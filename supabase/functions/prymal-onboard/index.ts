// prymal-onboard — client onboarding flow
//
// Trigger: POST { email: "owner@example.com" }
//
// Flow:
//   1. Create client record (or load existing)
//   2. Send branded intake form link via email
//   3. POST /submit — receives completed form, generates knowledge base doc
//   4. Sends 7-day welcome email with what to expect
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   RESEND_API_KEY, ANTHROPIC_API_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL   = Deno.env.get("SUPABASE_URL")!;
const SB_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND   = Deno.env.get("RESEND_API_KEY") ?? "";
const CLAUDE   = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const BASE_URL = Deno.env.get("PRYMAL_APP_URL") ?? "https://app.prymalai.com";

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Claude for knowledge base generation ──────────────────────────────────
async function callClaude(system: string, user: string, maxTokens = 2048): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.content?.[0]?.text ?? "";
}

// ── Knowledge base generator ───────────────────────────────────────────────
async function generateKnowledgeBase(form: IntakeForm): Promise<string> {
  const system = `You are writing an AI agent knowledge base document for a small business. This document will be injected as context into every AI agent that serves this business. Be specific, directive, and complete. Structure it clearly. Write in present tense. Cover: brand voice, what the business does, who their customers are, communication rules, platform rules, and things the AI must never say or do.`;

  const user = `Generate a complete knowledge base document for this business:

Business Name: ${form.business_name}
Owner: ${form.owner_name}
Industry: ${form.industry}
Target Customer: ${form.target_customer}
What they sell/offer: ${form.what_they_offer}
Tone of voice: ${form.tone_of_voice}
What they NEVER want posted or said: ${form.never_say}
Platforms they're active on: ${(form.platforms_active ?? []).join(", ")}
Platforms to manage: ${(form.platforms_managed ?? []).join(", ")}
Additional context: ${form.additional_context ?? ""}

Generate a structured knowledge base document with these sections:
1. BUSINESS OVERVIEW
2. TARGET CUSTOMER PROFILE
3. BRAND VOICE & TONE (with 3-5 examples of on-brand phrasing)
4. COMMUNICATION RULES (what to say, what to avoid)
5. PLATFORM-SPECIFIC GUIDELINES (one paragraph per active platform)
6. HARD STOPS — things the AI must NEVER do for this business`;

  return callClaude(system, user, 2048);
}

// ── Send intake form email ─────────────────────────────────────────────────
async function sendIntakeEmail(email: string, ownerName: string, formToken: string): Promise<boolean> {
  if (!RESEND) return false;
  const formUrl = `${BASE_URL}/onboarding?token=${formToken}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Georgia,serif;background:#0d1117;color:#eef2f7;padding:32px;max-width:600px;margin:0 auto;">
  <p style="font-size:11px;letter-spacing:2px;color:#666;text-transform:uppercase;margin-bottom:24px;">PRYMAL AI · WELCOME</p>
  <h1 style="font-size:26px;font-weight:700;color:#fff;margin:0 0 12px;">You're in, ${ownerName.split(" ")[0]}.</h1>
  <p style="font-size:15px;color:#9ca3af;line-height:1.7;margin-bottom:32px;">
    Your AI agent suite is ready to be configured. It takes about 5 minutes.
    We use your answers to build the knowledge base that powers all six agents — the more specific you are, the better they work.
  </p>
  <a href="${formUrl}" style="display:inline-block;background:#00c8ff;color:#0d1117;padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:0.5px;">Set Up Your Agents →</a>
  <p style="font-size:12px;color:#4b5563;margin-top:16px;">Link expires in 7 days. <a href="${formUrl}" style="color:#00c8ff;">${formUrl}</a></p>

  <div style="margin-top:48px;padding-top:24px;border-top:1px solid #1f2937;">
    <p style="font-size:13px;color:#6b7280;line-height:1.6;">
      After you complete setup, your agents go live within 24 hours. In the first 7 days:<br><br>
      <strong style="color:#9ca3af;">Day 1:</strong> Agents connect to your platforms<br>
      <strong style="color:#9ca3af;">Day 2–3:</strong> First social posts drafted and sent to you for approval<br>
      <strong style="color:#9ca3af;">Day 4–5:</strong> First outreach sequences built from your contact list<br>
      <strong style="color:#9ca3af;">Day 7:</strong> First Monday briefing lands in your inbox
    </p>
  </div>

  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #1f2937;font-size:11px;color:#4b5563;">
    PrymalAI · <a href="https://prymalai.com" style="color:#00c8ff;text-decoration:none;">prymalai.com</a> ·
    Questions? <a href="mailto:support@prymalai.com" style="color:#00c8ff;text-decoration:none;">support@prymalai.com</a>
  </div>
</body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND}` },
    body: JSON.stringify({ from: "welcome@prymalai.com", to: email, subject: "You're in — set up your AI agents (5 min)", html }),
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}

// ── Send 7-day welcome / confirmation email ────────────────────────────────
async function sendWelcomeConfirmation(client: any): Promise<void> {
  if (!RESEND || !client.owner_email) return;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Georgia,serif;background:#0d1117;color:#eef2f7;padding:32px;max-width:600px;margin:0 auto;">
  <p style="font-size:11px;letter-spacing:2px;color:#666;text-transform:uppercase;margin-bottom:24px;">PRYMAL AI · ONBOARDING COMPLETE</p>
  <h1 style="font-size:26px;font-weight:700;color:#fff;margin:0 0 12px;">${client.business_name} is live.</h1>
  <p style="font-size:15px;color:#9ca3af;line-height:1.7;margin-bottom:32px;">
    Your six agents are configured and active. Here's what happens next.
  </p>

  <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:20px;margin-bottom:16px;">
    <p style="font-size:11px;color:#00c8ff;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">THIS WEEK</p>
    <p style="font-size:14px;color:#e5e7eb;line-height:1.7;margin:0;">
      <strong>Google Agent</strong> — Monitoring your Gmail and flagging messages that need a response.<br>
      <strong>Brand Agent</strong> — Drafting your first 3 social posts. You'll get an approval request before anything goes live.<br>
      <strong>Service Agent</strong> — Watching inbound messages across your connected channels. Drafts responses, you approve them.<br>
      <strong>Ops Agent</strong> — Ready to answer operational questions. Ask it anything about your calendar, emails, or tasks.
    </p>
  </div>

  <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:20px;margin-bottom:16px;">
    <p style="font-size:11px;color:#7c3aed;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">NEXT MONDAY</p>
    <p style="font-size:14px;color:#e5e7eb;line-height:1.7;margin:0;">
      <strong>Intelligence Agent</strong> — Your first Monday morning briefing hits at 8am. Last 7 days of website traffic, email activity, social reach, and new leads — synthesized into plain language with three action items.
    </p>
  </div>

  <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:20px;margin-bottom:32px;">
    <p style="font-size:11px;color:#f59e0b;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">HOW TO RESPOND TO DRAFTS</p>
    <p style="font-size:14px;color:#e5e7eb;line-height:1.7;margin:0;">
      When an agent sends you a draft, reply with:<br>
      <code style="background:#1f2937;padding:2px 6px;border-radius:4px;color:#00c8ff;">APPROVE</code> — execute it<br>
      <code style="background:#1f2937;padding:2px 6px;border-radius:4px;color:#00c8ff;">EDIT Your revised version here</code> — use your version<br>
      <code style="background:#1f2937;padding:2px 6px;border-radius:4px;color:#00c8ff;">REJECT</code> — discard it
    </p>
  </div>

  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #1f2937;font-size:11px;color:#4b5563;">
    PrymalAI · <a href="https://prymalai.com" style="color:#00c8ff;text-decoration:none;">prymalai.com</a> ·
    Questions? <a href="mailto:support@prymalai.com" style="color:#00c8ff;text-decoration:none;">support@prymalai.com</a>
  </div>
</body></html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND}` },
    body: JSON.stringify({ from: "team@prymalai.com", to: client.owner_email, subject: `${client.business_name} is live — what to expect this week`, html }),
    signal: AbortSignal.timeout(10000),
  });
}

// ── Intake form type ───────────────────────────────────────────────────────
interface IntakeForm {
  form_token: string;
  business_name: string;
  owner_name: string;
  industry: string;
  target_customer: string;
  what_they_offer: string;
  tone_of_voice: string;       // e.g. "professional", "friendly", "bold", "casual"
  never_say: string;           // comma-separated hard stops
  platforms_active: string[];  // platforms they use today
  platforms_managed: string[]; // platforms they want PrymalAI to manage
  escalation_contacts: Array<{ name: string; phone?: string; email?: string; role: string }>;
  owner_phone?: string;
  delivery_channel?: string;   // 'email' | 'sms' | 'both'
  additional_context?: string;
}

// ── Main handler ───────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url      = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const action   = pathParts[pathParts.length - 1];
  const body     = await req.json().catch(() => ({}));

  // ── POST / (or /start) — initiate onboarding for an email address ──────
  if (req.method === "POST" && (action === "onboard" || action === "start" || !["submit", "status"].includes(action))) {
    const { email } = body;
    if (!email || !email.includes("@")) return json({ error: "Valid email address required" }, 400);

    // Upsert client record
    const formToken = crypto.randomUUID();
    const { data: existing } = await sb.from("prymal_clients").select("id, status").eq("owner_email", email).single();

    if (existing && existing.status !== "onboarding") {
      return json({ error: "A client with this email already exists", status: existing.status, client_id: existing.id }, 409);
    }

    let clientId: string;
    if (existing) {
      clientId = existing.id;
      await sb.from("prymal_clients").update({ updated_at: new Date().toISOString() }).eq("id", clientId);
    } else {
      // Create placeholder client — form submission fills in the rest
      const { data: newClient, error } = await sb
        .from("prymal_clients")
        .insert({ owner_email: email, business_name: "Pending Setup", owner_name: "Owner", status: "onboarding" })
        .select("id")
        .single();
      if (error) return json({ error: error.message }, 500);
      clientId = newClient.id;
    }

    // Store form token
    await sb.from("prymal_onboarding_tokens").upsert({
      client_id: clientId,
      token: formToken,
      email,
      expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
    }, { onConflict: "client_id" });

    // Send intake email
    const firstName = body.owner_name?.split(" ")[0] ?? "there";
    const sent = await sendIntakeEmail(email, firstName, formToken);

    return json({
      ok: true,
      client_id: clientId,
      form_token: formToken,
      form_url: `${BASE_URL}/onboarding?token=${formToken}`,
      email_sent: sent,
    });
  }

  // ── POST /submit — client submits completed intake form ─────────────────
  if (action === "submit") {
    const form = body as IntakeForm;
    if (!form.form_token) return json({ error: "form_token required" }, 400);
    const required = ["business_name", "owner_name", "industry", "target_customer", "what_they_offer", "tone_of_voice"];
    for (const f of required) {
      if (!form[f as keyof IntakeForm]) return json({ error: `Missing required field: ${f}` }, 400);
    }

    // Validate token
    const { data: tokenRow } = await sb
      .from("prymal_onboarding_tokens")
      .select("client_id, expires_at, used")
      .eq("token", form.form_token)
      .single();
    if (!tokenRow) return json({ error: "Invalid form token" }, 403);
    if (tokenRow.used) return json({ error: "This form has already been submitted" }, 409);
    if (new Date(tokenRow.expires_at) < new Date()) return json({ error: "Form link has expired — contact support@prymalai.com" }, 410);

    const clientId = tokenRow.client_id;

    // Generate knowledge base
    let knowledgeBase = "";
    try {
      knowledgeBase = await generateKnowledgeBase(form);
    } catch (err: any) {
      knowledgeBase = `[Knowledge base generation failed: ${err.message}. Contact support to regenerate.]`;
    }

    // Update client record with full intake data
    const { error: updateError } = await sb.from("prymal_clients").update({
      business_name:        form.business_name,
      owner_name:           form.owner_name,
      owner_phone:          form.owner_phone ?? null,
      industry:             form.industry,
      target_customer:      form.target_customer,
      tone_of_voice:        form.tone_of_voice,
      never_say:            form.never_say,
      escalation_contacts:  form.escalation_contacts ?? [],
      platforms_active:     form.platforms_active ?? [],
      platforms_managed:    form.platforms_managed ?? [],
      delivery_channel:     form.delivery_channel ?? "email",
      knowledge_base:       knowledgeBase,
      status:               "active",
      onboarded_at:         new Date().toISOString(),
      updated_at:           new Date().toISOString(),
    }).eq("id", clientId);

    if (updateError) return json({ error: updateError.message }, 500);

    // Mark token used
    await sb.from("prymal_onboarding_tokens").update({ used: true }).eq("token", form.form_token);

    // Load full client for confirmation email
    const { data: client } = await sb.from("prymal_clients").select("*").eq("id", clientId).single();
    if (client) await sendWelcomeConfirmation(client);

    return json({
      ok: true,
      client_id: clientId,
      message: "Onboarding complete. Your agents are now active. Check your email for next steps.",
      knowledge_base_preview: knowledgeBase.slice(0, 300) + "…",
    });
  }

  // ── GET /status?client_id=xxx ─────────────────────────────────────────────
  if (req.method === "GET" && action === "status") {
    const clientId = url.searchParams.get("client_id");
    if (!clientId) return json({ error: "client_id required" }, 400);
    const { data } = await sb.from("prymal_clients").select("id, business_name, status, onboarded_at, platforms_managed, knowledge_base").eq("id", clientId).single();
    if (!data) return json({ error: "Client not found" }, 404);
    return json({ ...data, has_knowledge_base: data.knowledge_base?.length > 100 });
  }

  return json({ error: "Unknown route. Use POST / to start onboarding, POST /submit to complete intake." }, 404);
});
