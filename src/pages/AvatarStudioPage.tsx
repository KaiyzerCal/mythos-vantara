// ============================================================
// VANTARA.EXE — Avatar Studio
// Face image + script → ElevenLabs voice → AI lip-sync video
// Powered by fal.ai SadTalker — replaces HeyGen entirely
// ============================================================
import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Link2,
  Video,
  Download,
  Loader2,
  RefreshCw,
  User,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Mic,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── ElevenLabs preset voices ────────────────────────────────

const VOICES = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", gender: "Male" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "Female" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "Male" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", gender: "Female" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", gender: "Male" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", gender: "Female" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", gender: "Female" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris", gender: "Male" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will", gender: "Male" },
  { id: "9BWtsMINqrJLrRacOk9x", name: "Aria", gender: "Female" },
];

// ─── Types ───────────────────────────────────────────────────

type GenStatus = "idle" | "tts" | "processing" | "complete" | "error";
type ImageMode = "upload" | "url";
type AspectKey = "16:9" | "9:16" | "1:1";
type EngineMode = "photo" | "heygen";
type PollProvider = "heygen" | "hallo2" | "sadtalker";

interface HeyGenOption { id: string; name: string; }

const ASPECTS: { key: AspectKey; label: string; hint: string; w: number; h: number }[] = [
  { key: "9:16", label: "Vertical",  hint: "Reels, TikTok, Shorts", w: 720,  h: 1280 },
  { key: "16:9", label: "Widescreen", hint: "YouTube, presentation", w: 1280, h: 720  },
  { key: "1:1",  label: "Square",    hint: "Feed post, thumbnail",  w: 720,  h: 720  },
];

const SCRIPT_TEMPLATES: { label: string; text: string }[] = [
  { label: "Product intro",   text: "Hi, I'm excited to introduce something we've been working on. It's a tool designed to help you move faster, think clearer, and ship the work that matters." },
  { label: "Course lesson",   text: "Welcome back. In today's lesson, we're going to break down one of the most important ideas in the entire course — and by the end, you'll know exactly how to apply it." },
  { label: "Sales pitch",     text: "If you've been struggling to grow, you're not alone — and it's not your fault. Let me show you the exact system we use to help clients double their output in half the time." },
  { label: "Announcement",    text: "Big news. We just launched something I've been dreaming about for months. Here's what it is, why it matters, and what it means for you." },
  { label: "Personal update", text: "Hey, quick update from me. It's been a wild couple of weeks — here's what I've been learning, what's changed, and where I'm headed next." },
];

// ─── AvatarStudioPage ────────────────────────────────────────

