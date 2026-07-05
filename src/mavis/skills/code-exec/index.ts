// SKILL: code-exec
// Multi-language sandboxed code execution: Python/Node/TypeScript/Bash via mavis-code-exec.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "code-exec", output: "Execute code in any language. Example: 'exec python: import json; print(json.dumps({\"hello\": \"world\"}))' or 'run node: console.log(process.version)'" };
  }
  const lang = /python/i.test(input) ? "python" : /node|javascript|js/i.test(input) ? "javascript" : /typescript|ts/i.test(input) ? "typescript" : /bash|shell/i.test(input) ? "bash" : "python";
  const code = input.replace(/^(exec|run|code exec|execute)\s*(python|node|javascript|typescript|bash|shell)?\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-code-exec", {
      body: { code, language: lang },
    });
    if (error) throw error;
    const stdout = data?.output ?? data?.stdout ?? data?.result;
    const stderr = data?.stderr ?? data?.error;
    const out = [stdout && `Output:\n${stdout}`, stderr && `Stderr:\n${stderr}`].filter(Boolean).join("\n\n") || JSON.stringify(data);
    return { skillName: "code-exec", output: `💻 **${lang} Output:**\n\n\`\`\`\n${String(out).slice(0, 4000)}\n\`\`\`` };
  } catch (err) {
    return { skillName: "code-exec", output: `Code exec error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "code-exec",
  description: "Multi-language sandboxed code execution — Python, Node.js, TypeScript, Bash",
  keywords: [
    "exec python", "exec node", "exec typescript", "exec bash", "run code",
    "execute code", "code exec", "code sandbox", "run javascript",
  ],
}, handler);
