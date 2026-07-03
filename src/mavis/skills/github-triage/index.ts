// SKILL: github-triage
// Pattern from 500-AI-Agents #07 — GitHub issue triager.
// Assigns severity, category, labels, and routing for incoming GitHub issues.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "github-triage", output: "Paste a GitHub issue title + description and I'll assign severity, category, suggested labels, and routing." };
  }
  const { data, error } = await supabase.functions.invoke("mavis-chat", {
    body: {
      messages: [{ role: "user", content: input }],
      systemPrompt: `You are a senior engineering triage specialist. Analyze the provided GitHub issue and output:

**SEVERITY:** [CRITICAL / HIGH / MEDIUM / LOW]
**CATEGORY:** [Bug / Feature Request / Performance / Security / Documentation / Question / Enhancement]
**LABELS:** [comma-separated suggested GitHub labels]
**ASSIGN TO:** [suggested team: Frontend / Backend / DevOps / Product / Security / N/A]
**PRIORITY QUEUE:** [immediate / this sprint / next sprint / backlog]

**Triage Summary:** [2-3 sentences explaining severity and routing rationale]

**Reproduction Steps Needed:** [Yes / No]
**Blockers Identified:** [list any upstream dependencies or blockers]`,
      mode: "CODEX",
      chatKind: "skill",
    },
  });
  if (error) throw error;
  return { skillName: "github-triage", output: data?.content ?? "[No output]" };
};

registerSkill({
  name: "github-triage",
  description: "Triages GitHub issues — assigns severity, category, labels, routing, and priority queue position",
  keywords: [
    "triage this issue", "github issue", "classify this issue", "severity of this bug",
    "label this issue", "triage", "categorize this issue", "how urgent is this",
    "issue triage", "bug severity", "prioritize this issue",
  ],
}, handler);
