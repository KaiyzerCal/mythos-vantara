// SKILL: python-run
// Executes Python code in a sandboxed environment via mavis-python-exec.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "python-run", output: "Run Python code. Example: 'python: print([i**2 for i in range(10)])' or 'run python script: calculate compound interest'" };
  }
  const code = input.replace(/^(python|run python|execute python|python run)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-python-exec", {
      body: { code },
    });
    if (error) throw error;
    const result = data?.output ?? data?.result ?? data?.stdout;
    const stderr = data?.stderr ?? data?.error;
    const out = [result && `Output:\n${result}`, stderr && `Errors:\n${stderr}`].filter(Boolean).join("\n\n") || JSON.stringify(data);
    return { skillName: "python-run", output: `🐍 **Python:**\n\n\`\`\`\n${String(out).slice(0, 4000)}\n\`\`\`` };
  } catch (err) {
    return { skillName: "python-run", output: `Python exec error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "python-run",
  description: "Executes Python code in a sandboxed environment — great for data processing and calculations",
  keywords: [
    "python", "run python", "execute python", "python script", "python code",
    "python run", "python exec", "run script python", "calculate with python",
  ],
}, handler);
