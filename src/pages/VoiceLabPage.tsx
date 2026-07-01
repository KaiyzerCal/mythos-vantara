// ============================================================
// VANTARA.EXE — VoiceLabPage
// Local voice studio connecting to a running Voicebox instance
// at http://localhost:17493 (voice cloning, TTS, STT via Whisper)
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, Play, Pause, Square, Volume2, Download,
  Loader2, RefreshCw, Settings, ExternalLink, Copy,
  CheckCircle2, AlertCircle, Wifi, WifiOff, Plus,
  History, Radio, Wand2, Star, Trash2, ChevronRight,
  FileAudio, Upload, Languages, Cpu,
} from "lucide-react";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ─── Supabase / env ──────────────────────────────────────────
const supabase: any = supabaseTyped;
const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const DEFAULT_VB_URL = "http://localhost:17493";

// ─── Engine / Language constants ──────────────────────────────
const ENGINES = [
  { value: "kokoro", label: "Kokoro (fast, 82M)" },
  { value: "chatterbox", label: "Chatterbox (23 langs)" },
  { value: "chatterbox_turbo", label: "Chatterbox Turbo (350M)" },
  { value: "qwen", label: "Qwen3-TTS (high quality)" },
  { value: "luxtts", label: "LuxTTS (English, 48kHz)" },
  { value: "tada", label: "TADA (700s+, HumeAI)" },
];

const LANGUAGES = ["en", "zh", "ja", "ko", "fr", "de", "es", "it", "pt", "ar", "hi", "ru"];

const STT_MODELS = ["tiny", "base", "small", "medium", "large"];

// ─── Types ───────────────────────────────────────────────────
interface VBProfile {
  id: string;
  name: string;
  type: "cloned" | "preset" | "designed";
  language: string;
  engine?: string;
  avatar_url?: string;
}

interface VBGeneration {
  id: string;
  profile_name: string;
  text: string;
  duration: number;
  engine: string;
  created_at: string;
  is_favorited: boolean;
}

