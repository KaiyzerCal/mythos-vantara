// SKILL: gmb-agent
// Manages Google My Business listings, posts, and reviews via mavis-gmb-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "gmb-agent", output: "Manage Google My Business. Example: 'gmb post: new summer collection available' or 'show my GMB reviews'" };
  }
  const action = input.replace(/^(gmb|google my business|gmb agent)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-gmb-agent", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.post ?? data?.reviews ?? data?.status ?? data?.output;
    return { skillName: "gmb-agent", output: result ? `📍 **Google My Business:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "gmb-agent", output: `GMB error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "gmb-agent",
  description: "Manages Google My Business — posts updates, monitors reviews, and updates business info",
  keywords: [
    "google my business", "gmb", "google business", "business listing",
    "gmb post", "gmb reviews", "local seo", "google maps listing",
  ],
}, handler);
