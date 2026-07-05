// SKILL: linkedin-post
// Writes and posts LinkedIn content via mavis-nora-linkedin.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "linkedin-post", output: "Tell me the topic or give me the text and I'll write and post on LinkedIn. Example: 'write a LinkedIn post about AI trends in 2025'" };
  }
  const shouldPost = /post|publish|share|go live/i.test(input);
  const topic = input.replace(/^(write|draft|create|post|publish)\s+(a\s+)?(linkedin post|linkedin article|post on linkedin|linkedin update)\s+(about|on|covering)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-nora-linkedin", {
      body: { action: shouldPost ? "post" : "draft", topic, user_id: ctx.userId },
    });
    if (error) throw error;
    const content = data?.post ?? data?.draft ?? data?.content ?? data?.output;
    const posted = data?.published ?? data?.posted;
    return {
      skillName: "linkedin-post",
      output: content
        ? (posted ? `✅ **Posted to LinkedIn:**\n\n${content}` : `📝 **LinkedIn Draft:**\n\n${content}`)
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "linkedin-post", output: `LinkedIn error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "linkedin-post",
  description: "Writes and publishes LinkedIn posts and articles",
  keywords: [
    "linkedin post", "post on linkedin", "linkedin update", "write for linkedin",
    "linkedin article", "share on linkedin", "linkedin content", "linkedin draft",
    "publish linkedin", "linkedin thought leadership",
  ],
}, handler);
