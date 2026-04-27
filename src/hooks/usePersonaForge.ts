import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ForgedPersona {
  id: string;
  name: string;
  role: string;
  archetype: string;
  personality: Record<string, any>;
  system_prompt: string;
  model: string;
  avatar_key: string | null;
  is_active: boolean;
  created_at: string;
  // Fine-tuning lifecycle
  finetune_status: "none" | "training" | "deployed" | "failed";
  finetune_model: string | null;
  finetune_examples: number | null;
  last_finetuned_at: string | null;
}

export function usePersonaForge() {
  const [isForging, setIsForging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forgePersona = useCallback(async (userId: string, description: string): Promise<ForgedPersona | null> => {
    setIsForging(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("mavis-persona-forge", {
        body: { user_id: userId, description },
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
      return data?.persona ?? null;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setIsForging(false);
    }
  }, []);

  const listPersonas = useCallback(async (userId: string): Promise<ForgedPersona[]> => {
    const { data } = await supabase
      .from("personas")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    return (data ?? []) as ForgedPersona[];
  }, []);

  const deletePersona = useCallback(async (personaId: string): Promise<void> => {
    await supabase.from("personas").update({ is_active: false }).eq("id", personaId);
  }, []);

  return { forgePersona, listPersonas, deletePersona, isForging, error };
}
