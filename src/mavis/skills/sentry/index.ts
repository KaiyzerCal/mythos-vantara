// SKILL: sentry
// Queries and triages Sentry errors and performance issues via mavis-sentry-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "sentry", output: "Check Sentry errors. Example: 'sentry errors today' or 'sentry: show critical issues in my-app'" };
  }
  const query = input.replace(/^(sentry|sentry errors|sentry issues|check sentry)\s*:?\s*/i, "").trim() || "recent errors";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-sentry-agent", {
      body: { query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.issues ?? data?.errors ?? data?.output;
    return { skillName: "sentry", output: result ? `🚨 **Sentry:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "sentry", output: `Sentry error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "sentry",
  description: "Queries and triages Sentry error tracking — shows issues, performance problems, and alerts",
  keywords: [
    "sentry", "sentry errors", "sentry issues", "error tracking", "check sentry",
    "sentry alerts", "app errors", "production errors", "sentry performance",
  ],
}, handler);
