// Skill registry — register, discover, and invoke MAVIS skills

import { supabase } from "@/integrations/supabase/client";

export interface SkillContext {
  userId: string;
  mode: string;
  appData?: Record<string, unknown>;
}

export interface SkillResult {
  skillName: string;
  output: string;
  data?: unknown;
}

export type SkillHandler = (ctx: SkillContext, input?: string) => Promise<SkillResult>;

export interface SkillDefinition {
  name: string;
  description: string;
  keywords: string[];
}

interface RegisteredSkill {
  definition: SkillDefinition;
  handler: SkillHandler;
}

const _registry = new Map<string, RegisteredSkill>();

// Tracks which skill names came from the DB (for selective removal on refresh)
const _runtimeSkillNames = new Set<string>();

export function registerSkill(definition: SkillDefinition, handler: SkillHandler): void {
  _registry.set(definition.name, { definition, handler });
}

export function getSkill(name: string): RegisteredSkill | undefined {
  return _registry.get(name);
}

export function getAllSkills(): SkillDefinition[] {
  return [..._registry.values()].map(s => s.definition);
}

export function matchSkillByKeyword(input: string): string | null {
  const lower = input.toLowerCase();
  for (const [name, { definition }] of _registry.entries()) {
    if (definition.keywords.some(kw => lower.includes(kw.toLowerCase()))) {
      return name;
    }
  }
  return null;
}

export async function invokeSkill(name: string, ctx: SkillContext, input?: string): Promise<SkillResult | null> {
  const skill = _registry.get(name);
  if (!skill) return null;
  try {
    return await skill.handler(ctx, input);
  } catch (err) {
    console.warn(`[Skill:${name}] Error:`, err);
    return { skillName: name, output: `Skill error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Loads DB-backed runtime skills for the given user from mavis_skill_definitions
 * and registers them in the registry. Safe to call multiple times — call
 * clearRuntimeSkills() first if you want a clean refresh.
 */
export async function loadRuntimeSkills(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("mavis_skill_definitions")
    .select("name, description, keywords, prompt_template")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    console.error("[loadRuntimeSkills] Failed to load skill definitions:", error);
    return;
  }

  if (!data || data.length === 0) return;

  for (const definition of data) {
    const skillName: string = definition.name;
    const promptTemplate: string = definition.prompt_template;

    const handler: SkillHandler = async (_ctx: SkillContext, input?: string): Promise<SkillResult> => {
      const { data: fnData, error: fnError } = await supabase.functions.invoke("mavis-chat", {
        body: {
          messages: [{ role: "user", content: input ?? "invoke" }],
          systemPrompt: promptTemplate,
          mode: "PRIME",
          chatKind: "skill",
        },
      });

      if (fnError) {
        console.warn(`[Skill:${skillName}] Edge function error:`, fnError);
        return { skillName, output: `Skill error: ${fnError.message ?? String(fnError)}` };
      }

      return {
        skillName,
        output: fnData?.content ?? "[No output]",
      };
    };

    registerSkill(
      {
        name: skillName,
        description: definition.description,
        keywords: definition.keywords ?? [],
      },
      handler
    );

    _runtimeSkillNames.add(skillName);
  }
}

/**
 * Removes all DB-backed (runtime) skills from the registry.
 * Call this before loadRuntimeSkills() to perform a clean refresh.
 */
export function clearRuntimeSkills(): void {
  for (const name of _runtimeSkillNames) {
    _registry.delete(name);
  }
  _runtimeSkillNames.clear();
}
