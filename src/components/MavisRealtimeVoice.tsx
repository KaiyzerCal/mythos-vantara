import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Phone, PhoneOff, Loader2, Volume2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Phase = "idle" | "connecting" | "listening" | "thinking" | "speaking";

interface Transcript {
  role: "user" | "mavis";
  text: string;
  id: string;
}

interface MavisRealtimeVoiceProps {
  onClose: () => void;
  context?: string;
}

const PHASE_LABELS: Record<Phase, string> = {
  idle:       "Ready",
  connecting: "Connecting to MAVIS...",
  listening:  "Listening...",
  thinking:   "Processing...",
  speaking:   "MAVIS speaking",
};

const ORB_COLORS: Record<Phase, string> = {
  idle:       "from-primary/20 to-primary/5",
  connecting: "from-violet-500/30 to-violet-500/10",
  listening:  "from-cyan-400/40 to-cyan-400/15",
  thinking:   "from-amber-400/30 to-amber-400/10",
  speaking:   "from-primary/50 to-primary/20",
};

const ORB_GLOW: Record<Phase, string> = {
  idle:       "shadow-primary/10",
  connecting: "shadow-violet-500/20",
  listening:  "shadow-cyan-400/40",
  thinking:   "shadow-amber-400/30",
  speaking:   "shadow-primary/60",
};

