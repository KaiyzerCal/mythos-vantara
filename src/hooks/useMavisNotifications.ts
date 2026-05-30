import { useEffect, useState } from "react";
import { supabase as _supabase } from "@/integrations/supabase/client";
import { usePushNotifications } from "./usePushNotifications";
import { useAuth } from "@/contexts/AuthContext";

const supabase = _supabase as any;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const LAST_CHECK_KEY = "mavis_last_notif_check";

interface PendingNotification {
  priority: number;
  type: string;
  title: string;
  body: string;
}

export function useMavisNotifications() {
  const { sendLocalNotification } = usePushNotifications();
  const { user } = useAuth();
  const userId = user?.id;
  const [budgetUsed, setBudgetUsed] = useState(0);
  const [budgetTotal, setBudgetTotal] = useState(5);

  // Load today's budget row on mount / when user becomes available
  const loadBudget = async () => {
    if (!userId) return;
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("notification_budget")
      .select("slots_used, slots_total")
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle();
    setBudgetUsed(data?.slots_used ?? 0);
    setBudgetTotal(data?.slots_total ?? 5);
  };

  // Consume one slot via RPC; returns true when a slot was available
  const canSend = async (): Promise<boolean> => {
    if (!userId) return false;
    const { data } = await supabase.rpc("consume_notification_slot", {
      p_user_id: userId,
    });
    if (data === true) {
      setBudgetUsed((prev) => prev + 1);
    }
    return data === true;
  };

  // Persist a record of every sent notification for analytics / tuning
  const logNotification = async (
    type: string,
    title: string,
    body: string,
    priority: number
  ) => {
    if (!userId) return;
    await supabase
      .from("notification_log")
      .insert({
        user_id: userId,
        type,
        title,
        body,
        priority,
        sent_at: new Date().toISOString(),
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!userId) return;

    loadBudget();

    const lastCheck = parseInt(localStorage.getItem(LAST_CHECK_KEY) ?? "0", 10);
    if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;

    const runChecks = async () => {
      const now = new Date().toISOString();
      const in4h = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const queue: PendingNotification[] = [];

      try {
        // --- Priority 1: Active commitment-contract quests with passed deadlines ---
        const { data: contracts } = await supabase
          .from("quests")
          .select("id, title, description, deadline")
          .eq("user_id", userId)
          .eq("status", "active")
          .not("deadline", "is", null)
          .lt("deadline", now)
          .ilike("description", "%commitment_contract%");

        for (const q of contracts ?? []) {
          queue.push({
            priority: 1,
            type: "contract_violation",
            title: "⚠️ Contract Violated",
            body: `Commitment contract for "${q.title}" has been broken`,
          });
        }

        // --- Priority 2: Quests due within 4 hours AND active streak > 5 ---
        const { data: urgentWithStreak } = await supabase
          .from("quests")
          .select("id, title, deadline, streak_count")
          .eq("user_id", userId)
          .eq("status", "active")
          .not("deadline", "is", null)
          .gte("deadline", now)
          .lte("deadline", in4h)
          .gt("streak_count", 5);

        for (const q of urgentWithStreak ?? []) {
          queue.push({
            priority: 2,
            type: "deadline",
            title: "🔥 Streak at Risk",
            body: `${q.title} — due in under 4 h and your ${q.streak_count}-day streak is on the line`,
          });
        }

        // --- Priority 3: Quests due within 24 hours ---
        // Exclude those already captured by priority 2
        const urgentIds = new Set((urgentWithStreak ?? []).map((q: any) => q.id));
        const { data: dueSoon } = await supabase
          .from("quests")
          .select("id, title, deadline")
          .eq("user_id", userId)
          .eq("status", "active")
          .not("deadline", "is", null)
          .gte("deadline", now)
          .lte("deadline", in24h);

        for (const q of dueSoon ?? []) {
          if (urgentIds.has(q.id)) continue;
          queue.push({
            priority: 3,
            type: "deadline",
            title: "⏰ Quest Due Soon",
            body: `${q.title} is due within 24 hours`,
          });
        }

        // --- Priority 4: Energy < 20% across any energy system ---
        const { data: energy } = await supabase
          .from("energy_systems")
          .select("type, current_value, max_value")
          .eq("user_id", userId);

        for (const e of energy ?? []) {
          const pct = (e.current_value ?? 0) / (e.max_value ?? 100);
          if (pct < 0.2) {
            queue.push({
              priority: 4,
              type: "energy",
              title: "⚡ Low Energy Warning",
              body: `${e.type} is at ${Math.round(pct * 100)}%`,
            });
          }
        }

        // --- Priority 5: Streak at risk (habit task not completed today, streak > 3) ---
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const { data: habitQuests } = await supabase
          .from("quests")
          .select("id, title, streak_count, last_completed_at")
          .eq("user_id", userId)
          .eq("status", "active")
          .eq("quest_type", "habit")
          .gt("streak_count", 3);

        for (const q of habitQuests ?? []) {
          const lastDone = q.last_completed_at ? new Date(q.last_completed_at) : null;
          const completedToday = lastDone && lastDone >= todayStart;
          if (!completedToday) {
            queue.push({
              priority: 5,
              type: "streak_risk",
              title: "🌀 Streak at Risk",
              body: `Complete "${q.title}" today to keep your ${q.streak_count}-day streak alive`,
            });
          }
        }

        // --- Priority 6: General overdue quests (non-contract) as motivational nudges ---
        const { data: overdue } = await supabase
          .from("quests")
          .select("id, title, deadline, description")
          .eq("user_id", userId)
          .eq("status", "active")
          .not("deadline", "is", null)
          .lt("deadline", now);

        const contractIds = new Set((contracts ?? []).map((q: any) => q.id));
        for (const q of overdue ?? []) {
          if (contractIds.has(q.id)) continue;
          queue.push({
            priority: 6,
            type: "motivational",
            title: "⚔️ Quest Overdue",
            body: `${q.title} — deadline has passed`,
          });
        }

        // Sort ascending by priority (1 fires first)
        queue.sort((a, b) => a.priority - b.priority);

        // Fire notifications in priority order, consuming budget slots
        for (const n of queue) {
          const slotGranted = await canSend();
          if (!slotGranted) break; // Budget exhausted for today

          sendLocalNotification(n.title, n.body, n.type);
          await logNotification(n.type, n.title, n.body, n.priority);
        }

        localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      } catch {
        // Fail silently — notifications are non-critical
      }
    };

    runChecks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { budgetUsed, budgetTotal };
}
