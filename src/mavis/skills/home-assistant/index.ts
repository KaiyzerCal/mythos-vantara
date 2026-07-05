// SKILL: home-assistant
// Home Assistant smart home control via Apify MCP server parseforge/home-assistant-mcp-server.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "home-assistant", output: "Control smart home. Example: 'turn on living room lights' or 'home assistant: set thermostat to 72' or 'lock front door'" };
  }
  const command = input.replace(/^(home assistant|ha)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "parseforge/home-assistant-mcp-server", input: { command, user_id: ctx.userId }, timeout: 30 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.result ?? data;
    return { skillName: "home-assistant", output: result ? `🏠 **Home Assistant:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "home-assistant", output: `Home Assistant error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "home-assistant",
  description: "Home Assistant smart home control — lights, thermostat, locks, automations",
  keywords: [
    "home assistant", "smart home", "turn on lights", "thermostat", "lock door",
    "home automation", "ha control", "smart home control",
  ],
}, handler);
