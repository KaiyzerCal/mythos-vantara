import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, Volume2 } from "lucide-react";
import { streamChatMessage } from "@/mavis/chatService";
import { useElevenLabsTts } from "@/hooks/useElevenLabsTts";

// Minimal SpeechRecognition typing — Web Speech API isn't in lib.dom yet
type SpeechRecognition = any;

export interface VoicePersona {
  name: string;
  role?: string;
  systemPrompt: string;
  voiceId?: string;   // browser:aria | browser:guy | ElevenLabs ID
}

interface VoiceChatOverlayProps {
  onClose: () => void;
  sendMessage?: (text: string) => Promise<void>;
  lastBotMessage?: string;
  isLoading?: boolean;
  persona?: VoicePersona;
}

type Phase = "listening" | "thinking" | "speaking";

export function VoiceChatOverlay({
  onClose,
  sendMessage,
  lastBotMessage = "",
  isLoading = false,
  persona,
}: VoiceChatOverlayProps) {
  const [phase, setPhase]               = useState<Phase>("listening");
  const [transcript, setTranscript]     = useState("");
  const [interim, setInterim]           = useState("");
  const [displayReply, setDisplayReply] = useState("");
  const textScrollRef = useRef<HTMLDivElement>(null);

  // ── TTS — uses voice catalog (browser or ElevenLabs), personalized per speaker
  const tts = useElevenLabsTts();

  // ── Refs — callbacks always see current values, no stale closures ─────────
  const phaseRef          = useRef<Phase>("listening");
  const closingRef        = useRef(false);
  const recognitionRef    = useRef<SpeechRecognition | null>(null);
  const restartTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const personaHistRef    = useRef<{ role: string; content: string }[]>([]);
  // MAVIS mode: only updated when TTS actually fires, not during streaming
  const lastSpokenRef     = useRef(lastBotMessage);
  const ttsRef            = useRef(tts);
  ttsRef.current          = tts;

  // ── setPhaseSync: update ref AND state in one call ────────────────────────
  const setPhaseSync = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  // ── Recognition helpers ───────────────────────────────────────────────────
  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    if (recognitionRef.current) {
      const r = recognitionRef.current;
      recognitionRef.current = null;
      (r as SpeechRecognition & { _dead?: boolean })._dead = true;
      r.abort();
    }
  }, []);

  const startListening = useCallback(() => {
    if (closingRef.current) return;
    if (recognitionRef.current) return;
    if (phaseRef.current === "thinking") return;

    const SR = (window as any).SpeechRecognition
            ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const r = new SR() as SpeechRecognition & { _dead?: boolean };
    r.continuous     = false;
    r.interimResults = true;
    r.lang           = "en-US";
    r._dead          = false;
    let finalText    = "";

    r.onspeechstart = () => {
      // Barge-in: cancel TTS if AI is speaking
      if (phaseRef.current === "speaking") {
        ttsRef.current.stop();
        setPhaseSync("listening");
      }
    };

    r.onresult = (ev) => {
      let int = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) { finalText += t + " "; setTranscript(finalText.trim()); setInterim(""); }
        else int = t;
      }
      if (int) setInterim(int);
    };

    r.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        r._dead = true;
      }
    };

    r.onend = () => {
      if (r._dead) return;
      recognitionRef.current = null;
      if (closingRef.current) return;
      const captured = finalText.trim();
      if (!captured) {
        if (phaseRef.current !== "thinking") {
          restartTimerRef.current = setTimeout(() => {
            restartTimerRef.current = null;
            if (!closingRef.current && phaseRef.current !== "thinking") startListening();
          }, 120);
        }
        return;
      }

      // Hand off to AI
      setPhaseSync("thinking");
      // 30s safety timeout in case AI never responds
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = setTimeout(() => {
        safetyTimerRef.current = null;
        if (!closingRef.current && phaseRef.current === "thinking") setPhaseSync("listening");
      }, 30_000);

      if (persona) {
        let acc = "";
        streamChatMessage(
          captured,
          persona.systemPrompt,
          personaHistRef.current,
          { mode: "CHAT", chatKind: "persona" },
          (_, a) => { acc = a; setDisplayReply(a); },
        ).then(() => {
          if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
          personaHistRef.current = [
            ...personaHistRef.current,
            { role: "user", content: captured },
            { role: "assistant", content: acc },
          ];
          if (closingRef.current) return;
          if (acc) {
            setPhaseSync("speaking");
            ttsRef.current.speak(acc, { voiceId: persona.voiceId ?? undefined })
              .then(() => { if (!closingRef.current) setPhaseSync("listening"); });
          } else {
            setPhaseSync("listening");
          }
        }).catch(() => {
          if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
          if (!closingRef.current) setPhaseSync("listening");
        });
      } else {
        sendMessage?.(captured).catch(() => {
          if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
          if (!closingRef.current) setPhaseSync("listening");
        });
      }
    };

    recognitionRef.current = r;
    setTranscript(""); setInterim("");
    try { r.start(); } catch { recognitionRef.current = null; }
    setPhaseSync("listening");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona, sendMessage, setPhaseSync]);

  // ── MAVIS mode: trigger TTS when final response lands ────────────────────
  useEffect(() => {
    if (persona) return;
    if (isLoading || !lastBotMessage || closingRef.current) return;
    if (lastBotMessage === lastSpokenRef.current) return;
    if (phaseRef.current !== "thinking") return;
    if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
    lastSpokenRef.current = lastBotMessage;
    setDisplayReply(lastBotMessage);
    setPhaseSync("speaking");
    ttsRef.current.speak(lastBotMessage, {})
      .then(() => { if (!closingRef.current) setPhaseSync("listening"); });
  }, [lastBotMessage, isLoading, persona, setPhaseSync]);

  // ── Auto-scroll response text as it streams in ───────────────────────────
  useEffect(() => {
    if (textScrollRef.current) {
      textScrollRef.current.scrollTop = textScrollRef.current.scrollHeight;
    }
  }, [displayReply]);

  // ── Auto-manage mic based on phase ───────────────────────────────────────
  useEffect(() => {
    if (closingRef.current) return;
    if (phase === "listening") {
      const t = setTimeout(() => startListening(), 80);
      return () => clearTimeout(t);
    }
    if (phase === "thinking") stopRecognition();
  }, [phase, startListening, stopRecognition]);

  // ── Mount: auto-start; Unmount: full cleanup ──────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => startListening(), 250);
    return () => {
      clearTimeout(t);
      closingRef.current = true;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      stopRecognition();
      ttsRef.current.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Close ─────────────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    closingRef.current = true;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    stopRecognition();
    ttsRef.current.stop();
    onClose();
  }, [onClose, stopRecognition]);

  // ── Orb/button tap ────────────────────────────────────────────────────────
  const handleTap = useCallback(() => {
    if (phase === "speaking") {
      ttsRef.current.stop();
      setPhaseSync("listening");
    } else if (phase === "listening") {
      stopRecognition();
      setPhaseSync("listening");
    }
    // "thinking" — do nothing, let it finish
  }, [phase, setPhaseSync, stopRecognition]);

  const speakerName = persona?.name ?? "MAVIS";
  const speakerRole = persona?.role;
  const phaseLabel: Record<Phase, string> = {
    listening: "LISTENING...",
    thinking:  "THINKING...",
    speaking:  "SPEAKING  ·  TAP ORB TO SKIP",
  };

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
        ].filter(Boolean).join(" ")}
        aria-label={phase === "speaking" ? "Skip speech" : "Tap to interact"}
      >
        {/* Spinning ring when thinking */}
        <span className={[
          "absolute inset-2 rounded-full border-2 border-transparent border-t-primary/70 transition-opacity",
          phase === "thinking" ? "animate-spin opacity-100" : "opacity-0",
        ].join(" ")} />
        {phase === "speaking"
          ? <Volume2 size={36} className="text-primary animate-pulse" />
          : <Mic     size={36} className={phase === "listening" ? "text-primary" : "text-primary/50"} />
        }
      </button>

      {/* Phase label */}
      <p className="mt-5 text-[11px] font-mono tracking-[0.2em] text-primary">{phaseLabel[phase]}</p>

      {/* User transcript */}
      <AnimatePresence mode="wait">
        {(transcript || interim) && phase !== "speaking" && (
          <motion.div
            key="transcript"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="mt-5 max-w-xs px-5 py-2 rounded-xl bg-white/5 border border-white/10"
          >
            <p className="text-center text-sm font-mono text-muted-foreground">
              {transcript || <em className="not-italic opacity-50">{interim}</em>}
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
            <div ref={textScrollRef} className="overflow-y-auto max-h-[35vh] scrollbar-thin">
              <p className="text-sm font-body text-white leading-relaxed text-center">
                {displayReply}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom mic button */}
      <button
        onClick={handleTap}
        className={[
          "absolute bottom-10 w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 border-2",
          phase === "listening"
            ? "bg-primary/15 border-primary/60 text-primary animate-pulse"
            : phase === "speaking"
            ? "bg-primary/10 border-primary/30 text-primary/60 hover:bg-primary/20 hover:text-primary"
            : "bg-muted/20 border-border text-muted-foreground",
        ].join(" ")}
        aria-label={phase === "speaking" ? "Skip" : "Mic"}
      >
        {phase === "speaking" ? <Volume2 size={24} /> : <Mic size={24} />}
      </button>
    </motion.div>
  );
}
