import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, Volume2 } from "lucide-react";
import { streamChatMessage } from "@/mavis/chatService";

export interface VoicePersona {
  name: string;
  role?: string;
  systemPrompt: string;
}

interface VoiceChatOverlayProps {
  onClose: () => void;
  sendMessage?: (text: string) => Promise<void>;
  lastBotMessage?: string;
  isLoading?: boolean;
  persona?: VoicePersona;
}

type Phase = "idle" | "listening" | "thinking" | "speaking";

// Handles Chrome's multiple speechSynthesis quirks:
// 1. cancel() + speak() in same tick can fail → use setTimeout
// 2. speech can get paused silently → resume after 150ms
// 3. voices may not be loaded → rely on outer preload
function speakText(text: string, onEnd: () => void): void {
  if (!text || !("speechSynthesis" in window)) { onEnd(); return; }
  window.speechSynthesis.cancel();
  setTimeout(() => {
    const utter = new SpeechSynthesisUtterance(text.slice(0, 2000));
    utter.rate   = 1.0;
    utter.pitch  = 1.0;
    utter.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const pick =
      voices.find(v => v.lang.startsWith("en") && (v.name.includes("Neural") || v.name.includes("Natural") || v.name.includes("Premium") || v.name.includes("Enhanced"))) ||
      voices.find(v => v.lang === "en-US" && !v.localService) ||
      voices.find(v => v.lang.startsWith("en-US")) ||
      voices.find(v => v.lang.startsWith("en"));
    if (pick) utter.voice = pick;
    utter.onend   = onEnd;
    utter.onerror = onEnd;
    window.speechSynthesis.speak(utter);
    // Chrome silent-pause bug: resume if stuck
    setTimeout(() => {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    }, 150);
  }, 50);
}

