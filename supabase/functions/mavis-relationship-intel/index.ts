// mavis-relationship-intel
// Tracks relationship health for all contacts.
// Detects dormancy, scores relationship strength, suggests nurturing actions.
// Runs Monday 8am via pg_cron. verify_jwt = false.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const sb = () => createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

function calcFrequency(daysSince: number): string {
  if (daysSince <= 1) return "daily";
  if (daysSince <= 7) return "weekly";
  if (daysSince <= 30) return "monthly";
  if (daysSince <= 90) return "quarterly";
  if (daysSince <= 180) return "rare";
  return "dormant";
}

function calcHealthScore(daysSince: number, interactionCount: number): number {
  let score = 10;
  if (daysSince > 7) score -= 1;
  if (daysSince > 30) score -= 2;
  if (daysSince > 60) score -= 2;
  if (daysSince > 90) score -= 2;
  if (daysSince > 180) score -= 1;
  if (interactionCount > 10) score = Math.min(10, score + 1);
  if (interactionCount === 0) score = Math.max(1, score - 1);
  return Math.max(1, Math.min(10, Math.round(score * 10) / 10));
}

async function generateSuggestion(
  name: string,
  daysSince: number,
  lastInteraction: any,
  notes: string,
): Promise<{ action: string; urgency: string }> {
  if (!ANTHROPIC_KEY) {
    if (daysSince > 90) return { action: `Reach out to ${name} — it's been ${daysSince} days.`, urgency: "high" };
    if (daysSince > 30) return { action: `Check in with ${name} briefly.`, urgency: "medium" };
    return { action: `Keep the connection warm with ${name}.`, urgency: "low" };
  }

  const prompt = `You are MAVIS giving a concise relationship nurturing suggestion.

Contact: ${name}
Days since last contact: ${daysSince}
Last known interaction context: ${lastInteraction ? JSON.stringify(lastInteraction).slice(0, 200) : "unknown"}
Notes: ${notes?.slice(0, 200) || "none"}

Give ONE specific, actionable suggestion (1 sentence) and an urgency level (low/medium/high/critical).
Return JSON: {"action": "...", "urgency": "low|medium|high|critical"}
Return ONLY valid JSON.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error();
    const d = await res.json();
    const text = d.content?.find((b: any) => b.type === "text")?.text ?? "{}";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error();
    const p = JSON.parse(m[0]);
    return { action: String(p.action ?? ""), urgency: String(p.urgency ?? "low") };
  } catch {
    const urgency = daysSince > 90 ? "high" : daysSince > 30 ? "medium" : "low";
    return { action: `Reconnect with ${name} — ${daysSince} days since last contact.`, urgency };
  }
}

async function analyzeUser(userId: string): Promise<number> {
  const [contactsRes, interactionsRes] = await Promise.all([
    sb().from("contacts").select("id,name,relationship_type,notes").eq("user_id", userId).limit(100),
    sb().from("contact_interactions").select("contact_id,created_at,type,notes").eq("user_id", userId).order("created_at", { ascending: false }).limit(500),
  ]);

  const contacts = contactsRes.data ?? [];
  const interactions = interactionsRes.data ?? [];

  if (contacts.length === 0) return 0;

  const now = Date.now();
  const interactionsByContact = new Map<string, any[]>();
  for (const i of interactions) {
    if (!interactionsByContact.has(i.contact_id)) interactionsByContact.set(i.contact_id, []);
    interactionsByContact.get(i.contact_id)!.push(i);
  }

  let updated = 0;
  for (const contact of contacts) {
    try {
      const contactInteractions = interactionsByContact.get(contact.id) ?? [];
      const lastInteraction = contactInteractions[0];
      const daysSince = lastInteraction
        ? Math.floor((now - new Date(lastInteraction.created_at).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      const healthScore = calcHealthScore(daysSince, contactInteractions.length);
      const frequency = calcFrequency(daysSince);

      let suggestion = { action: "", urgency: "low" };
      if (daysSince > 30 || healthScore < 5) {
        suggestion = await generateSuggestion(contact.name, daysSince, lastInteraction, contact.notes ?? "");
      }

      await sb().from("mavis_relationship_health").upsert({
        user_id: userId,
        contact_id: contact.id,
        contact_name: contact.name,
        health_score: healthScore,
        last_interaction_at: lastInteraction?.created_at ?? null,
        days_since_contact: daysSince === 999 ? 0 : daysSince,
        interaction_frequency: frequency,
        relationship_type: contact.relationship_type ?? "professional",
        notes: contact.notes ?? "",
        suggested_action: suggestion.action,
        action_urgency: suggestion.urgency,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,contact_name" });

      // Alert for critical dormancy
      if (daysSince > 90 && suggestion.urgency === "high") {
        try {
          await fetch(`${SB_URL}/functions/v1/mavis-push-notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_KEY}` },
            body: JSON.stringify({
              user_id: userId,
              title: `Relationship Alert: ${contact.name}`,
              body: suggestion.action,
              type: "relationship_alert",
            }),
            signal: AbortSignal.timeout(5000),
          });
          await sb().from("mavis_relationship_health").update({ alert_sent_at: new Date().toISOString() })
            .eq("user_id", userId).eq("contact_id", contact.id);
        } catch { /* non-fatal */ }
      }

      updated++;
    } catch { /* non-fatal per contact */ }
  }
  return updated;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any = {};
  try { if (req.method === "POST") body = await req.json().catch(() => ({})); } catch { /**/ }
  const isCron = Boolean(body?.cron);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  let targetUserId: string | null = null;

  if (isCron || token === SB_KEY) {
    targetUserId = body.user_id ?? null;
  } else {
    const { data: { user } } = await createClient(SB_URL, SB_KEY).auth.getUser(token);
    targetUserId = user?.id ?? null;
  }

  try {
    if (isCron) {
      const { data: users } = await sb().from("contacts").select("user_id").limit(200);
      const uniqueUsers = [...new Set((users ?? []).map((r: any) => r.user_id as string))];
      let total = 0;
      for (const uid of uniqueUsers) {
        try { total += await analyzeUser(uid); } catch { /**/ }
      }
      return json({ users_processed: uniqueUsers.length, contacts_analyzed: total });
    }

    if (!targetUserId) return json({ error: "Unauthorized" }, 401);

    if (req.method === "GET") {
      const url = new URL(req.url);
      const minDays = Number(url.searchParams.get("min_days") ?? 0);
      let q = sb().from("mavis_relationship_health").select("*").eq("user_id", targetUserId).order("days_since_contact", { ascending: false }).limit(50);
      if (minDays > 0) q = q.gte("days_since_contact", minDays);
      const { data } = await q;
      return json({ relationships: data ?? [] });
    }

    const count = await analyzeUser(targetUserId);
    const { data } = await sb().from("mavis_relationship_health").select("contact_name,health_score,days_since_contact,suggested_action,action_urgency").eq("user_id", targetUserId).order("days_since_contact", { ascending: false }).limit(20);
    return json({ contacts_analyzed: count, relationships: data ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
