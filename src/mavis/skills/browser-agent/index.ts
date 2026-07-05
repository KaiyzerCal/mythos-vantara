// SKILL: browser-agent
// Full browser automation — navigate, fill forms, click, extract via mavis-browser-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "browser-agent", output: "Tell me what to do in a browser. Example: 'go to amazon.com and find the price of AirPods' or 'fill out this form at [url]'" };
  }
  const urlMatch = input.match(/https?:\/\/[^\s]+/);
  try {
    const { data, error } = await supabase.functions.invoke("mavis-browser-agent", {
      body: { task: input.trim(), url: urlMatch?.[0] ?? null },
    });
    if (error) throw error;
    const result = data?.result ?? data?.output ?? data?.content ?? data?.extracted;
    return { skillName: "browser-agent", output: result ? `🌐 **Browser Result:**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "browser-agent", output: `Browser agent error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "browser-agent",
  description: "Automates browser tasks — navigate, extract, fill forms, click buttons",
  keywords: [
    "browse to", "go to the website", "navigate to", "open browser",
    "click on", "fill out the form", "find on the page", "extract from site",
    "check the website", "look up on", "browser automation", "web automation",
  ],
}, handler);
