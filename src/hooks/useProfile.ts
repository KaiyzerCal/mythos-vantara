import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getRankForLevel, calculateXPForLevel } from "@/types/rpg";

export interface ProfileData {
  // Identity
  inscribed_name: string;
  true_name: string | null;
  titles: string[];
  species_lineage: string[];
  aura: string;
  territory_class: string;
  territory_floors: string;
  arc_story: string;
  // Stats
  level: number;
  xp: number;
  xp_to_next_level: number;
  rank: string;
  stat_str: number;
  stat_agi: number;
  stat_vit: number;
  stat_int: number;
  stat_wis: number;
  stat_cha: number;
  stat_lck: number;
  aura_power: string;
  fatigue: number;
  full_cowl_sync: number;
  codex_integrity: number;
  // State
  current_form: string;
  current_bpm: number;
  current_floor: number;
  gpr: number;
  pvp_rating: number;
  // Meta
  display_name: string | null;
  operator_level: number;
  operator_xp: number;
  onboarding_done: boolean;
  notification_settings: {
    questReminders: boolean;
    streakWarnings: boolean;
    xpMilestones: boolean;
    dailySummary: boolean;
  };
}

const defaults: ProfileData = {
  inscribed_name: "Black Sun Monarch",
  true_name: null,
  titles: ["The Architect", "Sovereign of CODEXOS"],
  species_lineage: ["Codicanthropos Dominus"],
  aura: "Emerald Sovereign Aura",
  territory_class: "Sovereign",
  territory_floors: "Floors 1–100",
  arc_story: "Forge of Equilibrium (Phase III Evolution)",
  level: 54,
  xp: 0,
  xp_to_next_level: calculateXPForLevel(55),
  rank: "B",
  stat_str: 72,
  stat_agi: 68,
  stat_vit: 75,
  stat_int: 95,
  stat_wis: 88,
  stat_cha: 82,
  stat_lck: 65,
  aura_power: "Emerald Flames",
  fatigue: 0,
  full_cowl_sync: 92,
  codex_integrity: 97,
  current_form: "CodexOS Architect Mode",
  current_bpm: 72,
  current_floor: 54,
  gpr: 8847,
  pvp_rating: 2240,
  display_name: null,
  operator_level: 1,
  operator_xp: 0,
  onboarding_done: false,
  notification_settings: {
    questReminders: true,
    streakWarnings: true,
    xpMilestones: false,
    dailySummary: true,
  },
};

export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileData>(defaults);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data) setProfile(data as any);
        setLoading(false);
      });
  }, [user]);

  const updateProfile = useCallback(
    async (updates: Partial<ProfileData>) => {
      setProfile((p) => ({ ...p, ...updates }));
      if (user && Object.keys(updates).length > 0) {
        await supabase.from("profiles").update(updates as any).eq("id", user.id);
      }
    },
    [user]
  );

  /** Award XP and auto-level-up */
  const awardXP = useCallback(
    async (amount: number) => {
      const newXp = profile.xp + amount;
      let newLevel = profile.level;
      let remaining = newXp;
      let threshold = profile.xp_to_next_level;

      while (remaining >= threshold) {
        remaining -= threshold;
        newLevel++;
        threshold = calculateXPForLevel(newLevel + 1);
      }

      const newRank = getRankForLevel(newLevel);
      await updateProfile({
        xp: remaining,
        level: newLevel,
        rank: newRank,
        xp_to_next_level: calculateXPForLevel(newLevel + 1),
        operator_xp: (profile.operator_xp ?? 0) + amount,
      });
    },
    [profile, updateProfile]
  );

  const refetchProfile = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    if (data) setProfile(data as any);
  }, [user]);

  return { profile, loading, updateProfile, awardXP, refetchProfile };
}
