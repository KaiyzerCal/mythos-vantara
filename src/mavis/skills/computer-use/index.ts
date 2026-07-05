// SKILL: computer-use
// Uses Claude computer-use to automate desktop tasks via mavis-computer-use.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "computer-use", output: "Automate desktop tasks using AI. Example: 'computer use: open browser and fill out this form at [url]' or 'automate: copy all emails from today into a doc'" };
  }
  const task = input.replace(/^(computer use|automate|use computer|desktop task)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-computer-use", {
      body: { task },
    });
    if (error) throw error;
    const result = data?.result ?? data?.output ?? data?.actions;
    return { skillName: "computer-use", output: result ? `🖥️ **Computer Use:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "computer-use", output: `Computer use error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "computer-use",
  description: "Automates desktop tasks using Claude's computer-use capability — click, type, navigate",
  keywords: [
    "computer use", "automate on screen", "desktop automation", "use my computer",
    "click and fill", "screen automation", "automate this task",
    "control the browser", "computer automation",
  ],
}, handler);