export function VoiceChatOverlay({
  onClose,
  sendMessage,
  lastBotMessage = "",
  isLoading = false,
  persona,
}: VoiceChatOverlayProps) {
  const [phase, setPhase]               = useState<Phase>("idle");
  const [transcript, setTranscript]     = useState("");
  const [interim, setInterim]           = useState("");
  const [displayReply, setDisplayReply] = useState("");

  const personaHistoryRef   = useRef<{ role: string; content: string }[]>([]);
  const recognitionRef      = useRef<any>(null);
  const restartTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef          = useRef(false);
  const phaseRef            = useRef<Phase>("idle");
  const prevBotMsgRef       = useRef(lastBotMessage);

  // Keep phaseRef in sync so callbacks see current phase without stale closure
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Pre-load voices on mount (Chrome requires a user gesture then a getVoices() call)
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
    const onLoaded = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", onLoaded);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", onLoaded);
  }, []);

  const handleSpeakEnd = useCallback(() => {
    if (!closingRef.current) setPhase("idle");
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
  }, []);

  // Persona mode: stream reply then speak it directly (no effect indirection)
  const sendPersonaMessage = useCallback(async (text: string) => {
    if (!persona) return;
    setDisplayReply("");
    setPhase("thinking");
    let accumulated = "";
    try {
      await streamChatMessage(
        text,
        persona.systemPrompt,
        personaHistoryRef.current,
        { mode: "CHAT" },
        (_, acc) => { accumulated = acc; setDisplayReply(acc); },
      );
      personaHistoryRef.current = [
        ...personaHistoryRef.current,
        { role: "user", content: text },
        { role: "assistant", content: accumulated },
      ];
      if (!closingRef.current && accumulated) {
        setPhase("speaking");
        speakText(accumulated, handleSpeakEnd);
      } else if (!closingRef.current) {
        setPhase("idle");
      }
    } catch {
      if (!closingRef.current) setPhase("idle");
    }
  }, [persona, handleSpeakEnd]);

  // MAVIS mode: fire TTS when lastBotMessage arrives AND we're in thinking phase
  useEffect(() => {
    if (persona) return;
    if (prevBotMsgRef.current === lastBotMessage) return;
    prevBotMsgRef.current = lastBotMessage;
    if (!lastBotMessage || isLoading || closingRef.current) return;
    if (phaseRef.current !== "thinking") return;
    setDisplayReply(lastBotMessage);
    setPhase("speaking");
    speakText(lastBotMessage, handleSpeakEnd);
  }, [lastBotMessage, isLoading, persona, handleSpeakEnd]);

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const r = new SR();
    r.continuous      = false;
    r.interimResults  = true;
    r.lang            = "en-US";
    let finalText     = "";

    r.onresult = (ev: any) => {
      let int = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) { finalText += t + " "; setTranscript(finalText.trim()); }
        else int = t;
      }
      setInterim(int);
    };

    r.onerror = () => {
      recognitionRef.current = null;
      if (!closingRef.current) setPhase("idle");
    };

    r.onend = () => {
      recognitionRef.current = null;
      if (closingRef.current) return;
      const captured = finalText.trim();
      if (!captured) { setPhase("idle"); return; }

      setPhase("thinking");
      if (persona) {
        sendPersonaMessage(captured).catch(() => { if (!closingRef.current) setPhase("idle"); });
      } else {
        sendMessage?.(captured).catch(() => { if (!closingRef.current) setPhase("idle"); });
      }
    };

    recognitionRef.current = r;
    setTranscript("");
    setInterim("");
    r.start();
    setPhase("listening");
  }, [sendMessage, sendPersonaMessage, persona]);

  // Auto-restart after idle
  useEffect(() => {
    if (phase !== "idle" || closingRef.current) return;
    restartTimerRef.current = setTimeout(() => {
      if (!closingRef.current) startListening();
    }, 1200);
    return () => {
      if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    };
  }, [phase, startListening]);

  const handleClose = useCallback(() => {
    closingRef.current = true;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    stopListening();
    window.speechSynthesis?.cancel();
    onClose();
  }, [onClose, stopListening]);

  // Orb tap: toggle listen / skip speech / stop listen
  const handleTap = useCallback(() => {
    if (phase === "idle")       startListening();
    else if (phase === "listening") stopListening();
    else if (phase === "speaking") {
      window.speechSynthesis?.cancel();
      setPhase("idle");
    }
  }, [phase, startListening, stopListening]);

  const phaseLabel: Record<Phase, string> = {
    idle:      "TAP TO SPEAK",
    listening: "LISTENING...",
    thinking:  "THINKING...",
    speaking:  "SPEAKING...",
  };

  const speakerName = persona?.name ?? "MAVIS";
  const speakerRole = persona?.role;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/92 backdrop-blur-md"
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
      <div className="absolute top-6 left-6">
        <p className="text-xs font-mono font-bold text-primary tracking-widest">{speakerName}</p>
        {speakerRole && <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{speakerRole}</p>}
      </div>

      {/* Central orb */}
      <button
        onClick={handleTap}
        className={[
          "relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300",
          "bg-primary/15 border-2",
          phase === "listening" ? "border-primary scale-110 ring-8 ring-primary/15 animate-pulse" : "",
          phase === "speaking"  ? "border-primary/80 scale-108 shadow-[0_0_60px_rgba(139,92,246,0.55)]" : "",
          phase === "thinking"  ? "border-primary/50" : "",
          phase === "idle"      ? "border-primary/30 hover:border-primary/60 hover:scale-105" : "",
        ].filter(Boolean).join(" ")}
        aria-label={phase === "listening" ? "Stop listening" : "Start speaking"}
      >
        {/* Spinning ring when thinking */}
        <span className={[
          "absolute inset-2 rounded-full border-2 border-transparent border-t-primary/70 transition-opacity",
          phase === "thinking" ? "animate-spin opacity-100" : "opacity-0",
        ].join(" ")} />

        {phase === "speaking"
          ? <Volume2 size={36} className="text-primary animate-pulse" />
          : <Mic     size={36} className={phase === "listening" ? "text-primary" : "text-primary/60"} />
        }
      </button>

      {/* Phase label */}
      <p className="mt-5 text-[11px] font-mono tracking-[0.2em] text-primary">{phaseLabel[phase]}</p>

      {/* User transcript */}
      <AnimatePresence mode="wait">
        {(transcript || interim) && (
          <motion.div
            key="transcript"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="mt-5 max-w-xs px-5 py-2 rounded-xl bg-white/5 border border-white/10"
          >
            <p className="text-center text-sm font-mono text-muted-foreground">
              {transcript || interim}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI response */}
      <AnimatePresence mode="wait">
        {displayReply && phase === "speaking" && (
          <motion.div
            key="response"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-6 max-w-sm mx-6 px-5 py-4 rounded-2xl bg-primary/10 border border-primary/25"
          >
            <p className="text-sm font-body text-white leading-relaxed line-clamp-6 text-center">
              {displayReply}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom mic button */}
      <button
        onClick={handleTap}
        className={[
          "absolute bottom-10 w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 border-2",
          phase === "listening"
            ? "bg-destructive/20 border-destructive/60 text-destructive animate-pulse"
            : "bg-primary/10 border-primary/30 text-primary/70 hover:bg-primary/20 hover:text-primary hover:scale-105",
        ].join(" ")}
        aria-label={phase === "listening" ? "Stop" : "Speak"}
      >
        <Mic size={28} />
      </button>

      {/* Hint when speaking */}
      {phase === "speaking" && (
        <p className="absolute bottom-28 text-[10px] font-mono text-white/25">tap orb to skip</p>
      )}
    </motion.div>
  );
}
