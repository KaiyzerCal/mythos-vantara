// SKILL: wordpress
// Manages WordPress sites — posts, pages, plugins, and settings via mavis-wordpress.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "wordpress", output: "Manage WordPress. Example: 'wordpress publish post: [title]' or 'wordpress: show recent posts'" };
  }
  const action = input.replace(/^(wordpress|wp|wordpress agent)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-wordpress", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.post ?? data?.posts ?? data?.result ?? data?.output;
    return { skillName: "wordpress", output: result ? `📝 **WordPress:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "wordpress", output: `WordPress error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "wordpress",
  description: "Manages WordPress sites — create posts, update pages, manage plugins and settings",
  keywords: [
    "wordpress", "wp", "wordpress post", "wordpress publish", "wordpress blog",
    "create wordpress post", "wordpress site", "wordpress page", "wp admin",
  ],
}, handler);
