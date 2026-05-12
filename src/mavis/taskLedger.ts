// Task ledger — tracks all autonomous MAVIS operations.
// Operator visibility dashboard for everything MAVIS does or plans to do.

import { supabase } from "@/integrations/supabase/client";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "requires_confirmation";

export interface LedgerTask {
  id?: string;
  type: string;
  description?: string;
  payload?: Record<string, unknown>;
  status?: TaskStatus;
  scheduledAt?: string;
  result?: Record<string, unknown>;
  revenueGenerated?: number;
}

export async function createTask(userId: string, task: LedgerTask): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("mavis_tasks")
      .insert({
        user_id: userId,
        type: task.type,
        description: task.description,
        payload: task.payload ?? {},
        status: task.status ?? "pending",
        scheduled_at: task.scheduledAt,
        revenue_generated: task.revenueGenerated ?? 0,
      })
      .select("id")
      .single();
    if (error || !data) return null;
    return (data as any).id;
  } catch { return null; }
}

export async function getPendingTasks(userId: string): Promise<LedgerTask[]> {
  try {
    const { data } = await supabase
      .from("mavis_tasks")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["pending", "running", "requires_confirmation"])
      .order("created_at", { ascending: true });
    return mapRows(data ?? []);
  } catch { return []; }
}

export async function getAllTasks(userId: string, limit = 50): Promise<LedgerTask[]> {
  try {
    const { data } = await supabase
      .from("mavis_tasks")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return mapRows(data ?? []);
  } catch { return []; }
}

export async function completeTask(
  taskId: string,
  result?: Record<string, unknown>,
  revenueGenerated?: number,
): Promise<void> {
  await supabase.from("mavis_tasks").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    result: result ?? {},
    revenue_generated: revenueGenerated ?? 0,
  }).eq("id", taskId);
}

export async function cancelTask(taskId: string): Promise<void> {
  await supabase.from("mavis_tasks").update({ status: "cancelled" }).eq("id", taskId);
}

export async function failTask(taskId: string, errorMessage: string): Promise<void> {
  await supabase.from("mavis_tasks").update({
    status: "failed",
    result: { error: errorMessage },
    completed_at: new Date().toISOString(),
  }).eq("id", taskId);
}

// Detect inferred commitments in user text ("I'll X", "I need to X by Y")
export function inferCommitment(text: string): { detected: boolean; description?: string } {
  const patterns = [
    /i'?ll\s+(.{10,80}?)(?:\.|$)/i,
    /i need to\s+(.{10,80}?)(?:\.|$)/i,
    /i'm going to\s+(.{10,80}?)(?:\.|$)/i,
    /i should\s+(.{10,80}?)(?:\.|$)/i,
    /i have to\s+(.{10,80}?)(?:\.|$)/i,
    /remind me to\s+(.{10,80}?)(?:\.|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return { detected: true, description: match[1].trim() };
    }
  }
  return { detected: false };
}

function mapRows(rows: any[]): LedgerTask[] {
  return rows.map(r => ({
    id: r.id,
    type: r.type,
    description: r.description,
    payload: r.payload,
    status: r.status,
    scheduledAt: r.scheduled_at,
    result: r.result,
    revenueGenerated: r.revenue_generated,
  }));
}
