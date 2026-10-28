// _shared/voiceTools.ts
// Function-calling tool definitions for the realtime voice surfaces
// (mavis-voice-session → OpenAI Realtime, mavis-live-voice → Gemini Live).
//
// Before this, both realtime voice paths sent `tools: []` (Gemini Live) or no
// tools array at all (OpenAI Realtime session), so neither could ever emit a
// create_quest/update_quest/create_skill/etc. call no matter how good the
// system prompt was — they could only talk. This is the same action set the
// text/tap-to-speak-voice path already executes via mavis-actions, scoped to
// what's realistic to drive by voice: quests and skills, which is also where
// quest-skill linking lives.
//
// One canonical, provider-neutral spec per action; each provider's function-
// calling schema is close enough to JSON Schema that a single spec converts
// to both without drift.
interface VoiceToolParam {
  type: "string" | "number" | "boolean" | "array";
  description: string;
  enum?: string[];
  items?: { type: "string" };
}

interface VoiceToolSpec {
  name: string;
  description: string;
  params: Record<string, VoiceToolParam>;
  required: string[];
}

export const VOICE_TOOL_SPECS: VoiceToolSpec[] = [
  {
    name: "create_quest",
    description: "Create a new quest. Use linked_skill_ids to tie it to one or more skills from the SKILLS/BEYONDER PATHWAYS context so completing it raises their proficiency.",
    params: {
      title: { type: "string", description: "Quest title" },
      description: { type: "string", description: "Quest description" },
      quest_type: { type: "string", description: "daily (recurring), side (one-off), main (major goal), or epic (long-term arc)", enum: ["daily", "side", "main", "epic"] },
      difficulty: { type: "string", description: "Quest difficulty", enum: ["Easy", "Normal", "Hard", "Extreme", "Impossible"] },
      xp_reward: { type: "number", description: "XP awarded on completion" },
      linked_skill_ids: { type: "array", description: "Exact skill/subskill ids (from context) this quest trains. Never invent an id.", items: { type: "string" } },
    },
    required: ["title"],
  },
  {
    name: "update_quest",
    description: "Update an existing quest, including (re)linking it to skills via linked_skill_ids.",
    params: {
      quest_id: { type: "string", description: "Exact id of the quest to update, from context" },
      title: { type: "string", description: "New title" },
      status: { type: "string", description: "New status", enum: ["active", "completed", "failed"] },
      progress_current: { type: "number", description: "Current progress value" },
      progress_target: { type: "number", description: "Target progress value" },
      linked_skill_ids: { type: "array", description: "Exact skill/subskill ids this quest should be linked to (replaces the existing set). Never invent an id.", items: { type: "string" } },
    },
    required: ["quest_id"],
  },
  {
    name: "complete_quest",
    description: "Mark a quest as completed. Awards its XP and raises proficiency on every linked skill automatically.",
    params: {
      quest_id: { type: "string", description: "Exact id of the quest to complete, from context" },
    },
    required: ["quest_id"],
  },
  {
    name: "delete_quest",
    description: "Delete a quest permanently.",
    params: {
      quest_id: { type: "string", description: "Exact id of the quest to delete, from context" },
    },
    required: ["quest_id"],
  },
  {
    name: "create_skill",
    description: "Create a new root-level skill (a pathway). For a sub-skill under an existing skill, use create_subskill instead.",
    params: {
      name: { type: "string", description: "Skill name" },
      description: { type: "string", description: "Skill description" },
      category: { type: "string", description: "Skill category, e.g. Beyonder, Combat, Technical" },
      energy_type: { type: "string", description: "Energy type, e.g. Ki, Cursed Energy, Nen" },
      tier: { type: "number", description: "Skill tier" },
    },
    required: ["name"],
  },
  {
    name: "create_subskill",
    description: "Create a sub-skill nested under an existing parent skill.",
    params: {
      name: { type: "string", description: "Sub-skill name" },
      description: { type: "string", description: "Sub-skill description" },
      category: { type: "string", description: "Category, usually matching the parent's" },
      parent_skill_id: { type: "string", description: "Exact id of the parent skill, from context. Never invent an id." },
    },
    required: ["name", "parent_skill_id"],
  },
  {
    name: "update_skill",
    description: "Update an existing skill or sub-skill, e.g. raise proficiency or unlock it.",
    params: {
      skill_id: { type: "string", description: "Exact id of the skill to update, from context" },
      proficiency: { type: "number", description: "New proficiency percent (0-100)" },
      unlocked: { type: "boolean", description: "Whether the skill is unlocked" },
      name: { type: "string", description: "New name" },
      description: { type: "string", description: "New description" },
    },
    required: ["skill_id"],
  },
  {
    name: "delete_skill",
    description: "Delete a skill or sub-skill permanently.",
    params: {
      skill_id: { type: "string", description: "Exact id of the skill to delete, from context" },
    },
    required: ["skill_id"],
  },
];

// ── OpenAI Realtime API ──────────────────────────────────────────────────────
// https://platform.openai.com/docs/guides/realtime — session.tools entries are
// flat {type:"function", name, description, parameters:<json-schema>} objects.
export function toOpenAIRealtimeTools(): unknown[] {
  return VOICE_TOOL_SPECS.map((spec) => ({
    type: "function",
    name: spec.name,
    description: spec.description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(spec.params).map(([key, p]) => [
          key,
          p.type === "array"
            ? { type: "array", items: p.items, description: p.description }
            : { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}) },
        ]),
      ),
      required: spec.required,
    },
  }));
}

// ── Gemini Live API ──────────────────────────────────────────────────────────
// function_declarations use upper-case JSON Schema type names (OBJECT/STRING/...).
const GEMINI_TYPE: Record<VoiceToolParam["type"], string> = {
  string: "STRING",
  number: "NUMBER",
  boolean: "BOOLEAN",
  array: "ARRAY",
};

export function toGeminiFunctionDeclarations(): unknown[] {
  return VOICE_TOOL_SPECS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: {
      type: "OBJECT",
      properties: Object.fromEntries(
        Object.entries(spec.params).map(([key, p]) => [
          key,
          p.type === "array"
            ? { type: "ARRAY", items: { type: "STRING" }, description: p.description }
            : { type: GEMINI_TYPE[p.type], description: p.description, ...(p.enum ? { enum: p.enum } : {}) },
        ]),
      ),
      required: spec.required,
    },
  }));
}
