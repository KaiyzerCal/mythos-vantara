import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic } from "lucide-react";
import { streamChatMessage } from "@/mavis/chatService";

export interface VoicePersona {
  name: string;
  role?: string;
  systemPrompt: string;
}

interface VoiceChatOverlayProps {
  onClose: () => void;
  // MAVIS mode — required when persona is not provided
  sendMessage?: (text: string) => Promise<void>;
  lastBotMessage?: string;
  isLoading?: boolean;
  // Persona mode — self-contained conversation when provided
  persona?: VoicePersona;
}

type Phase = "idle" | "listening" | "thinking" | "speaking";

export function VoiceChatOverlay({
  onClose,
  sendMessage,
  lastBotMessage = "",
  isLoading = false,
  persona,
}: VoiceChatOverlayProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");

  // Persona-mode internal state
  const [personaReply, setPersonaReply] = useState("");
  const [personaLoading, setPersonaLoading] = useState(false);
  const personaHistoryRef = useRef<{ role: string; content: string }[]>([]);

  const recognitionRef = useRef<any>(null);
  const autoRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  const effectiveLoading = persona ? personaLoading : isLoading;
  const effectiveReply   = persona ? personaReply   : lastBotMessage;

  const prevLoadingRef   = useRef(effectiveLoading);
  const effectiveReplyRef = useRef(effectiveReply);
  useEffect(() => { effectiveReplyRef.current = effectiveReply; }, [effectiveReply]);

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
      // non-critical — phase will fall back to idle via loading transition
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
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalText = "";

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += t + " ";
          setTranscript(finalText.trim());
        } else {
          interim = t;
        }
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = () => {
      recognitionRef.current = null;
      if (!closingRef.current) setPhase("idle");
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (closingRef.current) return;
      const captured = finalText.trim();
      if (captured) {
        setPhase("thinking");
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

  // Transition: thinking → speaking when loading finishes
  useEffect(() => {
    if (prevLoadingRef.current && !effectiveLoading && phase === "thinking" && !closingRef.current) {
      const msg = effectiveReplyRef.current;
      if (msg && typeof window !== "undefined" && window.speechSynthesis) {
        setPhase("speaking");
        const utterance = new SpeechSynthesisUtterance(msg);
        utterance.onend = () => { if (!closingRef.current) setPhase("idle"); };
        utterance.onerror = () => { if (!closingRef.current) setPhase("idle"); };
        window.speechSynthesis.speak(utterance);
      } else {
        setPhase("idle");
      }
    }
    prevLoadingRef.current = effectiveLoading;
  }, [effectiveLoading, phase]);

  // Auto-restart listening after speaking or idle
  useEffect(() => {
    if (phase === "idle" && !closingRef.current) {
      autoRestartTimerRef.current = setTimeout(() => {
        if (!closingRef.current) startListening();
      }, 1200);
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
    else if (phase === "listening") stopListening();
  }, [phase, startListening, stopListening]);

  const phaseLabel: Record<Phase, string> = {
    idle: "TAP TO SPEAK",
    listening: "LISTENING...",
    thinking: "THINKING...",
    speaking: "SPEAKING...",
  };

  const orbListening = phase === "listening";
  const orbThinking  = phase === "thinking";
  const orbSpeaking  = phase === "speaking";

  const speakerName = persona?.name ?? "MAVIS";
  const speakerRole = persona?.role;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md"
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
      <div className="absolute top-5 left-6 text-left">
        <p className="text-xs font-mono font-bold text-primary tracking-widest">{speakerName}</p>
        {speakerRole && <p className="text-[10px] font-mono text-muted-foreground">{speakerRole}</p>}
      </div>

      {/* Orb */}
      <button
        onClick={handleOrbOrMicTap}
        className={[
          "relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300",
          "bg-primary/20 border-2 border-primary/40",
          orbListening ? "animate-pulse scale-110" : "",
          orbSpeaking ? "shadow-[0_0_40px_rgba(139,92,246,0.5)]" : "",
        ].filter(Boolean).join(" ")}
        aria-label={phase === "listening" ? "Stop listening" : "Start listening"}
      >
        <span className={[
          "absolute inset-1 rounded-full border-2 border-transparent border-t-primary/70",
          orbThinking ? "animate-spin" : "opacity-0",
        ].join(" ")} />
        <Mic size={28} className={phase === "listening" ? "text-primary" : "text-primary/60"} />
      </button>

      {/* Phase label */}
      <p className="mt-4 text-xs font-mono tracking-widest text-primary">{phaseLabel[phase]}</p>

      {/* Transcript */}
      <AnimatePresence mode="wait">
        {(transcript || interimTranscript) && (
          <motion.p
            key="transcript"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 max-w-sm px-4 text-center text-xs font-mono text-muted-foreground line-clamp-3"
          >
            {transcript || interimTranscript}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Response */}
      <AnimatePresence mode="wait">
        {effectiveReply && phase !== "idle" && (
          <motion.p
            key="response"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-6 max-w-sm px-4 text-center text-sm font-mono text-white line-clamp-4"
          >
            {effectiveReply}
          </motion.p>
        )}
      </AnimatePresence>

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
