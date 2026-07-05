// SKILL: newsletter-gen-actor
// AI newsletter generator on any topic via Apify louisdeconinck/ai-newsletter-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "newsletter-gen-actor", output: "Generate a newsletter. Example: 'newsletter on AI trends this week' or 'generate newsletter: crypto markets'" };
  }
  const topic = input.replace(/^(newsletter on|generate newsletter|newsletter about|newsletter)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "louisdeconinck/ai-newsletter-agent", input: { topic }, timeout: 120 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.newsletter ?? data;
    return { skillName: "newsletter-gen-actor", output: result ? `📰 **Newsletter Draft:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 6000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "newsletter-gen-actor", output: `Newsletter gen error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "newsletter-gen-actor",
  description: "AI newsletter generator — researches and writes a full newsletter on any topic",
  keywords: [
    "newsletter generator", "generate newsletter", "newsletter on topic",
    "ai newsletter", "write newsletter", "newsletter draft", "newsletter agent",
  ],
}, handler);
