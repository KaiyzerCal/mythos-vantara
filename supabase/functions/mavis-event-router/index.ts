// MAVIS Event Router — inbound event triage and routing.
// Any external trigger (Stripe payment, email, webhook, calendar event, etc.)
// can call this function. Claude classifies the event, determines urgency and
// required actions, then executes them and optionally notifies via Telegram.
//
// Input: { userId, event_type, source, payload, notify?: boolean }
// Output: { classified_as, actions_taken, telegram_sent, summary }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL     = Deno.env.get("SUPABASE_URL")!;
const SB_SRK     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLAUDE_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const BOT_TOKEN  = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callClaude(system: string, user: string, model = "claude-haiku-4-5-20251001"): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 1024, system, messages: [{ role: "user", content: user }] }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Claude error: ${res.status}`);
  const d = await res.json();
  return String(d.content?.[0]?.text ?? "").trim();
}

async function tgSend(chatId: string, text: string): Promise<void> {
  if (!BOT_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

// Classification schema returned by Claude
interface EventClassification {
  category: string;          // payment | email | calendar | task | alert | social | health | unknown
  urgency: "high" | "medium" | "low";
  summary: string;           // one-sentence human-readable summary
  actions: Array<{           // actions MAVIS should take
    type: string;            // save_memory | create_task | update_world_model | send_telegram | log_revenue
    params: Record<string, unknown>;
  }>;
  telegram_brief: string;    // short Telegram message if notify=true
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { userId, event_type, source, payload, notify = true } = body as Record<string, unknown>;
    if (!userId) throw new Error("userId required");

    const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

    // ── Step 1: Classify the event with Claude ────────────────────────────
    const classifyRaw = await callClaude(
      `You are an event triage AI for a personal AI operating system called MAVIS.
Classify incoming events and determine what MAVIS should do in response.
Reply ONLY with valid JSON matching this schema:
{
  "category": "payment|email|calendar|task|alert|social|health|unknown",
  "urgency": "high|medium|low",
  "summary": "one sentence summary",
  "actions": [
    {"type": "action_type", "params": {...}}
  ],
  "telegram_brief": "short message for Telegram notification"
}

Available action types:
- save_memory: save to long-term memory {content, importance_score (1-5), tags[]}
- create_task: create a follow-up task {title, description, priority, due_date?}
- log_revenue: log revenue event {amount, currency, source, description}
- update_world_model: trigger world model rebuild {}
- no_action: event acknowledged but no action needed {}

Rules:
- Payment events → log_revenue + save_memory (importance 4)
- Email from unknown → save_memory only (importance 2)
- Email from VIP contact → save_memory (importance 4) + create_task to respond
- Calendar event starting soon → save_memory (importance 3)
- Error/alert → create_task (priority high) + save_memory
- Health data → save_memory (importance 2)
- Always include at least save_memory for important events`,
      `Event type: ${event_type}\nSource: ${source}\nPayload: ${JSON.stringify(payload).slice(0, 2000)}`
    );

    let classification: EventClassification;
    try {
      const jsonMatch = classifyRaw.match(/\{[\s\S]*\}/);
      classification = JSON.parse(jsonMatch?.[0] ?? "{}") as EventClassification;
    } catch {
      classification = {
        category: "unknown",
        urgency: "low",
        summary: `Received ${event_type} from ${source}`,
        actions: [{ type: "save_memory", params: { content: `Event received: ${event_type} from ${source}`, importance_score: 2, tags: ["event", String(source ?? "unknown")] } }],
        telegram_brief: `📨 Event: ${event_type} from ${source}`,
      };
    }

    // ── Step 2: Execute the classified actions ────────────────────────────
    const actionResults: Array<{ type: string; ok: boolean; result?: unknown }> = [];

    for (const action of (classification.actions ?? [])) {
      try {
        if (action.type === "save_memory") {
          const { error } = await sb.from("mavis_memory").insert({
            user_id:          userId,
            content:          String(action.params.content ?? classification.summary),
            importance_score: Number(action.params.importance_score ?? 3),
            tags:             Array.isArray(action.params.tags) ? action.params.tags : ["event", classification.category],
            timestamp:        Date.now(),
            consolidated:     false,
          });
          actionResults.push({ type: "save_memory", ok: !error });

        } else if (action.type === "create_task") {
          const { error } = await sb.from("mavis_tasks").insert({
            user_id:      userId,
            type:         "event_followup",
            description:  String(action.params.description ?? classification.summary),
            payload:      { title: action.params.title, priority: action.params.priority, due_date: action.params.due_date, source_event: event_type },
            status:       "pending",
            scheduled_at: new Date().toISOString(),
          });
          actionResults.push({ type: "create_task", ok: !error });

        } else if (action.type === "log_revenue") {
          const { error } = await sb.from("mavis_revenue").insert({
            user_id:     userId,
            amount:      Number(action.params.amount ?? 0),
            currency:    String(action.params.currency ?? "USD"),
            source:      String(action.params.source ?? source ?? event_type),
            description: String(action.params.description ?? classification.summary),
            date:        new Date().toISOString().slice(0, 10),
          });
          // Also trigger world model rebuild after revenue event
          fetch(`${SB_URL}/functions/v1/mavis-world-model`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
            body: JSON.stringify({ userId }),
            signal: AbortSignal.timeout(30_000),
          }).catch(() => {});
          actionResults.push({ type: "log_revenue", ok: !error });

        } else if (action.type === "update_world_model") {
          fetch(`${SB_URL}/functions/v1/mavis-world-model`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
            body: JSON.stringify({ userId }),
            signal: AbortSignal.timeout(30_000),
          }).catch(() => {});
          actionResults.push({ type: "update_world_model", ok: true });

        } else {
          actionResults.push({ type: action.type, ok: true }); // no_action etc.
        }
      } catch (e: any) {
        actionResults.push({ type: action.type, ok: false, result: e.message });
      }
    }

    // ── Step 3: Telegram notification (if high urgency or notify=true) ────
    let telegramSent = false;
    if (notify && (classification.urgency === "high" || classification.urgency === "medium")) {
      const { data: profile } = await sb
        .from("profiles")
        .select("telegram_chat_id")
        .eq("id", userId)
        .maybeSingle();
      const chatId = (profile as any)?.telegram_chat_id;
      if (chatId) {
        const urgencyIcon = classification.urgency === "high" ? "🚨" : "📨";
        const msg = `${urgencyIcon} <b>MAVIS Event</b> [${classification.category}]\n\n${classification.telegram_brief}\n\n<i>Actions: ${actionResults.map(a => `${a.ok ? "✓" : "✗"} ${a.type}`).join(", ")}</i>`;
        await tgSend(chatId, msg);
        telegramSent = true;
      }
    }

    // ── Log to mavis_memory for observability ─────────────────────────────
    await sb.from("mavis_memory").insert({
      user_id:          userId,
      content:          `Event routed: ${event_type} from ${source} → [${classification.category}] ${classification.summary}. Actions: ${actionResults.map(a => a.type).join(", ")}`,
      importance_score: 1,
      tags:             ["event-router", classification.category, "system"],
      timestamp:        Date.now(),
      consolidated:     false,
    }).catch(() => {});

    return new Response(JSON.stringify({
      classified_as:  classification.category,
      urgency:        classification.urgency,
      summary:        classification.summary,
      actions_taken:  actionResults,
      telegram_sent:  telegramSent,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
