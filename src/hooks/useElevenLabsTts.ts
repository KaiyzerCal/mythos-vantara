// Browser Web Speech API TTS — free fallback while ElevenLabs credits aren't
// purchased. Same hook surface as before so call sites stay unchanged. When
// ElevenLabs is funded, swap the body of `speak` back to invoke `mavis-tts`.
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

// Heuristic: native voices that tend to sound the most natural per gender.
// We pick the first match in priority order.
const FEMALE_NAME_HINTS = [
  "Samantha", "Victoria", "Karen", "Moira", "Tessa", "Allison",
  "Ava", "Susan", "Zira", "Jenny", "Aria", "Libby", "Sonia",
  "Google UK English Female", "Google US English",
];
const MALE_NAME_HINTS = [
  "Daniel", "Alex", "Fred", "Tom", "Aaron", "Arthur", "Oliver",
  "David", "Mark", "Guy", "Ryan", "Brandon",
  "Google UK English Male",
];

function pickVoice(gender: VoiceGender): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const hints = gender === "female" ? FEMALE_NAME_HINTS : MALE_NAME_HINTS;
  for (const hint of hints) {
    const v = voices.find((vc) => vc.name.includes(hint));
    if (v) return v;
  }
  // Fallback: any English voice; otherwise the first available.
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ??
    voices[0] ??
    null
  );
}

export function useElevenLabsTts() {
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading] = useState(false); // No async load — kept for API parity.
  const [, setVoicesReady] = useState(0);

  // Voices load asynchronously in most browsers; force a re-render once ready.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const onChange = () => setVoicesReady((n) => n + 1);
    // Trigger initial population
    synth.getVoices();
    synth.addEventListener?.("voiceschanged", onChange);
    return () => synth.removeEventListener?.("voiceschanged", onChange);
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    utterRef.current = null;
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string, options: TtsOptions = {}) => {
    if (!text?.trim()) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      console.warn("Web Speech API not available in this browser");
      return;
    }
    stop();

    // Light cleaning so markdown / code / stage directions aren't read aloud.
    const cleaned = text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]*`/g, "")
      .replace(/:::ACTION[\s\S]*?:::/g, "")
      .replace(/\*[^*\n]+\*/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[#*_~>]/g, "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return;

    const gender: VoiceGender = options.gender ?? "female";
    const voice = pickVoice(gender);

    const utter = new SpeechSynthesisUtterance(cleaned);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    }
    utter.rate = options.speed ?? 1.0;
    utter.pitch = gender === "female" ? 1.05 : 0.95;
    utter.volume = 1.0;

    utter.onstart = () => setIsSpeaking(true);
    utter.onend = () => {
      setIsSpeaking(false);
      utterRef.current = null;
    };
    utter.onerror = () => {
      setIsSpeaking(false);
      utterRef.current = null;
    };

    utterRef.current = utter;
    window.speechSynthesis.speak(utter);
  }, [stop]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { speak, stop, isSpeaking, isLoading };
}
