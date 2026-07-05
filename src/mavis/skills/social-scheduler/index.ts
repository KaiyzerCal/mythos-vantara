// SKILL: social-scheduler
// Schedules posts across multiple social platforms via mavis-social-scheduler.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "social-scheduler", output: "Schedule content across all your social platforms. Example: 'schedule for tomorrow at 9am: Check out our new feature! [link]' or 'show my scheduled posts'" };
  }
  const isView = /show|list|scheduled|upcoming posts|what.?s scheduled/i.test(input);
  const platformMatch = input.match(/\b(twitter|linkedin|instagram|tiktok|facebook|x\.com)\b/gi);
  const platforms = platformMatch ?? ["twitter", "linkedin", "instagram"];
  const timeMatch = input.match(/\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?:am|pm)|\d{1,2}:\d{2})\b/gi);
  try {
    const { data, error } = await supabase.functions.invoke("mavis-social-scheduler", {
      body: {
        action: isView ? "list" : "schedule",
        content: isView ? undefined : input.replace(/^(schedule|post|publish)\s+(for\s+\S+\s+)?/i, "").trim(),
        platforms: platforms.map(p => p.toLowerCase()),
        scheduled_for: timeMatch?.[0] ?? "tomorrow at 9am",
        user_id: ctx.userId,
      },
    });
    if (error) throw error;
    const result = data?.posts ?? data?.scheduled ?? data?.result ?? data?.output;
    return {
      skillName: "social-scheduler",
      output: result
        ? (isView ? `📅 **Scheduled Posts:**\n\n${JSON.stringify(result, null, 2).slice(0, 2000)}` : `✅ Scheduled across ${platforms.join(", ")}`)
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "social-scheduler", output: `Social scheduler error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "social-scheduler",
  description: "Schedules content across Twitter, LinkedIn, Instagram, and TikTok simultaneously",
  keywords: [
    "schedule post", "schedule for tomorrow", "social schedule", "schedule across platforms",
    "scheduled posts", "publish later", "queue post", "social media schedule",
    "post at", "schedule content", "batch schedule",
  ],
}, handler);
