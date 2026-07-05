// SKILL: cloud-browser
// Launches a cloud-hosted browser session for web automation via mavis-browser.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "cloud-browser", output: "Launch cloud browser. Example: 'open browser https://app.com' or 'browser session for https://dashboard.example.com'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? input.replace(/^(open browser|browser session|cloud browser)\s*(for\s+)?/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-browser", {
      body: { url, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.session ?? data?.screenshot ?? data?.output;
    return { skillName: "cloud-browser", output: result ? `🌐 **Cloud Browser:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "cloud-browser", output: `Cloud browser error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "cloud-browser",
  description: "Launches a cloud-hosted browser session for web automation and screenshots",
  keywords: [
    "cloud browser", "open browser", "browser session", "web automation",
    "browser automation", "headless browser", "take screenshot",
  ],
}, handler);
