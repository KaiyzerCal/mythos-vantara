// SKILL: terminal
// Executes shell commands in a sandboxed terminal environment via mavis-terminal.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "terminal", output: "Run a terminal command. Example: 'terminal: ls -la' or 'run command: git log --oneline -10'" };
  }
  const command = input.replace(/^(terminal|run command|exec|shell)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-terminal", {
      body: { command, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.output ?? data?.stdout ?? data?.result;
    return { skillName: "terminal", output: result ? `💻 **Terminal:**\n\n\`\`\`\n${String(result).slice(0, 4000)}\n\`\`\`` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "terminal", output: `Terminal error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "terminal",
  description: "Executes shell commands in a sandboxed environment and returns output",
  keywords: [
    "terminal", "run command", "shell command", "execute command", "bash command",
    "terminal command", "run shell", "exec command", "cli command",
  ],
}, handler);
