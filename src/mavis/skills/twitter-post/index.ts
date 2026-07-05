// SKILL: twitter-post
// Writes tweets and threads via mavis-twitter-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "twitter-post", output: "Tell me what to tweet. Example: 'write a tweet about my new product launch' or 'create a Twitter thread about productivity tips'" };
  }
  const isThread = /thread/i.test(input);
  const shouldPost = /post|publish|tweet it|send it/i.test(input);
  const topic = input.replace(/^(write|draft|create|post|tweet|publish)\s+(a\s+)?(tweet|twitter thread|twitter post|thread)\s+(about|on)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-twitter-agent", {
      body: { action: shouldPost ? "post" : "draft", topic, format: isThread ? "thread" : "tweet", user_id: ctx.userId },
    });
    if (error) throw error;
    const content = data?.tweet ?? data?.thread ?? data?.draft ?? data?.content ?? data?.output;
    return {
      skillName: "twitter-post",
      output: content
        ? (shouldPost ? `🐦 **Tweet${isThread ? " Thread" : ""} Posted:**\n\n${content}` : `📝 **Tweet${isThread ? " Thread" : ""} Draft:**\n\n${content}`)
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "twitter-post", output: `Twitter error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "twitter-post",
  description: "Writes and posts tweets and Twitter threads",
  keywords: [
    "tweet", "twitter post", "post on twitter", "write a tweet",
    "twitter thread", "thread about", "tweet about", "post on x",
    "twitter content", "viral tweet", "tweet draft",
  ],
}, handler);