export function AvatarStudioPage() {
  const { user } = useAuth();
  const { profile, updateProfile } = useProfile();

  // Engine — SadTalker face-animation vs. a trained HeyGen avatar
  const [engineMode, setEngineMode] = useState<EngineMode>("photo");

  // HeyGen avatar mode
  const [avatarId, setAvatarId] = useState("");
  const [heygenVoiceId, setHeygenVoiceId] = useState("");
  const [avatarLabel, setAvatarLabel] = useState("");
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const [avatarOptions, setAvatarOptions] = useState<HeyGenOption[]>([]);
  const [heygenVoiceOptions, setHeygenVoiceOptions] = useState<HeyGenOption[]>([]);
  const [fetchingAvatars, setFetchingAvatars] = useState(false);
  const [fetchingVoices, setFetchingVoices] = useState(false);

  const savedAvatars = profile.saved_heygen_avatars ?? [];

  function loadSavedAvatar(label: string) {
    const found = savedAvatars.find((a) => a.label === label);
    if (!found) return;
    setAvatarId(found.avatar_id);
    setHeygenVoiceId(found.voice_id);
    setAvatarLabel(found.label);
  }

  function saveCurrentAvatarToRoster() {
    if (!avatarId.trim() || !heygenVoiceId.trim()) {
      toast.error("Set an avatar ID and voice ID first");
      return;
    }
    const label = avatarLabel.trim() || `Avatar ${savedAvatars.length + 1}`;
    const next = [
      ...savedAvatars.filter((a) => a.label !== label),
      { label, avatar_id: avatarId.trim(), voice_id: heygenVoiceId.trim() },
    ];
    updateProfile({ saved_heygen_avatars: next });
    setAvatarLabel(label);
    toast.success(`Saved "${label}" to your avatars`);
  }

  function removeSavedAvatar(label: string) {
    updateProfile({ saved_heygen_avatars: savedAvatars.filter((a) => a.label !== label) });
  }

  // Prefill from the saved default once the profile loads
  useEffect(() => {
    if (profile.default_heygen_avatar_id) setAvatarId(profile.default_heygen_avatar_id);
    if (profile.default_heygen_voice_id) setHeygenVoiceId(profile.default_heygen_voice_id);
  }, [profile.default_heygen_avatar_id, profile.default_heygen_voice_id]);

  // Image
  const [imageMode, setImageMode] = useState<ImageMode>("upload");
  const [imageUrl, setImageUrl] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Script & voice
  const [script, setScript] = useState("");
  const [voiceId, setVoiceId] = useState("JBFqnCBsd6RMkjVDRZzb");
  const [aspect, setAspect] = useState<AspectKey>("9:16");
  const [stillMode, setStillMode] = useState(false);
  const [useEnhancer, setUseEnhancer] = useState(true);


  // Generation
  const [status, setStatus] = useState<GenStatus>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [requestId, setRequestId] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Captured at generation start so a completed poll persists the script
  // that was actually rendered, even if the textarea was edited meanwhile.
  const generatingScriptRef = useRef("");

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  // Cleanup on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Image upload ──────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }

    const localUrl = URL.createObjectURL(file);
    setImagePreview(localUrl);
    setImageUploading(true);

    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `avatar-faces/${user?.id ?? "anon"}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw new Error(error.message);
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      setImageUrl(publicUrl);
      toast.success("Image uploaded");
    } catch (err: any) {
      toast.error(`Upload failed: ${err.message}`);
      setImagePreview("");
    } finally {
      setImageUploading(false);
    }
  }

  // ── HeyGen avatar/voice lookup ────────────────────────────

  async function fetchHeyGenAvatars() {
    setFetchingAvatars(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-heygen-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({ action: "list_avatars" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const avatars = (data.avatars ?? []) as any[];
      setAvatarOptions(avatars.map((a) => ({ id: a.avatar_id ?? a.id, name: a.avatar_name ?? a.avatar_id ?? a.id })));
      toast.success(`Found ${avatars.length} avatar${avatars.length === 1 ? "" : "s"}`);
    } catch (err: any) {
      toast.error(`Failed to fetch avatars: ${err.message}`);
    } finally {
      setFetchingAvatars(false);
    }
  }

  async function fetchHeyGenVoices() {
    setFetchingVoices(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-heygen-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({ action: "list_voices" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const voices = (data.voices ?? []) as any[];
      setHeygenVoiceOptions(voices.map((v) => ({ id: v.voice_id ?? v.id, name: v.name ?? v.voice_id ?? v.id })));
      toast.success(`Found ${voices.length} voice${voices.length === 1 ? "" : "s"}`);
    } catch (err: any) {
      toast.error(`Failed to fetch voices: ${err.message}`);
    } finally {
      setFetchingVoices(false);
    }
  }

  // ── Polling ───────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // Save completed videos to vault_media — the same table the Gallery reads
  // from — so a generated video survives navigating away instead of only
  // existing as an in-page download link. Best-effort: the result is still
  // shown and downloadable even if this insert fails.
  const persistAvatarVideo = useCallback(async (url: string, provider: string) => {
    if (!user) return;
    const label = generatingScriptRef.current.slice(0, 80) || "avatar-video";
    try {
      await (supabase as any).from("vault_media").insert({
        user_id: user.id,
        file_name: label,
        file_type: "video/mp4",
        file_url: url,
        description: generatingScriptRef.current,
        tags: ["generated", "avatar-studio", provider],
      });
    } catch {
      // non-fatal — see comment above
    }
  }, [user]);

  const doPoll = useCallback(async (rid: string, provider: PollProvider = "hallo2") => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-avatar-video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({ action: "poll", request_id: rid, provider, userId: user?.id }),
      });
      const data = await res.json();

      if (data.status === "complete" && data.url) {
        stopPolling();
        setResultUrl(data.url);
        setStatus("complete");
        setStatusMsg("");
        toast.success("Avatar video ready!");
        persistAvatarVideo(data.url, provider);
      } else if (data.error) {
        stopPolling();
        setStatus("error");
        setStatusMsg(data.error);
        toast.error(data.error);
      }
      // otherwise still processing — keep polling
    } catch {
      // network hiccup — keep polling silently
    }
  }, [SUPABASE_URL, SUPABASE_KEY, stopPolling, user, persistAvatarVideo]);

  // ── Generate ──────────────────────────────────────────────

  async function generateHeyGen() {
    if (!avatarId.trim()) { toast.error("Enter or fetch a HeyGen avatar ID first"); return; }
    if (!heygenVoiceId.trim()) { toast.error("Enter or fetch a HeyGen voice ID first"); return; }
    if (!script.trim()) { toast.error("Enter a script for the avatar to say"); return; }
    if (!user) { toast.error("Not signed in"); return; }

    stopPolling();
    setStatus("processing");
    setStatusMsg("Generating with HeyGen…");
    setResultUrl("");
    setRequestId("");
    generatingScriptRef.current = script.trim();

    if (saveAsDefault) {
      updateProfile({ default_heygen_avatar_id: avatarId.trim(), default_heygen_voice_id: heygenVoiceId.trim() });
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-avatar-video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          provider: "heygen",
          userId: user.id,
          avatar_id: avatarId.trim(),
          heygen_voice_id: heygenVoiceId.trim(),
          text: script.trim(),
          width: ASPECTS.find(a => a.key === aspect)?.w,
          height: ASPECTS.find(a => a.key === aspect)?.h,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.status === "complete" && data.url) {
        setResultUrl(data.url);
        setStatus("complete");
        setStatusMsg("");
        toast.success("Avatar video ready!");
        persistAvatarVideo(data.url, "heygen");
        return;
      }

      setRequestId(data.request_id);
      setStatusMsg("Generating with HeyGen… (30–120 seconds)");
      pollRef.current = setInterval(() => doPoll(data.request_id, "heygen"), 5000);
    } catch (err: any) {
      setStatus("error");
      setStatusMsg(err.message);
      toast.error(err.message);
    }
  }

  async function generatePhoto() {
    if (!imageUrl) { toast.error("Upload or enter a face image URL first"); return; }
    if (!script.trim()) { toast.error("Enter a script for the avatar to say"); return; }

    stopPolling();
    setStatus("tts");
    setStatusMsg("Generating voice…");
    setResultUrl("");
    setRequestId("");
    generatingScriptRef.current = script.trim();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-avatar-video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          source_image_url: imageUrl,
          text: script.trim(),
          voice_id: voiceId,
          still_mode: stillMode,
          use_enhancer: useEnhancer,
          aspect_ratio: aspect,
          width: ASPECTS.find(a => a.key === aspect)?.w,
          height: ASPECTS.find(a => a.key === aspect)?.h,

        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setRequestId(data.request_id);
      setStatus("processing");
      setStatusMsg("Animating face… (30–90 seconds)");

      // Poll every 5 seconds — round-trip the provider submit actually used
      // (hallo2 tried first, sadtalker on fallback) instead of assuming one.
      const provider: PollProvider = data.provider === "sadtalker" ? "sadtalker" : "hallo2";
      pollRef.current = setInterval(() => doPoll(data.request_id, provider), 5000);
    } catch (err: any) {
      setStatus("error");
      setStatusMsg(err.message);
      toast.error(err.message);
    }
  }

  function generate() {
    if (engineMode === "heygen") return generateHeyGen();
    return generatePhoto();
  }

  function reset() {
    stopPolling();
    setStatus("idle");
    setStatusMsg("");
    setResultUrl("");
    setRequestId("");
    setScript("");
  }

  const isBusy = status === "tts" || status === "processing";
  const imageSource = imagePreview || (imageMode === "url" ? imageUrl : "");

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Avatar Studio"
        subtitle="AI talking-head videos. Your face or your trained HeyGen avatar, your voice, your script."
        icon={<User size={18} />}
      />

      {/* Engine toggle */}
      <div className="flex gap-2 mb-4">
        {([
          { key: "photo" as const, label: "My Photo (SadTalker)" },
          { key: "heygen" as const, label: "My HeyGen Avatar" },
        ]).map((m) => (
          <button
            key={m.key}
            onClick={() => setEngineMode(m.key)}
            className={`flex-1 py-2 rounded text-xs font-mono border transition-colors ${
              engineMode === m.key
                ? "bg-primary/20 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:border-zinc-600"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Column 1: Face Image or HeyGen Avatar ── */}
        {engineMode === "heygen" ? (
          <HudCard>
            <h3 className="font-mono text-xs font-bold text-primary mb-3 flex items-center gap-2">
              <User size={12} /> HeyGen Avatar
            </h3>

            {savedAvatars.length > 0 && (
              <div className="mb-3">
                <label className="text-xs font-mono text-muted-foreground block mb-1">My Avatars</label>
                <div className="flex flex-wrap gap-1.5">
                  {savedAvatars.map((a) => (
                    <div
                      key={a.label}
                      className={`flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                        avatarLabel === a.label && avatarId === a.avatar_id
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                      }`}
                    >
                      <button onClick={() => loadSavedAvatar(a.label)}>{a.label}</button>
                      <button onClick={() => removeSavedAvatar(a.label)} className="hover:text-red-400"><X size={9} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <label className="text-xs font-mono text-muted-foreground block mb-1">Avatar ID</label>
            <input
              type="text"
              value={avatarId}
              onChange={(e) => setAvatarId(e.target.value)}
              placeholder="e.g. your trained avatar's ID"
              className="w-full bg-zinc-900 border border-border rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary/50 mb-2"
            />
            {avatarOptions.length > 0 && (
              <select
                value={avatarId}
                onChange={(e) => setAvatarId(e.target.value)}
                className="w-full bg-zinc-900 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/50 mb-2"
              >
                <option value="">— pick from your account —</option>
                {avatarOptions.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
            <button
              onClick={fetchHeyGenAvatars}
              disabled={fetchingAvatars}
              className="w-full text-[10px] font-mono px-2 py-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {fetchingAvatars ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              Fetch my avatars
            </button>

            <label className="text-xs font-mono text-muted-foreground block mb-1 mt-3">Save this avatar as…</label>
            <div className="flex gap-1.5 mb-2">
              <input
                type="text"
                value={avatarLabel}
                onChange={(e) => setAvatarLabel(e.target.value)}
                placeholder="e.g. bioneerx"
                className="flex-1 bg-zinc-900 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/50"
              />
              <button
                onClick={saveCurrentAvatarToRoster}
                className="text-[10px] font-mono px-3 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
              >
                Save
              </button>
            </div>

            <label className="flex items-center gap-2 cursor-pointer group mt-1">
              <input
                type="checkbox"
                checked={saveAsDefault}
                onChange={(e) => setSaveAsDefault(e.target.checked)}
                className="accent-primary"
              />
              <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                Also use as my hands-free default (MAVIS uses this when no avatar is named)
              </span>
            </label>

            <p className="text-xs text-muted-foreground mt-3 font-mono leading-relaxed">
              Uses HeyGen's API directly — no photo needed, no lip-sync generation step. Save any number of avatars here — MAVIS can post as any of them by name ("post as bioneerx…").
            </p>
          </HudCard>
        ) : (
        <HudCard>
          <h3 className="font-mono text-xs font-bold text-primary mb-3 flex items-center gap-2">
            <User size={12} /> Face Image
          </h3>

          {/* Mode toggle */}
          <div className="flex gap-2 mb-3">
            {(["upload", "url"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setImageMode(m); setImagePreview(""); setImageUrl(""); }}
                className={`flex-1 py-1 rounded text-xs font-mono border transition-colors ${
                  imageMode === m
                    ? "bg-primary/20 border-primary/40 text-primary"
                    : "border-border text-muted-foreground hover:border-zinc-600"
                }`}
              >
                {m === "upload" ? (
                  <span className="flex items-center justify-center gap-1"><Upload size={9} />Upload</span>
                ) : (
                  <span className="flex items-center justify-center gap-1"><Link2 size={9} />URL</span>
                )}
              </button>
            ))}
          </div>

          {imageMode === "upload" ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={imageUploading}
                className="w-full h-20 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors text-xs font-mono disabled:opacity-60"
              >
                {imageUploading ? (
                  <><Loader2 size={16} className="animate-spin" />Uploading…</>
                ) : (
                  <><Upload size={16} />Click to upload face photo</>
                )}
              </button>
            </>
          ) : (
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => { setImageUrl(e.target.value); setImagePreview(e.target.value); }}
              placeholder="https://… (direct image URL)"
              className="w-full bg-zinc-900 border border-border rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary/50"
            />
          )}

          {/* Preview */}
          <AnimatePresence>
            {imageSource && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-3 rounded-lg overflow-hidden border border-border relative"
                style={{ aspectRatio: "1" }}
              >
                <img
                  src={imageSource}
                  alt="Face"
                  className="w-full h-full object-cover"
                  onError={() => { setImagePreview(""); }}
                />
                <button
                  onClick={() => { setImagePreview(""); setImageUrl(""); }}
                  className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                >
                  <X size={11} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <p className="text-xs text-muted-foreground mt-3 font-mono leading-relaxed">
            Best results: clear frontal face, good lighting, neutral expression, minimal background clutter.
          </p>
        </HudCard>
        )}

        {/* ── Column 2: Script & Settings ── */}
        <HudCard>
          <h3 className="font-mono text-xs font-bold text-primary mb-3 flex items-center gap-2">
            <Mic size={12} /> Script & Voice
          </h3>

          {/* Script templates — HeyGen-style quick starters */}
          <div className="mb-2">
            <label className="text-xs font-mono text-muted-foreground block mb-1">Templates</label>
            <div className="flex flex-wrap gap-1.5">
              {SCRIPT_TEMPLATES.map(t => (
                <button
                  key={t.label}
                  onClick={() => setScript(t.text)}
                  className="text-[10px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>



          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Type what the avatar should say…&#10;&#10;Example: Hi, I'm excited to share what we've been working on. Here's a quick overview of our latest features…"
            rows={8}
            className="w-full bg-zinc-900 border border-border rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary/50 resize-none leading-relaxed"
          />
          <div className="flex justify-between items-center mt-1 mb-3">
            <span className={`text-xs font-mono ${script.length > 2200 ? "text-yellow-400" : "text-muted-foreground"}`}>
              {script.length}/2500 chars
            </span>
            {script.length > 0 && (
              <button onClick={() => setScript("")} className="text-xs text-muted-foreground hover:text-foreground font-mono">
                Clear
              </button>
            )}
          </div>

          {/* Aspect ratio — HeyGen-style output framing */}
          <div className="mb-3">
            <label className="text-xs font-mono text-muted-foreground block mb-1">Aspect Ratio</label>
            <div className="flex gap-1.5">
              {ASPECTS.map(a => (
                <button
                  key={a.key}
                  onClick={() => setAspect(a.key)}
                  title={a.hint}
                  className={`flex-1 text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                    aspect === a.key
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                  }`}
                >
                  {a.label} <span className="opacity-60">{a.key}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Voice */}
          <div className="mb-3">
            <label className="text-xs font-mono text-muted-foreground block mb-1">Voice</label>

            {engineMode === "heygen" ? (
              <>
                <input
                  type="text"
                  value={heygenVoiceId}
                  onChange={(e) => setHeygenVoiceId(e.target.value)}
                  placeholder="HeyGen voice ID"
                  className="w-full bg-zinc-900 border border-border rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary/50 mb-2"
                />
                {heygenVoiceOptions.length > 0 && (
                  <select
                    value={heygenVoiceId}
                    onChange={(e) => setHeygenVoiceId(e.target.value)}
                    className="w-full bg-zinc-900 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/50 mb-2"
                  >
                    <option value="">— pick a voice —</option>
                    {heygenVoiceOptions.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                )}
                <button
                  onClick={fetchHeyGenVoices}
                  disabled={fetchingVoices}
                  className="w-full text-[10px] font-mono px-2 py-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {fetchingVoices ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  Fetch voices
                </button>
              </>
            ) : (
              <select
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                className="w-full bg-zinc-900 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/50"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>{v.name} ({v.gender})</option>
                ))}
              </select>
            )}
          </div>

          {/* Options — SadTalker-only, no HeyGen equivalent */}
          {engineMode === "photo" && (
            <div className="space-y-2 mb-4">
              <label className="text-xs font-mono text-muted-foreground block">Options</label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={useEnhancer}
                  onChange={(e) => setUseEnhancer(e.target.checked)}
                  className="accent-primary"
                />
                <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                  Face enhancer — sharper output (slower)
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={stillMode}
                  onChange={(e) => setStillMode(e.target.checked)}
                  className="accent-primary"
                />
                <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                  Still mode — minimal head movement
                </span>
              </label>
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={generate}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded text-sm font-mono bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBusy ? (
              <><Loader2 size={14} className="animate-spin" />{statusMsg || "Generating…"}</>
            ) : (
              <><Sparkles size={14} />Generate Avatar Video</>
            )}
          </button>

          {isBusy && (
            <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary/50 rounded-full"
                animate={{ x: ["-100%", "200%"] }}
                transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              />
            </div>
          )}
        </HudCard>

        {/* ── Column 3: Result ── */}
        <HudCard>
          <h3 className="font-mono text-xs font-bold text-primary mb-3 flex items-center gap-2">
            <Video size={12} /> Result
          </h3>

          {status === "complete" && resultUrl ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              <div className="rounded-lg overflow-hidden border border-green-700/40 bg-black aspect-video">
                <video
                  src={resultUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="w-full h-full"
                />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-green-400 font-mono">
                <CheckCircle2 size={12} />
                Video generated successfully
              </div>
              <div className="flex gap-2">
                <a
                  href={resultUrl}
                  download="avatar-video.mp4"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-mono bg-green-900/20 border border-green-700 text-green-400 hover:bg-green-900/40 transition-colors"
                >
                  <Download size={11} />Download
                </a>
                <button
                  onClick={reset}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-mono bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors"
                >
                  <RefreshCw size={11} />New Video
                </button>
              </div>
            </motion.div>
          ) : status === "error" ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <AlertCircle size={28} className="text-red-400" />
              <p className="text-xs text-red-400 font-mono text-center leading-relaxed">{statusMsg}</p>
              <button
                onClick={() => { setStatus("idle"); setStatusMsg(""); }}
                className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Try again
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Video size={36} className="text-muted-foreground" />
              <p className="text-xs font-mono text-muted-foreground text-center">
                Your avatar video will appear here
              </p>
              {isBusy && (
                <div className="flex flex-col items-center gap-2 mt-2">
                  <Loader2 size={16} className="animate-spin text-primary" />
                  <span className="text-xs font-mono text-primary/80">{statusMsg}</span>
                  <p className="text-xs text-muted-foreground font-mono">
                    {engineMode === "heygen" ? "HeyGen typically takes 30–120 seconds" : "SadTalker typically takes 30–90 seconds"}
                  </p>
                </div>
              )}
            </div>
          )}
        </HudCard>
      </div>

      {/* How it works */}
      <div className="mt-4 px-4 py-3 rounded-lg border border-border bg-zinc-900/30">
        <p className="text-xs font-mono text-muted-foreground leading-relaxed">
          <span className="text-muted-foreground font-bold">How it works:</span>{" "}
          {engineMode === "heygen" ? (
            <>
              Enter (or fetch) your HeyGen avatar and voice ID → type your script → Generate.
              Renders through your HeyGen account directly — no photo or TTS step needed here.
              Save it as your default once and it's remembered next time.
            </>
          ) : (
            <>
              Upload a face photo → type your script → choose a voice → Generate.
              MAVIS converts the script to speech via ElevenLabs, then uses{" "}
              <span className="text-muted-foreground">SadTalker (fal.ai)</span> to animate the face with precise lip sync.
              For best quality, use a well-lit frontal headshot with a plain background.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
