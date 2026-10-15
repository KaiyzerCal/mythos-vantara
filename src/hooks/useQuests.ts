import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { recordAutoMemory } from "@/mavis/autoMemory";
import { triggerEmbed } from "@/lib/embedTrigger";

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
  // Sub-quests and GAME_MASTER consequence chains — real columns, previously
  // untyped (FeaturePages.tsx accessed parent_quest_id via `any` casts only).
  parent_quest_id: string | null;
  consequence_quest_id: string | null;
  is_consequence: boolean | null;
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
    triggerEmbed(user.id, "quests");
    return quest;
  }, [user]);

  const updateQuest = useCallback(async (id: string, input: UpdateQuestInput) => {
    setQuests((qs) => qs.map((q) => (q.id === id ? { ...q, ...input } : q)));
    await (supabase as any).from("quests").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id);
    // Only a title/description change invalidates the embedding — progress,
    // status, and reward-amount edits don't touch what got embedded.
    if (user && (input.title !== undefined || input.description !== undefined)) {
      (supabase as any).from("quests").update({ embedding: null }).eq("id", id).eq("user_id", user.id)
        .then(() => triggerEmbed(user.id, "quests"));
    }
  }, [user]);

  const completeQuest = useCallback(async (id: string) => {
    const quest = quests.find(q => q.id === id);
    // Routes through mavis-actions' complete_quest action instead of a plain
    // status update — that's where XP award and linked-skill proficiency
    // (with tier-unlock cascade) actually happen. One call site for every
    // "complete quest" entry point (main quest row, sub-quest row, chat)
    // keeps them from drifting the way awardXP/skill bumps previously did
    // between this hook and FeaturePages.tsx's own handleComplete.
    setQuests((qs) => qs.map((q) => (q.id === id ? { ...q, status: "completed" } : q)));
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not authenticated — please sign in again");
    const { data, error } = await supabase.functions.invoke("mavis-actions", {
      body: { actions: [{ type: "complete_quest", params: { quest_id: id } }] },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) throw error;
    const failed = Array.isArray(data?.results) ? data.results.filter((r: any) => r?.success === false) : [];
    if (failed.length > 0) throw new Error(failed[0]?.error || "Failed to complete quest");
    if (quest) {
      recordAutoMemory("quest_complete", {
        title: `Quest Completed: ${quest.title}`,
        content: `Completed quest "${quest.title}" (${quest.type}, ${quest.xp_reward ?? 0} XP).${quest.description ? ` Description: ${quest.description}` : ""}`,
        tags: [quest.type ?? "quest"],
        metadata: { quest_id: id, xp_reward: quest.xp_reward },
      }).catch(() => {});
    }
  }, [quests]);

  // GAME_MASTER's consequence-quest mechanic (see the "Consequence quest
  // linking" migration comment): a quest can name another quest to surface
  // when IT is failed. Failing never awards or deducts anything itself —
  // "consequences must be redemptive, not punitive" — it just marks the
  // quest failed and, if its named consequence was sitting dormant
  // ("locked"), makes it playable.
  const failQuest = useCallback(async (id: string) => {
    const quest = quests.find(q => q.id === id);
    setQuests((qs) => qs.map((q) => (q.id === id ? { ...q, status: "failed" } : q)));
    await supabase.from("quests").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", id);

    const consequenceId = quest?.consequence_quest_id;
    if (consequenceId && user) {
      const { data: consequence } = await supabase
        .from("quests").select("id, title, status").eq("id", consequenceId).eq("user_id", user.id).maybeSingle();
      if (consequence && consequence.status === "locked") {
        setQuests((qs) => qs.map((q) => (q.id === consequenceId ? { ...q, status: "active" } : q)));
        await supabase.from("quests").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", consequenceId);
        await supabase.from("activity_log").insert({
          user_id: user.id, event_type: "quest_created",
          description: `⚠ Consequence triggered: "${consequence.title}" (from failing "${quest?.title}")`,
          xp_amount: 0,
        });
      }
    }
  }, [quests, user]);

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

  return { quests, loading, stats, createQuest, updateQuest, completeQuest, failQuest, deleteQuest, refetch: fetch };
}