// ─── Component ────────────────────────────────────────────────
export default function VoiceLabPage() {
  const { user } = useAuth();

  // Connection
  const [voiceboxUrl, setVoiceboxUrl] = useState(
    () => localStorage.getItem("voicebox_url") ?? DEFAULT_VB_URL
  );
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Profiles
  const [profiles, setProfiles] = useState<VBProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<VBProfile | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(false);

  // TTS
  const [ttsText, setTtsText] = useState("");
  const [ttsEngine, setTtsEngine] = useState("kokoro");
  const [ttsLanguage, setTtsLanguage] = useState("en");
  const [ttsPersonality, setTtsPersonality] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);

  // STT
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [sttModel, setSttModel] = useState("base");

  // History
  const [history, setHistory] = useState<VBGeneration[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // UI
  const [activeTab, setActiveTab] = useState<"tts" | "stt" | "history">("tts");
  const [showSettings, setShowSettings] = useState(false);
  const [urlInput, setUrlInput] = useState(voiceboxUrl);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Connection ──────────────────────────────────────────────
  const loadProfiles = useCallback(async (url = voiceboxUrl) => {
    setProfilesLoading(true);
    try {
      const res = await fetch(`${url}/profiles`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const data = await res.json();
      setProfiles(data ?? []);
      if (data?.length && !selectedProfile) setSelectedProfile(data[0]);
    } catch {}
    finally { setProfilesLoading(false); }
  }, [voiceboxUrl, selectedProfile]);

  const loadHistory = useCallback(async (url = voiceboxUrl) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${url}/history?limit=30`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.generations ?? []);
    } catch {}
    finally { setHistoryLoading(false); }
  }, [voiceboxUrl]);

  const checkConnection = useCallback(async (url: string) => {
    setConnecting(true);
    try {
      const res = await fetch(`${url}/`, { signal: AbortSignal.timeout(3000) });
      const ok = res.ok;
      setConnected(ok);
      if (ok) {
        localStorage.setItem("voicebox_url", url);
        await loadProfiles(url);
        await loadHistory(url);
      }
      return ok;
    } catch {
      setConnected(false);
      return false;
    } finally {
      setConnecting(false);
    }
  }, [loadProfiles, loadHistory]);

  useEffect(() => { checkConnection(voiceboxUrl); }, []);

  // ── TTS ─────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!selectedProfile || !ttsText.trim()) return;
    setGenerating(true);
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    setCurrentAudioUrl(null);
    try {
      const res = await fetch(`${voiceboxUrl}/generate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: selectedProfile.id,
          text: ttsText,
          language: ttsLanguage,
          engine: ttsEngine,
          personality: ttsPersonality,
          max_chunk_chars: 200,
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`Generation failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setCurrentAudioUrl(url);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
        setAudioPlaying(true);
      }
      toast.success("Voice generated");
      await loadHistory();
    } catch (e: any) {
      toast.error("Generation failed: " + e.message);
    } finally {
      setGenerating(false);
    }
  }

  function togglePlay() {
    if (!audioRef.current || !currentAudioUrl) return;
    if (audioPlaying) {
      audioRef.current.pause();
      setAudioPlaying(false);
    } else {
      audioRef.current.play();
      setAudioPlaying(true);
    }
  }

  function handleDownload() {
    if (!currentAudioUrl) return;
    const a = document.createElement("a");
    a.href = currentAudioUrl;
    a.download = `voicebox-${Date.now()}.wav`;
    a.click();
  }

  // ── STT ─────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await transcribeBlob(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (e: any) {
      toast.error("Microphone access denied");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  async function transcribeBlob(blob: Blob) {
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("file", blob, "recording.webm");
      form.append("model", sttModel);
      const res = await fetch(`${voiceboxUrl}/transcribe`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`Transcription failed: ${res.status}`);
      const { text } = await res.json();
      setTranscript(text ?? "");
      toast.success("Transcription complete");
    } catch (e: any) {
      toast.error("Transcription failed: " + e.message);
    } finally {
      setTranscribing(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await transcribeBlob(file);
  }

  // ── History ─────────────────────────────────────────────────
  async function playHistoryItem(gen: VBGeneration) {
    const audioUrl = `${voiceboxUrl}/history/${gen.id}/export-audio`;
    if (audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.play();
      setAudioPlaying(true);
      setCurrentAudioUrl(audioUrl);
    }
  }

  // ── Settings save ────────────────────────────────────────────
  async function handleSaveUrl() {
    const trimmed = urlInput.trim().replace(/\/$/, "");
    setVoiceboxUrl(trimmed);
    setShowSettings(false);
    const ok = await checkConnection(trimmed);
    if (!ok) toast.error("Could not connect to " + trimmed);
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onEnded={() => setAudioPlaying(false)}
        onPause={() => setAudioPlaying(false)}
        onPlay={() => setAudioPlaying(true)}
      />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-violet-500/10 border border-violet-500/20 rounded-lg flex items-center justify-center">
            <Mic size={16} className="text-violet-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-widest text-white uppercase font-mono">
              Voice Lab
            </h1>
            <p className="text-xs text-zinc-500 font-mono">Voicebox Studio</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono border ${
            connected
              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
              : "bg-red-500/20 text-red-400 border-red-500/30"
          }`}>
            {connecting
              ? <Loader2 size={10} className="animate-spin" />
              : connected
                ? <Wifi size={10} />
                : <WifiOff size={10} />
            }
            <span>
              {connecting
                ? "Connecting..."
                : connected
                  ? `Connected · ${voiceboxUrl.replace("http://", "")}`
                  : "Not Connected"
              }
            </span>
          </div>

          <button
            onClick={() => checkConnection(voiceboxUrl)}
            disabled={connecting}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-40"
            title="Refresh connection"
          >
            <RefreshCw size={14} className={connecting ? "animate-spin" : ""} />
          </button>

          <button
            onClick={() => { setUrlInput(voiceboxUrl); setShowSettings(s => !s); }}
            className={`p-1.5 rounded-lg transition-colors ${
              showSettings ? "bg-zinc-700 text-zinc-200" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
            title="Settings"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* ── Settings popover ── */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-14 right-4 z-50 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4"
          >
            <h3 className="text-sm font-semibold text-white mb-3">Voicebox Connection</h3>
            <label className="text-xs text-zinc-400 mb-1 block">Server URL</label>
            <div className="flex gap-2">
              <input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSaveUrl()}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500"
                placeholder="http://localhost:17493"
              />
              <button
                onClick={handleSaveUrl}
                className="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm rounded-lg transition-colors font-medium"
              >
                Save
              </button>
            </div>
            <p className="text-xs text-zinc-600 mt-2">
              Default: <code className="text-zinc-400">localhost:17493</code>.
              For cloud deployments, use your server's public URL.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Body ── */}
      {!connected && !connecting ? (
        /* ── Not connected: install prompt ── */
        <div className="flex flex-col items-center justify-center flex-1 gap-6 text-center px-8">
          <div className="w-16 h-16 bg-violet-500/10 border border-violet-500/20 rounded-2xl flex items-center justify-center">
            <Mic size={32} className="text-violet-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white mb-2">Connect Voicebox</h2>
            <p className="text-sm text-zinc-400 max-w-sm">
              Voicebox is a free, local AI voice studio with voice cloning and Whisper transcription.
              Install and run it to unlock advanced TTS/STT in Vantara.
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            <a
              href="https://github.com/KaiyzerCal/voicebox"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
            >
              <ExternalLink size={14} /> Get Voicebox
            </a>
            <button
              onClick={() => checkConnection(voiceboxUrl)}
              className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              <RefreshCw size={14} /> {connecting ? "Checking..." : "Retry Connection"}
            </button>
          </div>
          <div className="text-xs text-zinc-600">
            Default: <code className="text-zinc-400">localhost:17493</code> ·{" "}
            <button
              onClick={() => setShowSettings(true)}
              className="text-violet-400 hover:text-violet-300 ml-1"
            >
              Configure URL
            </button>
          </div>
        </div>
      ) : (
        /* ── Connected: two-column layout ── */
        <div className="flex flex-1 min-h-0">
          {/* ── LEFT: Profile panel ── */}
          <div className="w-56 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-950">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800">
              <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Voices</span>
              {profilesLoading
                ? <Loader2 size={12} className="animate-spin text-zinc-600" />
                : <button onClick={() => loadProfiles()} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                    <RefreshCw size={12} />
                  </button>
              }
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {profiles.length === 0 && !profilesLoading && (
                <p className="text-xs text-zinc-600 text-center py-6 px-2">
                  No voice profiles found. Add voices in Voicebox.
                </p>
              )}
              {profiles.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProfile(p)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    selectedProfile?.id === p.id
                      ? "bg-violet-500/10 border-violet-500/30 text-violet-300"
                      : "bg-zinc-800/40 border-transparent hover:border-zinc-700 text-zinc-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300 shrink-0">
                      {p.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">{p.name}</p>
                      <p className="text-xs text-zinc-500">{p.type} · {p.language}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Engine / Language quick settings */}
            <div className="border-t border-zinc-800 p-3 space-y-3">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block flex items-center gap-1">
                  <Cpu size={10} /> Engine
                </label>
                <select
                  value={ttsEngine}
                  onChange={e => setTtsEngine(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-violet-500"
                >
                  {ENGINES.map(e => (
                    <option key={e.value} value={e.value}>{e.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block flex items-center gap-1">
                  <Languages size={10} /> Language
                </label>
                <select
                  value={ttsLanguage}
                  onChange={e => setTtsLanguage(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-violet-500"
                >
                  {LANGUAGES.map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ttsPersonality}
                  onChange={e => setTtsPersonality(e.target.checked)}
                  className="rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500"
                />
                <span className="text-xs text-zinc-400">Personality mode</span>
              </label>
            </div>
          </div>

          {/* ── RIGHT: Studio panel ── */}
          <div className="flex flex-col flex-1 min-w-0">
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800 shrink-0">
              {(["tts", "stt", "history"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === tab
                      ? "bg-violet-500/10 text-violet-300 border border-violet-500/20"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                  }`}
                >
                  {tab === "tts" && <span className="flex items-center gap-1.5"><Volume2 size={12} /> Generate</span>}
                  {tab === "stt" && <span className="flex items-center gap-1.5"><Mic size={12} /> Transcribe</span>}
                  {tab === "history" && <span className="flex items-center gap-1.5"><History size={12} /> History</span>}
                </button>
              ))}
              {activeTab === "history" && (
                <button
                  onClick={() => loadHistory()}
                  disabled={historyLoading}
                  className="ml-auto text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  <RefreshCw size={12} className={historyLoading ? "animate-spin" : ""} />
                </button>
              )}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4">
              <AnimatePresence mode="wait">
                {/* ── TTS tab ── */}
                {activeTab === "tts" && (
                  <motion.div
                    key="tts"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="space-y-4"
                  >
                    {!selectedProfile && (
                      <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        Select a voice profile from the left panel to get started.
                      </div>
                    )}

                    {selectedProfile && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-violet-500/5 border border-violet-500/10 rounded-lg">
                        <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-violet-300 shrink-0">
                          {selectedProfile.name[0]?.toUpperCase()}
                        </div>
                        <span className="text-sm text-violet-300 font-medium">{selectedProfile.name}</span>
                        <span className="text-xs text-zinc-600 ml-auto">{selectedProfile.type} · {selectedProfile.language}</span>
                      </div>
                    )}

                    <div>
                      <label className="text-xs text-zinc-400 mb-1.5 block">Text to speak</label>
                      <textarea
                        value={ttsText}
                        onChange={e => setTtsText(e.target.value)}
                        placeholder="Enter text to convert to speech..."
                        rows={6}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-violet-500 transition-colors"
                      />
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-zinc-600">{ttsText.length} chars</span>
                        {ttsText.length > 500 && (
                          <span className="text-xs text-amber-400">Long text may be slow</span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={handleGenerate}
                      disabled={generating || !selectedProfile || !ttsText.trim()}
                      className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-xl px-4 py-3 text-sm transition-colors"
                    >
                      {generating
                        ? <><Loader2 size={14} className="animate-spin" /> Generating...</>
                        : <><Wand2 size={14} /> Generate Voice</>
                      }
                    </button>
                  </motion.div>
                )}

                {/* ── STT tab ── */}
                {activeTab === "stt" && (
                  <motion.div
                    key="stt"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="space-y-4"
                  >
                    <div>
                      <label className="text-xs text-zinc-400 mb-1.5 block flex items-center gap-1">
                        <Cpu size={10} /> Whisper Model
                      </label>
                      <select
                        value={sttModel}
                        onChange={e => setSttModel(e.target.value)}
                        className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-violet-500"
                      >
                        {STT_MODELS.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>

                    {/* Record button */}
                    <div className="flex flex-col items-center gap-4 py-6">
                      <button
                        onClick={recording ? stopRecording : startRecording}
                        className={`w-20 h-20 rounded-full flex items-center justify-center transition-all border-2 ${
                          recording
                            ? "bg-red-500/20 border-red-500 text-red-400 animate-pulse"
                            : "bg-zinc-800 border-zinc-700 hover:border-violet-500 text-zinc-300 hover:text-violet-400"
                        }`}
                      >
                        {recording ? <Square size={28} /> : <Mic size={28} />}
                      </button>
                      <p className="text-sm text-zinc-400">
                        {recording ? "Recording... click to stop" : "Click to start recording"}
                      </p>
                    </div>

                    {/* File upload */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-zinc-800" />
                      <span className="text-xs text-zinc-600">or upload audio</span>
                      <div className="flex-1 h-px bg-zinc-800" />
                    </div>

                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={transcribing}
                      className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 rounded-xl px-4 py-3 text-sm border border-zinc-700 hover:border-zinc-600 transition-colors"
                    >
                      {transcribing
                        ? <><Loader2 size={14} className="animate-spin" /> Transcribing...</>
                        : <><Upload size={14} /> Upload Audio File</>
                      }
                    </button>

                    {/* Transcript output */}
                    {transcript && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs text-zinc-400">Transcript</label>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(transcript);
                              toast.success("Copied to clipboard");
                            }}
                            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                          >
                            <Copy size={10} /> Copy
                          </button>
                        </div>
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 min-h-[80px] whitespace-pre-wrap">
                          {transcript}
                        </div>
                        <button
                          onClick={() => { setTtsText(transcript); setActiveTab("tts"); }}
                          className="text-xs text-violet-400 hover:text-violet-300 transition-colors flex items-center gap-1"
                        >
                          <ChevronRight size={12} /> Use as TTS input
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* ── History tab ── */}
                {activeTab === "history" && (
                  <motion.div
                    key="history"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="space-y-1"
                  >
                    {historyLoading && (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 size={20} className="animate-spin text-zinc-600" />
                      </div>
                    )}

                    {!historyLoading && history.length === 0 && (
                      <div className="text-center py-12">
                        <FileAudio size={32} className="text-zinc-700 mx-auto mb-3" />
                        <p className="text-sm text-zinc-500">No generation history yet.</p>
                        <p className="text-xs text-zinc-600 mt-1">Generate some voice clips to see them here.</p>
                      </div>
                    )}

                    {history.map(gen => (
                      <button
                        key={gen.id}
                        onClick={() => playHistoryItem(gen)}
                        className="w-full text-left flex items-start gap-3 p-3 rounded-lg hover:bg-zinc-800/60 border border-transparent hover:border-zinc-700/50 transition-all"
                      >
                        <div className="w-8 h-8 bg-zinc-800 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                          <FileAudio size={14} className="text-violet-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-zinc-300 line-clamp-2">{gen.text}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-zinc-600">{gen.profile_name}</span>
                            <span className="text-xs text-zinc-700">·</span>
                            <span className="text-xs text-zinc-600">{gen.duration?.toFixed(1)}s</span>
                            <span className="text-xs text-zinc-700">·</span>
                            <span className="text-xs text-zinc-600">{gen.engine}</span>
                            {gen.is_favorited && <Star size={10} className="text-amber-400 fill-amber-400" />}
                          </div>
                        </div>
                        <Play size={12} className="text-zinc-600 shrink-0 mt-1" />
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Audio player (fixed bottom) ── */}
            {currentAudioUrl && (
              <div className="border-t border-zinc-800 p-3 bg-zinc-950/80 shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlay}
                    className="w-8 h-8 bg-violet-600 rounded-full flex items-center justify-center hover:bg-violet-700 transition-colors shrink-0"
                  >
                    {audioPlaying
                      ? <Pause size={14} className="text-white" />
                      : <Play size={14} className="text-white" />
                    }
                  </button>
                  <div className="flex-1 h-1 bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full bg-violet-500 rounded-full transition-all ${
                        audioPlaying ? "w-1/3" : "w-0"
                      }`}
                    />
                  </div>
                  <button
                    onClick={handleDownload}
                    className="text-zinc-400 hover:text-zinc-300 transition-colors"
                    title="Download"
                  >
                    <Download size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
