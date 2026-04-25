// Curated voice catalog used across Council, Persona, and MAVIS chats.
//
// Two providers are listed side by side:
//   • Edge neural voices (id prefixed with "edge:") — FREE, no API key.
//   • ElevenLabs preset voices (raw id) — premium, requires credits.
//
// Defaults point at Edge so voice works out of the box at no cost. Users can
// pick an ElevenLabs voice from the dropdown once credits are funded.

export type VoiceGender = "male" | "female";

export interface VoiceOption {
  id: string;
  name: string;
  gender: VoiceGender;
  description: string;
  provider: "edge" | "elevenlabs";
}

const edge = (
  voiceName: string,
  display: string,
  gender: VoiceGender,
  description: string,
): VoiceOption => ({
  id: `edge:${voiceName}`,
  name: display,
  gender,
  description,
  provider: "edge",
});

const eleven = (
  id: string,
  name: string,
  gender: VoiceGender,
  description: string,
): VoiceOption => ({
  id,
  name,
  gender,
  description,
  provider: "elevenlabs",
});

export const VOICE_CATALOG: VoiceOption[] = [
  // ── Edge neural (FREE) — Male ────────────────────────────
  edge("en-US-GuyNeural",         "Guy (Free)",         "male", "Warm, natural American — Edge neural"),
  edge("en-US-ChristopherNeural", "Christopher (Free)", "male", "Confident, mature American — Edge neural"),
  edge("en-US-EricNeural",        "Eric (Free)",        "male", "Smooth, friendly American — Edge neural"),
  edge("en-US-DavisNeural",       "Davis (Free)",       "male", "Casual, conversational American — Edge neural"),
  edge("en-US-RogerNeural",       "Roger (Free)",       "male", "Classic announcer American — Edge neural"),
  edge("en-US-AndrewNeural",      "Andrew (Free)",      "male", "Articulate, professional American — Edge neural"),
  edge("en-US-BrianNeural",       "Brian (Free)",       "male", "Deep, resonant American — Edge neural"),
  edge("en-GB-RyanNeural",        "Ryan (Free)",        "male", "Crisp British — Edge neural"),
  edge("en-GB-ThomasNeural",      "Thomas (Free)",      "male", "Calm British — Edge neural"),
  edge("en-AU-WilliamNeural",     "William (Free)",     "male", "Easy-going Australian — Edge neural"),

  // ── Edge neural (FREE) — Female ──────────────────────────
  edge("en-US-AriaNeural",        "Aria (Free)",        "female", "Expressive, lifelike American — Edge neural"),
  edge("en-US-JennyNeural",       "Jenny (Free)",       "female", "Friendly, approachable American — Edge neural"),
  edge("en-US-MichelleNeural",    "Michelle (Free)",    "female", "Warm, clear American — Edge neural"),
  edge("en-US-AvaNeural",         "Ava (Free)",         "female", "Bright, modern American — Edge neural"),
  edge("en-US-EmmaNeural",        "Emma (Free)",        "female", "Soft, conversational American — Edge neural"),
  edge("en-US-SaraNeural",        "Sara (Free)",        "female", "Smooth, narration American — Edge neural"),
  edge("en-GB-SoniaNeural",       "Sonia (Free)",       "female", "Confident British — Edge neural"),
  edge("en-GB-LibbyNeural",       "Libby (Free)",       "female", "Gentle British — Edge neural"),
  edge("en-AU-NatashaNeural",     "Natasha (Free)",     "female", "Lively Australian — Edge neural"),
  edge("en-IE-EmilyNeural",       "Emily (Free)",       "female", "Lilting Irish — Edge neural"),

  // ── ElevenLabs (premium, requires credits) — Male ────────
  eleven("JBFqnCBsd6RMkjVDRZzb", "George (Premium)",   "male", "Warm, mature British narrator — ElevenLabs"),
  eleven("nPczCjzI2devNBz1zQrb", "Brian (Premium)",    "male", "Deep, resonant American — ElevenLabs"),
  eleven("TX3LPaxmHKxFdv7VOQHJ", "Liam (Premium)",     "male", "Confident, articulate American — ElevenLabs"),
  eleven("onwK4e9ZLuTAKqWW03F9", "Daniel (Premium)",   "male", "Authoritative British anchor — ElevenLabs"),
  eleven("iP95p4xoKVk53GoZ742B", "Chris (Premium)",    "male", "Casual, friendly American — ElevenLabs"),
  eleven("bIHbv24MWmeRgasZH58o", "Will (Premium)",     "male", "Energetic young American — ElevenLabs"),
  eleven("N2lVS1w4EtoT3dr4eOWO", "Callum (Premium)",   "male", "Intense, raspy character — ElevenLabs"),
  eleven("IKne3meq5aSn9XLyUdCD", "Charlie (Premium)",  "male", "Natural Australian — ElevenLabs"),

  // ── ElevenLabs (premium, requires credits) — Female ──────
  eleven("EXAVITQu4vr4xnSDxMaL", "Sarah (Premium)",    "female", "Soft, professional American — ElevenLabs"),
  eleven("FGY2WhTYpPnrIDTdsKH5", "Laura (Premium)",    "female", "Upbeat, friendly American — ElevenLabs"),
  eleven("Xb7hH8MSUJpSbSDYk0k2", "Alice (Premium)",    "female", "Confident British — ElevenLabs"),
  eleven("XrExE9yKIg1WjnnlVkGX", "Matilda (Premium)",  "female", "Warm, narrative American — ElevenLabs"),
  eleven("cgSgspJ2msm6clMCkdW9", "Jessica (Premium)",  "female", "Expressive young American — ElevenLabs"),
  eleven("pFZP5JQG7iQjIQuC4Bku", "Lily (Premium)",     "female", "Gentle, calm British — ElevenLabs"),
  eleven("SAz9YHcvj6GT2YYXdXww", "River (Premium)",    "female", "Smooth, neutral American — ElevenLabs"),
];

// Defaults point to FREE Edge neural voices so playback works without credits.
export const DEFAULT_VOICE_BY_GENDER: Record<VoiceGender, string> = {
  male: "edge:en-US-GuyNeural",
  female: "edge:en-US-AriaNeural",
};

export function findVoice(id?: string | null): VoiceOption | undefined {
  if (!id) return undefined;
  return VOICE_CATALOG.find((v) => v.id === id);
}

export function voicesByGender(gender: VoiceGender): VoiceOption[] {
  return VOICE_CATALOG.filter((v) => v.gender === gender);
}

// Helpers for the playback hook to know which backend to call.
export function isEdgeVoice(id?: string | null): boolean {
  return !!id && id.startsWith("edge:");
}
export function edgeVoiceName(id: string): string {
  return id.replace(/^edge:/, "");
}
