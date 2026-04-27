import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface RelationshipState {
  bond_level: number;
  trust_level: number;
  current_mood: string;
  mood_reason: string | null;
  total_interactions: number;
  last_interaction_at: string | null;
}

export interface PersonaMessage {
  role: "user" | "assistant";
  content: string;
}

export function usePersona(personaId: string, userId: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [isFinetuning, setIsFinetuning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (message: string, attachmentIds?: string[]): Promise<string | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("mavis-persona-router", {
        body: { persona_id: personaId, user_id: userId, message, attachment_ids: attachmentIds },
      });
      if (fnError) throw new Error(fnError.message);
      return data?.response ?? null;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [personaId, userId]);

  const triggerEmotionUpdate = useCallback(async (): Promise<void> => {
    try {
      await supabase.functions.invoke("mavis-emotion-engine", {
        body: { persona_id: personaId, user_id: userId },
      });
    } catch {
      // non-critical, swallow
    }
  }, [personaId, userId]);

  const loadHistory = useCallback(async (): Promise<PersonaMessage[]> => {
    const { data } = await supabase
      .from("persona_conversations")
      .select("role, content")
      .eq("persona_id", personaId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(50);
    return (data ?? []) as PersonaMessage[];
  }, [personaId, userId]);

  const loadRelationshipState = useCallback(async (): Promise<RelationshipState | null> => {
    const { data } = await supabase
      .from("relationship_states")
      .select("bond_level, trust_level, current_mood, mood_reason, total_interactions, last_interaction_at")
      .eq("persona_id", personaId)
      .eq("user_id", userId)
      .single();
    return data as RelationshipState | null;
  }, [personaId, userId]);

  const loadConversationCount = useCallback(async (): Promise<number> => {
    const { count } = await supabase
      .from("persona_conversations")
      .select("id", { count: "exact", head: true })
      .eq("persona_id", personaId)
      .eq("user_id", userId)
      .eq("role", "user");
    return count ?? 0;
  }, [personaId, userId]);

  // Submits a fine-tune job for this NAVI — requires 50+ conversations.
  const triggerFinetune = useCallback(async (): Promise<{ success: boolean; message: string; job_id?: string; examples?: number }> => {
    setIsFinetuning(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("navi-finetune-pipeline", {
        body: { persona_id: personaId, user_id: userId },
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);
      return { success: true, message: `Training started with ${data.examples} examples`, job_id: data.job_id, examples: data.examples };
    } catch (e: any) {
      return { success: false, message: e.message };
    } finally {
      setIsFinetuning(false);
    }
  }, [personaId, userId]);

  // Polls OpenAI for the current fine-tune job status and updates the persona row.
  const checkFinetuneStatus = useCallback(async (): Promise<string | null> => {
    try {
      const { data } = await supabase.functions.invoke("navi-finetune-check", {
        body: { persona_id: personaId },
      });
      const result = data?.results?.[0];
      return result?.status ?? null;
    } catch {
      return null;
    }
  }, [personaId]);

  return {
    sendMessage,
    triggerEmotionUpdate,
    loadHistory,
    loadRelationshipState,
    loadConversationCount,
    triggerFinetune,
    checkFinetuneStatus,
    isLoading,
    isFinetuning,
    error,
  };
}
