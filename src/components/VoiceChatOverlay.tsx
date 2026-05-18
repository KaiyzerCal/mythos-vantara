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

const SILENCE_MS = 1600;

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

// ── TTS with Chrome quirk handling ───────────────────────────────────────────
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
    setTimeout(() => { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); }, 150);
  }, 50);
}

// ── Animated waveform bars ─────────────────────────────────────────────────
const BAR_COUNT = 7;

const barAnimation = {
  listening: (i: number) => ({
    scaleY: [0.25, 1, 0.5, 0.85, 0.25],
    transition: { duration: 0.55 + (i % 3) * 0.12, repeat: Infinity, delay: i * 0.07, ease: "easeInOut" as const },
  }),
  processing: (i: number) => ({
    scaleY: [0.15, 0.45, 0.15],
    transition: { duration: 1.1, repeat: Infinity, delay: i * 0.13, ease: "easeInOut" as const },
  }),
  speaking: (i: number) => ({
    scaleY: [0.3, 1, 0.55, 0.9, 0.3],
    transition: { duration: 0.48 + (i % 3) * 0.1, repeat: Infinity, delay: i * 0.06, ease: "easeInOut" as const },
  }),
};

function WaveBars({ phase, muted }: { phase: Phase; muted: boolean }) {
  return (
    <div className="flex items-center gap-[5px]" style={{ height: 56 }}>
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <motion.div
          key={i}
          className={`rounded-full origin-center ${
            muted ? "bg-white/15" : phase === "speaking" ? "bg-primary" : "bg-primary/65"
          }`}
          style={{ width: 5, height: "100%" }}
          animate={muted ? { scaleY: 0.12 } : barAnimation[phase](i)}
        />
      ))}
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

  // ── Refs (callbacks must read current values without stale closures) ────────
  const phaseRef        = useRef<Phase>("listening");
  const mutedRef        = useRef(false);
  const closingRef      = useRef(false);
  const recognitionRef  = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accTextRef      = useRef("");          // accumulated final transcript
  const shouldSendRef   = useRef(false);       // silence timer fired → send on onend
  const personaHistRef  = useRef<{ role: string; content: string }[]>([]);
  const prevBotMsgRef   = useRef(lastBotMessage);

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

  // ── Process accumulated speech ─────────────────────────────────────────────
  const processText = useCallback(async (text: string) => {
    if (!text.trim() || closingRef.current) return;
    setPhase("processing");
    setUserText(text.trim());
    setInterimText("");
    setAiText("");

    if (persona) {
      let acc = "";
      try {
        await streamChatMessage(
          text,
          persona.systemPrompt,
          personaHistRef.current,
          { mode: "CHAT" },
          (_, a) => { acc = a; setAiText(a); },
        );
        personaHistRef.current = [
          ...personaHistRef.current,
          { role: "user", content: text },
          { role: "assistant", content: acc },
        ];
        if (!closingRef.current && acc) {
          setPhase("speaking");
          speakText(acc, () => { if (!closingRef.current) setPhase("listening"); });
        } else if (!closingRef.current) {
          setPhase("listening");
        }
      } catch {
        if (!closingRef.current) setPhase("listening");
      }
    } else {
      // MAVIS mode: parent will update lastBotMessage
      sendMessage?.(text).catch(() => { if (!closingRef.current) setPhase("listening"); });
    }
  }, [persona, sendMessage]);

  // ── MAVIS mode: watch for lastBotMessage changes ───────────────────────────
  useEffect(() => {
    if (persona) return;
    if (prevBotMsgRef.current === lastBotMessage) return;
    prevBotMsgRef.current = lastBotMessage;
    if (!lastBotMessage || isLoading || closingRef.current) return;
    if (phaseRef.current !== "processing") return;
    setAiText(lastBotMessage);
    setPhase("speaking");
    speakText(lastBotMessage, () => { if (!closingRef.current) setPhase("listening"); });
  }, [lastBotMessage, isLoading, persona]);

  // ── Speech recognition ─────────────────────────────────────────────────────
  const stopRecognition = useCallback(() => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (recognitionRef.current) {
      recognitionRef.current._skipRestart = true;
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
  }, []);

  const startRecognition = useCallback(() => {
    if (closingRef.current || mutedRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const r = new SR();
    r.continuous     = true;
    r.interimResults = true;
    r.lang           = "en-US";
    r._skipRestart   = false;
    accTextRef.current = "";
    shouldSendRef.current = false;

    r.onspeechstart = () => {
      // Barge-in: if AI is speaking, cancel and switch to listening
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
          accTextRef.current += t + " ";
          setUserText(accTextRef.current.trim());
        } else {
          interim = t;
        }
      }
      setInterimText(interim);

      // Reset silence timer on any speech activity
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (accTextRef.current.trim()) {
        silenceTimerRef.current = setTimeout(() => {
          shouldSendRef.current = true;
          r.stop(); // triggers onend which calls processText
        }, SILENCE_MS);
      }
    };

    r.onerror = (ev: any) => {
      if (ev.error === "no-speech" || ev.error === "aborted") return;
      recognitionRef.current = null;
    };

    r.onend = () => {
      recognitionRef.current = null;
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      if (r._skipRestart || closingRef.current) return;

      if (shouldSendRef.current && accTextRef.current.trim()) {
        processText(accTextRef.current.trim());
      } else if (phaseRef.current === "listening" && !mutedRef.current) {
        // No speech or incomplete — restart immediately to stay warm
        setTimeout(() => startRecognition(), 100);
      }
    };

    recognitionRef.current = r;
    try { r.start(); } catch { /* already started */ }
  }, [processText]);

  // Auto-start recognition when phase becomes "listening"
  useEffect(() => {
    if (phase !== "listening" || muted || closingRef.current) return;
    if (recognitionRef.current) return; // already running
    // Small delay to let state settle and avoid Chrome issues
    const t = setTimeout(() => startRecognition(), 150);
    return () => clearTimeout(t);
  }, [phase, muted, startRecognition]);

  // Initial auto-start
  useEffect(() => {
    const t = setTimeout(() => startRecognition(), 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Close handler ──────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    closingRef.current = true;
    stopRecognition();
    window.speechSynthesis?.cancel();
    onClose();
  }, [onClose, stopRecognition]);

  // ── Mute toggle ────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    setMuted(next);
    if (next) {
      // Muting: stop recognition, cancel speech
      window.speechSynthesis?.cancel();
      stopRecognition();
      if (phaseRef.current !== "processing") setPhase("listening");
    } else {
      // Unmuting: restart recognition
      setTimeout(() => startRecognition(), 150);
    }
  }, [stopRecognition, startRecognition]);

  // ── Tap to interrupt speech ────────────────────────────────────────────────
  const handleOrbTap = useCallback(() => {
    if (phase === "speaking") {
      window.speechSynthesis?.cancel();
      setPhase("listening");
    }
  }, [phase]);

  const speakerName = persona?.name ?? "MAVIS";
  const speakerRole = persona?.role;

  const phaseLabel =
    muted       ? "MUTED"
    : phase === "processing" ? "THINKING..."
    : phase === "speaking"   ? "SPEAKING"
    :                          "LISTENING";

  const displayText = phase === "speaking" ? aiText : (userText || interimText);
  const isUserText  = phase !== "speaking";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-xl"
      onClick={phase === "speaking" ? handleOrbTap : undefined}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 pt-6 pb-2">
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

      {/* Main content */}
      <div className="flex flex-col items-center gap-8 px-6 w-full max-w-sm">

        {/* Waveform + phase ring */}
        <button
          onClick={handleOrbTap}
          className="relative flex items-center justify-center cursor-default"
          aria-label={phase === "speaking" ? "Tap to interrupt" : undefined}
          style={{ cursor: phase === "speaking" ? "pointer" : "default" }}
        >
          {/* Outer glow ring */}
          <motion.div
            className="absolute rounded-full"
            style={{ inset: -24 }}
            animate={{
              boxShadow: muted
                ? "0 0 0px 0px rgba(139,92,246,0)"
                : phase === "speaking"
                  ? ["0 0 40px 12px rgba(139,92,246,0.35)", "0 0 60px 20px rgba(139,92,246,0.5)", "0 0 40px 12px rgba(139,92,246,0.35)"]
                  : phase === "listening"
                  ? ["0 0 20px 4px rgba(139,92,246,0.15)", "0 0 35px 10px rgba(139,92,246,0.25)", "0 0 20px 4px rgba(139,92,246,0.15)"]
                  : "0 0 0px 0px rgba(139,92,246,0)",
            }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
          <WaveBars phase={phase} muted={muted} />
        </button>

        {/* Phase label */}
        <motion.p
          key={phaseLabel}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className={`text-[11px] font-mono tracking-[0.25em] ${
            muted ? "text-white/25" : phase === "processing" ? "text-white/50" : "text-primary"
          }`}
        >
          {phaseLabel}
        </motion.p>

        {/* Transcript / response */}
        <AnimatePresence mode="wait">
          {displayText && (
            <motion.div
              key={isUserText ? "user" : "ai"}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className={`w-full px-5 py-4 rounded-2xl text-center ${
                isUserText
                  ? "bg-white/5 border border-white/10"
                  : "bg-primary/12 border border-primary/25"
              }`}
            >
              <p className={`text-sm font-body leading-relaxed line-clamp-5 ${
                isUserText ? "text-white/60" : "text-white"
              }`}>
                {isUserText && interimText && !userText
                  ? <span className="opacity-60 italic">{interimText}</span>
                  : displayText
                }
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-10 flex flex-col items-center gap-3">
        {/* Mute button */}
        <button
          onClick={toggleMute}
          className={`w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all duration-200 ${
            muted
              ? "bg-destructive/15 border-destructive/50 text-destructive"
              : "bg-white/5 border-white/15 text-white/50 hover:border-white/30 hover:text-white/80"
          }`}
          aria-label={muted ? "Unmute" : "Mute microphone"}
        >
          {muted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
        <p className="text-[9px] font-mono text-white/20 tracking-widest">
          {muted ? "TAP TO UNMUTE" : phase === "speaking" ? "TAP TO INTERRUPT" : "TAP TO MUTE"}
        </p>
      </div>
    </motion.div>
  );
}
