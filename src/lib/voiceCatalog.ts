// Curated voice catalog used across Council, Persona, and MAVIS chats.
//
// Two providers:
//   • Browser (FREE) — uses the OS's built-in neural voices via Web Speech API.
//     IDs are prefixed with "browser:" plus optional name hints. The actual
//     voice picked depends on what the user's OS / browser provides.
//   • ElevenLabs (Premium, requires credits) — preset voice IDs.
//
// Defaults point at browser voices so playback works at zero cost.

export type VoiceGender = "male" | "female";

export interface VoiceOption {
  id: string;
  name: string;
  gender: VoiceGender;
  description: string;
  provider: "browser" | "elevenlabs";
}

const browser = (
  hintKey: string,
  display: string,
  gender: VoiceGender,
  description: string,
): VoiceOption => ({
  id: `browser:${hintKey}`,
  name: display,
  gender,
  description,
  provider: "browser",
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
  // ── Browser (FREE) — neural where the OS supports it ────
  browser("aria",     "Aria (Free)",     "female", "Best available female neural voice on your device"),
  browser("jenny",    "Jenny (Free)",    "female", "Friendly American — uses Microsoft Jenny when available"),
  browser("samantha", "Samantha (Free)", "female", "Warm American — Apple premium when available"),
  browser("uk-female","Sonia (Free)",    "female", "British female — Microsoft Sonia / Google UK"),

  browser("guy",      "Guy (Free)",      "male",   "Best available male neural voice on your device"),
  browser("davis",    "Davis (Free)",    "male",   "Casual American — uses Microsoft Davis when available"),
  browser("daniel",   "Daniel (Free)",   "male",   "Mature British — Apple premium when available"),
  browser("uk-male",  "Ryan (Free)",     "male",   "British male — Microsoft Ryan / Google UK"),

  // ── ElevenLabs (Premium, requires credits) — Male ───────
  eleven("JBFqnCBsd6RMkjVDRZzb", "George (Premium)",   "male", "Warm British narrator — ElevenLabs"),
  eleven("nPczCjzI2devNBz1zQrb", "Brian (Premium)",    "male", "Deep, resonant American — ElevenLabs"),
  eleven("TX3LPaxmHKxFdv7VOQHJ", "Liam (Premium)",     "male", "Confident, articulate American — ElevenLabs"),
  eleven("onwK4e9ZLuTAKqWW03F9", "Daniel (Premium)",   "male", "Authoritative British anchor — ElevenLabs"),
  eleven("iP95p4xoKVk53GoZ742B", "Chris (Premium)",    "male", "Casual, friendly American — ElevenLabs"),
  eleven("bIHbv24MWmeRgasZH58o", "Will (Premium)",     "male", "Energetic young American — ElevenLabs"),
  eleven("N2lVS1w4EtoT3dr4eOWO", "Callum (Premium)",   "male", "Intense, raspy character — ElevenLabs"),
  eleven("IKne3meq5aSn9XLyUdCD", "Charlie (Premium)",  "male", "Natural Australian — ElevenLabs"),

  // ── ElevenLabs (Premium, requires credits) — Female ─────
  eleven("EXAVITQu4vr4xnSDxMaL", "Sarah (Premium)",    "female", "Soft, professional American — ElevenLabs"),
  eleven("FGY2WhTYpPnrIDTdsKH5", "Laura (Premium)",    "female", "Upbeat, friendly American — ElevenLabs"),
  eleven("Xb7hH8MSUJpSbSDYk0k2", "Alice (Premium)",    "female", "Confident British — ElevenLabs"),
  eleven("XrExE9yKIg1WjnnlVkGX", "Matilda (Premium)",  "female", "Warm, narrative American — ElevenLabs"),
  eleven("cgSgspJ2msm6clMCkdW9", "Jessica (Premium)",  "female", "Expressive young American — ElevenLabs"),
  eleven("pFZP5JQG7iQjIQuC4Bku", "Lily (Premium)",     "female", "Gentle, calm British — ElevenLabs"),
  eleven("SAz9YHcvj6GT2YYXdXww", "River (Premium)",    "female", "Smooth, neutral American — ElevenLabs"),
];

// Defaults point to FREE browser voices so playback works without credits.
export const DEFAULT_VOICE_BY_GENDER: Record<VoiceGender, string> = {
  male: "browser:guy",
  female: "browser:aria",
};

export function findVoice(id?: string | null): VoiceOption | undefined {
  if (!id) return undefined;
  return VOICE_CATALOG.find((v) => v.id === id);
}

export function voicesByGender(gender: VoiceGender): VoiceOption[] {
  return VOICE_CATALOG.filter((v) => v.gender === gender);
}

export function isBrowserVoice(id?: string | null): boolean {
  return !!id && id.startsWith("browser:");
}
export function browserVoiceHint(id: string): string {
  return id.replace(/^browser:/, "");
}

// Map a browser voice hint to OS voice name candidates, in priority order.
// We pick the first match the device exposes.
export const BROWSER_VOICE_HINTS: Record<string, string[]> = {
  aria:       ["Microsoft Aria", "Microsoft Ava", "Google US English", "Samantha", "Allison"],
  jenny:      ["Microsoft Jenny", "Microsoft Michelle", "Samantha", "Google US English"],
  samantha:   ["Samantha", "Ava", "Allison", "Microsoft Aria"],
  "uk-female":["Microsoft Sonia", "Microsoft Libby", "Google UK English Female", "Karen"],

  guy:        ["Microsoft Guy", "Microsoft Andrew", "Google US English", "Daniel"],
  davis:      ["Microsoft Davis", "Microsoft Christopher", "Daniel", "Alex"],
  daniel:     ["Daniel", "Alex", "Microsoft Guy"],
  "uk-male":  ["Microsoft Ryan", "Microsoft Thomas", "Google UK English Male", "Daniel"],
};
