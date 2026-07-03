// SKILL: code-review
// Pattern from 500-AI-Agents #02 — bug/security/performance analysis.
// Calls mavis-code-agent with review mode; falls back to direct LLM.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "code-review", output: "Paste the code you want reviewed and I'll check for bugs, security issues, performance problems, and style violations." };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-code-agent", {
      body: { task: `Review this code for bugs, security issues, performance problems, and style violations. Rank findings by severity.\n\n${input.trim()}`, mode: "review" },
    });
    if (error) throw error;
    return { skillName: "code-review", output: data?.result ?? data?.output ?? data?.content ?? JSON.stringify(data) };
  } catch {
    const { data, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: input }],
        systemPrompt: "You are a senior code reviewer. Analyze the provided code for: (1) bugs and logic errors, (2) security vulnerabilities (OWASP top 10), (3) performance issues, (4) code style and maintainability. Rank each finding as CRITICAL/HIGH/MEDIUM/LOW. Be specific — include line references and suggested fixes.",
        mode: "CODEX",
        chatKind: "skill",
      },
    });
    if (chatErr) throw chatErr;
    return { skillName: "code-review", output: data?.content ?? "[No output]" };
  }
};

registerSkill({
  name: "code-review",
  description: "Reviews code for bugs, security vulnerabilities, performance issues, and style violations — severity-ranked",
  keywords: [
    "review this code", "code review", "check this code", "audit this code",
    "find bugs", "security review", "is this code safe", "code audit",
    "review my function", "check my code", "what's wrong with this code",
  ],
}, handler);
