// Unified TTS playback hook supporting three providers, in order of preference:
//   1. Edge neural voices (FREE) via the `edge-tts` edge function — default.
//   2. ElevenLabs premium voices via `mavis-tts` — used when the picked voice
//      is an ElevenLabs preset and credits are available.
//   3. Browser Web Speech API — last-resort fallback if both backends fail.
//
// Hook surface kept identical (`speak`, `stop`, `isSpeaking`, `isLoading`) so
// existing chat components don't change.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_VOICE_BY_GENDER,
  edgeVoiceName,
  isEdgeVoice,
  type VoiceGender,
} from "@/lib/voiceCatalog";

interface TtsOptions {
  voiceId?: string | null;
  gender?: VoiceGender;
  speed?: number;
  // Kept for compatibility — used only by the ElevenLabs path.
  stability?: number;
  similarity?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  modelId?: string;
  previousText?: string;
  nextText?: string;
}

// ── Browser Web Speech fallback helpers ────────────────────────────────────
const FEMALE_NAME_HINTS = [
  "Microsoft Aria", "Microsoft Jenny", "Google UK English Female",
  "Google US English", "Samantha", "Ava", "Allison", "Karen",
];
const MALE_NAME_HINTS = [
  "Microsoft Guy", "Microsoft Davis", "Google UK English Male",
  "Daniel", "Alex", "Tom",
];

function pickBrowserVoice(gender: VoiceGender): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const hints = gender === "female" ? FEMALE_NAME_HINTS : MALE_NAME_HINTS;
  for (const hint of hints) {
    const v = voices.find((vc) => vc.name.includes(hint));
    if (v) return v;
  }
  return voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ?? voices[0];
}

function speakWithBrowser(text: string, gender: VoiceGender, speed: number) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  const v = pickBrowserVoice(gender);
  if (v) {
    utter.voice = v;
    utter.lang = v.lang;
  }
  utter.rate = speed;
  utter.pitch = gender === "female" ? 1.02 : 0.96;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
  return utter;
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useElevenLabsTts() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelledRef = useRef(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

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

  const playBase64 = useCallback(async (audioContent: string) => {
    const audio = new Audio(`data:audio/mpeg;base64,${audioContent}`);
    audioRef.current = audio;
    return await new Promise<void>((resolve) => {
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

    try {
      // ── 1) Edge neural (free) ───────────────────────────────────────────
      if (isEdgeVoice(voiceId)) {
        const voice = edgeVoiceName(voiceId);
        // Map a 0.7..1.2 speed multiplier to Edge's % offset (-30..+20).
        const speedMul = options.speed ?? 1.0;
        const rate = Math.round((speedMul - 1) * 100);
        const { data, error } = await supabase.functions.invoke("edge-tts", {
          body: { text, voice, gender, rate },
        });
        if (error) throw error;
        const audioContent = (data as any)?.audioContent;
        if (!audioContent) throw new Error("No audio returned from edge-tts");
        if (cancelledRef.current) return;
        await playBase64(audioContent);
        return;
      }

      // ── 2) ElevenLabs (premium) ─────────────────────────────────────────
      const { data, error } = await supabase.functions.invoke("mavis-tts", {
        body: {
          text,
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
      // ── 3) Browser fallback ────────────────────────────────────────────
      try {
        const utter = speakWithBrowser(text, gender, options.speed ?? 0.96);
        if (utter) {
          setIsSpeaking(true);
          utter.onend = () => setIsSpeaking(false);
          utter.onerror = () => setIsSpeaking(false);
        }
      } catch (err) {
        console.error("Browser TTS also failed:", err);
        setIsSpeaking(false);
      }
    } finally {
      setIsLoading(false);
    }
  }, [stop, playBase64]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { speak, stop, isSpeaking, isLoading };
}
