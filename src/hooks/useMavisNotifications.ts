import { useEffect } from "react";
import { supabase as _supabase } from "@/integrations/supabase/client";
import { usePushNotifications } from "./usePushNotifications";
import { useProfile } from "./useProfile";

const supabase = _supabase as any;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const LAST_CHECK_KEY = "mavis_last_notif_check";

export function useMavisNotifications() {
  const { sendLocalNotification } = usePushNotifications();
  const { profile } = useProfile();

  useEffect(() => {
    if (!profile?.id) return;

    const lastCheck = parseInt(localStorage.getItem(LAST_CHECK_KEY) ?? "0", 10);
    if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;

    const runChecks = async () => {
      const userId = profile.id;
      const now = new Date().toISOString();

      try {
        // 1. Overdue quests
        const { data: overdue } = await supabase
          .from("quests")
          .select("id, title, deadline")
          .eq("user_id", userId)
          .eq("status", "active")
          .not("deadline", "is", null)
          .lt("deadline", now);

        for (const q of overdue ?? []) {
          sendLocalNotification("⚔️ Quest Overdue", `${q.title} — deadline has passed`, "quest_overdue");
        }

        // 2. Due within 24h
        const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const { data: dueSoon } = await supabase
          .from("quests")
          .select("id, title, deadline")
          .eq("user_id", userId)
          .eq("status", "active")
          .not("deadline", "is", null)
          .gte("deadline", now)
          .lte("deadline", in24h);

        for (const q of dueSoon ?? []) {
          sendLocalNotification("⏰ Quest Due Soon", `${q.title} is due within 24 hours`, "quest_due_soon");
        }

        // 3. Low energy systems
        const { data: energy } = await supabase
          .from("energy_systems")
          .select("type, current_value, max_value")
          .eq("user_id", userId);

        for (const e of energy ?? []) {
          const pct = (e.current_value ?? 0) / (e.max_value ?? 100);
          if (pct < 0.3) {
            sendLocalNotification("⚡ Low Energy Warning", `${e.type} is at ${Math.round(pct * 100)}%`, "low_energy");
          }
        }

        // 4. Commitment contract violations
        const { data: contracts } = await supabase
          .from("quests")
          .select("id, title, description, deadline")
          .eq("user_id", userId)
          .eq("status", "active")
          .not("deadline", "is", null)
          .lt("deadline", now)
          .ilike("description", "%commitment_contract%");

        for (const q of contracts ?? []) {
          sendLocalNotification("⚠️ Contract Violated", `Commitment contract for "${q.title}" has been broken`, "contract_violation");
        }

        localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      } catch {
        // Fail silently — notifications are non-critical
      }
    };

    runChecks();
  }, [profile?.id]);
}
