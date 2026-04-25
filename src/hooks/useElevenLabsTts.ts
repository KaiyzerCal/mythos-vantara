// Browser Web Speech API TTS — free fallback while ElevenLabs credits aren't
// purchased. Prioritizes neural / premium / natural system voices when the OS
// exposes them, and chunks long replies into sentences so prosody resets
// naturally instead of droning in one breath.
import { useCallback, useEffect, useRef, useState } from "react";
import { type VoiceGender } from "@/lib/voiceCatalog";

interface TtsOptions {
  voiceId?: string | null;
  gender?: VoiceGender;
  speed?: number;
  // Kept for API compatibility with the ElevenLabs version — unused here.
  stability?: number;
  similarity?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  modelId?: string;
  previousText?: string;
  nextText?: string;
}

// Quality tier keywords found in voice names across OSes. Higher = better.
const QUALITY_KEYWORDS = [
  "natural", "neural", "premium", "enhanced", "online", "wavenet", "studio",
];

// Known good native voice names per gender, in priority order.
// macOS "Premium"/"Enhanced" downloads, Windows neural voices, ChromeOS Google voices.
const FEMALE_NAMES = [
  // Microsoft neural (Windows / Edge)
  "Microsoft Aria", "Microsoft Jenny", "Microsoft Libby", "Microsoft Sonia",
  "Microsoft Michelle", "Microsoft Ava",
  // Google natural
  "Google UK English Female", "Google US English",
  // Apple premium
  "Samantha", "Ava", "Allison", "Susan", "Karen", "Moira", "Tessa", "Victoria",
  "Serena", "Fiona",
];
const MALE_NAMES = [
  "Microsoft Guy", "Microsoft Davis", "Microsoft Tony", "Microsoft Ryan",
  "Microsoft Brandon", "Microsoft Andrew",
  "Google UK English Male",
  "Daniel", "Alex", "Tom", "Aaron", "Arthur", "Oliver", "Fred",
];

function scoreVoice(v: SpeechSynthesisVoice, gender: VoiceGender): number {
  const name = v.name.toLowerCase();
  let score = 0;
  // Quality tier hints
  for (const kw of QUALITY_KEYWORDS) if (name.includes(kw)) score += 50;
  // Prefer English voices
  if (v.lang?.toLowerCase().startsWith("en")) score += 20;
  // Prefer en-US/en-GB specifically
  if (/en-(us|gb)/i.test(v.lang || "")) score += 5;
  // Non-local (cloud) voices on Edge/Chrome are usually higher quality
  if (!v.localService) score += 15;
  // Name match priority
  const list = gender === "female" ? FEMALE_NAMES : MALE_NAMES;
  for (let i = 0; i < list.length; i++) {
    if (v.name.includes(list[i])) {
      score += 100 - i; // earlier = better
      break;
    }
  }
  return score;
}

function pickVoice(gender: VoiceGender): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const ranked = [...voices]
    .map((v) => ({ v, s: scoreVoice(v, gender) }))
    .sort((a, b) => b.s - a.s);

  return ranked[0]?.v ?? null;
}

// Split into natural-length chunks so the synth resets prosody between
// sentences. Long single utterances are what causes the "robotic monotone".
function chunkText(text: string): string[] {
  const sentences = text
    .replace(/([.!?])\s+/g, "$1|")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  // Merge very short fragments back together so we don't get staccato.
  const out: string[] = [];
  for (const s of sentences) {
    const last = out[out.length - 1];
    if (last && last.length < 40) {
      out[out.length - 1] = `${last} ${s}`;
    } else {
      out.push(s);
    }
  }
  return out.length ? out : [text];
}

export function useElevenLabsTts() {
  const cancelledRef = useRef(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading] = useState(false);
  const [, setVoicesReady] = useState(0);

  // Voices load asynchronously on most browsers; force a re-render once ready.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const onChange = () => setVoicesReady((n) => n + 1);
    synth.getVoices(); // trigger initial population
    synth.addEventListener?.("voiceschanged", onChange);
    return () => synth.removeEventListener?.("voiceschanged", onChange);
  }, []);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string, options: TtsOptions = {}) => {
    if (!text?.trim()) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      console.warn("Web Speech API not available in this browser");
      return;
    }
    stop();
    cancelledRef.current = false;

    // Strip markup, code, stage directions, emoji.
    const cleaned = text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]*`/g, "")
      .replace(/:::ACTION[\s\S]*?:::/g, "")
      .replace(/\*[^*\n]+\*/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[#*_~>]/g, "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
      .replace(/\s*[—–]\s*/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return;

    const gender: VoiceGender = options.gender ?? "female";
    const voice = pickVoice(gender);
    const chunks = chunkText(cleaned);

    setIsSpeaking(true);

    // Sequentially queue each chunk; a short pause between them sounds natural.
    for (let i = 0; i < chunks.length; i++) {
      if (cancelledRef.current) break;
      const chunk = chunks[i];
      await new Promise<void>((resolve) => {
        const utter = new SpeechSynthesisUtterance(chunk);
        if (voice) {
          utter.voice = voice;
          utter.lang = voice.lang;
        }
        // Slightly slower than 1.0 and softer pitch differentiation reads more
        // human than the default chipmunk-y settings most browsers ship.
        utter.rate = options.speed ?? 0.96;
        utter.pitch = gender === "female" ? 1.02 : 0.96;
        utter.volume = 1.0;
        utter.onend = () => resolve();
        utter.onerror = () => resolve();
        window.speechSynthesis.speak(utter);
      });
    }

    if (!cancelledRef.current) setIsSpeaking(false);
  }, [stop]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { speak, stop, isSpeaking, isLoading };
}
