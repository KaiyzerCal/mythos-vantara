// MAVIS autonomous revenue tracking.
// Logs, queries, and summarizes all revenue-generating events across CODEXOS products.

import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

export type RevenueSource =
  | "skyforgeai_subscription"
  | "bioneer_subscription"
  | "vantara_sale"
  | "skill_sale"
  | "service_sale"
  | "affiliate"
  | "custom";

export interface RevenueEvent {
  source: RevenueSource | string;
  amount: number;
  currency?: string;
  description: string;
  stripePaymentId?: string;
  taskId?: string;
}

export async function logRevenue(userId: string, event: RevenueEvent): Promise<void> {
  const { error } = await supabase.from("mavis_revenue").insert({
    user_id: userId,
    source: event.source,
    amount: event.amount,
    currency: event.currency ?? "USD",
    description: event.description,
    stripe_payment_id: event.stripePaymentId,
    task_id: event.taskId,
  });
  if (error) console.warn("[RevenueEngine] Failed to log revenue:", error.message);
}

export async function getRevenueTotal(userId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from("mavis_revenue")
      .select("amount")
      .eq("user_id", userId);
    return (data ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
  } catch { return 0; }
}

export async function getRevenueBySource(userId: string): Promise<Record<string, number>> {
  try {
    const { data } = await supabase
      .from("mavis_revenue")
      .select("source, amount")
      .eq("user_id", userId);
    const totals: Record<string, number> = {};
    for (const row of data ?? []) {
      totals[row.source] = (totals[row.source] ?? 0) + Number(row.amount);
    }
    return totals;
  } catch { return {}; }
}

export async function getRevenueHistory(userId: string, limit = 50) {
  try {
    const { data } = await supabase
      .from("mavis_revenue")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return data ?? [];
  } catch { return []; }
}
