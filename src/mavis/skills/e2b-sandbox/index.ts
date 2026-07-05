// SKILL: e2b-sandbox
// Runs code in a secure E2B cloud sandbox environment via mavis-e2b-sandbox.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "e2b-sandbox", output: "Run code in E2B sandbox. Example: 'e2b: import pandas as pd; df = pd.read_csv(\"data.csv\"); print(df.head())'" };
  }
  const code = input.replace(/^(e2b|e2b sandbox|sandbox run|run in sandbox)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-e2b-sandbox", {
      body: { code, language: "python" },
    });
    if (error) throw error;
    const result = data?.output ?? data?.stdout ?? data?.result;
    return { skillName: "e2b-sandbox", output: result ? `📦 **E2B Sandbox:**\n\n\`\`\`\n${String(result).slice(0, 4000)}\n\`\`\`` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "e2b-sandbox", output: `E2B sandbox error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "e2b-sandbox",
  description: "Runs code in a secure E2B cloud sandbox — data analysis, scripts, file processing",
  keywords: [
    "e2b", "e2b sandbox", "sandbox run", "cloud sandbox", "run in sandbox",
    "secure code run", "e2b code", "cloud code execution",
  ],
}, handler);
