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

  return { sendMessage, triggerEmotionUpdate, loadHistory, loadRelationshipState, isLoading, error };
}
