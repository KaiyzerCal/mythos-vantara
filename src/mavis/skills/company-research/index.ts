// SKILL: company-research
// Deep AI company research — financials, products, leadership, competitive position.
// Via Apify's AI Company Researcher Agent with mavis-chat fallback.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const SYSTEM_PROMPT = `You are an enterprise AI company researcher. Generate a comprehensive company intelligence report:

**COMPANY INTELLIGENCE REPORT**

**Company:** [Name | Website | Industry | Stage]
**Founded / HQ / Size:** [key facts]
**Business Model:** [how they make money]
**Products & Services:** [main offerings with differentiation]
**Leadership:** [CEO, key executives, notable advisors]
**Financial Overview:** [revenue, funding rounds, valuation, burn rate if known]
**Competitive Position:** [main competitors, moat, market share estimate]
**Recent News & Events:** [last 6 months highlights]
**Technology / IP:** [stack, patents, proprietary advantages]
**SWOT:**
  • Strengths:
  • Weaknesses:
  • Opportunities:
  • Threats:
**Strategic Outlook:** [growth trajectory, key risks, 12-month outlook]
**Verdict:** [1-2 sentence executive summary for decision-making]`;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return {
      skillName: "company-research",
      output: "Give me a company name or URL and I'll generate a deep research report — financials, products, leadership, competitive position, and strategic outlook.",
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: {
        actorId: "louisdeconinck/ai-company-researcher-agent",
        input: { companyName: input.trim() },
        timeout: 90,
      },
    });
    if (!error && data?.data?.length > 0) {
      const result = data.data[0];
      const text = result.report ?? result.analysis ?? result.summary ?? JSON.stringify(result, null, 2);
      return { skillName: "company-research", output: text };
    }
  } catch { /* fall through to mavis-chat */ }

  const { data: chatData, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
    body: {
      messages: [{ role: "user", content: `Research this company: ${input}` }],
      systemPrompt: SYSTEM_PROMPT,
      mode: "RESEARCH",
      chatKind: "skill",
    },
  });
  if (chatErr) throw chatErr;
  return { skillName: "company-research", output: chatData?.content ?? "[No output]" };
};

registerSkill({
  name: "company-research",
  description: "Deep AI company research — financials, products, leadership, competitive position, and strategic outlook",
  keywords: [
    "research this company", "company research", "company analysis", "tell me about this company",
    "company intelligence", "company profile", "research competitor", "analyze this company",
    "company report", "who is this company", "company background", "due diligence on",
    "company deep dive", "startup research",
  ],
}, handler);
