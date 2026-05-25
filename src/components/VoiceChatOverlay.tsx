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
    let reply = "";
    try {
      if (persona.entityType === "persona" && persona.entityId && persona.userId) {
        // Route through the dedicated persona router — it preserves memories,
        // relationship state, and character framing. Never returns MAVIS.
        const { data, error } = await supabase.functions.invoke("mavis-persona-router", {
          body: { persona_id: persona.entityId, user_id: persona.userId, message: text },
        });
        if (error) throw error;
        reply = (data as any)?.response ?? "";
        setPersonaReply(reply);
      } else {
        // Council member / custom persona — pass mode:"COUNCIL" so mavis-chat
        // uses the provided systemPrompt instead of the MAVIS Prime prompt.
        await streamChatMessage(
          text,
          persona.systemPrompt,
          personaHistoryRef.current,
          { mode: "COUNCIL" },
          (_, acc) => { reply = acc; setPersonaReply(acc); },
        );
        // Persist council voice turn to the shared council chat thread so MAVIS,
        // the council member, and other agents see the conversation later.
        if (persona.entityType === "council" && persona.entityId && persona.userId) {
          try {
            await supabase.from("council_chat_messages").insert([
              { user_id: persona.userId, council_member_id: persona.entityId, role: "user",      content: text  },
              { user_id: persona.userId, council_member_id: persona.entityId, role: "assistant", content: reply },
            ]);
          } catch { /* non-fatal — voice convo still played */ }
        }
      }
      personaHistoryRef.current = [
        ...personaHistoryRef.current,
        { role: "user", content: text },
        { role: "assistant", content: reply },
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

    let lastCapturedText = "";
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    const SILENCE_MS = 10000;

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
    listening: "LISTENING — pause ~10s to send",
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
            <p className="text-[9px] font-mono text-primary/50 tracking-widest text-center mb-1 uppercase">
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
