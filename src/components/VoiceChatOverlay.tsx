import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic } from "lucide-react";
import { streamChatMessage } from "@/mavis/chatService";

// Chrome continuous-mode often re-emits already-finalized words at the start
// of the next interim result, causing visible duplication. Strip the overlap.
function stripFinalOverlap(finalized: string, interim: string): string {
  if (!interim || !finalized) return interim;
  const fw = finalized.toLowerCase().split(/\s+/);
  const iw = interim.toLowerCase().split(/\s+/);
  for (let n = Math.min(fw.length, iw.length); n > 0; n--) {
    if (fw.slice(-n).join(" ") === iw.slice(0, n).join(" ")) {
      return interim.split(/\s+/).slice(n).join(" ");
    }
  }
  return interim;
}

export interface VoicePersona {
  name: string;
  role?: string;
  systemPrompt: string;
  voiceId?: string;
  entityId?: string;
  entityType?: string;
}

interface VoiceChatOverlayProps {
  onClose: () => void;
  sendMessage?: (text: string) => Promise<void>;
  lastBotMessage?: string;
  isLoading?: boolean;
  persona?: VoicePersona;
  // When true, skip internal speechSynthesis (caller handles audio externally)
  externalAudio?: boolean;
}

type Phase = "idle" | "listening" | "thinking" | "speaking";

