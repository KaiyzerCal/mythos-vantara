// Unified TTS playback hook supporting two providers:
//   1. Browser Web Speech (FREE, default) — picks the best matching neural
//      OS voice using hints from the catalog. Long replies are chunked by
//      sentence so prosody resets naturally instead of droning.
//   2. ElevenLabs premium — used when the picked voice is an ElevenLabs ID
//      and credits are available. Falls back to browser TTS on any failure.
//
// Hook surface (`speak`, `stop`, `isSpeaking`, `isLoading`) is unchanged so
// existing chat components don't need to change.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  BROWSER_VOICE_HINTS,
  DEFAULT_VOICE_BY_GENDER,
  browserVoiceHint,
  isBrowserVoice,
  type VoiceGender,
} from "@/lib/voiceCatalog";

interface TtsOptions {
  voiceId?: string | null;
  gender?: VoiceGender;
  speed?: number;
  // Used only by the ElevenLabs path; kept for API parity.
  stability?: number;
  similarity?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  modelId?: string;
  previousText?: string;
  nextText?: string;
}

// ── Browser voice ranking ──────────────────────────────────────────────────
const QUALITY_KEYWORDS = ["natural", "neural", "premium", "enhanced", "online", "wavenet"];

function scoreBrowserVoice(
  v: SpeechSynthesisVoice,
  gender: VoiceGender,
  hintList: string[],
): number {
  let score = 0;
  const name = v.name.toLowerCase();
  for (const kw of QUALITY_KEYWORDS) if (name.includes(kw)) score += 50;
  if (v.lang?.toLowerCase().startsWith("en")) score += 20;
  if (/en-(us|gb|au|ie)/i.test(v.lang || "")) score += 5;
  if (!v.localService) score += 15; // cloud voices usually higher quality
  for (let i = 0; i < hintList.length; i++) {
    if (v.name.includes(hintList[i])) {
      score += 200 - i * 5; // strong bonus, ordered by priority
      break;
    }
  }
  // Light gender heuristic for fallback when nothing matches
  if (gender === "female" && /(female|woman|aria|jenny|samantha|sonia|libby|emma|ava)/i.test(v.name)) score += 5;
  if (gender === "male" && /(male|man|guy|davis|daniel|ryan|thomas|andrew|brian)/i.test(v.name)) score += 5;
  return score;
}

function pickBrowserVoice(
  gender: VoiceGender,
  hintKey: string,
): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const hints = BROWSER_VOICE_HINTS[hintKey] ?? [];
  const ranked = [...voices]
    .map((v) => ({ v, s: scoreBrowserVoice(v, gender, hints) }))
    .sort((a, b) => b.s - a.s);
  return ranked[0]?.v ?? null;
}

// ── Text cleaning + sentence chunking ──────────────────────────────────────
function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/:::ACTION[\s\S]*?:::/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\*[^*\n]+\*/g, "")
    .replace(/_[^_\n]+_/g, "")
    .replace(/\((?:laughs?|smiles?|sighs?|whispers?|chuckles?|grins?|pauses?)[^)]*\)/gi, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[#*_~>]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, "")
    .replace(/\bw\/\b/gi, "with")
    .replace(/\b&\b/g, "and")
    .replace(/\.{3,}/g, "…")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkBySentence(text: string): string[] {
  const parts = text.replace(/([.!?])\s+/g, "$1|").split("|").map((s) => s.trim()).filter(Boolean);
  const merged: string[] = [];
  for (const s of parts) {
    const last = merged[merged.length - 1];
    if (last && last.length < 40) {
      merged[merged.length - 1] = `${last} ${s}`;
    } else {
      merged.push(s);
    }
  }
  return merged.length ? merged : [text];
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useElevenLabsTts() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelledRef = useRef(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [, setVoicesReady] = useState(0);

  // Voices populate asynchronously in most browsers — force a re-render once they do.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const onChange = () => setVoicesReady((n) => n + 1);
    synth.getVoices();
    synth.addEventListener?.("voiceschanged", onChange);
    return () => synth.removeEventListener?.("voiceschanged", onChange);
  }, []);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const speakBrowser = useCallback(async (
    text: string,
    gender: VoiceGender,
    hintKey: string,
    speed: number,
  ) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const voice = pickBrowserVoice(gender, hintKey);
    const chunks = chunkBySentence(text);
    setIsSpeaking(true);
    for (let i = 0; i < chunks.length; i++) {
      if (cancelledRef.current) break;
      await new Promise<void>((resolve) => {
        const utter = new SpeechSynthesisUtterance(chunks[i]);
        if (voice) {
          utter.voice = voice;
          utter.lang = voice.lang;
        }
        utter.rate = speed;
        utter.pitch = gender === "female" ? 1.02 : 0.96;
        utter.volume = 1.0;
        utter.onend = () => resolve();
        utter.onerror = () => resolve();
        window.speechSynthesis.speak(utter);
      });
    }
    if (!cancelledRef.current) setIsSpeaking(false);
  }, []);

  const playBase64 = useCallback(async (audioContent: string) => {
    return await new Promise<void>((resolve) => {
      const audio = new Audio(`data:audio/mpeg;base64,${audioContent}`);
      audioRef.current = audio;
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => {
        setIsSpeaking(false);
        audioRef.current = null;
        resolve();
      };
      audio.onerror = () => {
        setIsSpeaking(false);
        audioRef.current = null;
        resolve();
      };
      audio.play().catch(() => resolve());
    });
  }, []);

  const speak = useCallback(async (text: string, options: TtsOptions = {}) => {
    if (!text?.trim()) return;
    stop();
    cancelledRef.current = false;
    setIsLoading(true);

    const gender: VoiceGender = options.gender ?? "female";
    const voiceId = options.voiceId ?? DEFAULT_VOICE_BY_GENDER[gender];
    const cleaned = cleanForSpeech(text);
    if (!cleaned) {
      setIsLoading(false);
      return;
    }

    try {
      // ── 1) Browser (free) ───────────────────────────────────────────────
      if (isBrowserVoice(voiceId)) {
        const hintKey = browserVoiceHint(voiceId);
        await speakBrowser(cleaned, gender, hintKey, options.speed ?? 0.96);
        return;
      }

      // ── 2) ElevenLabs (premium) ─────────────────────────────────────────
      const { data, error } = await supabase.functions.invoke("mavis-tts", {
        body: {
          text: cleaned,
          gender,
          voice_id: voiceId,
          model_id: options.modelId ?? "eleven_multilingual_v2",
          previous_text: options.previousText,
          next_text: options.nextText,
          voice_settings: {
            stability: options.stability ?? 0.35,
            similarity_boost: options.similarity ?? 0.78,
            style: options.style ?? 0.45,
            use_speaker_boost: options.useSpeakerBoost ?? true,
            speed: options.speed ?? 1.0,
          },
        },
      });
      if (error) throw error;
      const audioContent = (data as any)?.audioContent;
      if (!audioContent) throw new Error("No audio returned from mavis-tts");
      if (cancelledRef.current) return;
      await playBase64(audioContent);
    } catch (e) {
      console.warn("Cloud TTS failed, falling back to browser speech:", e);
      try {
        await speakBrowser(cleaned, gender, "aria", options.speed ?? 0.96);
      } catch (err) {
        console.error("Browser TTS also failed:", err);
        setIsSpeaking(false);
      }
    } finally {
      setIsLoading(false);
    }
  }, [stop, speakBrowser, playBase64]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { speak, stop, isSpeaking, isLoading };
}
