import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const PRIORITY_SCORE: Record<string, number> = { urgent: 9, high: 7, medium: 5, low: 2 };
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

interface TriageResult {
  email_id: string;
  priority: "urgent" | "high" | "medium" | "low";
  category: "action_required" | "reply_needed" | "fyi" | "newsletter" | "spam";
  summary: string;
  suggested_reply?: string;
  suggested_action?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (!ANTHROPIC_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawLimit    = Number(body.limit ?? 20);
    const limit       = Math.min(Math.max(1, rawLimit), 50);
    const draftReplies = body.draft_replies === true;
    const minPriority  = (body.min_priority ?? "low") as "low" | "medium" | "high" | "urgent";

    let emails: any[] | null = null;

    const { data: gmailRows, error: gmailErr } = await sb
      .from("gmail_messages")
      .select("id, subject, from_email, snippet, body, received_at, is_read, labels")
      .eq("user_id", user.id)
      .order("received_at", { ascending: false })
      .limit(limit);

    if (!gmailErr && gmailRows && gmailRows.length > 0) {
      emails = gmailRows;
    } else {
      const { data: memRows, error: memErr } = await sb
        .from("mavis_memory")
        .select("id, content, created_at")
        .eq("user_id", user.id)
        .eq("role", "email")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!memErr && memRows && memRows.length > 0) {
        emails = memRows.map((m: any) => ({
          id: m.id,
          subject: "(from memory)",
          from_email: "unknown",
          snippet: m.content,
          body: m.content,
          received_at: m.created_at,
          is_read: true,
          labels: [],
        }));
      }
    }

    if (!emails || emails.length === 0) {
      return new Response(
        JSON.stringify({ triaged: [], message: "No emails found. Connect Gmail in Integrations." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const emailList = emails.map((e: any, i: number) =>
      `[${i + 1}] ID: ${e.id}\nFrom: ${e.from_email}\nSubject: ${e.subject ?? "(no subject)"}\nSnippet: ${(e.snippet ?? e.body ?? "").slice(0, 300)}`
    ).join("\n\n");

    const replyField = draftReplies ? ', suggested_reply (string, optional)' : '';
    const systemPrompt = `You are an intelligent email triage assistant. Analyze emails and return a JSON array. Each element must have: email_id (string), priority ("urgent"|"high"|"medium"|"low"), category ("action_required"|"reply_needed"|"fyi"|"newsletter"|"spam"), summary (1-2 sentences)${replyField}, suggested_action (string, optional). Return ONLY valid JSON — no markdown, no explanation.`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: `Triage these ${emails.length} emails:\n\n${emailList}`,
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error ${claudeRes.status}: ${errText.slice(0, 300)}`);
    }

    const claudeData = await claudeRes.json();
    const rawText    = claudeData.content?.[0]?.text ?? "[]";
    const jsonMatch  = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("Failed to parse triage JSON from Claude response");

    let triaged: TriageResult[] = JSON.parse(jsonMatch[0]);

    const minOrder = PRIORITY_ORDER[minPriority] ?? 3;
    triaged = triaged.filter((t) => (PRIORITY_ORDER[t.priority] ?? 3) <= minOrder);

    const memoryRows = triaged.map((t) => ({
      user_id:          user.id,
      role:             "assistant",
      content:          `[EMAIL TRIAGE] ID:${t.email_id} | ${t.priority.toUpperCase()} | ${t.category} — ${t.summary}`,
      importance_score: PRIORITY_SCORE[t.priority] ?? 5,
      created_at:       new Date().toISOString(),
    }));

    if (memoryRows.length > 0) {
      await sb.from("mavis_memory").insert(memoryRows).catch((e: any) =>
        console.error("[mavis-email-triage] mavis_memory insert error:", e.message)
      );
    }

    return new Response(
      JSON.stringify({ triaged }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[mavis-email-triage]", e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