export function MavisRealtimeVoice({ onClose, context }: MavisRealtimeVoiceProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState<Transcript[]>([]);
  const [muted, setMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pcRef    = useRef<RTCPeerConnection | null>(null);
  const dcRef    = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Partial transcript accumulation (MAVIS streaming)
  const partialMavisRef = useRef("");
  const partialIdRef    = useRef<string>("");

  const scrollToBottom = useCallback(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [transcript, scrollToBottom]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { teardown(); };
  }, []);

  function teardown() {
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.pause();
    }
    pcRef.current = null;
    dcRef.current = null;
    streamRef.current = null;
  }

  function handleRealtimeEvent(event: any) {
    switch (event.type) {
      case "session.created":
      case "session.updated":
        setPhase("listening");
        break;

      case "input_audio_buffer.speech_started":
        setPhase("listening");
        break;

      case "input_audio_buffer.speech_stopped":
        setPhase("thinking");
        break;

      case "conversation.item.input_audio_transcription.completed": {
        const text = event.transcript?.trim();
        if (text) {
          setTranscript(t => [...t, { role: "user", text, id: event.item_id ?? crypto.randomUUID() }]);
        }
        break;
      }

      case "response.created":
        setPhase("thinking");
        partialMavisRef.current = "";
        partialIdRef.current = event.response?.id ?? crypto.randomUUID();
        break;

      case "response.audio.delta":
        setPhase("speaking");
        break;

      case "response.audio_transcript.delta": {
        partialMavisRef.current += event.delta ?? "";
        const id = partialIdRef.current;
        setTranscript(t => {
          const last = t[t.length - 1];
          if (last && last.role === "mavis" && last.id === id) {
            return [...t.slice(0, -1), { ...last, text: partialMavisRef.current }];
          }
          return [...t, { role: "mavis", text: partialMavisRef.current, id }];
        });
        break;
      }

      case "response.audio_transcript.done": {
        const text = event.transcript?.trim();
        const id = partialIdRef.current;
        if (text) {
          setTranscript(t => {
            const last = t[t.length - 1];
            if (last && last.role === "mavis" && last.id === id) {
              return [...t.slice(0, -1), { ...last, text }];
            }
            return [...t, { role: "mavis", text, id }];
          });
        }
        partialMavisRef.current = "";
        break;
      }

      case "response.done":
        setPhase("listening");
        break;

      case "error":
        console.error("[MavisRealtimeVoice] Server error:", event.error);
        setError(event.error?.message ?? "Unknown error from voice session");
        break;
    }
  }

  async function connect() {
    setError(null);
    setPhase("connecting");

    try {
      // 1. Get ephemeral token from MAVIS
      const { data: sessionData, error: fnErr } = await (supabase as any).functions.invoke(
        "mavis-voice-session",
        { body: { context: context ?? "" } },
      );

      if (fnErr || !sessionData?.client_secret?.value) {
        throw new Error(fnErr?.message ?? sessionData?.error ?? "Failed to get voice session token");
      }

      const ephemeralKey = sessionData.client_secret.value;

      // 2. Audio element for remote (MAVIS) audio
      const audio = new Audio();
      audio.autoplay = true;
      audioRef.current = audio;

      // 3. Peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setConnected(false);
          setPhase("idle");
        }
      };

      // 4. Local mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      // 5. Data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (e) => {
        try { handleRealtimeEvent(JSON.parse(e.data)); } catch { /* ignore malformed */ }
      };

      // 6. SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 7. Exchange SDP with OpenAI Realtime API
      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        },
      );

      if (!sdpRes.ok) {
        const errText = await sdpRes.text();
        throw new Error(`OpenAI Realtime ${sdpRes.status}: ${errText.slice(0, 200)}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setConnected(true);
      setPhase("listening");
      toast.success("MAVIS voice session active");

    } catch (err: any) {
      console.error("[MavisRealtimeVoice] Connection failed:", err);
      const msg = err.message ?? "Connection failed";
      setError(msg);
      setPhase("idle");
      toast.error(`Voice session failed: ${msg}`);
      teardown();
    }
  }

  function disconnect() {
    teardown();
    setConnected(false);
    setPhase("idle");
    onClose();
  }

  function toggleMute() {
    if (!streamRef.current) return;
    const newMuted = !muted;
    streamRef.current.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
    setMuted(newMuted);
  }

  const isActive = phase !== "idle";
  const isPulsing = phase === "listening" || phase === "speaking";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-md"
    >
      {/* Close / Disconnect */}
      <button
        onClick={disconnect}
        className="absolute top-5 right-5 p-2 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        title="End session"
      >
        <PhoneOff size={18} />
      </button>

      {/* Header */}
      <div className="text-center mb-8">
        <h2 className="font-display text-primary text-sm font-bold tracking-widest text-glow-gold">
          MAVIS // VOICE REALTIME
        </h2>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          {PHASE_LABELS[phase]}
        </p>
      </div>

      {/* Orb */}
      <div className="relative mb-10">
        <motion.div
          animate={{
            scale: isPulsing ? [1, 1.08, 1] : 1,
            opacity: phase === "idle" ? 0.5 : 1,
          }}
          transition={{
            duration: phase === "speaking" ? 0.6 : 1.2,
            repeat: isPulsing ? Infinity : 0,
            ease: "easeInOut",
          }}
          className={`w-36 h-36 rounded-full bg-gradient-to-br ${ORB_COLORS[phase]} border border-primary/20 shadow-2xl ${ORB_GLOW[phase]} flex items-center justify-center`}
        >
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30 flex items-center justify-center">
            {phase === "connecting" ? (
              <Loader2 size={28} className="text-primary animate-spin" />
            ) : phase === "speaking" ? (
              <Volume2 size={28} className="text-primary" />
            ) : (
              <Mic size={28} className={`text-primary ${muted ? "opacity-40" : ""}`} />
            )}
          </div>
        </motion.div>

        {/* Ripple rings when listening */}
        <AnimatePresence>
          {phase === "listening" && (
            <>
              {[1, 2, 3].map((i) => (
                <motion.div
                  key={i}
                  initial={{ scale: 1, opacity: 0.3 }}
                  animate={{ scale: 1 + i * 0.25, opacity: 0 }}
                  transition={{ duration: 1.5, delay: i * 0.3, repeat: Infinity, ease: "easeOut" }}
                  className="absolute inset-0 rounded-full border border-cyan-400/30"
                />
              ))}
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 mb-8">
        {!connected ? (
          <button
            onClick={connect}
            disabled={phase === "connecting"}
            className="flex items-center gap-2 px-6 py-3 rounded bg-primary text-primary-foreground font-mono text-sm font-bold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {phase === "connecting" ? (
              <><Loader2 size={16} className="animate-spin" /> Connecting</>
            ) : (
              <><Phone size={16} /> Start Voice Session</>
            )}
          </button>
        ) : (
          <>
            <button
              onClick={toggleMute}
              className={`p-3 rounded border transition-colors ${
                muted
                  ? "border-destructive/50 text-destructive bg-destructive/10 hover:bg-destructive/20"
                  : "border-border text-muted-foreground hover:text-primary hover:border-primary/50"
              }`}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              onClick={disconnect}
              className="px-5 py-2.5 rounded border border-destructive/50 text-destructive hover:bg-destructive/10 font-mono text-sm transition-colors flex items-center gap-2"
            >
              <PhoneOff size={16} /> End Session
            </button>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-2 bg-destructive/10 border border-destructive/30 rounded text-destructive text-xs font-mono max-w-sm text-center">
          {error}
        </div>
      )}

      {/* Transcript */}
      {transcript.length > 0 && (
        <div className="w-full max-w-lg max-h-52 overflow-y-auto px-4 space-y-2 scrollbar-thin">
          {transcript.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2 ${t.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] px-3 py-1.5 rounded text-xs font-body ${
                  t.role === "user"
                    ? "bg-muted text-foreground"
                    : "bg-primary/10 text-primary border border-primary/20"
                }`}
              >
                <span className="block text-xs font-mono mb-0.5 opacity-60">
                  {t.role === "user" ? "YOU" : "MAVIS"}
                </span>
                {t.text}
              </div>
            </motion.div>
          ))}
          <div ref={transcriptEndRef} />
        </div>
      )}

      {transcript.length === 0 && connected && (
        <p className="text-xs font-mono text-muted-foreground">
          Speak to begin — MAVIS is listening.
        </p>
      )}

      {/* Footer note */}
      <p className="absolute bottom-4 text-xs font-mono text-muted-foreground">
        MAVIS REALTIME · OPENAAI WEBRTC · END-TO-END ENCRYPTED
      </p>
    </motion.div>
  );
}
