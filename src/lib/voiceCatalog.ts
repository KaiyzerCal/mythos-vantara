// Curated ElevenLabs voice catalog used across Council, Persona, and MAVIS chats.
// All IDs are publicly available preset voices on ElevenLabs.

export type VoiceGender = "male" | "female";

export interface VoiceOption {
  id: string;
  name: string;
  gender: VoiceGender;
  description: string;
}

export const VOICE_CATALOG: VoiceOption[] = [
  // Male
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George",   gender: "male",   description: "Warm, mature British narrator" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian",    gender: "male",   description: "Deep, resonant American" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam",     gender: "male",   description: "Confident, articulate American" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel",   gender: "male",   description: "Authoritative British news anchor" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris",    gender: "male",   description: "Casual, friendly American" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric",     gender: "male",   description: "Smooth, measured American" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will",     gender: "male",   description: "Energetic, expressive young American" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum",   gender: "male",   description: "Intense, raspy character voice" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie",  gender: "male",   description: "Natural, conversational Australian" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger",    gender: "male",   description: "Classic American announcer" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill",     gender: "male",   description: "Trustworthy older American" },

  // Female
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah",    gender: "female", description: "Soft, professional young American" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura",    gender: "female", description: "Upbeat, friendly American" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice",    gender: "female", description: "Confident British" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda",  gender: "female", description: "Warm, narrative American" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica",  gender: "female", description: "Expressive, conversational young American" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily",     gender: "female", description: "Gentle, calm British" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River",    gender: "female", description: "Smooth, neutral American" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel",   gender: "female", description: "Calm, narration-quality American" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi",     gender: "female", description: "Strong, confident American" },
];

export const DEFAULT_VOICE_BY_GENDER: Record<VoiceGender, string> = {
  male: "JBFqnCBsd6RMkjVDRZzb",     // George
  female: "EXAVITQu4vr4xnSDxMaL",   // Sarah
};

export function findVoice(id?: string | null): VoiceOption | undefined {
  if (!id) return undefined;
  return VOICE_CATALOG.find((v) => v.id === id);
}

export function voicesByGender(gender: VoiceGender): VoiceOption[] {
  return VOICE_CATALOG.filter((v) => v.gender === gender);
}
