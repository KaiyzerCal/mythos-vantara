import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { recordAutoMemory } from "@/mavis/autoMemory";

export interface QuestBuffEffect {
  label: string;
  value: number;
  unit: string;
  duration?: string;
}

export interface Quest {
  id: string;
  user_id: string;
  title: string;
  description: string;
  type: "main" | "side" | "daily" | "epic";
  status: "active" | "completed" | "failed" | "locked";
  difficulty: "Easy" | "Normal" | "Hard" | "Extreme" | "Impossible";
  xp_reward: number;
  codex_points_reward: number;
  progress_current: number;
  progress_target: number;
  real_world_mapping: string | null;
  category: string | null;
  deadline: string | null;
  loot_rewards: { itemName: string; quantity: number; rarity?: string }[];
  linked_skill_ids: string[];
  buff_effects: QuestBuffEffect[];
  debuff_effects: QuestBuffEffect[];
  // ISA schema (LifeOS)
  current_state: string | null;
  ideal_state: string | null;
  effort_tier: "E1" | "E2" | "E3" | "E4" | "E5" | null;
  phase: "PLAN" | "BUILD" | "VERIFY" | "DONE" | null;
  completion_criteria: string[];
  decisions_log: { date: string; note: string }[];
  // Freshness tracking
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CreateQuestInput = Omit<Quest, "id" | "user_id" | "created_at" | "updated_at">;
export type UpdateQuestInput = Partial<CreateQuestInput>;

export function useQuests() {
  const { user } = useAuth();
  const [quests, setQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("quests")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setQuests(data as unknown as Quest[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  // Real-time: keep state in sync when quests are created/updated/deleted
  // externally (e.g. from mavis-actions via Inbox approval).
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("quests-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "quests", filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setQuests((prev) => {
              if (prev.some((q) => q.id === (payload.new as Quest).id)) return prev;
              return [payload.new as Quest, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            setQuests((prev) =>
              prev.map((q) => q.id === (payload.new as Quest).id ? payload.new as Quest : q)
            );
          } else if (payload.eventType === "DELETE") {
            setQuests((prev) => prev.filter((q) => q.id !== (payload.old as Quest).id));
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const createQuest = useCallback(async (input: CreateQuestInput): Promise<Quest | null> => {
    if (!user) return null;
    const { data, error } = await (supabase as any)
      .from("quests")
      .insert({ ...input, user_id: user.id })
      .select()
      .single();
    if (error || !data) return null;
    const quest = data as unknown as Quest;
    setQuests((q) => [quest, ...q]);
    return quest;
  }, [user]);

  const updateQuest = useCallback(async (id: string, input: UpdateQuestInput) => {
    setQuests((qs) => qs.map((q) => (q.id === id ? { ...q, ...input } : q)));
    await (supabase as any).from("quests").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id);
  }, []);

  const completeQuest = useCallback(async (id: string) => {
    const quest = quests.find(q => q.id === id);
    await updateQuest(id, { status: "completed" });
    if (quest) {
      recordAutoMemory("quest_complete", {
        title: `Quest Completed: ${quest.title}`,
        content: `Completed quest "${quest.title}" (${quest.type}, ${quest.xp_reward ?? 0} XP).${quest.description ? ` Description: ${quest.description}` : ""}`,
        tags: [quest.type ?? "quest"],
        metadata: { quest_id: id, xp_reward: quest.xp_reward },
      }).catch(() => {});
    }
  }, [updateQuest, quests]);

  const deleteQuest = useCallback(async (id: string) => {
    setQuests((qs) => qs.filter((q) => q.id !== id));
    await supabase.from("quests").delete().eq("id", id);
  }, []);

  const stats = {
    total: quests.length,
    active: quests.filter((q) => q.status === "active").length,
    completed: quests.filter((q) => q.status === "completed").length,
    epic: quests.filter((q) => q.type === "epic").length,
    xpEarned: quests.filter((q) => q.status === "completed").reduce((s, q) => s + q.xp_reward, 0),
  };

  return { quests, loading, stats, createQuest, updateQuest, completeQuest, deleteQuest, refetch: fetch };
}
