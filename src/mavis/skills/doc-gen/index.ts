// SKILL: doc-gen
// Pattern from 500-AI-Agents #16 — documentation writer.
// Generates READMEs, API references, and inline docs from code or descriptions.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "doc-gen", output: "Paste code or describe a module/system and I'll generate README, API docs, or inline documentation for it." };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-code-agent", {
      body: { task: `Generate complete documentation for this. Include: overview, parameters/props, return values, usage examples, and edge cases.\n\n${input.trim()}`, mode: "document" },
    });
    if (error) throw error;
    return { skillName: "doc-gen", output: data?.result ?? data?.output ?? data?.content ?? JSON.stringify(data) };
  } catch {
    const { data, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: input }],
        systemPrompt: "You are a technical writer. Generate clear, complete documentation for the provided code or system. Format output as clean Markdown. Include: description, parameters (type + description), return values, usage examples, and any important notes or gotchas.",
        mode: "CODEX",
        chatKind: "skill",
      },
    });
    if (chatErr) throw chatErr;
    return { skillName: "doc-gen", output: data?.content ?? "[No output]" };
  }
};

registerSkill({
  name: "doc-gen",
  description: "Generates README files, API documentation, and inline code comments from code or descriptions",
  keywords: [
    "write documentation", "generate docs", "create a readme", "document this",
    "write a readme", "api docs", "document this code", "generate documentation",
    "write docs for", "create documentation", "document my function",
  ],
}, handler);
