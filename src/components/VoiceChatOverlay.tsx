import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MicOff, Mic } from "lucide-react";
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

type Phase = "listening" | "processing" | "speaking";

// ── Voice picker ──────────────────────────────────────────────────────────────
function pickVoice(): SpeechSynthesisVoice | undefined {
  const v = window.speechSynthesis.getVoices();
  return (
    v.find(x => x.lang.startsWith("en") && /Neural|Natural|Premium|Enhanced/.test(x.name)) ||
    v.find(x => x.lang === "en-US" && !x.localService) ||
    v.find(x => x.lang.startsWith("en-US")) ||
    v.find(x => x.lang.startsWith("en"))
  );
}

// ── TTS ───────────────────────────────────────────────────────────────────────
function speakText(text: string, onEnd: () => void): void {
  if (!text || !("speechSynthesis" in window)) { onEnd(); return; }
  window.speechSynthesis.cancel();
  setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text.slice(0, 2000));
    u.rate = 1.05; u.pitch = 1.0; u.volume = 1.0;
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.onend = onEnd; u.onerror = onEnd;
    window.speechSynthesis.speak(u);
    // Chrome silent-pause bug
    setTimeout(() => { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); }, 150);
  }, 50);
}

// ── Waveform bars ─────────────────────────────────────────────────────────────
function WaveBars({ phase, muted }: { phase: Phase; muted: boolean }) {
  const active  = !muted && (phase === "listening" || phase === "speaking");
  const pulsing = !muted && phase === "processing";
  return (
    <div className="flex items-center gap-[5px]" style={{ height: 52 }}>
      {Array.from({ length: 7 }).map((_, i) => (
        <motion.div
          key={i}
          className={`rounded-full origin-center ${
            muted    ? "bg-white/12"
            : phase === "speaking" ? "bg-primary"
            : "bg-primary/55"
          }`}
          style={{ width: 5, height: "100%" }}
          animate={
            pulsing ? { scaleY: [0.1, 0.4, 0.1] }
            : active  ? { scaleY: [0.2, 1, 0.5, 0.85, 0.2] }
            :           { scaleY: 0.1 }
          }
          transition={
            pulsing
              ? { duration: 1.1, repeat: Infinity, delay: i * 0.13, ease: "easeInOut" }
              : active
              ? { duration: 0.5 + (i % 3) * 0.1, repeat: Infinity, delay: i * 0.07, ease: "easeInOut" }
              : { duration: 0.2 }
          }
        />
      ))}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export function VoiceChatOverlay({
  onClose,
  sendMessage,
  lastBotMessage = "",
  isLoading = false,
  persona,
}: VoiceChatOverlayProps) {
  const [phase, setPhase]           = useState<Phase>("listening");
  const [muted, setMuted]           = useState(false);
  const [userText, setUserText]     = useState("");
  const [interimText, setInterimText] = useState("");
  const [aiText, setAiText]         = useState("");
  const [permError, setPermError]   = useState("");

  // ── All mutable state in refs so callbacks never read stale closures ──────
  const phaseRef        = useRef<Phase>("listening");
  const mutedRef        = useRef(false);
  const closingRef      = useRef(false);
  const recognitionRef  = useRef<any>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processToutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const personaHistRef  = useRef<{ role: string; content: string }[]>([]);
  // lastSpokenRef: what was most recently spoken via TTS (not updated during streaming)
  const lastSpokenRef   = useRef(lastBotMessage);
  // processTextRef: stable callback ref so onend always calls the latest version
  const processTextRef  = useRef<(t: string) => void>(() => {});

  // ── setPhaseSync: update ref AND state atomically ─────────────────────────
  // Using a regular function (not useCallback) so it's always current.
  // This prevents the one-render lag that useEffect({ phaseRef = phase }) caused.
  const setPhaseSync = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  // Pre-load voices on mount
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
    const cb = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", cb);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", cb);
  }, []);

  // ── processText ───────────────────────────────────────────────────────────
  const processText = useCallback((text: string) => {
    if (!text.trim() || closingRef.current) return;

    // Stop any pending restart timers
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }

    setPhaseSync("processing");
    setUserText(text.trim());
    setInterimText("");
    setAiText("");

    // Safety timeout: if stuck in processing for 45s, reset
    if (processToutRef.current) clearTimeout(processToutRef.current);
    processToutRef.current = setTimeout(() => {
      if (!closingRef.current && phaseRef.current === "processing") {
        setPhaseSync("listening");
      }
    }, 45_000);

    if (persona) {
      let acc = "";
      streamChatMessage(
        text,
        persona.systemPrompt,
        personaHistRef.current,
        { mode: "CHAT" },
        (_, a) => { acc = a; setAiText(a); },
      ).then(() => {
        if (processToutRef.current) { clearTimeout(processToutRef.current); processToutRef.current = null; }
        personaHistRef.current = [
          ...personaHistRef.current,
          { role: "user", content: text },
          { role: "assistant", content: acc },
        ];
        if (closingRef.current) return;
        if (acc) {
          setPhaseSync("speaking");
          speakText(acc, () => { if (!closingRef.current) setPhaseSync("listening"); });
        } else {
          setPhaseSync("listening");
        }
      }).catch(() => {
        if (processToutRef.current) { clearTimeout(processToutRef.current); processToutRef.current = null; }
        if (!closingRef.current) setPhaseSync("listening");
      });
    } else {
      // MAVIS mode: sendMessage is fire-and-forget; response arrives via lastBotMessage prop
      sendMessage?.(text).catch(() => {
        if (processToutRef.current) { clearTimeout(processToutRef.current); processToutRef.current = null; }
        if (!closingRef.current) setPhaseSync("listening");
      });
    }
  }, [persona, sendMessage, setPhaseSync]);

  useEffect(() => { processTextRef.current = processText; }, [processText]);

  // ── MAVIS mode: trigger TTS when the final response lands ────────────────
  // Key invariant: lastSpokenRef is only updated when we actually speak,
  // NOT during streaming. This way when isLoading flips false (stream done),
  // lastBotMessage !== lastSpokenRef.current and TTS fires correctly.
  useEffect(() => {
    if (persona) return;
    if (isLoading || !lastBotMessage || closingRef.current) return;
    if (lastBotMessage === lastSpokenRef.current) return;
    if (phaseRef.current !== "processing") return;

    if (processToutRef.current) { clearTimeout(processToutRef.current); processToutRef.current = null; }
    lastSpokenRef.current = lastBotMessage;
    setAiText(lastBotMessage);
    setPhaseSync("speaking");
    speakText(lastBotMessage, () => { if (!closingRef.current) setPhaseSync("listening"); });
  }, [lastBotMessage, isLoading, persona, setPhaseSync]);

  // ── Speech recognition ────────────────────────────────────────────────────
  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    if (recognitionRef.current) {
      const r = recognitionRef.current;
      recognitionRef.current = null;
      r._dead = true;
      r.abort();
    }
  }, []);

  const startRecognition = useCallback(() => {
    // Don't start if shutting down, muted, already running, or waiting for AI
    if (closingRef.current) return;
    if (mutedRef.current) return;
    if (recognitionRef.current) return;
    if (phaseRef.current === "processing") return;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setPermError("Speech recognition is not supported in this browser (Chrome/Edge only)."); return; }

    const r = new SR();
    r.continuous     = false;
    r.interimResults = true;
    r.lang           = "en-US";
    r._dead          = false;
    let finalText    = "";

    r.onspeechstart = () => {
      // Barge-in: cancel TTS if AI is currently speaking
      if (phaseRef.current === "speaking") {
        window.speechSynthesis.cancel();
        setPhaseSync("listening");
      }
    };

    r.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const seg = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) {
          finalText += seg + " ";
          setUserText(finalText.trim());
          setInterimText("");
        } else {
          interim = seg;
          setInterimText(interim);
        }
      }
    };

    r.onerror = (ev: any) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        r._dead = true;
        setPermError("Microphone access denied. Please allow mic access and reload.");
      }
      // Other errors (no-speech, network, aborted) are handled in onend
    };

    r.onend = () => {
      if (r._dead) return;          // aborted by us — don't restart
      recognitionRef.current = null;
      if (closingRef.current || mutedRef.current) return;

      const captured  = finalText.trim();
      const curPhase  = phaseRef.current;

      if (captured && curPhase !== "processing") {
        // Captured something and not already processing → send to AI
        processTextRef.current(captured);
      } else if (curPhase !== "processing") {
        // Nothing captured (Chrome timed out) OR in speaking phase — restart mic immediately
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null;
          if (!closingRef.current && !mutedRef.current && phaseRef.current !== "processing") {
            startRecognition();
          }
        }, 80);
      }
      // If processing: don't restart — phase change to listening/speaking will trigger it
    };

    recognitionRef.current = r;
    try { r.start(); } catch { recognitionRef.current = null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPhaseSync]);

  // ── Auto-manage recognition based on phase ────────────────────────────────
  useEffect(() => {
    if (muted || closingRef.current) return;

    if (phase === "listening" || phase === "speaking") {
      // Start recognition (guarded inside startRecognition)
      const t = setTimeout(() => startRecognition(), 100);
      return () => clearTimeout(t);
    }

    if (phase === "processing") {
      stopRecognition();
    }
  }, [phase, muted, startRecognition, stopRecognition]);

  // ── Mount / unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    // Boot: start listening right away
    const t = setTimeout(() => startRecognition(), 300);
    return () => {
      clearTimeout(t);
      closingRef.current = true;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (processToutRef.current) clearTimeout(processToutRef.current);
      stopRecognition();
      window.speechSynthesis?.cancel();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mute / unmute ─────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      stopRecognition();
      window.speechSynthesis?.cancel();
    } else {
      setTimeout(() => startRecognition(), 150);
    }
  }, [stopRecognition, startRecognition]);

  // ── Close ─────────────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    closingRef.current = true;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (processToutRef.current) clearTimeout(processToutRef.current);
    stopRecognition();
    window.speechSynthesis?.cancel();
    onClose();
  }, [onClose, stopRecognition]);

  // ── Tap overlay to interrupt AI speech ───────────────────────────────────
  const handleOverlayClick = useCallback(() => {
    if (phaseRef.current === "speaking") {
      window.speechSynthesis?.cancel();
      setPhaseSync("listening");
    }
  }, [setPhaseSync]);

  // ── Render ────────────────────────────────────────────────────────────────
  const speakerName  = persona?.name ?? "MAVIS";
  const speakerRole  = persona?.role;
  const displayText  = phase === "speaking" ? aiText : (userText || interimText);
  const isUserSide   = phase !== "speaking";

  const statusLabel =
    permError            ? "MIC ERROR"
    : muted              ? "MUTED"
    : phase === "processing" ? "THINKING..."
    : phase === "speaking"   ? "SPEAKING  ·  TAP TO INTERRUPT"
    :                          "LISTENING";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-xl"
      onClick={handleOverlayClick}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 pt-6 pb-2"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <p className="text-xs font-mono font-bold text-primary tracking-[0.2em] uppercase">{speakerName}</p>
          {speakerRole && <p className="text-[10px] font-mono text-white/35 mt-0.5">{speakerRole}</p>}
        </div>
        <button
          onClick={handleClose}
          className="p-2 rounded-full text-white/30 hover:text-white/70 transition-colors"
          aria-label="Close voice mode"
        >
          <X size={20} />
        </button>
      </div>

      {/* Center */}
      <div
        className="flex flex-col items-center gap-8 px-6 w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        {/* Glow + bars */}
        <div className="relative flex items-center justify-center">
          <motion.div
            className="absolute rounded-full pointer-events-none"
            style={{ inset: -28 }}
            animate={{
              boxShadow:
                muted ? "0 0 0 0 rgba(139,92,246,0)"
                : phase === "speaking"
                  ? ["0 0 45px 15px rgba(139,92,246,0.4)", "0 0 65px 24px rgba(139,92,246,0.55)", "0 0 45px 15px rgba(139,92,246,0.4)"]
                  : phase === "listening"
                  ? ["0 0 18px 4px rgba(139,92,246,0.12)", "0 0 32px 10px rgba(139,92,246,0.22)", "0 0 18px 4px rgba(139,92,246,0.12)"]
                  : "0 0 0 0 rgba(139,92,246,0)",
            }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
          <WaveBars phase={phase} muted={muted} />
        </div>

        {/* Status label */}
        <motion.p
          key={statusLabel}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          className={`text-[10px] font-mono tracking-[0.22em] ${
            permError            ? "text-destructive"
            : muted              ? "text-white/25"
            : phase === "processing" ? "text-white/45"
            : "text-primary"
          }`}
        >
          {statusLabel}
        </motion.p>

        {/* Transcript / response */}
        <AnimatePresence mode="wait">
          {displayText && (
            <motion.div
              key={isUserSide ? "user" : "ai"}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className={`w-full px-5 py-4 rounded-2xl text-center ${
                isUserSide
                  ? "bg-white/5 border border-white/10"
                  : "bg-primary/10 border border-primary/25"
              }`}
            >
              <p className={`text-sm font-body leading-relaxed line-clamp-5 ${
                isUserSide ? "text-white/65" : "text-white"
              }`}>
                {isUserSide && interimText && !userText
                  ? <em className="not-italic opacity-50">{interimText}</em>
                  : displayText
                }
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {permError && (
          <p className="text-xs font-mono text-destructive/80 text-center px-4">{permError}</p>
        )}
      </div>

      {/* Mute button */}
      <div
        className="absolute bottom-10 flex flex-col items-center gap-2"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={toggleMute}
          className={`w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all duration-200 ${
            muted
              ? "bg-destructive/15 border-destructive/50 text-destructive"
              : "bg-white/5 border-white/15 text-white/45 hover:border-white/30 hover:text-white/75"
          }`}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
        <p className="text-[9px] font-mono text-white/20 tracking-widest">
          {muted ? "UNMUTE" : "MUTE"}
        </p>
      </div>
    </motion.div>
  );
}
