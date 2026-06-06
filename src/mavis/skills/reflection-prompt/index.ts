import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const PROMPTS_BY_MOOD: Record<string, string[]> = {
  great: [
    "What specifically drove today's peak state? How do you replicate it?",
    "What belief did you validate today that you want to cement?",
    "Who contributed to today's momentum — and have you acknowledged them?",
  ],
  good: [
    "What is one thing you could have done better today?",
    "What are you building right now that your future self will thank you for?",
    "Where did you spend energy that didn't move the mission forward?",
  ],
  okay: [
    "What friction are you tolerating that you should eliminate?",
    "Is your current trajectory aligned with your stated goals?",
    "What one action tomorrow would create the most leverage?",
  ],
  low: [
    "What is the root cause of today's drag — energy, clarity, or environment?",
    "What does the strongest version of you do when they feel this way?",
    "Which commitments are draining you most right now?",
  ],
  bad: [
    "What truth are you avoiding looking at directly?",
    "What would need to change for tomorrow to be categorically different?",
    "Who can you talk to that will cut through the noise?",
  ],
  tired: [
    "What recovery protocol are you neglecting?",
    "Are you working on the right things or just working hard?",
    "What is the minimum viable action that still moves you forward today?",
  ],
  motivated: [
    "What is the highest-leverage use of this energy right now?",
    "Which dormant goal deserves attention while you are in this state?",
    "How do you build a system to access this state on demand?",
  ],
  focused: [
    "What is the one deliverable you commit to completing in this session?",
    "What are you intentionally ignoring to protect this focus?",
    "How do you measure the quality of this focus block afterward?",
  ],
};

const FALLBACK_PROMPTS = [
  "What is the single most important thing you should be working on right now?",
  "What pattern are you repeating that is keeping you stuck?",
  "If you had perfect clarity, what would you stop doing immediately?",
  "What conversation are you avoiding that needs to happen?",
  "What does the gap between who you are and who you intend to be look like?",
];

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const uid = ctx.userId;
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const { data: entries } = await supabase
      .from("journal_entries")
      .select("mood, title, created_at")
      .eq("user_id", uid)
      .gte("created_at", since.toISOString())
      .not("mood", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);

    const moodCounts: Record<string, number> = {};
    for (const e of entries ?? []) {
      if (e.mood) moodCounts[e.mood] = (moodCounts[e.mood] ?? 0) + 1;
    }

    const dominantMood = Object.entries(moodCounts).sort(([, a], [, b]) => b - a)[0]?.[0];
    const prompts = dominantMood ? (PROMPTS_BY_MOOD[dominantMood] ?? FALLBACK_PROMPTS) : FALLBACK_PROMPTS;
    const selected = prompts[Math.floor(Math.random() * prompts.length)];

    const moodContext = dominantMood
      ? `Based on your recent mood pattern (${dominantMood}), here is your reflection prompt:\n\n`
      : "Reflection prompt:\n\n";

    return {
      skillName: "reflection-prompt",
      output: `${moodContext}— ${selected}\n\nTake 5 minutes. Write without filtering. The answer is already there.`,
    };
  } catch (err) {
    return { skillName: "reflection-prompt", output: `Reflection unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "reflection-prompt",
  description: "Generates a targeted reflection question based on recent journal mood patterns",
  keywords: ["reflect", "reflection", "journal prompt", "think about", "introspect", "meditate", "what should i reflect on", "give me a prompt"],
}, handler);
