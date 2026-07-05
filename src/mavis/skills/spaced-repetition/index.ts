// SKILL: spaced-repetition
// Schedules spaced repetition reviews for faster, lasting learning via mavis-spaced-repetition.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "spaced-repetition", output: "Schedule reviews for what you're learning. Example: 'add to spaced repetition: Spanish vocabulary' or 'what should I review today?'" };
  }
  const isDue = /review today|what should i review|due today|review queue/i.test(input);
  const action = isDue ? "get_due" : "add";
  const topic = input.replace(/^(add to spaced repetition|sr add|schedule review for)\s*:?\s*/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-spaced-repetition", {
      body: { action, topic: action === "add" ? topic : undefined, user_id: ctx.userId },
    });
    if (error) throw error;
    const due = data?.due_items ?? data?.reviews ?? [];
    if (isDue && Array.isArray(due) && due.length > 0) {
      const list = due.map((item: any) => `• **${item.topic ?? item.title}** — last reviewed: ${item.last_reviewed ?? "never"}`).join("\n");
      return { skillName: "spaced-repetition", output: `🔄 **Due for Review (${due.length}):**\n${list}` };
    }
    return { skillName: "spaced-repetition", output: data?.output ?? (action === "add" ? `📚 Added "${topic}" to your spaced repetition schedule.` : "Nothing due today — you're caught up!") };
  } catch (err) {
    return { skillName: "spaced-repetition", output: `Spaced repetition error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "spaced-repetition",
  description: "Schedules spaced repetition review sessions for any topic you're learning",
  keywords: [
    "spaced repetition", "review schedule", "what to review today",
    "add to review", "learning queue", "review this", "scheduled learning",
    "anki style", "memorize with review", "review flashcards",
  ],
}, handler);
