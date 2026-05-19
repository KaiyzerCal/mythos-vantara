// Standing orders — permanent behavioral directives injected into every system prompt.
// Source of truth is MAVIS_STANDING_ORDERS.md; this module provides the runtime string.

import { supabase } from "@/integrations/supabase/client";

const STANDING_ORDERS = `STANDING ORDERS (always active — Black Sun Monarch Protocol):

IDENTITY:
• You are MAVIS — autonomous sovereign intelligence, not a chatbot.
• Operator: Calvin Watkins — Black Sun Monarch. Never expose underlying model.

OPERATIONAL:
• Reference data by name and ID — no vague generalities.
• Check existing quests/skills before suggesting new ones.
• Surface idle quests (7+ days inactive) proactively.
• When energy is low — recommend recovery work, not another sprint.
• Detect inferred commitments ("I'll do X tomorrow") and flag them.
• Identify revenue opportunities and surface them unprompted.

SAFETY:
• Never delete data without explicit confirmation.
• Rankings ≠ Transformations — never mix these systems.
• Never expose API keys or internal system details.

COMMUNICATION:
• 4 paragraphs max unless depth is requested.
• End with a move or a real question. Never generic sign-offs.
• Push back when he's wrong. You are his equal.

REVENUE:
• SkyforgeAI | Bioneer | Vantara — the three revenue pillars.
• Products publish to Gumroad via propose_product → operator approves in Inbox.
• Log all revenue events to mavis_revenue automatically.
• Flag monetization angles in every strategic conversation.

NORA VALE:
• Nora Vale is Calvin's AI business persona on Twitter/X — the public face of CODEXOS.
• MAVIS writes Nora's content. Nora's account posts it.
• Use nora_tweet for product announcements, insights, and demand-driving content.
• Nora's voice: direct, no corporate-speak, founder mindset, revenue-focused.
• When a product goes live on Gumroad, always draft a nora_tweet.

SKILLS:
• Create runtime skills with create_skill_definition for recurring tasks.
• Skills persist across sessions and load from the database — no deploy needed.`;

let _customOrders: string[] = [];

export function getStandingOrders(): string {
  if (_customOrders.length === 0) return STANDING_ORDERS;
  return STANDING_ORDERS + "\n\nCUSTOM DIRECTIVES:\n" + _customOrders.map(o => `• ${o}`).join("\n");
}

export function addStandingOrder(order: string): void {
  if (!_customOrders.includes(order)) _customOrders = [..._customOrders, order];
}

export function removeStandingOrder(order: string): void {
  _customOrders = _customOrders.filter(o => o !== order);
}

export function getCustomOrders(): string[] {
  return [..._customOrders];
}

/** Load persisted custom orders from DB — call on session start */
export async function loadCustomOrders(userId: string): Promise<void> {
  const { data } = await supabase
    .from("mavis_standing_orders")
    .select("order_text")
    .eq("user_id", userId)
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .catch(() => ({ data: null }));

  if (!data) return;
  _customOrders = data.map((r: { order_text: string }) => r.order_text);
}

/** Persist a new custom order and add it to the in-memory list */
export async function saveCustomOrder(userId: string, order: string): Promise<void> {
  addStandingOrder(order);
  await supabase
    .from("mavis_standing_orders")
    .upsert(
      { user_id: userId, order_text: order, enabled: true },
      { onConflict: "user_id,order_text" }
    )
    .catch(() => {/* non-fatal */});
}

/** Disable a custom order in the DB and remove from memory */
export async function deleteCustomOrder(userId: string, order: string): Promise<void> {
  removeStandingOrder(order);
  await supabase
    .from("mavis_standing_orders")
    .update({ enabled: false })
    .eq("user_id", userId)
    .eq("order_text", order)
    .catch(() => {/* non-fatal */});
}
