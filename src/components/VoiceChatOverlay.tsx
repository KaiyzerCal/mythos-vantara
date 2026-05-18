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

// ── Animated waveform bars ────────────────────────────────────────────────────
const BAR_COUNT = 7;

function WaveBars({ phase, muted }: { phase: Phase; muted: boolean }) {
  const listening = !muted && phase === "listening";
  const speaking  = !muted && phase === "speaking";
  const processing = !muted && phase === "processing";

  return (
    <div className="flex items-center gap-[5px]" style={{ height: 52 }}>
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const delay = i * 0.07;
        const color = speaking ? "bg-primary" : "bg-primary/55";
        return (
          <motion.div
            key={i}
            className={`rounded-full origin-center ${muted ? "bg-white/12" : color}`}
            style={{ width: 5, height: "100%" }}
            animate={
              muted || processing
                ? { scaleY: processing ? [0.12, 0.35, 0.12] : 0.1 }
                : listening || speaking
                  ? { scaleY: [0.2, 1, 0.5, 0.85, 0.2] }
                  : { scaleY: 0.1 }
            }
            transition={
              processing
                ? { duration: 1.2, repeat: Infinity, delay, ease: "easeInOut" }
                : (listening || speaking)
                  ? {
                      duration: 0.5 + (i % 3) * 0.1,
                      repeat: Infinity,
                      delay,
                      ease: "easeInOut",
                    }
                  : { duration: 0.2 }
            }
          />
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
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

  const phaseRef        = useRef<Phase>("listening");
  const mutedRef        = useRef(false);
  const closingRef      = useRef(false);
  const recognitionRef  = useRef<any>(null);
  const personaHistRef  = useRef<{ role: string; content: string }[]>([]);
  const prevBotMsgRef   = useRef(lastBotMessage);
  // processText changes when persona/sendMessage changes; keep ref so onend always calls latest
  const processTextRef  = useRef<(t: string) => void>(() => {});

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Pre-load voices
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
    const cb = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", cb);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", cb);
  }, []);

  // ── Core: process captured speech ─────────────────────────────────────────
  const processText = useCallback((text: string) => {
    if (!text.trim() || closingRef.current) return;
    setPhase("processing");
    setUserText(text.trim());
    setInterimText("");
    setAiText("");

    if (persona) {
      let acc = "";
      streamChatMessage(
        text,
        persona.systemPrompt,
        personaHistRef.current,
        { mode: "CHAT" },
        (_, a) => { acc = a; setAiText(a); },
      ).then(() => {
        personaHistRef.current = [
          ...personaHistRef.current,
          { role: "user", content: text },
          { role: "assistant", content: acc },
        ];
        if (closingRef.current) return;
        if (acc) {
          setPhase("speaking");
          speakText(acc, () => { if (!closingRef.current) setPhase("listening"); });
        } else {
          setPhase("listening");
        }
      }).catch(() => { if (!closingRef.current) setPhase("listening"); });
    } else {
      sendMessage?.(text).catch(() => { if (!closingRef.current) setPhase("listening"); });
    }
  }, [persona, sendMessage]);

  useEffect(() => { processTextRef.current = processText; }, [processText]);

  // ── MAVIS mode: respond when lastBotMessage arrives ───────────────────────
  // prevBotMsgRef is only updated AFTER the isLoading check so that when
  // streaming ends (isLoading flips false) the ref still differs from the
  // final message and we don't skip it.
  useEffect(() => {
    if (persona) return;
    if (!lastBotMessage || isLoading || closingRef.current) return;
    if (prevBotMsgRef.current === lastBotMessage) return;
    prevBotMsgRef.current = lastBotMessage;   // update only when we'll actually process
    if (phaseRef.current !== "processing") return;
    setAiText(lastBotMessage);
    setPhase("speaking");
    speakText(lastBotMessage, () => { if (!closingRef.current) setPhase("listening"); });
  }, [lastBotMessage, isLoading, persona]);

  // ── Speech recognition ─────────────────────────────────────────────────────
  // Uses continuous=false so Chrome handles silence detection natively.
  // Recognition runs in both "listening" and "speaking" phases:
  //   - listening: capture user speech
  //   - speaking:  hot-mic for barge-in (onspeechstart cancels TTS)
  // After onend it restarts immediately (no delay) to stay warm.

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current._managed = false;
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
  }, []);

  const startRecognition = useCallback(() => {
    if (closingRef.current || mutedRef.current) return;
    if (recognitionRef.current) return; // already running

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setPermError("Speech recognition not supported in this browser."); return; }

    const r = new SR();
    r.continuous     = false;  // let Chrome decide when phrase ends
    r.interimResults = true;
    r.lang           = "en-US";
    r._managed       = true;   // flag so we can tell abort vs natural end
    let finalText    = "";

    r.onspeechstart = () => {
      // Barge-in: user speaks while AI is talking → interrupt
      if (phaseRef.current === "speaking") {
        window.speechSynthesis.cancel();
        setPhase("listening");
      }
    };

    r.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) {
          finalText += t + " ";
          setUserText(finalText.trim());
          setInterimText("");
        } else {
          interim = t;
          setInterimText(interim);
        }
      }
    };

    r.onerror = (ev: any) => {
      // no-speech and aborted are normal — let onend handle restart
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setPermError("Microphone permission denied. Please allow mic access and reload.");
      }
    };

    r.onend = () => {
      // Guard: only handle if this instance is still the active one
      if (!r._managed) return;
      recognitionRef.current = null;
      if (closingRef.current || mutedRef.current) return;

      const captured = finalText.trim();
      const currentPhase = phaseRef.current;

      if (captured && currentPhase !== "processing") {
        // Have speech and not already processing → send it
        processTextRef.current(captured);
      } else if (!captured || currentPhase === "speaking") {
        // No speech captured, or speaking phase (barge-in mic expired) → restart immediately
        setTimeout(() => {
          if (!closingRef.current && !mutedRef.current) startRecognition();
        }, 80);
      }
      // If processing: don't restart — phase change to listening will trigger it
    };

    recognitionRef.current = r;
    try {
      r.start();
    } catch {
      recognitionRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start/restart recognition whenever phase becomes listening
  useEffect(() => {
    if (muted || closingRef.current) return;
    if (phase === "listening" || phase === "speaking") {
      // Small settle time to avoid double-start on rapid phase changes
      const t = setTimeout(() => {
        if (!closingRef.current && !mutedRef.current) startRecognition();
      }, 120);
      return () => clearTimeout(t);
    }
    if (phase === "processing") {
      // Stop recognition while we wait for AI (not needed)
      stopRecognition();
    }
  }, [phase, muted, startRecognition, stopRecognition]);

  // Boot: start listening immediately
  useEffect(() => {
    const t = setTimeout(() => startRecognition(), 250);
    return () => {
      clearTimeout(t);
      closingRef.current = true;
      stopRecognition();
      window.speechSynthesis?.cancel();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mute toggle ────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    setMuted(next);
    if (next) {
      stopRecognition();
      window.speechSynthesis?.cancel();
    } else {
      setTimeout(() => startRecognition(), 150);
    }
  }, [stopRecognition, startRecognition]);

  // ── Close ──────────────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    closingRef.current = true;
    stopRecognition();
    window.speechSynthesis?.cancel();
    onClose();
  }, [onClose, stopRecognition]);

  // ── Tap while speaking → interrupt ─────────────────────────────────────────
  const handleOverlayClick = useCallback(() => {
    if (phaseRef.current === "speaking") {
      window.speechSynthesis?.cancel();
      setPhase("listening");
    }
  }, []);

  const speakerName = persona?.name ?? "MAVIS";
  const speakerRole = persona?.role;

  const statusLabel =
    permError    ? "MIC ERROR"
    : muted      ? "MUTED"
    : phase === "processing" ? "THINKING..."
    : phase === "speaking"   ? "SPEAKING  ·  TAP TO INTERRUPT"
    :                          "LISTENING";

  const displayText  = phase === "speaking" ? aiText : (userText || interimText);
  const isUserSide   = phase !== "speaking";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-xl"
      onClick={handleOverlayClick}
    >
      {/* Top bar — stop propagation so clicking name/close doesn't interrupt */}
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

      {/* Center content */}
      <div
        className="flex flex-col items-center gap-8 px-6 w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        {/* Glow ring + waveform */}
        <div className="relative flex items-center justify-center">
          {/* Outer pulsing glow */}
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

        {/* Status */}
        <motion.p
          key={statusLabel}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          className={`text-[10px] font-mono tracking-[0.22em] ${
            permError ? "text-destructive"
            : muted ? "text-white/25"
            : phase === "processing" ? "text-white/45"
            : "text-primary"
          }`}
        >
          {statusLabel}
        </motion.p>

        {/* Transcript / AI reply */}
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

        {/* Permission error */}
        {permError && (
          <p className="text-xs font-mono text-destructive/80 text-center">{permError}</p>
        )}
      </div>

      {/* Mute button — stop propagation so it doesn't trigger interrupt */}
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
        <p className="text-[9px] font-mono text-white/18 tracking-widest">
          {muted ? "UNMUTE" : "MUTE"}
        </p>
      </div>
    </motion.div>
  );
}
