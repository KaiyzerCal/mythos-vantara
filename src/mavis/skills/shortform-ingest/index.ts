// SKILL: shortform-ingest
// Transcribes TikTok/Reels/Shorts and saves to knowledge base via mavis-shortform-ingest.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "shortform-ingest", output: "Ingest a short-form video. Example: 'ingest tiktok: https://tiktok.com/@user/video/...' or 'save reel: [url]'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0];
  if (!url) return { skillName: "shortform-ingest", output: "Please provide a TikTok, Reel, or Short URL." };
  try {
    const { data, error } = await supabase.functions.invoke("mavis-shortform-ingest", {
      body: { url, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.transcript ?? data?.insights ?? data?.output;
    return { skillName: "shortform-ingest", output: result ? `📱 **Short-form Ingested:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "shortform-ingest", output: `Shortform ingest error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "shortform-ingest",
  description: "Transcribes TikTok, Instagram Reels, and YouTube Shorts into your knowledge base",
  keywords: [
    "shortform ingest", "ingest tiktok", "save reel", "tiktok to text",
    "reel transcript", "short video ingest", "ingest short", "save tiktok",
  ],
}, handler);
