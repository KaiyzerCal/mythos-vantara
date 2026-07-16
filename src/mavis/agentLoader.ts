// src/mavis/agentLoader.ts
// Loads and normalizes AgentEntity objects from Supabase for both
// Council Members (table: councils) and Personas (table: personas).

import { supabase } from "@/integrations/supabase/client";
import type { UnifiedCouncilMember, UnifiedPersona, AgentEntity } from "./agentTypes";

export async function loadCouncilAgents(userId: string): Promise<UnifiedCouncilMember[]> {
  try {
    const { data } = await supabase
      .from("councils")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    return (data ?? []).map(rowToCouncilAgent);
  } catch { return []; }
}

export async function loadPersonaAgents(userId: string): Promise<UnifiedPersona[]> {
  try {
    const { data } = await supabase
      .from("personas")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    return (data ?? []).map(rowToPersonaAgent);
  } catch { return []; }
}

export async function loadAllAgents(userId: string): Promise<AgentEntity[]> {
  const [council, personas] = await Promise.all([
    loadCouncilAgents(userId),
    loadPersonaAgents(userId),
  ]);
  return [...council, ...personas];
}

function rowToCouncilAgent(row: Record<string, unknown>): UnifiedCouncilMember {
  return {
    id:               row.id as string,
    userId:           row.user_id as string,
    agentType:        "council",
    name:             row.name as string,
    role:             row.role as string | undefined,
    archetype:        row.class as string | undefined,
    specialty:        row.specialty as string | undefined,
    characterClass:   row.class as string | undefined,
    notes:            row.notes as string | undefined,
    description:      row.notes as string | undefined,
    avatarUrl:        row.avatar as string | undefined,
    voiceStyle:       row.voice_style as string | undefined,
    personalityPrompt:row.personality_prompt as string | undefined,
    karma:            row.karma as number | undefined,
    heartbeatEnabled: true,
    telegramEnabled:  (row.telegram_enabled as boolean) ?? true,
    canBeSummoned:    (row.can_be_summoned as boolean) ?? true,
    dataAccessTier:   "full",
    active:           true,
    createdAt:        row.created_at as string | undefined,
    updatedAt:        row.updated_at as string | undefined,
  };
}

function rowToPersonaAgent(row: Record<string, unknown>): UnifiedPersona {
  return {
    id:               row.id as string,
    userId:           row.user_id as string,
    agentType:        "persona",
    name:             row.name as string,
    role:             row.role as string | undefined,
    archetype:        row.archetype as string | undefined,
    description:      row.role as string | undefined,
    avatarUrl:        row.avatar_key as string | undefined,
    voiceStyle:       row.voice_style as string | undefined,
    personalityPrompt:row.system_prompt as string | undefined,
    systemPrompt:     row.system_prompt as string | undefined,
    contentNiche:     row.content_niche as string | undefined,
    model:            row.model as string | undefined,
    telegramEnabled:  (row.telegram_enabled as boolean) ?? true,
    dataAccessTier:   ((row.data_access_tier as string) ?? "scoped") as "scoped" | "public",
    canJoinCouncil:   (row.can_join_council as boolean) ?? true,
    active:           (row.is_active as boolean) ?? true,
    createdAt:        row.created_at as string | undefined,
    updatedAt:        row.updated_at as string | undefined,
  };
}
