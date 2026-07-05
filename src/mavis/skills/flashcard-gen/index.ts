// SKILL: flashcard-gen
// Generates study flashcards on any topic via mavis-flashcard-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "flashcard-gen", output: "Give me a topic and I'll create study flashcards. Example: 'flashcards for the French Revolution' or 'make flashcards on React hooks'" };
  }
  const topic = input.replace(/^(make|create|generate|build)\s+(flashcards?|study cards?|quiz cards?)\s+(for|on|about)?\s*/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-flashcard-agent", {
      body: { topic, count: 10, user_id: ctx.userId },
    });
    if (error) throw error;
    const cards = data?.flashcards ?? data?.cards ?? data?.result;
    if (Array.isArray(cards) && cards.length > 0) {
      const formatted = cards.map((c: any, i: number) =>
        `**Q${i + 1}: ${c.question ?? c.front}**\n→ ${c.answer ?? c.back}`
      ).join("\n\n");
      return { skillName: "flashcard-gen", output: `🗂️ **${cards.length} Flashcards: ${topic}**\n\n${formatted}` };
    }
    return { skillName: "flashcard-gen", output: data?.output ?? JSON.stringify(data) };
  } catch (err) {
    return { skillName: "flashcard-gen", output: `Flashcard generation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "flashcard-gen",
  description: "Generates study flashcards on any topic for active recall learning",
  keywords: [
    "flashcards", "study cards", "make flashcards", "create flashcards",
    "quiz cards", "spaced repetition", "study for", "help me study",
    "review cards", "test myself on", "memorize", "practice questions",
  ],
}, handler);
