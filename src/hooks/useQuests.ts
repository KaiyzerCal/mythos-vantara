import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
    await updateQuest(id, { status: "completed" });
  }, [updateQuest]);

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
