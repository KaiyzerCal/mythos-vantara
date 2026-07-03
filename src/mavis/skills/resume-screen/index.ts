// SKILL: resume-screen
// Pattern from 500-AI-Agents #09 — resume parser + candidate fit scorer.
// Scores candidate fit 0-100 against a job/role description with Hire/Consider/Pass verdict.
// Also handles 500-Agents #18 (job application) — generating application materials.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "resume-screen", output: "Paste a resume (or describe a candidate) + the role you're hiring for. I'll score fit 0-100 with a Hire/Consider/Pass verdict and key reasoning." };
  }
  const { data, error } = await supabase.functions.invoke("mavis-chat", {
    body: {
      messages: [{ role: "user", content: input }],
      systemPrompt: `You are a senior talent evaluator. Analyze the provided resume/candidate information against the role requirements.

Output format:
**FIT SCORE: [0-100]**
**VERDICT: [HIRE / CONSIDER / PASS]**

**Strengths (top 3):**
- ...

**Gaps / Risks (top 3):**
- ...

**Interview Focus Areas:**
- ...

**Reasoning:** [2-3 sentence summary of your verdict]

Be decisive. Score accurately. Don't inflate scores.`,
      mode: "PRIME",
      chatKind: "skill",
    },
  });
  if (error) throw error;
  return { skillName: "resume-screen", output: data?.content ?? "[No output]" };
};

registerSkill({
  name: "resume-screen",
  description: "Scores candidate resumes 0-100 against a role with Hire/Consider/Pass verdict and interview focus areas",
  keywords: [
    "screen this resume", "evaluate this candidate", "review this resume", "candidate fit",
    "hire or pass", "resume review", "should i hire", "score this resume",
    "evaluate application", "interview this person", "is this person a good fit",
  ],
}, handler);
