// Skill registry — register, discover, and invoke MAVIS skills

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
