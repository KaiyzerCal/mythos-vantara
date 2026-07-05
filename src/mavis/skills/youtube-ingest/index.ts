// SKILL: youtube-ingest
// Ingests YouTube videos — transcription and knowledge extraction via mavis-youtube-ingest.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "youtube-ingest", output: "Ingest a YouTube video. Example: 'youtube ingest https://youtube.com/watch?v=...' or 'transcribe this youtube video'" };
  }
  const url = input.match(/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/)?.[0]
    ?? input.match(/https?:\/\/[^\s]+/)?.[0];
  if (!url) return { skillName: "youtube-ingest", output: "Please provide a YouTube URL to ingest." };
  try {
    const { data, error } = await supabase.functions.invoke("mavis-youtube-ingest", {
      body: { url, user_id: ctx.userId, extract_insights: true },
    });
    if (error) throw error;
    const result = data?.transcript ?? data?.insights ?? data?.summary ?? data?.output;
    return { skillName: "youtube-ingest", output: result ? `🎬 **YouTube Ingested:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "youtube-ingest", output: `YouTube ingest error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "youtube-ingest",
  description: "Ingests YouTube videos — transcribes and extracts key insights into your knowledge base",
  keywords: [
    "youtube ingest", "ingest youtube", "transcribe youtube", "save youtube video",
    "youtube to knowledge", "extract from youtube", "youtube transcript save",
  ],
}, handler);
