import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { saveTacit } from "../../memoryEngine";

const handler: SkillHandler = async (_ctx, input) => {
  if (!input) return { skillName: "knowledge-extract", output: "No input to extract from." };

  // Parse "remember that X" patterns and save to Layer 3
  const lower = input.toLowerCase();
  let key = input.slice(0, 80);
  let value = input;
  let category: "preference" | "hard_rule" | "lesson_learned" | "workflow_habit" = "preference";

  if (lower.includes("never ") || lower.includes("always ") || lower.includes("hard rule")) {
    category = "hard_rule";
  } else if (lower.includes("lesson") || lower.includes("learned") || lower.includes("mistake")) {
    category = "lesson_learned";
  } else if (lower.includes("habit") || lower.includes("workflow") || lower.includes("process")) {
    category = "workflow_habit";
  }

  // Strip trigger phrases from key
  key = key
    .replace(/^(remember that|note that|always remember|never forget|add to memory|important:|i prefer|i like|i want)/i, "")
    .trim()
    .slice(0, 80);

  await saveTacit({ category, key, value, source: "user_explicit", confidence: 8 });

  return {
    skillName: "knowledge-extract",
    output: `Noted. Saved to memory as a ${category.replace("_", " ")}: "${key}"`,
  };
};

registerSkill({
  name: "knowledge-extract",
  description: "Saves important facts, preferences, and rules mid-conversation into Layer 3 tacit memory",
  keywords: ["remember that", "note that", "always remember", "never forget", "add to memory", "important:", "i prefer", "keep in mind"],
}, handler);