export function VoiceChatOverlay({
  onClose,
  sendMessage,
  lastBotMessage = "",
  isLoading = false,
  persona,
  externalAudio = false,
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
  const autoRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const closingRef = useRef(false);
  const replyScrollRef = useRef<HTMLDivElement>(null);
  const spokenWordRef = useRef<HTMLSpanElement>(null);

  const effectiveLoading = persona ? personaLoading : isLoading;
  const effectiveReply   = persona ? personaReply   : lastBotMessage;

  const prevLoadingRef = useRef(effectiveLoading);
  const effectiveReplyRef = useRef(effectiveReply);
  useEffect(() => { effectiveReplyRef.current = effectiveReply; }, [effectiveReply]);

  // ── Speech synthesis with karaoke ──────────────────────────
  const speakReply = useCallback((text: string) => {
    if (!text || closingRef.current) return;
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    setDisplayedReply(text);
    setSpokenUpTo(0);
    setPhase("speaking");

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1;

    utterance.onboundary = (ev: SpeechSynthesisEvent) => {
      if (ev.name === "word") {
        setSpokenUpTo(ev.charIndex + (ev.charLength ?? 0));
        // Keep spoken word in view
        spokenWordRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    };

    utterance.onend = () => {
      setSpokenUpTo(text.length);
      utteranceRef.current = null;
      if (!closingRef.current) setPhase("idle");
    };

    utterance.onerror = () => {
      utteranceRef.current = null;
      if (!closingRef.current) setPhase("idle");
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

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
            autoRestartTimerRef.current = setTimeout(tick, 140);
          };
          autoRestartTimerRef.current = setTimeout(tick, 140);
        } else {
          speakReply(msg);
        }
      } else {
        setPhase("idle");
      }
    }
    prevLoadingRef.current = effectiveLoading;
  }, [effectiveLoading, phase, externalAudio, speakReply]);

  // ── Voice input ─────────────────────────────────────────────
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
  }, []);

  const sendPersonaMessage = useCallback(async (text: string) => {
    if (!persona) return;
    setPersonaLoading(true);
    setPersonaReply("");
    let accumulated = "";
    try {
      await streamChatMessage(
        text,
        persona.systemPrompt,
        personaHistoryRef.current,
        { mode: "CHAT" },
        (_, acc) => { accumulated = acc; setPersonaReply(acc); },
      );
      personaHistoryRef.current = [
        ...personaHistoryRef.current,
        { role: "user", content: text },
        { role: "assistant", content: accumulated },
      ];
    } catch {
      // phase falls back to idle via loading transition
    } finally {
      setPersonaLoading(false);
    }
  }, [persona]);

  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalText = "";
    // Guard against Chrome re-firing the same final result at the same index
    const finalizedIndices = new Set<number>();
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    const SILENCE_MS = 1800;

    function resetSilenceTimer() {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (recognitionRef.current) recognitionRef.current.stop();
      }, SILENCE_MS);
    }

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const t: string = result[0].transcript;
        if (result.isFinal) {
          if (!finalizedIndices.has(i)) {
            finalizedIndices.add(i);
            finalText += t + " ";
            setTranscript(finalText.trim());
          }
        } else {
          interim = t;
        }
      }
      // Strip words the interim shares with already-finalized text so the
      // display never shows "word word word word" repetition
      setInterimTranscript(stripFinalOverlap(finalText.trim(), interim.trim()));
      resetSilenceTimer();
    };

    recognition.onerror = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      recognitionRef.current = null;
      if (!closingRef.current) setPhase("idle");
    };

    recognition.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      recognitionRef.current = null;
      if (closingRef.current) return;
      const captured = finalText.trim();
      if (captured) {
        setPhase("thinking");
        setTranscript("");
        setInterimTranscript("");
        const dispatch = persona ? sendPersonaMessage : sendMessage;
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
  }, [sendMessage, sendPersonaMessage, persona]);

  // Auto-restart after speaking finishes
  useEffect(() => {
    if (phase === "idle" && !closingRef.current) {
      autoRestartTimerRef.current = setTimeout(() => {
        if (!closingRef.current) startListening();
      }, 1000);
    }
    return () => {
      if (autoRestartTimerRef.current) {
        clearTimeout(autoRestartTimerRef.current);
        autoRestartTimerRef.current = null;
      }
    };
  }, [phase, startListening]);

  const handleClose = useCallback(() => {
    closingRef.current = true;
    if (autoRestartTimerRef.current) clearTimeout(autoRestartTimerRef.current);
    stopListening();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    onClose();
  }, [onClose, stopListening]);

  const handleOrbOrMicTap = useCallback(() => {
    if (phase === "idle") startListening();
    else if (phase === "listening") {
      if (recognitionRef.current) recognitionRef.current.stop();
    } else if (phase === "speaking") {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      setPhase("idle");
    }
  }, [phase, startListening]);

  const phaseLabel: Record<Phase, string> = {
    idle: "TAP TO SPEAK",
    listening: "LISTENING — pause to send",
    thinking: "THINKING...",
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
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/92 backdrop-blur-md px-6"
    >
      {/* Close */}
      <button
        onClick={handleClose}
        className="absolute top-5 right-5 p-2 rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-all"
        aria-label="Close voice mode"
      >
        <X size={20} />
      </button>

      {/* Speaker label */}
      <div className="absolute top-5 left-6">
        <p className="text-xs font-mono font-bold text-primary tracking-widest">{speakerName}</p>
        {speakerRole && <p className="text-[10px] font-mono text-muted-foreground">{speakerRole}</p>}
      </div>

      {/* Orb */}
      <button
        onClick={handleOrbOrMicTap}
        className={[
          "relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 shrink-0",
          "bg-primary/20 border-2 border-primary/40",
          phase === "listening" ? "animate-pulse scale-110" : "",
          phase === "speaking"  ? "shadow-[0_0_40px_rgba(139,92,246,0.5)] scale-105" : "",
        ].filter(Boolean).join(" ")}
      >
        <span className={[
          "absolute inset-1 rounded-full border-2 border-transparent border-t-primary/70",
          phase === "thinking" ? "animate-spin" : "opacity-0",
        ].join(" ")} />
        <Mic size={28} className={phase === "listening" ? "text-primary" : "text-primary/60"} />
      </button>

      {/* Phase label */}
      <p className="text-xs font-mono tracking-widest text-primary">{phaseLabel[phase]}</p>

      {/* User transcript */}
      <AnimatePresence mode="wait">
        {(transcript || interimTranscript) && (
          <motion.p
            key="transcript"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="max-w-sm text-center text-xs font-mono text-muted-foreground leading-relaxed"
          >
            {transcript}
            {interimTranscript && (
              <span className="text-white/40"> {interimTranscript}</span>
            )}
          </motion.p>
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
