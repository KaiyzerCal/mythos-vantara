// SKILL: zendesk-agent
// Zendesk customer support ticket management via Apify MCP server amaranth_nylon/zendesk-mcp-server-actor.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "zendesk-agent", output: "Manage Zendesk tickets. Example: 'zendesk list open tickets' or 'zendesk reply to ticket 1234: [reply]' or 'zendesk ticket summary'" };
  }
  const query = input.replace(/^(zendesk)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "amaranth_nylon/zendesk-mcp-server-actor", input: { query, user_id: ctx.userId }, timeout: 60 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.tickets ?? data;
    return { skillName: "zendesk-agent", output: result ? `🎫 **Zendesk:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "zendesk-agent", output: `Zendesk error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "zendesk-agent",
  description: "Zendesk ticket management — list, reply, escalate, and summarize support tickets",
  keywords: [
    "zendesk", "zendesk tickets", "support tickets", "zendesk reply",
    "customer support tickets", "zendesk manage", "zendesk agent",
  ],
}, handler);
