// SKILL: youtube-intel
// YouTube transcript extraction and channel analysis via Apify.
// Handles video transcripts, channel research, and content insights.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

function extractVideoId(text: string): string | null {
  const m = text.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m?.[1] ?? null;
}

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return {
      skillName: "youtube-intel",
      output: "Give me a YouTube URL or channel name — I'll extract transcripts, analyze content strategy, or pull key insights from the video.",
    };
  }

  const videoId = extractVideoId(input);

  if (videoId) {
    // Transcript extraction
    try {
      const { data, error } = await supabase.functions.invoke("mavis-apify", {
        body: {
          actorId: "supreme_coder/youtube-transcript-scraper",
          input: { videoUrls: [`https://www.youtube.com/watch?v=${videoId}`] },
          timeout: 60,
        },
      });
      if (!error && data?.data?.length > 0) {
        const result = data.data[0];
        const transcript = result.transcript ?? result.captions ?? result.text;
        const title = result.title ?? `Video ${videoId}`;
        if (transcript) {
          const cleaned = typeof transcript === "string"
            ? transcript
            : Array.isArray(transcript)
              ? transcript.map((t: any) => t.text ?? t).join(" ")
              : JSON.stringify(transcript);
          return {
            skillName: "youtube-intel",
            output: `**TRANSCRIPT: ${title}**\nhttps://youtu.be/${videoId}\n\n${cleaned.slice(0, 12000)}`,
          };
        }
      }
    } catch { /* fall through */ }
  }

  // Fallback: rich analysis via mavis-chat
  const { data: chatData, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
    body: {
      messages: [{ role: "user", content: input }],
      systemPrompt: `You are a YouTube content intelligence analyst. For the given YouTube content:

If it's a VIDEO URL:
- Identify the video ID and likely title/topic from context
- Explain what content this type of YouTube video usually contains
- Outline key insights, timestamps to look for, and main themes
- Recommend using AGENT mode + google_api YouTube Data API for live transcript

If it's a CHANNEL:
- Analyze the content niche and strategy from the channel handle/name
- Estimate audience, posting frequency, and content pillars
- Identify monetization methods and brand partnership opportunities
- List top 5 search strategies to find this channel's best content

If it's a TOPIC query about YouTube:
- List the top creator strategies in this niche
- Identify trending content formats
- Provide hook templates and content angles that perform`,
      mode: "RESEARCH",
      chatKind: "skill",
    },
  });
  if (chatErr) throw chatErr;
  return { skillName: "youtube-intel", output: chatData?.content ?? "[No output]" };
};

registerSkill({
  name: "youtube-intel",
  description: "YouTube intelligence — transcript extraction, channel analysis, and video content insights",
  keywords: [
    "youtube transcript", "get transcript", "youtube video", "analyze this youtube",
    "summarize this video", "youtube channel analysis", "extract transcript",
    "what does this video say", "youtube intel", "video transcript",
    "youtu.be", "youtube.com/watch", "youtube channel research",
  ],
}, handler);
