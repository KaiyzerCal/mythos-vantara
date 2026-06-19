import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic } from "lucide-react";
import { streamChatMessage } from "@/mavis/chatService";
import { supabase } from "@/integrations/supabase/client";

export interface VoicePersona {
  name: string;
  role?: string;
  systemPrompt: string;
  voiceId?: string;
  entityId?: string;
  entityType?: string;
  userId?: string;
  avatarUrl?: string;
}

interface VoiceChatOverlayProps {
  onClose: () => void;
  sendMessage?: (text: string) => Promise<void>;
  lastBotMessage?: string;
  isLoading?: boolean;
  persona?: VoicePersona;
  // When true, skip internal speechSynthesis (caller handles audio externally)
  externalAudio?: boolean;
  // Called after each completed voice exchange so the parent can persist/display the turn
  onExchange?: (userText: string, replyText: string) => void;
}

type Phase = "idle" | "listening" | "thinking" | "speaking";

export function VoiceChatOverlay({
  onClose,
  sendMessage,
  lastBotMessage = "",
  isLoading = false,
  persona,
  externalAudio = false,
  onExchange,
}: VoiceChatOverlayProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");

  // Karaoke: track how many chars have been spoken
  const [spokenUpTo, setSpokenUpTo] = useState(0);
  // The reply currently being spoken (frozen so karaoke doesn't jump on new messages)
  const [displayedReply, setDisplayedReply] = useState("");

  // Persona-mode internal state
  const [personaReply, setPersonaReply] = useState("");
  const [personaLoading, setPersonaLoading] = useState(false);
  const personaHistoryRef = useRef<{ role: string; content: string }[]>([]);

  const recognitionRef = useRef<any>(null);
  const historyLoadedRef = useRef(false);
  const autoRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const karaokeTickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const closingRef = useRef(false);
  const replyScrollRef = useRef<HTMLDivElement>(null);
  const spokenWordRef = useRef<HTMLSpanElement>(null);
  // Monotonic request ID — bumped on every send and on user-tap cancel.
  // Lets stale async completions detect they've been superseded and skip state updates.
  const requestIdRef = useRef(0);

  // Live Voice state
  const [liveMode, setLiveMode] = useState(false);
  const liveWsRef = useRef<WebSocket | null>(null);
  // Two separate AudioContexts: output (24kHz TTS playback) and input (16kHz mic capture).
  // Output is pre-created synchronously during the user gesture so Chrome/Opera never
  // suspend it — their autoplay policy only blocks contexts created outside a gesture.
  const liveOutputCtxRef = useRef<AudioContext | null>(null);
  const liveInputCtxRef  = useRef<AudioContext | null>(null);
  // Keep liveAudioContextRef as an alias for playNextAudioChunk (uses output ctx)
  const liveAudioContextRef = liveOutputCtxRef;
  const liveAudioQueueRef = useRef<AudioBuffer[]>([]);
  const livePlayingRef = useRef(false);
  const liveMicStreamRef = useRef<MediaStream | null>(null);
  const liveScriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  // ElevenLabs TTS audio context (used when persona has a voice_id set)
  const elevenLabsAudioCtxRef = useRef<AudioContext | null>(null);
  // iOS Safari requires speechSynthesis.speak() to be called within a user gesture.
  // We unlock the audio session on the first tap so async speakReply() works.
  const audioUnlockedRef = useRef(false);
  // Set to true after any ElevenLabs failure so subsequent turns skip the
  // service entirely and go straight to browser TTS (avoids repeated 402/quota hangs).
  const ttsConsecFailuresRef = useRef(0);

  const unlockAudio = useCallback(() => {
    // One-time: unlock speechSynthesis for iOS — a silent utterance played
    // during the user gesture activates the iOS audio session.
    if (!audioUnlockedRef.current) {
      audioUnlockedRef.current = true;
      if (window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance('​');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
    }

    // Every tap: re-activate the Web Audio API context. Chrome re-suspends it
    // after each playback ends (autoplay policy), so a one-time unlock is not
    // enough — we must resume on every user gesture.  We also wire up
    // onstatechange so the context auto-heals during the no-tap auto-restart
    // flow (where the overlay resumes listening without requiring a new tap).
    try {
      const ctx = elevenLabsAudioCtxRef.current ?? new AudioContext();
      elevenLabsAudioCtxRef.current = ctx;
      // Auto-resume whenever Chrome re-suspends the context mid-session.
      // After the first user gesture the page has "user activation", so
      // resume() succeeds even from non-gesture callbacks like onstatechange.
      ctx.onstatechange = () => {
        if (ctx.state === "suspended" && !closingRef.current) {
          ctx.resume().catch(() => {});
        }
      };
      ctx.resume().then(() => {
        try {
          const silent = ctx.createBuffer(1, 1, 22050);
          const src    = ctx.createBufferSource();
          src.buffer   = silent;
          src.connect(ctx.destination);
          src.start(0);
        } catch { /* ignore */ }
      }).catch(() => {});
    } catch { /* AudioContext not supported on this browser */ }
  }, []);


  const effectiveLoading = persona ? personaLoading : isLoading;
  const effectiveReply   = persona ? personaReply   : lastBotMessage;

  const prevLoadingRef = useRef(effectiveLoading);
  const effectiveReplyRef = useRef(effectiveReply);
  useEffect(() => { effectiveReplyRef.current = effectiveReply; }, [effectiveReply]);

  // Pick an English voice once available (some browsers return [] until loaded)
  const pickVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (!window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    return (
      voices.find(v => v.lang?.startsWith("en") && v.default) ||
      voices.find(v => v.lang?.startsWith("en")) ||
      voices[0]
    );
  }, []);

  // ── Speech synthesis with karaoke ──────────────────────────
  const speakReply = useCallback((text: string) => {
    if (!text || closingRef.current) return;
    const synth = window.speechSynthesis;
    if (!synth) return;

    // Chrome bug: if synth is in a "paused" or stalled state, speak() fires no
    // sound. Resume, then cancel any queued utterance, then defer the new one
    // by a tick so Chrome actually plays it.
    try { synth.resume(); } catch { /* ignore */ }
    synth.cancel();

    setDisplayedReply(text);
    setSpokenUpTo(0);
    setPhase("speaking");

    const doSpeak = () => {
      if (closingRef.current) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.volume = 1;
      const voice = pickVoice();
      if (voice) utterance.voice = voice;

      utterance.onboundary = (ev: SpeechSynthesisEvent) => {
        if (ev.name === "word") {
          setSpokenUpTo(ev.charIndex + (ev.charLength ?? 0));
          spokenWordRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      };

      utterance.onend = () => {
        setSpokenUpTo(text.length);
        utteranceRef.current = null;
        if (resumeKeepAliveRef.current) {
          clearInterval(resumeKeepAliveRef.current);
          resumeKeepAliveRef.current = null;
        }
        if (!closingRef.current) setPhase("idle");
      };

      utterance.onerror = () => {
        utteranceRef.current = null;
        if (resumeKeepAliveRef.current) {
          clearInterval(resumeKeepAliveRef.current);
          resumeKeepAliveRef.current = null;
        }
        if (!closingRef.current) setPhase("idle");
      };

      utteranceRef.current = utterance;
      try { synth.resume(); } catch { /* ignore */ }
      synth.speak(utterance);

      // Chrome stops speech after ~15s of speaking. Calling resume() (without
      // pause) periodically keeps it going without truncating the utterance.
      if (resumeKeepAliveRef.current) clearInterval(resumeKeepAliveRef.current);
      resumeKeepAliveRef.current = setInterval(() => {
        if (!synth.speaking) {
          if (resumeKeepAliveRef.current) {
            clearInterval(resumeKeepAliveRef.current);
            resumeKeepAliveRef.current = null;
          }
          return;
        }
        try { synth.resume(); } catch { /* ignore */ }
      }, 5000);
    };

    // If voices aren't loaded yet, wait for them once
    if (!synth.getVoices().length) {
      const onVoices = () => {
        synth.removeEventListener("voiceschanged", onVoices);
        // small delay lets Chrome settle after cancel()
        setTimeout(doSpeak, 60);
      };
      synth.addEventListener("voiceschanged", onVoices);
      // Fallback in case voiceschanged never fires
      setTimeout(() => {
        synth.removeEventListener("voiceschanged", onVoices);
        doSpeak();
      }, 400);
    } else {
      // Tiny defer avoids the "cancel()-then-speak() silently dropped" bug
      setTimeout(doSpeak, 60);
    }
  }, [pickVoice]);

  // Track the currently-playing ElevenLabs <audio> element so we can clean up
  // before starting a new one (prevents stuck/overlapping playback on turn 2+).
  const elevenAudioElRef = useRef<HTMLAudioElement | null>(null);
  const elevenAudioUrlRef = useRef<string | null>(null);

  // ── ElevenLabs TTS — used for persona voices (voiceId set) ────────────────
  // Uses HTMLAudioElement + blob URL so playback works reliably across turns.
  // Falls back to browser speech synthesis on any error (quota, network, decode).
  // Gives up on ElevenLabs only after 3 consecutive real failures so that a
  // transient autoplay-policy rejection doesn't permanently silence a persona.
  const speakWithElevenLabs = useCallback(async (text: string, voiceId: string) => {
    setDisplayedReply(text);
    setSpokenUpTo(0);
    setPhase("speaking");

    // Give up after 3 consecutive real ElevenLabs failures this session.
    if (ttsConsecFailuresRef.current >= 3) {
      speakReply(text);
      return;
    }

    // Tear down any previous audio element + blob URL so we never leak or
    // double-play. Important when the user fires multiple turns in a row.
    if (elevenAudioElRef.current) {
      try { elevenAudioElRef.current.pause(); } catch { /* ignore */ }
      elevenAudioElRef.current.src = "";
      elevenAudioElRef.current = null;
    }
    if (elevenAudioUrlRef.current) {
      URL.revokeObjectURL(elevenAudioUrlRef.current);
      elevenAudioUrlRef.current = null;
    }
    if (karaokeTickRef.current) { clearTimeout(karaokeTickRef.current); karaokeTickRef.current = null; }

    try {
      // Race the invoke against a 12-second timeout so a hanging ElevenLabs
      // response (e.g. during quota exhaustion) doesn't leave the overlay
      // stuck in "speaking" with no audio. The timeout resolves (not rejects)
      // so it doesn't create an unhandled rejection when invoke wins the race.
      const ttsResult = await Promise.race([
        supabase.functions.invoke("mavis-tts", { body: { text, voice_id: voiceId } }),
        new Promise<{ data: null; error: Error }>((resolve) =>
          setTimeout(() => resolve({ data: null, error: new Error("TTS timeout (12s)") }), 12000)
        ),
      ]);
      const { data, error } = ttsResult;
      if (error || !data?.audioContent) throw new Error((data as any)?.error ?? "TTS unavailable");
      if (closingRef.current) return;

      const bytes = Uint8Array.from(atob(data.audioContent), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      elevenAudioUrlRef.current = url;

      const audio = new Audio(url);
      audio.preload = "auto";
      elevenAudioElRef.current = audio;

      const startKaraoke = (durationMs: number) => {
        const words = text.split(/\s+/);
        const msPerWord = durationMs / Math.max(words.length, 1);
        let charPos = 0;
        let wordIdx = 0;
        const tick = () => {
          if (wordIdx >= words.length || closingRef.current) { setSpokenUpTo(text.length); return; }
          charPos += words[wordIdx].length + 1;
          setSpokenUpTo(Math.min(charPos, text.length));
          wordIdx++;
          karaokeTickRef.current = setTimeout(tick, msPerWord);
        };
        karaokeTickRef.current = setTimeout(tick, msPerWord);
      };

      const cleanup = () => {
        if (karaokeTickRef.current) { clearTimeout(karaokeTickRef.current); karaokeTickRef.current = null; }
        if (elevenAudioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          elevenAudioUrlRef.current = null;
        }
        if (elevenAudioElRef.current === audio) elevenAudioElRef.current = null;
      };

      audio.onloadedmetadata = () => {
        const durMs = isFinite(audio.duration) && audio.duration > 0
          ? audio.duration * 1000
          : text.split(/\s+/).length * 280;
        startKaraoke(durMs);
      };
      audio.onended = () => {
        cleanup();
        if (!closingRef.current) { setSpokenUpTo(text.length); setPhase("idle"); }
      };
      audio.onerror = () => {
        cleanup();
        if (!closingRef.current) speakReply(text);
      };

      try {
        await audio.play();
        // Successful play — reset consecutive-failure counter.
        ttsConsecFailuresRef.current = 0;
      } catch (playErr: any) {
        // NotAllowedError = browser autoplay policy blocked us; this is transient
        // (user just needs to interact) — don't count it as an ElevenLabs failure.
        if (playErr?.name === "NotAllowedError") {
          cleanup();
          if (!closingRef.current) speakReply(text);
          return;
        }
        throw playErr;
      }
    } catch {
      ttsConsecFailuresRef.current += 1;
      if (!closingRef.current) speakReply(text);
    }
  }, [speakReply]);

  // ── Transition: thinking → speaking when loading finishes ──
  useEffect(() => {
    if (prevLoadingRef.current && !effectiveLoading && phase === "thinking" && !closingRef.current) {
      const msg = effectiveReplyRef.current;
      if (msg) {
        if (externalAudio) {
          // Caller plays audio — just show karaoke text with a word-timing simulation
          setDisplayedReply(msg);
          setSpokenUpTo(0);
          setPhase("speaking");
          // Simulate word boundaries at ~140ms/word since we have no onboundary
          const words = msg.split(/\s+/);
          let charPos = 0;
          let wordIdx = 0;
          const tick = () => {
            if (wordIdx >= words.length || closingRef.current) {
              setSpokenUpTo(msg.length);
              if (!closingRef.current) setPhase("idle");
              return;
            }
            charPos += words[wordIdx].length + 1;
            setSpokenUpTo(Math.min(charPos, msg.length));
            wordIdx++;
            karaokeTickRef.current = setTimeout(tick, 140);
          };
          karaokeTickRef.current = setTimeout(tick, 140);
        } else if (personaRef.current?.voiceId) {
          // Persona has an ElevenLabs voice — use it for dramatically better TTS
          speakWithElevenLabs(msg, personaRef.current.voiceId);
        } else {
          speakReply(msg);
        }
      } else {
        setPhase("idle");
      }
    }
    prevLoadingRef.current = effectiveLoading;
  }, [effectiveLoading, phase, externalAudio, speakReply, speakWithElevenLabs]);

  // Stable refs for dispatch fns so startListening doesn't change identity on
  // every parent render — that was cancelling the 1s auto-restart timer and
  // preventing subsequent voice turns from starting.
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);
  const personaRef = useRef(persona);
  useEffect(() => { personaRef.current = persona; }, [persona]);

  // ── Voice input ─────────────────────────────────────────────
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
  }, []);

  const sendPersonaMessage = useCallback(async (text: string) => {
    const p = personaRef.current;
    if (!p) { setPhase("idle"); return; }

    const reqId = ++requestIdRef.current;
    const isStale = () => requestIdRef.current !== reqId || closingRef.current;

    setPersonaLoading(true);
    setPersonaReply("");
    let reply = "";

    try {
      if (p.entityType === "persona" && p.entityId && p.userId) {
        // Race the edge function call against a 30-second client-side timeout so the
        // overlay never gets permanently stuck in "thinking" on a slow/hung function.
        const invokePromise = supabase.functions.invoke("mavis-persona-router", {
          body: { persona_id: p.entityId, user_id: p.userId, message: text },
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Persona router timed out (30s)")), 30000),
        );
        const result = await Promise.race([invokePromise, timeoutPromise]);
        if (isStale()) return;
        if (result.error) throw result.error;
        reply = (result.data as any)?.response ?? "";
        setPersonaReply(reply);
      } else {
        await streamChatMessage(
          text,
          p.systemPrompt,
          personaHistoryRef.current,
          { mode: "COUNCIL" },
          (_, acc) => {
            if (!isStale()) { reply = acc; setPersonaReply(acc); }
          },
        );
        if (isStale()) return;
        if (p.entityType === "council" && p.entityId && p.userId) {
          Promise.resolve(
            supabase.from("council_chat_messages").insert([
              { user_id: p.userId, council_member_id: p.entityId, role: "user",      content: text  },
              { user_id: p.userId, council_member_id: p.entityId, role: "assistant", content: reply },
            ])
          ).catch(() => {});
        }
      }

      if (!isStale()) {
        personaHistoryRef.current = [
          ...personaHistoryRef.current,
          { role: "user", content: text },
          { role: "assistant", content: reply },
        ];
        if (reply) onExchange?.(text, reply);
      }
    } catch {
      // Explicitly reset phase on any error so the UI never stays stuck in "thinking".
      if (!isStale()) setPhase("idle");
    } finally {
      // Only update loading state if this request hasn't been superseded (e.g. by user tap-cancel).
      if (!isStale()) setPersonaLoading(false);
    }
  }, [onExchange]);


  // ── Live Voice helpers ────────────────────────────────────────
  const playNextAudioChunk = useCallback(() => {
    const audioCtx = liveAudioContextRef.current;
    const queue = liveAudioQueueRef.current;
    if (!audioCtx || queue.length === 0) { livePlayingRef.current = false; return; }
    livePlayingRef.current = true;
    const source = audioCtx.createBufferSource();
    source.buffer = queue.shift()!;
    source.connect(audioCtx.destination);
    source.onended = playNextAudioChunk;
    source.start();
  }, []);

  const connectLiveVoice = useCallback(async () => {
    // Pre-create the output AudioContext HERE — synchronously, before any await —
    // so Chrome/Opera see it created during the user gesture (button click).
    // After the first await the browser no longer considers this a gesture context,
    // and Chrome will suspend any newly-created AudioContext automatically.
    if (!liveOutputCtxRef.current) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      liveOutputCtxRef.current = new AC({ sampleRate: 24000 });
      // Kick off resume() synchronously while activation is still live.
      // Don't await — it will complete in the background; we just need to start it.
      liveOutputCtxRef.current.resume().catch(() => {});
      // Auto-heal if Chrome re-suspends (e.g. tab goes to background then returns)
      liveOutputCtxRef.current.onstatechange = () => {
        if (liveOutputCtxRef.current?.state === "suspended") {
          liveOutputCtxRef.current.resume().catch(() => {});
        }
      };
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const wsUrl = supabaseUrl
      .replace("https://", "wss://")
      .replace("http://", "ws://");

    const systemParam = encodeURIComponent("You are MAVIS, a sovereign AI life OS.");
    const ws = new WebSocket(
      `${wsUrl}/functions/v1/mavis-live-voice?system=${systemParam}`,
    );

    // Attach bearer token via a sub-protocol trick isn't possible for Supabase edge
    // functions behind the standard WS upgrade — send it as the first message instead.
    ws.onopen = async () => {
      liveWsRef.current = ws;
      // Authenticate: send bearer token as first message
      ws.send(JSON.stringify({ type: "auth", token: session.access_token }));

      // Start capturing mic audio and streaming PCM chunks
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        liveMicStreamRef.current = stream;
        // Input context: separate from output — 16kHz for PCM streaming to server.
        // By this point the page has sticky activation (user clicked LIVE), so
        // resume() is permitted even from this async WebSocket callback.
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = liveInputCtxRef.current ?? new AC({ sampleRate: 16000 });
        liveInputCtxRef.current = audioCtx;
        if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
        const source = audioCtx.createMediaStreamSource(stream);
        // ScriptProcessor is deprecated but has the widest support without extra deps
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        liveScriptProcessorRef.current = processor;
        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const inputData = e.inputBuffer.getChannelData(0);
          // Convert Float32 PCM → Int16 PCM
          const pcm16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          // Base64-encode and send
          const bytes = new Uint8Array(pcm16.buffer);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          ws.send(JSON.stringify({ type: "audio_chunk", data: btoa(binary) }));
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
      } catch { /* mic access denied — live mode still works for text */ }
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "audio" && msg.data) {
          const audioData = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
          // Use the pre-created output context (24kHz) — never create a new one here
          // because onmessage is not a user-gesture context in Chrome/Opera.
          const audioCtx = liveOutputCtxRef.current;
          if (!audioCtx) return;
          if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
          try {
            const buffer = await audioCtx.decodeAudioData(audioData.buffer);
            liveAudioQueueRef.current.push(buffer);
            if (!livePlayingRef.current) playNextAudioChunk();
          } catch { /* skip bad chunks */ }
        }
        if (msg.type === "text" && msg.content) {
          setDisplayedReply((prev) => prev + msg.content);
        }
        if (msg.type === "turn_complete") {
          // Response finished — noop, audio queue drains naturally
        }
        if (msg.type === "ready") {
          setPhase("listening");
        }
      } catch { /* skip malformed */ }
    };

    ws.onclose = () => {
      liveWsRef.current = null;
      setLiveMode(false);
      setPhase("idle");
    };
  }, [playNextAudioChunk]);

  const disconnectLiveVoice = useCallback(() => {
    // Stop mic capture
    if (liveScriptProcessorRef.current) {
      liveScriptProcessorRef.current.disconnect();
      liveScriptProcessorRef.current = null;
    }
    if (liveMicStreamRef.current) {
      liveMicStreamRef.current.getTracks().forEach((t) => t.stop());
      liveMicStreamRef.current = null;
    }
    liveWsRef.current?.close();
    liveWsRef.current = null;
    liveOutputCtxRef.current?.close().catch(() => {});
    liveOutputCtxRef.current = null;
    liveInputCtxRef.current?.close().catch(() => {});
    liveInputCtxRef.current = null;
    livePlayingRef.current = false;
    liveAudioQueueRef.current = [];
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let lastCapturedText = "";
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    const SILENCE_MS = 6000;

    const normalizeTranscript = (value: string) =>
      value.replace(/\s+/g, " ").trim();

    const mergeTranscriptSegments = (segments: string[]) => {
      const cleaned = segments.map(normalizeTranscript).filter(Boolean);
      if (cleaned.length === 0) return "";

      const mergedWords: string[] = [];

      for (const segment of cleaned) {
        const nextWords = segment.split(" ").filter(Boolean);
        if (nextWords.length === 0) continue;

        if (mergedWords.length === 0) {
          mergedWords.push(...nextWords);
          continue;
        }

        const mergedText = mergedWords.join(" ").toLowerCase();
        const nextText = nextWords.join(" ").toLowerCase();

        if (nextText === mergedText || mergedText.endsWith(nextText)) {
          continue;
        }

        if (nextText.startsWith(mergedText)) {
          mergedWords.splice(0, mergedWords.length, ...nextWords);
          continue;
        }

        let overlap = 0;
        const maxOverlap = Math.min(mergedWords.length, nextWords.length);
        for (let size = maxOverlap; size > 0; size--) {
          const mergedTail = mergedWords.slice(-size).join(" ").toLowerCase();
          const nextHead = nextWords.slice(0, size).join(" ").toLowerCase();
          if (mergedTail === nextHead) {
            overlap = size;
            break;
          }
        }

        if (overlap > 0) {
          mergedWords.push(...nextWords.slice(overlap));
          continue;
        }

        mergedWords.push(...nextWords);
      }

      return mergedWords.join(" ");
    };

    const syncTranscriptState = (results: SpeechRecognitionResultList | any[]) => {
      const finalSegments: string[] = [];
      const interimSegments: string[] = [];

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const text = normalizeTranscript(result?.[0]?.transcript ?? "");
        if (!text) continue;

        if (result.isFinal) finalSegments.push(text);
        else interimSegments.push(text);
      }

      const confirmed = mergeTranscriptSegments(finalSegments);
      const live = mergeTranscriptSegments(interimSegments);
      const fullCapture = mergeTranscriptSegments([confirmed, live].filter(Boolean));

      lastCapturedText = fullCapture;

      if (!confirmed) {
        setTranscript("");
        setInterimTranscript(fullCapture);
        return;
      }

      if (!fullCapture || fullCapture.toLowerCase() === confirmed.toLowerCase()) {
        setTranscript(confirmed);
        setInterimTranscript("");
        return;
      }

      const confirmedLower = confirmed.toLowerCase();
      const fullLower = fullCapture.toLowerCase();

      if (fullLower.startsWith(confirmedLower)) {
        const delta = normalizeTranscript(fullCapture.slice(confirmed.length));
        setTranscript(confirmed);
        setInterimTranscript(delta);
        return;
      }

      setTranscript("");
      setInterimTranscript(fullCapture);
    };

    function resetSilenceTimer() {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (recognitionRef.current) recognitionRef.current.stop();
      }, SILENCE_MS);
    }

    recognition.onresult = (event: any) => {
      syncTranscriptState(event.results);
      resetSilenceTimer();
    };

    recognition.onerror = (event: any) => {
      // no-speech: Chrome fires this silently after a pause — let the silence
      // timer handle it rather than killing the session. aborted: we triggered
      // it intentionally via recognition.abort(), no phase change needed.
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (silenceTimer) clearTimeout(silenceTimer);
      recognitionRef.current = null;
      if (!closingRef.current) setPhase("idle");
    };

    recognition.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      recognitionRef.current = null;
      if (closingRef.current) return;
      const captured = normalizeTranscript(lastCapturedText);
      if (captured) {
        setPhase("thinking");
        setTranscript("");
        setInterimTranscript("");
        const dispatch = personaRef.current ? sendPersonaMessage : sendMessageRef.current;
        dispatch?.(captured).catch(() => {
          if (!closingRef.current) setPhase("idle");
        });
      } else {
        setPhase("idle");
      }
    };

    recognitionRef.current = recognition;
    setTranscript("");
    setInterimTranscript("");
    recognition.start();
    setPhase("listening");
  }, [sendPersonaMessage]);

  // Auto-restart after speaking finishes (skip in live mode — WS handles it)
  useEffect(() => {
    if (phase === "idle" && !closingRef.current && !liveMode) {
      autoRestartTimerRef.current = setTimeout(() => {
        if (!closingRef.current && !liveMode) startListening();
      }, 1000);
    }
    return () => {
      if (autoRestartTimerRef.current) {
        clearTimeout(autoRestartTimerRef.current);
        autoRestartTimerRef.current = null;
      }
    };
  }, [phase, liveMode, startListening]);

  const handleClose = useCallback(() => {
    closingRef.current = true;
    if (autoRestartTimerRef.current) clearTimeout(autoRestartTimerRef.current);
    if (karaokeTickRef.current) clearTimeout(karaokeTickRef.current);
    if (resumeKeepAliveRef.current) clearInterval(resumeKeepAliveRef.current);
    stopListening();
    disconnectLiveVoice();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    elevenLabsAudioCtxRef.current?.close().catch(() => {});
    elevenLabsAudioCtxRef.current = null;
    if (elevenAudioElRef.current) {
      try { elevenAudioElRef.current.pause(); } catch { /* ignore */ }
      elevenAudioElRef.current.src = "";
      elevenAudioElRef.current = null;
    }
    if (elevenAudioUrlRef.current) {
      URL.revokeObjectURL(elevenAudioUrlRef.current);
      elevenAudioUrlRef.current = null;
    }
    onClose();
  }, [onClose, stopListening, disconnectLiveVoice]);

  // Load prior conversation history into personaHistoryRef so the AI has
  // full context from previous sessions when the overlay opens.
  useEffect(() => {
    if (historyLoadedRef.current || !persona?.entityId || !persona?.userId) return;
    historyLoadedRef.current = true;
    const { entityId, entityType, userId } = persona;

    (async () => {
      try {
        if (entityType === "persona") {
          const { data } = await supabase
            .from("persona_conversations" as any)
            .select("role, content")
            .eq("persona_id", entityId)
            .eq("user_id", userId)
            .order("created_at", { ascending: true })
            .limit(40);
          if (data?.length) personaHistoryRef.current = data as unknown as { role: string; content: string }[];
        } else if (entityType === "council") {
          const { data } = await (supabase as any)
            .from("council_chat_messages")
            .select("role, content")
            .eq("council_member_id", entityId)
            .eq("user_id", userId)
            .order("created_at", { ascending: true })
            .limit(40);
          if (data?.length) personaHistoryRef.current = data as { role: string; content: string }[];
        }
      } catch { /* non-critical — start fresh if load fails */ }
    })();
  }, [persona?.entityId, persona?.entityType, persona?.userId]);

  // Warm up voices list on mount (Chrome lazy-loads them)
  useEffect(() => {
    if (window.speechSynthesis && !window.speechSynthesis.getVoices().length) {
      window.speechSynthesis.getVoices();
    }
    // Reset unlock flag so the audio session is re-activated on every overlay open.
    // iOS can re-lock audio if the page is backgrounded between sessions.
    audioUnlockedRef.current = false;
    // Give ElevenLabs a fresh chance on each new overlay session — credits may
    // have been replenished since the last time the overlay was open.
    ttsConsecFailuresRef.current = 0;
  }, []);

  const handleOrbOrMicTap = useCallback(() => {
    // Unlock iOS audio session on every tap so async speakReply() can play sound.
    // On other platforms this is a harmless no-op after the first call.
    unlockAudio();
    if (liveMode) {
      // In live mode, tapping sends an interrupt signal
      if (liveWsRef.current?.readyState === WebSocket.OPEN) {
        liveWsRef.current.send(JSON.stringify({ type: "interrupt" }));
      }
      return;
    }
    if (phase === "idle") startListening();
    else if (phase === "listening") {
      if (recognitionRef.current) recognitionRef.current.stop();
    } else if (phase === "thinking") {
      // Cancel the in-flight request by bumping the request ID, then return to idle
      // so the user isn't permanently stuck waiting for a slow/hung edge function.
      requestIdRef.current++;
      setPersonaLoading(false);
      setPhase("idle");
    } else if (phase === "speaking") {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      setPhase("idle");
    }
  }, [phase, liveMode, startListening, unlockAudio]);

  const phaseLabel: Record<Phase, string> = {
    idle: "TAP TO SPEAK",
    listening: "LISTENING — pause ~10s to send",
    thinking: "THINKING... — TAP TO CANCEL",
    speaking: "TAP ORB TO INTERRUPT",
  };

  const speakerName = persona?.name ?? "MAVIS";
  const speakerRole = persona?.role;

  // Karaoke split
  const spoken    = displayedReply.slice(0, spokenUpTo);
  const remaining = displayedReply.slice(spokenUpTo);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/55 backdrop-blur-[2px] px-6"
    >
      {/* Close */}
      <button
        onClick={handleClose}
        className="absolute top-5 right-5 p-2 rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-all"
        aria-label="Close voice mode"
      >
        <X size={20} />
      </button>

      {/* Speaker label + Live toggle */}
      <div className="absolute top-5 left-6 flex items-center gap-2.5">
        {/* Avatar */}
        <div className="shrink-0 w-10 h-10 rounded-full overflow-hidden border-2 border-primary/40 bg-primary/10 flex items-center justify-center">
          {persona?.avatarUrl ? (
            <img src={persona.avatarUrl} alt={speakerName} className="w-full h-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-primary/80 font-display">
              {speakerName[0]?.toUpperCase() ?? "?"}
            </span>
          )}
        </div>
        <div>
          <p className="text-xs font-mono font-bold text-primary tracking-widest">{speakerName}</p>
          {speakerRole && <p className="text-xs font-mono text-muted-foreground">{speakerRole}</p>}
        </div>
        <button
          onClick={() => {
            if (!liveMode) { setLiveMode(true); connectLiveVoice(); }
            else { disconnectLiveVoice(); setLiveMode(false); }
          }}
          className={`text-xs font-mono px-2 py-0.5 rounded-full border transition-all ${
            liveMode
              ? "bg-neon-gold/20 border-neon-gold/50 text-neon-gold"
              : "bg-white/5 border-white/10 text-white/30 hover:text-white/60"
          }`}
        >
          {liveMode ? "● LIVE" : "LIVE"}
        </button>
      </div>

      {/* Orb */}
      <button
        onClick={handleOrbOrMicTap}
        className={[
          "relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 shrink-0 overflow-hidden",
          "bg-primary/20 border-2 border-primary/40",
          phase === "listening" ? "animate-pulse scale-110" : "",
          phase === "speaking"  ? "shadow-[0_0_40px_rgba(139,92,246,0.5)] scale-105" : "",
        ].filter(Boolean).join(" ")}
      >
        <span className={[
          "absolute inset-1 rounded-full border-2 border-transparent border-t-primary/70 z-10",
          phase === "thinking" ? "animate-spin" : "opacity-0",
        ].join(" ")} />
        {persona?.avatarUrl ? (
          <>
            <img src={persona.avatarUrl} alt={speakerName} className="absolute inset-0 w-full h-full object-cover" />
            {phase === "listening" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
                <Mic size={28} className="text-primary" />
              </div>
            )}
          </>
        ) : (
          <Mic size={28} className={phase === "listening" ? "text-primary" : "text-primary/60"} />
        )}
      </button>

      {/* Phase label */}
      <p className="text-xs font-mono tracking-widest text-primary">{phaseLabel[phase]}</p>

      {/* What you're saying — show live interim OR confirmed text, never both */}
      <AnimatePresence>
        {(interimTranscript || transcript) && (
          <motion.div
            key="transcript"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-md px-4"
          >
            <p className="text-xs font-mono text-primary/50 tracking-widest text-center mb-1 uppercase">
              You
            </p>
            <p className="text-center text-sm font-mono leading-relaxed break-words">
              {transcript && <span className="text-white/90">{transcript}</span>}
              {transcript && interimTranscript && " "}
              {interimTranscript && <span className="text-white/50 italic">{interimTranscript}</span>}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI response — karaoke word reveal, full scrollable text */}
      {displayedReply ? (
        <div
          ref={replyScrollRef}
          className="w-full max-w-lg max-h-56 overflow-y-auto rounded-lg px-1 py-1"
          style={{ scrollbarWidth: "none" }}
        >
          <p className="text-center text-sm font-mono leading-relaxed break-words">
            {/* Spoken words — full white */}
            <span className="text-white">{spoken}</span>
            {/* Current boundary marker for scroll targeting */}
            <span ref={spokenWordRef} />
            {/* Upcoming words — dimmed */}
            <span className="text-white/30">{remaining}</span>
          </p>
        </div>
      ) : phase === "thinking" ? (
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-primary/60"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      ) : null}

      {/* Bottom mic button */}
      <button
        onClick={handleOrbOrMicTap}
        className={[
          "absolute bottom-12 w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 border-2",
          phase === "listening"
            ? "bg-destructive/20 border-destructive/50 text-destructive animate-pulse"
            : "bg-primary/10 border-primary/30 text-primary/70 hover:bg-primary/20 hover:text-primary",
        ].join(" ")}
        aria-label={phase === "listening" ? "Stop" : "Speak"}
      >
        <Mic size={32} />
      </button>
    </motion.div>
  );
}
