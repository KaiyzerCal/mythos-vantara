// src/mavis/personaEngine.ts
// Revenue attribution and content generation for Personas.
// Foundation for the AI influencer trajectory.

import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import type { PersonaContent, ContentType } from "./agentTypes";
import type { UnifiedPersona } from "./agentTypes";
import type { AppContextSnapshot } from "./appContextLoader";
import { buildPersonaTelegramPrompt } from "./agentPersona";
import { invokeAI } from "./chatService";

// ─── CONTENT GENERATION ──────────────────────────────────

export async function generatePersonaContent(
  persona: UnifiedPersona,
  ctx: AppContextSnapshot,
  brief: string,
  contentType: ContentType,
): Promise<string> {
  const systemPrompt = buildPersonaTelegramPrompt(persona, ctx) +
    `\n\nYou are generating a ${contentType} for publication. Write entirely in your authentic voice. Do not sound like an AI — sound like yourself. Be specific, original, and true to your niche.`;

  return invokeAI(systemPrompt, [{ role: "user", content: brief }], "PRIME", "persona-content");
}

// ─── CONTENT STORAGE ─────────────────────────────────────

export async function savePersonaContent(
  userId: string,
  content: PersonaContent,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("persona_content" as any)
      .insert({
        user_id:      userId,
        persona_id:   content.personaId,
        title:        content.title,
        body:         content.body,
        content_type: content.contentType,
        platform:     content.platform,
        status:       content.status,
      })
      .select("id")
      .single();
    if (error || !data) return null;
    return (data as any).id;
  } catch { return null; }
}

export async function getPersonaContent(
  userId: string,
  personaId: string,
  status?: PersonaContent["status"],
): Promise<PersonaContent[]> {
  try {
    let q = (supabase as any)
      .from("persona_content")
      .select("*")
      .eq("user_id", userId)
      .eq("persona_id", personaId)
      .order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data } = await q;
    return (data ?? []).map((r: any): PersonaContent => ({
      id:               r.id,
      personaId:        r.persona_id,
      title:            r.title,
      body:             r.body,
      contentType:      r.content_type,
      platform:         r.platform,
      status:           r.status,
      engagementScore:  r.engagement_score,
      revenueGenerated: r.revenue_generated,
      publishedAt:      r.published_at,
    }));
  } catch { return []; }
}

// ─── REVENUE ATTRIBUTION ─────────────────────────────────

export async function logPersonaRevenue(
  userId: string,
  personaId: string,
  source: string,
  amount: number,
  description: string,
  contentId?: string,
  stripePaymentId?: string,
): Promise<void> {
  try {
    await (supabase as any).from("persona_revenue").insert({
      user_id:           userId,
      persona_id:        personaId,
      source,
      amount,
      description,
      content_id:        contentId,
      stripe_payment_id: stripePaymentId,
    });
  } catch (err) {
    console.warn("[PersonaEngine] Failed to log revenue:", err);
  }
}

export async function getPersonaRevenueTotal(
  userId: string,
  personaId: string,
): Promise<number> {
  try {
    const { data } = await (supabase as any)
      .from("persona_revenue")
      .select("amount")
      .eq("user_id", userId)
      .eq("persona_id", personaId);
    return (data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  } catch { return 0; }
}

export async function getAllPersonaRevenueTotals(
  userId: string,
): Promise<{ personaId: string; total: number }[]> {
  try {
    const { data } = await (supabase as any)
      .from("persona_revenue")
      .select("persona_id, amount")
      .eq("user_id", userId);
    const totals = new Map<string, number>();
    for (const row of data ?? []) {
      totals.set(row.persona_id, (totals.get(row.persona_id) ?? 0) + Number(row.amount));
    }
    return [...totals.entries()].map(([personaId, total]) => ({ personaId, total }));
  } catch { return []; }
}
