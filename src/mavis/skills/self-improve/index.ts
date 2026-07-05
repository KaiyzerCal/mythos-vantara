// SKILL: self-improve
// Uses LLM to review and suggest improvements to source code files via mavis-self-improve.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "self-improve", output: "Give me a file path and improvement goal. Example: 'improve src/mavis/agent.ts for better error handling' — I'll review it and suggest optimizations without auto-applying." };
  }
  const fileMatch = input.match(/src\/[\w/.-]+|supabase\/[\w/.-]+\.ts/);
  const filePath = fileMatch?.[0] ?? null;
  const goal = filePath ? input.replace(fileMatch![0], "").replace(/^(improve|optimize|refactor|enhance|fix)\s*/i, "").trim() || "Improve overall code quality" : input;
  if (!filePath) return { skillName: "self-improve", output: "Please specify a file path. Example: 'improve src/mavis/specialistDispatcher.ts for better routing'" };
  try {
    const { data, error } = await supabase.functions.invoke("mavis-self-improve", {
      body: { file: filePath, goal },
    });
    if (error) throw error;
    const improved = data?.improvedCode ?? data?.suggestions ?? data?.output;
    return { skillName: "self-improve", output: improved ? `⚡ **Improvements for ${filePath}:**\n\nGoal: ${goal}\n\n\`\`\`typescript\n${String(improved).slice(0, 6000)}\n\`\`\`` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "self-improve", output: `Self-improve error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "self-improve",
  description: "Reviews and suggests AI-powered improvements to source code files",
  keywords: [
    "improve this file", "optimize this code", "refactor", "self improve",
    "improve src/", "enhance this function", "code suggestions",
    "improve the code", "ai code review", "suggest improvements",
  ],
}, handler);
