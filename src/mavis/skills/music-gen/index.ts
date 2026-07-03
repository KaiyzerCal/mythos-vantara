import { registerSkill } from "../_registry";

registerSkill(
  {
    name: "music-gen",
    description:
      "Generate AI music, beats, background tracks, and sound effects. " +
      "Produces audio files from text descriptions using Stable Audio (primary, sync) " +
      "or MusicGen Large (async queue). Supports genres, BPM, mood, instruments, and duration.",
    keywords: [
      "generate music",
      "create music",
      "make music",
      "create a beat",
      "make a beat",
      "background music",
      "generate audio",
      "create audio",
      "music for",
      "soundtrack",
      "sound effects",
      "sfx",
      "jingle",
      "lo-fi",
      "hip hop beat",
      "cinematic music",
      "ambient music",
      "compose music",
      "music track",
      "audio track",
    ],
  },
  async (input, { supabaseClient, userId }) => {
    const lines = input.trim().split("\n");
    const promptLine = lines.find((l) => l.toLowerCase().startsWith("prompt:")) ?? "";
    const styleLine  = lines.find((l) => l.toLowerCase().startsWith("style:"))  ?? "";
    const durLine    = lines.find((l) => l.toLowerCase().startsWith("duration:")) ?? "";
    const modelLine  = lines.find((l) => l.toLowerCase().startsWith("model:"))  ?? "";

    const prompt   = promptLine ? promptLine.replace(/^prompt:\s*/i, "").trim() : input.trim();
    const style    = styleLine  ? styleLine.replace(/^style:\s*/i, "").trim()   : "";
    const duration = durLine    ? parseInt(durLine.replace(/^duration:\s*/i, "").trim(), 10) : 30;
    const model    = modelLine  ? modelLine.replace(/^model:\s*/i, "").trim()   : "stable-audio";

    if (!prompt) return "Please describe the music you want me to generate.";

    const { data, error } = await supabaseClient.functions.invoke("mavis-music-gen", {
      body: { prompt, style, duration, model },
    });

    if (error) return `Music generation failed: ${error.message}`;
    if (data?.error) return `Music generation error: ${data.error}`;

    if (data?.status === "complete" && data?.url) {
      const dur = data.duration ? ` (${data.duration}s)` : "";
      return (
        `Music generated successfully${dur} via ${data.provider ?? "stable-audio"}.\n\n` +
        `**Audio URL:** ${data.url}\n\n` +
        `Prompt used: _${prompt}${style ? ` — Style: ${style}` : ""}_`
      );
    }

    if (data?.status === "processing" && data?.request_id) {
      return (
        `Music is being generated (${data.provider ?? "musicgen"}). ` +
        `Request ID: \`${data.request_id}\`\n\n` +
        `Poll for completion: call \`mavis-music-gen\` with ` +
        `\`{ action: "poll", request_id: "${data.request_id}" }\`.`
      );
    }

    return `Unexpected response from music generator: ${JSON.stringify(data)}`;
  },
);
