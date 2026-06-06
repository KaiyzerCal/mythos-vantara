// MAVIS Design Engine — client-side orchestrator
// Routes through the mavis-design-engine Edge Function (API key stays server-side)

import { supabase } from "@/integrations/supabase/client";
import type { DesignBrief, DesignGenerationOutput } from "./types";

export async function runDesignEngine(
  userId: string,
  brief: DesignBrief,
): Promise<DesignGenerationOutput> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  // Map frontend brief to the snake_case shape the edge function expects
  const briefPayload = {
    project_name:         brief.projectName,
    brand:                brief.brand,
    project_goal:         brief.projectGoal,
    target_audience:      brief.targetAudience,
    key_features:         brief.keyFeatures,
    aesthetic_directives: brief.aestheticDirectives,
    competitor_urls:      brief.competitorUrls ?? [],
    user_journey:         brief.userJourney,
    deadline_tier:        brief.deadlineTier,
    client_name:          brief.clientName,
    project_value:        brief.projectValue,
  };

  const { data, error } = await (supabase as any).functions.invoke("mavis-design-engine", {
    body: { brief: briefPayload },
  });

  if (error) throw new Error(`Design engine error: ${error.message ?? String(error)}`);

  return {
    projectId:   data.projectId,
    brief,
    blueprint:   data.blueprint,
    designSystem: data.designSystem,
    files:        data.files,
    qualityGate:  data.qualityGate,
  };
}
