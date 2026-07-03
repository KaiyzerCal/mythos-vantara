// SKILL: proposal-gen
// Pattern from 500-AI-Agents #18 — job application / partnership materials generator.
// Creates proposals, grants, partnership pitches, press kits, and application packages.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "proposal-gen", output: "Tell me what you're applying for or proposing — I'll generate a full package: pitch, key points, objection handling, and tailored messaging." };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-content-pipeline", {
      body: { userId: ctx.userId, brief: input.trim(), type: "proposal" },
    });
    if (error) throw error;
    return { skillName: "proposal-gen", output: data?.content ?? data?.output ?? JSON.stringify(data) };
  } catch {
    const { data, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: input }],
        systemPrompt: "You are an expert proposal writer. Generate a complete, compelling proposal or application package based on the user's brief. Include: (1) executive summary / hook, (2) the core value proposition, (3) key differentiators, (4) relevant proof points or credentials, (5) clear ask or call to action. Tailor the tone to the specific audience (investor, press, partner, grant committee, etc.).",
        mode: "SOVEREIGN",
        chatKind: "skill",
      },
    });
    if (chatErr) throw chatErr;
    return { skillName: "proposal-gen", output: data?.content ?? "[No output]" };
  }
};

registerSkill({
  name: "proposal-gen",
  description: "Generates proposals, grant applications, partnership pitches, and application materials",
  keywords: [
    "write a proposal", "create a pitch", "proposal for", "grant application",
    "partnership pitch", "write an application", "create a pitch deck", "pitch this",
    "proposal template", "apply for", "press kit", "sponsorship proposal",
  ],
}, handler);
