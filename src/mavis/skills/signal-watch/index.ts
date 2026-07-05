// SKILL: signal-watch
// Configures and monitors signals (RSS, market, keyword alerts) with AI reasoning via mavis-signal-watcher.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "signal-watch", output: "Monitor signals. Example: 'watch signal: any news about OpenAI funding' or 'signal alert: when bitcoin drops below $80k' or 'show my signals'" };
  }
  const action = /show|list|my signals/i.test(input) ? "list" : /add|watch|monitor|create/i.test(input) ? "add" : /delete|remove|stop/i.test(input) ? "delete" : "list";
  const signal = input.replace(/^(watch signal|signal alert|signal watch|add signal|monitor signal|show signals|my signals)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-signal-watcher", {
      body: { action, signal, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.signals ?? data?.status ?? data?.output;
    return { skillName: "signal-watch", output: result ? `📡 **Signal Watch:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "signal-watch", output: `Signal watch error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "signal-watch",
  description: "Configures and monitors custom signals — market moves, keyword alerts, RSS triggers — with AI reasoning when fired",
  keywords: [
    "signal watch", "watch signal", "signal alert", "monitor signal", "add signal",
    "market alert", "keyword alert", "signal monitor", "my signals", "watch for",
  ],
}, handler);
