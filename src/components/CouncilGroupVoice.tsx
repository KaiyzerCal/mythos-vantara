import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, MicOff, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// ── Types ────────────────────────────────────────────────────────────────────

interface SessionMember {
  id: string;
  name: string;
  role?: string;
  specialty?: string;
  avatar?: string | null;
  voice_style?: string | null; // ElevenLabs voice ID
}

interface MemberResponse {
  member_id: string;
  member_name: string;
  member_role?: string;
  voice_style?: string | null;
  content: string;
}

interface TurnEntry {
  speaker: "user" | "member";
  memberName?: string;
  text: string;
}

export interface CouncilGroupVoiceProps {
  userId: string;
  onClose: () => void;
  initialTopic?: string;
  memberIds?: string[];
}

type Phase = "idle" | "listening" | "processing" | "playing" | "done";

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

// ── Component ────────────────────────────────────────────────────────────────

export function CouncilGroupVoice({
  userId,
  onClose,
  initialTopic,
  memberIds,
}: CouncilGroupVoiceProps) {
  // ── Session state ──────────────────────────────────────────────────────────
  const [members, setMembers] = useState<SessionMember[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [history, setHistory] = useState<TurnEntry[]>([]);
  const sessionIdRef = useRef<string | null>(null);

  // ── Phase + speech ─────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");

  // Playback queue
  const [currentSpeakerIndex, setCurrentSpeakerIndex] = useState<number>(-1);
  const pendingResponsesRef = useRef<MemberResponse[]>([]);

  // Karaoke
  const [displayedText, setDisplayedText] = useState("");
  const [spokenUpTo, setSpokenUpTo] = useState(0);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const closingRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const karaokeTickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const elevenAudioElRef = useRef<HTMLAudioElement | null>(null);
  const elevenAudioUrlRef = useRef<string | null>(null);
  const audioUnlockedRef = useRef(false);
  const ttsConsecFailuresRef = useRef(0);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const spokenWordRef = useRef<HTMLSpanElement>(null);

  // ── iOS Audio unlock (same pattern as VoiceChatOverlay) ───────────────────
  const unlockAudio = useCallback(() => {
    if (!audioUnlockedRef.current) {
      audioUnlockedRef.current = true;
      if (window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance("​");
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
    }
  }, []);

  // ── Voice picker ───────────────────────────────────────────────────────────
  const pickVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (!window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    return (
      voices.find((v) => v.lang?.startsWith("en") && v.default) ||
      voices.find((v) => v.lang?.startsWith("en")) ||
      voices[0]
    );
  }, []);

  // ── Browser TTS (fallback) — karaoke via onboundary ───────────────────────
  const speakWithBrowser = useCallback(
    (text: string, onDone: () => void) => {
      if (!text || closingRef.current) { onDone(); return; }
      const synth = window.speechSynthesis;
      if (!synth) { onDone(); return; }

      try { synth.resume(); } catch { /* ignore */ }
      synth.cancel();

      setDisplayedText(text);
      setSpokenUpTo(0);

      const doSpeak = () => {
        if (closingRef.current) { onDone(); return; }
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

        const finish = () => {
          utteranceRef.current = null;
          if (resumeKeepAliveRef.current) {
            clearInterval(resumeKeepAliveRef.current);
            resumeKeepAliveRef.current = null;
          }
          if (!closingRef.current) {
            setSpokenUpTo(text.length);
            onDone();
          }
        };

        utterance.onend = finish;
        utterance.onerror = finish;

        utteranceRef.current = utterance;
        try { synth.resume(); } catch { /* ignore */ }
        synth.speak(utterance);

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

      if (!synth.getVoices().length) {
        const onVoices = () => {
          synth.removeEventListener("voiceschanged", onVoices);
          setTimeout(doSpeak, 60);
        };
        synth.addEventListener("voiceschanged", onVoices);
        setTimeout(() => {
          synth.removeEventListener("voiceschanged", onVoices);
          doSpeak();
        }, 400);
      } else {
        setTimeout(doSpeak, 60);
      }
    },
    [pickVoice],
  );

  // ── ElevenLabs TTS — exact pattern from VoiceChatOverlay ──────────────────
  const speakWithElevenLabs = useCallback(
    async (text: string, voiceId: string, onDone: () => void) => {
      if (ttsConsecFailuresRef.current >= 3) {
        speakWithBrowser(text, onDone);
        return;
      }

      // Tear down previous element
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

      setDisplayedText(text);
      setSpokenUpTo(0);

      try {
        const ttsResult = await Promise.race([
          supabase.functions.invoke("mavis-tts", { body: { text, voice_id: voiceId } }),
          new Promise<{ data: null; error: Error }>((resolve) =>
            setTimeout(() => resolve({ data: null, error: new Error("TTS timeout (12s)") }), 12000),
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
          const durMs =
            isFinite(audio.duration) && audio.duration > 0
              ? audio.duration * 1000
              : text.split(/\s+/).length * 280;
          startKaraoke(durMs);
        };
        audio.onended = () => {
          cleanup();
          if (!closingRef.current) { setSpokenUpTo(text.length); onDone(); }
        };
        audio.onerror = () => {
          cleanup();
          if (!closingRef.current) speakWithBrowser(text, onDone);
        };

        try {
          await audio.play();
          ttsConsecFailuresRef.current = 0;
        } catch (playErr: any) {
          if (playErr?.name === "NotAllowedError") {
            cleanup();
            if (!closingRef.current) speakWithBrowser(text, onDone);
            return;
          }
          throw playErr;
        }
      } catch {
        ttsConsecFailuresRef.current += 1;
        if (!closingRef.current) speakWithBrowser(text, onDone);
      }
    },
    [speakWithBrowser],
  );

  // ── Stop all active audio ──────────────────────────────────────────────────
  const stopAudio = useCallback(() => {
    if (karaokeTickRef.current) { clearTimeout(karaokeTickRef.current); karaokeTickRef.current = null; }
    if (resumeKeepAliveRef.current) { clearInterval(resumeKeepAliveRef.current); resumeKeepAliveRef.current = null; }
    if (utteranceRef.current) {
      try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
      utteranceRef.current = null;
    }
    if (elevenAudioElRef.current) {
      try { elevenAudioElRef.current.pause(); } catch { /* ignore */ }
      elevenAudioElRef.current.src = "";
      elevenAudioElRef.current = null;
    }
    if (elevenAudioUrlRef.current) {
      URL.revokeObjectURL(elevenAudioUrlRef.current);
      elevenAudioUrlRef.current = null;
    }
  }, []);

  // ── Play response queue sequentially ──────────────────────────────────────
  const playResponseAtIndex = useCallback(
    (responses: MemberResponse[], index: number) => {
      if (closingRef.current || index >= responses.length) {
        setPhase("done");
        setCurrentSpeakerIndex(-1);
        return;
      }

      const resp = responses[index];
      setCurrentSpeakerIndex(index);
      setPhase("playing");

      const onDone = () => {
        if (closingRef.current) return;
        // Append to history
        setHistory((prev) => [
          ...prev,
          { speaker: "member", memberName: resp.member_name, text: resp.content },
        ]);
        playResponseAtIndex(responses, index + 1);
      };

      if (resp.voice_style) {
        speakWithElevenLabs(resp.content, resp.voice_style, onDone);
      } else {
        speakWithBrowser(resp.content, onDone);
      }
    },
    [speakWithBrowser, speakWithElevenLabs],
  );

  // ── Web Speech API — same pattern as VoiceChatOverlay ─────────────────────
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
  }, []);

  const sendUserMessage = useCallback(
    async (text: string) => {
      const sid = sessionIdRef.current;
      if (!sid || closingRef.current) return;

      setPhase("processing");
      setHistory((prev) => [...prev, { speaker: "user", text }]);

      try {
        const { data, error } = await supabase.functions.invoke("mavis-council-session", {
          body: { action: "send_message", userId, session_id: sid, content: text, mode: "voice" },
        });

        if (closingRef.current) return;
        if (error) throw error;

        const responses: MemberResponse[] = data?.responses ?? [];
        setTurnCount((n) => n + 1);
        pendingResponsesRef.current = responses;
        playResponseAtIndex(responses, 0);
      } catch {
        if (!closingRef.current) setPhase("idle");
      }
    },
    [userId, playResponseAtIndex],
  );

  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let lastCapturedText = "";
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    const SILENCE_MS = 2500;

    const normalizeTranscript = (value: string) => value.replace(/\s+/g, " ").trim();

    const mergeTranscriptSegments = (segments: string[]) => {
      const cleaned = segments.map(normalizeTranscript).filter(Boolean);
      if (cleaned.length === 0) return "";
      const mergedWords: string[] = [];
      for (const segment of cleaned) {
        const nextWords = segment.split(" ").filter(Boolean);
        if (nextWords.length === 0) continue;
        if (mergedWords.length === 0) { mergedWords.push(...nextWords); continue; }
        const mergedText = mergedWords.join(" ").toLowerCase();
        const nextText = nextWords.join(" ").toLowerCase();
        if (nextText === mergedText || mergedText.endsWith(nextText)) continue;
        if (nextText.startsWith(mergedText)) { mergedWords.splice(0, mergedWords.length, ...nextWords); continue; }
        let overlap = 0;
        const maxOverlap = Math.min(mergedWords.length, nextWords.length);
        for (let size = maxOverlap; size > 0; size--) {
          const mergedTail = mergedWords.slice(-size).join(" ").toLowerCase();
          const nextHead = nextWords.slice(0, size).join(" ").toLowerCase();
          if (mergedTail === nextHead) { overlap = size; break; }
        }
        if (overlap > 0) { mergedWords.push(...nextWords.slice(overlap)); continue; }
        mergedWords.push(...nextWords);
      }
      return mergedWords.join(" ");
    };

    const syncTranscriptState = (results: any) => {
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
      if (!confirmed) { setTranscript(""); setInterimTranscript(fullCapture); return; }
      if (!fullCapture || fullCapture.toLowerCase() === confirmed.toLowerCase()) {
        setTranscript(confirmed); setInterimTranscript(""); return;
      }
      const confirmedLower = confirmed.toLowerCase();
      const fullLower = fullCapture.toLowerCase();
      if (fullLower.startsWith(confirmedLower)) {
        const delta = normalizeTranscript(fullCapture.slice(confirmed.length));
        setTranscript(confirmed); setInterimTranscript(delta); return;
      }
      setTranscript(""); setInterimTranscript(fullCapture);
    };

    const resetSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (recognitionRef.current) recognitionRef.current.stop();
      }, SILENCE_MS);
    };

    recognition.onresult = (event: any) => {
      syncTranscriptState(event.results);
      resetSilenceTimer();
    };

    recognition.onerror = (event: any) => {
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
        setTranscript("");
        setInterimTranscript("");
        sendUserMessage(captured).catch(() => {
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
  }, [sendUserMessage]);

  // Transition "done" → "idle" automatically so next turn is ready
  useEffect(() => {
    if (phase === "done" && !closingRef.current) {
      setPhase("idle");
    }
  }, [phase]);

  // ── Mic button handler ─────────────────────────────────────────────────────
  const handleMicTap = useCallback(() => {
    unlockAudio();
    if (phase === "idle") {
      startListening();
    } else if (phase === "listening") {
      if (recognitionRef.current) recognitionRef.current.stop();
    } else if (phase === "playing") {
      // Interrupt current TTS, stop queue, go straight to listening
      stopAudio();
      pendingResponsesRef.current = [];
      setCurrentSpeakerIndex(-1);
      stopListening();
      startListening();
    }
  }, [phase, unlockAudio, startListening, stopAudio, stopListening]);

  // ── Session lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("mavis-council-session", {
          body: {
            action: "start_session",
            userId,
            topic: initialTopic,
            voice_mode: true,
            member_ids: memberIds,
          },
        });

        if (cancelled || closingRef.current) return;
        if (error) throw error;

        const sid: string = data?.session_id ?? "";
        const mems: SessionMember[] = data?.members ?? [];
        sessionIdRef.current = sid;
        setSessionId(sid);
        setMembers(mems);
      } catch {
        // Non-fatal — show empty member list
      }
    })();

    // Warm up voices
    if (window.speechSynthesis && !window.speechSynthesis.getVoices().length) {
      window.speechSynthesis.getVoices();
    }
    audioUnlockedRef.current = false;
    ttsConsecFailuresRef.current = 0;

    return () => { cancelled = true; };
  }, [userId, initialTopic, memberIds]);

  // Auto-scroll history
  useEffect(() => {
    if (historyScrollRef.current) {
      historyScrollRef.current.scrollTop = historyScrollRef.current.scrollHeight;
    }
  }, [history]);

  // ── Close handler ──────────────────────────────────────────────────────────
  const handleClose = useCallback(async () => {
    closingRef.current = true;
    stopListening();
    stopAudio();
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    const sid = sessionIdRef.current;
    if (sid) {
      try {
        await supabase.functions.invoke("mavis-council-session", {
          body: { action: "end_session", userId, session_id: sid },
        });
      } catch { /* ignore */ }
    }

    onClose();
  }, [userId, onClose, stopListening, stopAudio]);

  // ── Derived display ────────────────────────────────────────────────────────
  const currentMemberResponse =
    currentSpeakerIndex >= 0 ? pendingResponsesRef.current[currentSpeakerIndex] : null;

  const activeMemberId = currentMemberResponse?.member_id ?? null;

  const phaseLabel: Record<Phase, string> = {
    idle: "TAP MIC TO SPEAK",
    listening: "LISTENING...",
    processing: "COUNCIL IS DELIBERATING...",
    playing: `${currentMemberResponse?.member_name?.toUpperCase() ?? "MEMBER"} SPEAKING`,
    done: "READY",
  };

  const spoken = displayedText.slice(0, spokenUpTo);
  const remaining = displayedText.slice(spokenUpTo);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
            <Users size={14} className="text-primary" />
          </div>
          <div>
            <p className="text-xs font-mono font-bold text-primary tracking-widest">COUNCIL SESSION</p>
            <p className="text-[10px] font-mono text-white/30 tracking-widest flex items-center gap-1">
              {sessionId ? (
                <>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  LIVE · TURN {turnCount}
                </>
              ) : (
                "CONNECTING..."
              )}
            </p>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="p-2 rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-all"
          aria-label="Close council session"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Member avatar row ── */}
      <div className="flex items-end justify-center gap-5 px-6 py-5 shrink-0">
        {members.length === 0 ? (
          // Loading placeholders
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 animate-pulse" />
              <div className="h-2 w-10 rounded bg-white/10 animate-pulse" />
            </div>
          ))
        ) : (
          members.map((member) => {
            const isActive = member.id === activeMemberId;
            return (
              <div key={member.id} className="flex flex-col items-center gap-1.5">
                <div
                  className={[
                    "w-12 h-12 rounded-full overflow-hidden border-2 flex items-center justify-center transition-all duration-300",
                    isActive
                      ? "border-primary ring-2 ring-primary/60 animate-pulse scale-110 shadow-[0_0_20px_rgba(var(--primary)/0.5)]"
                      : "border-white/15 bg-white/5",
                  ].join(" ")}
                >
                  {member.avatar ? (
                    <img
                      src={member.avatar}
                      alt={member.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span
                      className={[
                        "text-xs font-bold font-mono",
                        isActive ? "text-primary" : "text-white/50",
                      ].join(" ")}
                    >
                      {initials(member.name)}
                    </span>
                  )}
                </div>
                <p
                  className={[
                    "text-[10px] font-mono tracking-wide truncate max-w-[60px] text-center",
                    isActive ? "text-primary font-bold" : "text-white/40",
                  ].join(" ")}
                >
                  {member.name.split(" ")[0]}
                </p>
              </div>
            );
          })
        )}
      </div>

      {/* ── Karaoke text box ── */}
      <div className="px-5 shrink-0">
        <AnimatePresence mode="wait">
          {(phase === "playing" || phase === "processing") && (
            <motion.div
              key="karaoke"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 min-h-[72px] flex flex-col justify-center"
            >
              {phase === "processing" ? (
                <div className="flex items-center gap-2 justify-center">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-primary/60"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                    />
                  ))}
                </div>
              ) : displayedText ? (
                <>
                  {currentMemberResponse && (
                    <p className="text-[10px] font-mono text-primary/60 tracking-widest mb-1.5 uppercase">
                      {currentMemberResponse.member_name}
                      {currentMemberResponse.member_role
                        ? ` · ${currentMemberResponse.member_role}`
                        : ""}
                    </p>
                  )}
                  <p className="text-sm font-mono leading-relaxed break-words">
                    <span className="text-white">{spoken}</span>
                    <span ref={spokenWordRef} />
                    <span className="text-white/30">{remaining}</span>
                  </p>
                </>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Session history ── */}
      <div className="flex-1 flex flex-col min-h-0 px-5 mt-4">
        <p className="text-[10px] font-mono text-white/25 tracking-widest mb-2 shrink-0">
          ──── SESSION HISTORY ────
        </p>
        <div
          ref={historyScrollRef}
          className="flex-1 overflow-y-auto space-y-2 pr-1"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
        >
          {history.length === 0 ? (
            <p className="text-xs font-mono text-white/20 text-center mt-4">
              {initialTopic ? `Topic: ${initialTopic}` : "Tap the mic to begin"}
            </p>
          ) : (
            history.map((entry, i) => (
              <div
                key={i}
                className={[
                  "text-xs font-mono leading-relaxed",
                  entry.speaker === "user" ? "text-white/70" : "text-white/50",
                ].join(" ")}
              >
                <span
                  className={[
                    "font-bold mr-1",
                    entry.speaker === "user" ? "text-primary/80" : "text-white/40",
                  ].join(" ")}
                >
                  {entry.speaker === "user" ? "You:" : `${entry.memberName}:`}
                </span>
                {entry.text}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── User transcript (live) ── */}
      <AnimatePresence>
        {(transcript || interimTranscript) && (
          <motion.div
            key="user-transcript"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="px-5 mt-2 shrink-0"
          >
            <p className="text-xs font-mono text-center leading-relaxed break-words">
              {transcript && <span className="text-white/90">{transcript}</span>}
              {transcript && interimTranscript && " "}
              {interimTranscript && (
                <span className="text-white/40 italic">{interimTranscript}</span>
              )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Mic button + phase label ── */}
      <div className="flex flex-col items-center gap-3 py-6 shrink-0">
        <p className="text-[10px] font-mono tracking-widest text-primary/70">
          {phaseLabel[phase]}
        </p>
        <button
          onClick={handleMicTap}
          disabled={phase === "processing"}
          className={[
            "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 border-2 disabled:opacity-40 disabled:cursor-not-allowed",
            phase === "listening"
              ? "bg-red-500/20 border-red-500/60 text-red-400 animate-pulse scale-110"
              : phase === "playing"
              ? "bg-primary/20 border-primary/50 text-primary hover:bg-primary/30"
              : "bg-primary/10 border-primary/30 text-primary/70 hover:bg-primary/20 hover:text-primary",
          ].join(" ")}
          aria-label={
            phase === "listening"
              ? "Stop recording"
              : phase === "playing"
              ? "Interrupt"
              : "Start speaking"
          }
        >
          {phase === "listening" ? <MicOff size={26} /> : <Mic size={26} />}
        </button>
      </div>
    </motion.div>
  );
}
