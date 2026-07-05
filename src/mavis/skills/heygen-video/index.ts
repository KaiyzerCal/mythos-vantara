// SKILL: heygen-video
// Creates talking avatar/presenter videos via mavis-heygen-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "heygen-video", output: "Give me a script or topic and I'll create a talking avatar video. Example: 'create a HeyGen video explaining our product'" };
  }
  const script = input.replace(/^(create|make|generate)\s+(a\s+)?(heygen|avatar|presenter|talking head)\s+(video\s+)?(about|saying|explaining|for)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-heygen-agent", {
      body: { script, avatar_id: null },
    });
    if (error) throw error;
    const url = data?.video_url ?? data?.url ?? data?.output;
    const status = data?.status;
    return {
      skillName: "heygen-video",
      output: url
        ? `🎥 **Avatar Video Ready:**\n\n[Watch Video](${url})`
        : (status ? `⏳ Video is being rendered (status: ${status}). Check back in a few minutes.` : JSON.stringify(data)),
    };
  } catch (err) {
    return { skillName: "heygen-video", output: `HeyGen error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "heygen-video",
  description: "Creates AI talking avatar videos with lip-synced presenters",
  keywords: [
    "heygen", "avatar video", "talking head video", "presenter video",
    "create avatar", "lip sync video", "ai spokesperson", "digital avatar",
    "talking avatar", "video presenter", "ai anchor",
  ],
}, handler);
