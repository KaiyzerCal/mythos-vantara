import { useState, useRef, useEffect } from "react";
import { Mic, Square, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase as _supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const supabase = _supabase as any;

type MemoState = "idle" | "recording" | "transcribing" | "preview";

interface TranscriptResult {
  transcript: string;
  suggested_title: string;
  mood: string;
  duration_seconds: number;
}

interface VoiceMemoProps {
  inline?: boolean;
}

export function VoiceMemo({ inline = false }: VoiceMemoProps) {
  const [state, setState] = useState<MemoState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(100);
      mediaRecorderRef.current = mr;
      setSeconds(0);
      setState("recording");
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch {
      toast({ title: "Mic access denied", description: "Allow microphone to record voice memos.", variant: "destructive" });
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      mr.stream.getTracks().forEach(t => t.stop());
      await transcribe(blob);
    };
    mr.stop();
    setState("transcribing");
  };

  const transcribe = async (blob: Blob) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      // Convert blob to base64 for Gemini
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-transcribe-memo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ audio_base64: base64, mime_type: "audio/webm" }),
      });

      if (!res.ok) throw new Error(`Transcription failed: ${res.status}`);
      const data = await res.json();
      setResult({ transcript: data.transcript ?? "", suggested_title: data.suggested_title ?? "Voice Memo", mood: data.mood ?? "reflective", duration_seconds: data.duration_seconds ?? seconds });
      setState("preview");
    } catch (err: any) {
      toast({ title: "Transcription failed", description: err.message, variant: "destructive" });
      setState("idle");
    }
  };

  const saveJournalEntry = async () => {
    if (!result || !user?.id) return;
    try {
      await supabase.from("journal_entries").insert({
        user_id: user.id,
        title: result.suggested_title,
        content: result.transcript,
        mood: result.mood,
        category: "voice-memo",
        tags: ["voice-memo", "auto-transcribed"],
      });
      toast({ title: "Journal entry saved", description: result.suggested_title });
      setResult(null);
      setState("idle");
    } catch {
      toast({ title: "Failed to save entry", variant: "destructive" });
    }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // Inline preview card (rendered inside the chat input column)
  if (inline && state === "preview" && result) {
    return (
      <div className="w-full bg-[#0d0d0d] border border-neon-gold/30 rounded-lg p-3 shadow-xl mb-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-mono font-semibold text-neon-gold">VOICE MEMO</span>
          <span className="text-[9px] text-white/40 font-mono">{result.mood.toUpperCase()}</span>
        </div>
        <p className="text-[10px] font-mono text-white/70 mb-1 font-semibold truncate">{result.suggested_title}</p>
        <p className="text-[10px] text-white/50 line-clamp-3 mb-2">{result.transcript}</p>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 h-6 text-[10px] bg-neon-gold/20 hover:bg-neon-gold/30 text-neon-gold border border-neon-gold/40" onClick={saveJournalEntry}>
            <Check size={10} className="mr-1" /> Save
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-white/30 hover:text-white/60" onClick={() => { setResult(null); setState("idle"); }}>
            <X size={10} />
          </Button>
        </div>
      </div>
    );
  }

  // Floating preview card (default behavior)
  if (state === "preview" && result) {
    return (
      <div className="fixed bottom-6 left-6 z-50 w-80 bg-[#0d0d0d] border border-neon-gold/30 rounded-xl p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono font-semibold text-neon-gold">VOICE MEMO</span>
          <span className="text-[10px] text-white/40 font-mono">{result.mood.toUpperCase()}</span>
        </div>
        <p className="text-[11px] font-mono text-white/70 mb-1 font-semibold">{result.suggested_title}</p>
        <p className="text-[11px] text-white/50 line-clamp-4 mb-3">{result.transcript}</p>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 h-7 text-xs bg-neon-gold/20 hover:bg-neon-gold/30 text-neon-gold border border-neon-gold/40" onClick={saveJournalEntry}>
            <Check size={12} className="mr-1" /> Save to Journal
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/30 hover:text-white/60" onClick={() => { setResult(null); setState("idle"); }}>
            <X size={12} />
          </Button>
        </div>
      </div>
    );
  }

  // Inline mode — button sits in the chat input column above the attach button
  if (inline) {
    return (
      <div className="flex flex-col items-center gap-1">
        {state === "recording" && (
          <div className="flex items-center gap-1.5 bg-[#0d0d0d] border border-red-500/40 rounded-full px-2 py-1 shadow-lg">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[9px] font-mono text-red-400">{formatTime(seconds)}</span>
          </div>
        )}
        {state === "transcribing" && (
          <div className="flex items-center gap-1.5 bg-[#0d0d0d] border border-neon-gold/30 rounded-full px-2 py-1 shadow-lg">
            <Loader2 size={10} className="text-neon-gold animate-spin" />
            <span className="text-[9px] font-mono text-white/50">Transcribing...</span>
          </div>
        )}
        <Button
          onClick={state === "recording" ? stopRecording : startRecording}
          disabled={state === "transcribing"}
          size="icon"
          className={cn(
            "h-9 w-9 rounded-lg shadow transition-all shrink-0",
            state === "recording"
              ? "bg-red-500 hover:bg-red-600 scale-110"
              : "bg-[#1a1a1a] hover:bg-[#222] border border-white/10"
          )}
        >
          {state === "recording" ? <Square size={13} className="text-white" fill="white" /> : <Mic size={13} className="text-white/60" />}
        </Button>
      </div>
    );
  }

  // Floating mode (default)
  return (
    <div className="fixed bottom-6 left-6 z-50">
      {state === "recording" && (
        <div className="flex items-center gap-2 bg-[#0d0d0d] border border-red-500/40 rounded-full px-3 py-1.5 mb-2 shadow-lg">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-mono text-red-400">{formatTime(seconds)}</span>
        </div>
      )}
      {state === "transcribing" && (
        <div className="flex items-center gap-2 bg-[#0d0d0d] border border-neon-gold/30 rounded-full px-3 py-1.5 mb-2 shadow-lg">
          <Loader2 size={12} className="text-neon-gold animate-spin" />
          <span className="text-xs font-mono text-white/50">Transcribing...</span>
        </div>
      )}
      <Button
        onClick={state === "recording" ? stopRecording : startRecording}
        disabled={state === "transcribing"}
        size="icon"
        className={`h-10 w-10 rounded-full shadow-lg transition-all ${state === "recording" ? "bg-red-500 hover:bg-red-600 scale-110" : "bg-[#1a1a1a] hover:bg-[#222] border border-white/10"}`}
      >
        {state === "recording" ? <Square size={14} className="text-white" fill="white" /> : <Mic size={14} className="text-white/60" />}
      </Button>
    </div>
  );
}
