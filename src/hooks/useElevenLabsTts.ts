// Plays text via the ElevenLabs TTS edge function and exposes simple controls.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_VOICE_BY_GENDER, type VoiceGender } from "@/lib/voiceCatalog";

interface TtsOptions {
  voiceId?: string | null;
  gender?: VoiceGender;
  speed?: number;
  stability?: number;
  similarity?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  modelId?: string;
  // Optional surrounding context for request stitching — keeps prosody
  // continuous across turns so the conversation flows like a real one.
  previousText?: string;
  nextText?: string;
}

export function useElevenLabsTts() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string, options: TtsOptions = {}) => {
    if (!text?.trim()) return;
    stop();
    setIsLoading(true);
    try {
      const gender: VoiceGender = options.gender ?? "male";
      const voice_id = options.voiceId ?? DEFAULT_VOICE_BY_GENDER[gender];
      const { data, error } = await supabase.functions.invoke("mavis-tts", {
        body: {
          text,
          gender,
          voice_id,
          model_id: options.modelId ?? "eleven_multilingual_v2",
          previous_text: options.previousText,
          next_text: options.nextText,
          voice_settings: {
            // Defaults aligned with the edge function — natural, conversational
            // delivery with expressive variation rather than flat narration.
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
      if (!audioContent) throw new Error("No audio returned");
      const audio = new Audio(`data:audio/mpeg;base64,${audioContent}`);
      audioRef.current = audio;
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => {
        setIsSpeaking(false);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setIsSpeaking(false);
        audioRef.current = null;
      };
      await audio.play();
    } catch (e) {
      console.error("TTS playback error", e);
      setIsSpeaking(false);
    } finally {
      setIsLoading(false);
    }
  }, [stop]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { speak, stop, isSpeaking, isLoading };
}
