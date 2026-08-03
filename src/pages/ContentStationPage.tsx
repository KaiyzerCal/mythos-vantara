// ============================================================
// VANTARA.EXE — ContentStationPage
// Repurpose content into platform variants, queue/schedule posts,
// and review what's already published — one home for content ops.
// Merges the former RepurposePage + SchedulerPage.
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { motion, AnimatePresence } from "framer-motion";
import {
  Repeat2, Loader2, Copy, Check, ChevronDown, Database, Twitter, Send,
  Calendar, Plus, Trash2, CheckCircle2, Clock, X, MessageSquare,
} from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ─── Repurpose types ────────────────────────────────────────
const REPURPOSE_PLATFORMS = [
  { key: "twitter_thread", label: "Twitter Thread" },
  { key: "linkedin_post", label: "LinkedIn Post" },
  { key: "instagram_caption", label: "Instagram Caption" },
  { key: "youtube_description", label: "YouTube Description" },
  { key: "short_video_script", label: "Short Video Script (60s)" },
] as const;

type RepurposePlatformKey = (typeof REPURPOSE_PLATFORMS)[number]["key"];

const BRAND_VOICES = ["Default", "Technical", "Conversational", "Bold", "Minimal"] as const;

interface VaultEntry {
  id: string;
  title: string;
  content?: string;
  body?: string;
}

// ─── Scheduler types ────────────────────────────────────────
type PostStatus = "queued" | "scheduled" | "posted" | "failed" | "requires_confirmation";
type SchedulerPlatform = "twitter" | "linkedin" | "instagram" | "youtube" | "other";
type StationTab = "repurpose" | "queue" | "calendar" | "posted";

interface SocialPost {
  id: string;
  user_id: string;
  content: string;
  platform: string;
  status: PostStatus;
  scheduled_at: string | null;
  created_at: string;
}

interface CreateForm {
  content: string;
  platform: SchedulerPlatform;
  scheduled_at: string;
}

const PLATFORM_COLORS: Record<string, string> = {
  twitter: "bg-sky-900/50 text-sky-300 border-sky-700",
  linkedin: "bg-blue-900/50 text-blue-300 border-blue-700",
  instagram: "bg-pink-900/50 text-pink-300 border-pink-700",
  youtube: "bg-red-900/50 text-red-300 border-red-700",
  other: "bg-zinc-800/50 text-zinc-300 border-zinc-600",
};

const SCHEDULER_PLATFORMS: SchedulerPlatform[] = ["twitter", "linkedin", "instagram", "youtube", "other"];

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── ContentStationPage ─────────────────────────────────────
export function ContentStationPage() {
  const { user, session } = useAuth();
  const [activeTab, setActiveTab] = useState<StationTab>("repurpose");

  // ── Repurpose state ──────────────────────────────────────
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [brandVoice, setBrandVoice] = useState<string>("Default");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<RepurposePlatformKey>>(new Set(["twitter_thread"]));
  const [results, setResults] = useState<Record<string, string>>({});
  const [editedResults, setEditedResults] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [queuedKey, setQueuedKey] = useState<string | null>(null);
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([]);
  const [showVaultDropdown, setShowVaultDropdown] = useState(false);
  const [vaultLoading, setVaultLoading] = useState(false);

  async function loadVaultEntries() {
    setVaultLoading(true);
    const { data } = await supabase
      .from("vault_entries")
      .select("id, title, content, body")
      .order("created_at", { ascending: false })
      .limit(20);
    setVaultEntries(data || []);
    setVaultLoading(false);
  }

  function handleSelectVaultEntry(entry: VaultEntry) {
    setContent(entry.content || entry.body || "");
    setTitle(entry.title || "");
    setShowVaultDropdown(false);
    toast.success(`Loaded: ${entry.title}`);
  }

  function togglePlatform(key: RepurposePlatformKey) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return next; // keep at least 1
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleRepurpose() {
    if (!content.trim()) { toast.error("Please enter content to repurpose"); return; }
    if (!session) return;
    setIsLoading(true);
    setResults({});
    setEditedResults({});
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-repurpose`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: content.trim(),
          title: title.trim() || undefined,
          platforms: Array.from(selectedPlatforms),
          brand_voice: brandVoice,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Repurpose failed");
      }
      const data = await res.json();
      const variants: Record<string, string> = data.variants || data.results || data || {};
      setResults(variants);
      setEditedResults({ ...variants });
      toast.success("Content repurposed successfully");
    } catch (e: any) {
      toast.error(e.message || "Failed to repurpose content");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopy(key: string) {
    const text = editedResults[key] || results[key] || "";
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedKey(null), 2000);
  }

  async function handleQueueForNora(key: string) {
    if (!session) return;
    const text = editedResults[key] || results[key] || "";
    setQueuedKey(key);
    const { error } = await supabase.from("mavis_social_posts").insert({
      user_id: session.user.id,
      content: text,
      platform: "twitter",
      status: "queued",
    });
    if (error) {
      toast.error("Failed to queue post");
    } else {
      toast.success("Queued");
      fetchPosts();
    }
    setQueuedKey(null);
  }

  function platformLabel(key: string) {
    return REPURPOSE_PLATFORMS.find((p) => p.key === key)?.label || key;
  }

  function charCount(key: string) {
    return (editedResults[key] || results[key] || "").length;
  }

  // ── Scheduler state ──────────────────────────────────────
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>({
    content: "",
    platform: "twitter",
    scheduled_at: "",
  });
  const [scheduleTarget, setScheduleTarget] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);

  const fetchPosts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("mavis_social_posts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load posts");
    } else {
      setPosts((data as SocialPost[]) || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  async function handleCreate() {
    if (!user) return;
    if (!createForm.content.trim()) { toast.error("Content is required"); return; }
    setSubmitting(true);
    const status: PostStatus = createForm.scheduled_at ? "scheduled" : "queued";
    const { error } = await supabase.from("mavis_social_posts").insert({
      user_id: user.id,
      content: createForm.content.trim(),
      platform: createForm.platform,
      status,
      scheduled_at: createForm.scheduled_at || null,
    });
    if (error) {
      toast.error("Failed to create post");
    } else {
      toast.success("Post created");
      setCreateForm({ content: "", platform: "twitter", scheduled_at: "" });
      setShowCreate(false);
      fetchPosts();
    }
    setSubmitting(false);
  }

  async function handleApprove(id: string) {
    setActionLoading(id);
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, status: "queued" } : p));
    const { error } = await supabase.from("mavis_social_posts").update({ status: "queued" }).eq("id", id);
    if (error) { toast.error("Failed to approve"); fetchPosts(); }
    else toast.success("Post approved — queued");
    setActionLoading(null);
  }

  async function handleSchedule(id: string) {
    if (!scheduleDate) { toast.error("Pick a date/time"); return; }
    setScheduleLoading(id);
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, status: "scheduled", scheduled_at: scheduleDate } : p));
    const { error } = await supabase
      .from("mavis_social_posts")
      .update({ status: "scheduled", scheduled_at: new Date(scheduleDate).toISOString() })
      .eq("id", id);
    if (error) { toast.error("Failed to schedule"); fetchPosts(); }
    else toast.success("Post scheduled");
    setScheduleLoading(null);
    setScheduleTarget(null);
    setScheduleDate("");
  }

  async function handleDelete(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id));
    const { error } = await supabase.from("mavis_social_posts").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); fetchPosts(); }
    else toast.success("Post removed");
  }

  const queuePosts = posts.filter((p) => ["queued", "scheduled", "requires_confirmation"].includes(p.status));
  const postedPosts = posts.filter((p) => p.status === "posted");
  const twitterCharWarn = createForm.platform === "twitter" && createForm.content.length > 280;

  const TABS: { key: StationTab; label: string }[] = [
    { key: "repurpose", label: "Repurpose" },
    { key: "queue", label: `Queue (${queuePosts.length})` },
    { key: "calendar", label: "Post Calendar" },
    { key: "posted", label: `Posted (${postedPosts.length})` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content Station"
        subtitle="Repurpose content into platform variants, queue, schedule, and review what's published"
        icon={<Send size={18} />}
        actions={
          activeTab !== "repurpose" ? (
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
            >
              <Plus size={12} /> New Post
            </button>
          ) : undefined
        }
      />

      {/* ── Tab Bar ───────────────────────────────────────────── */}
      <div className="flex gap-1 flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 text-xs font-mono rounded border transition-colors ${
              activeTab === tab.key
                ? "bg-primary/10 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Create Post Modal (queue/calendar/posted tabs) ─────── */}
      <AnimatePresence>
        {showCreate && activeTab !== "repurpose" && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <HudCard glowColor="gold">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-mono text-primary uppercase tracking-widest">Create Post</p>
                <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                  <X size={14} />
                </button>
              </div>

              <div className="mb-3">
                <label className="text-xs font-mono text-muted-foreground block mb-1.5">Platform</label>
                <div className="flex flex-wrap gap-1.5">
                  {SCHEDULER_PLATFORMS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setCreateForm((f) => ({ ...f, platform: p }))}
                      className={`px-2.5 py-1 text-xs font-mono rounded border capitalize transition-colors ${
                        createForm.platform === p
                          ? PLATFORM_COLORS[p]
                          : "bg-muted/20 border-border text-muted-foreground hover:border-primary/30"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-mono text-muted-foreground">Content *</label>
                  <span className={`text-xs font-mono ${twitterCharWarn ? "text-red-400" : "text-muted-foreground"}`}>
                    {createForm.content.length}{createForm.platform === "twitter" ? " / 280" : ""}
                  </span>
                </div>
                <textarea
                  value={createForm.content}
                  onChange={(e) => setCreateForm((f) => ({ ...f, content: e.target.value }))}
                  rows={4}
                  placeholder="What's on your mind..."
                  className={`w-full bg-muted/30 border rounded px-3 py-2 text-xs font-mono focus:outline-none resize-none transition-colors ${
                    twitterCharWarn ? "border-red-500/60 focus:border-red-400/60" : "border-border focus:border-primary/40"
                  }`}
                />
                {twitterCharWarn && (
                  <p className="text-xs font-mono text-red-400 mt-0.5">Exceeds Twitter's 280 character limit</p>
                )}
              </div>

              <div className="mb-3">
                <label className="text-xs font-mono text-muted-foreground block mb-1.5">Schedule (optional)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="datetime-local"
                    value={createForm.scheduled_at}
                    onChange={(e) => setCreateForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                    className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                  />
                  {createForm.scheduled_at ? (
                    <span className="text-xs font-mono text-blue-400">Will be scheduled</span>
                  ) : (
                    <span className="text-xs font-mono text-green-400">Will be queued immediately</span>
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleCreate}
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
                >
                  {submitting ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Create Post
                </button>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Repurpose Tab ─────────────────────────────────────── */}
      {activeTab === "repurpose" && (
        <div className="space-y-5">
          <HudCard className="border-primary/10">
            <p className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Source Content</p>
            <div className="space-y-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Content title (optional)..."
                className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40"
              />

              <div className="relative">
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Paste your content here, or load from vault..."
                  rows={6}
                  className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-primary/40"
                />
                <div className="flex justify-between items-center mt-1">
                  <span className="text-xs font-mono text-muted-foreground">{content.length} chars</span>
                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowVaultDropdown((v) => !v);
                        if (vaultEntries.length === 0) loadVaultEntries();
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono text-muted-foreground border border-border rounded hover:text-foreground hover:border-border/60 transition-colors"
                    >
                      <Database size={9} /> Load from Vault <ChevronDown size={9} />
                    </button>
                    {showVaultDropdown && (
                      <div className="absolute right-0 top-full mt-1 w-64 bg-card border border-border rounded shadow-xl z-20 max-h-48 overflow-y-auto">
                        {vaultLoading ? (
                          <div className="flex justify-center py-3"><Loader2 size={14} className="animate-spin text-primary" /></div>
                        ) : vaultEntries.length === 0 ? (
                          <p className="text-xs font-mono text-muted-foreground px-3 py-2">No vault entries found</p>
                        ) : (
                          vaultEntries.map((e) => (
                            <button
                              key={e.id}
                              onClick={() => handleSelectVaultEntry(e)}
                              className="w-full text-left px-3 py-2 text-xs font-mono hover:bg-muted/30 transition-colors border-b border-border/20 last:border-0"
                            >
                              {e.title}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground shrink-0">Brand Voice:</span>
                <div className="flex gap-1.5 flex-wrap">
                  {BRAND_VOICES.map((v) => (
                    <button
                      key={v}
                      onClick={() => setBrandVoice(v)}
                      className={`px-2 py-1 text-xs font-mono rounded border transition-colors ${
                        brandVoice === v
                          ? "bg-primary/10 border-primary/40 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-border/60"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-mono text-muted-foreground mb-2">Output Platforms:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {REPURPOSE_PLATFORMS.map(({ key, label }) => (
                    <label
                      key={key}
                      className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer transition-colors ${
                        selectedPlatforms.has(key)
                          ? "border-primary/40 bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:border-border/60 hover:text-foreground"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPlatforms.has(key)}
                        onChange={() => togglePlatform(key)}
                        className="sr-only"
                      />
                      <span className={`w-3 h-3 rounded-sm border flex items-center justify-center shrink-0 ${selectedPlatforms.has(key) ? "bg-primary border-primary" : "border-muted-foreground"}`}>
                        {selectedPlatforms.has(key) && <Check size={8} className="text-background" />}
                      </span>
                      <span className="text-xs font-mono">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={handleRepurpose}
                disabled={isLoading || !content.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    MAVIS is repurposing content...
                  </>
                ) : (
                  <>
                    <Repeat2 size={14} />
                    Repurpose
                  </>
                )}
              </button>
            </div>
          </HudCard>

          <AnimatePresence>
            {Object.keys(results).length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                <h2 className="text-xs font-mono text-primary uppercase tracking-widest">Repurposed Variants</h2>
                {Object.entries(editedResults).map(([key, val], i) => (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07 }}
                  >
                    <HudCard>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-display font-bold">{platformLabel(key)}</span>
                          <span className="text-xs font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">
                            {charCount(key)} chars
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {key === "twitter_thread" && (
                            <button
                              onClick={() => handleQueueForNora(key)}
                              disabled={queuedKey === key}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-amber-400 border border-amber-800/40 rounded hover:bg-amber-900/20 disabled:opacity-50 transition-colors"
                            >
                              {queuedKey === key ? <Loader2 size={9} className="animate-spin" /> : <Twitter size={9} />}
                              Queue for Nora
                            </button>
                          )}
                          <button
                            onClick={() => handleCopy(key)}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-muted-foreground border border-border rounded hover:text-foreground hover:border-border/60 transition-colors"
                          >
                            {copiedKey === key ? <Check size={9} className="text-green-400" /> : <Copy size={9} />}
                            {copiedKey === key ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={val}
                        onChange={(e) => setEditedResults((prev) => ({ ...prev, [key]: e.target.value }))}
                        rows={6}
                        className="w-full bg-muted/20 border border-border/30 rounded px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:border-primary/40"
                      />
                    </HudCard>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Queue Tab ─────────────────────────────────────────── */}
      {activeTab === "queue" && (
        <div className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" size={20} /></div>
          ) : queuePosts.length === 0 ? (
            <HudCard>
              <div className="text-center py-8">
                <MessageSquare size={28} className="text-muted-foreground mx-auto mb-2" />
                <p className="text-xs font-mono text-muted-foreground">No posts in queue. Create a new one, or repurpose some content.</p>
              </div>
            </HudCard>
          ) : (
            queuePosts.map((post, i) => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <HudCard>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-mono px-1.5 py-0.5 rounded border capitalize ${PLATFORM_COLORS[post.platform] ?? PLATFORM_COLORS.other}`}>
                        {post.platform}
                      </span>
                      {post.status === "requires_confirmation" && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded border bg-amber-900/40 text-amber-300 border-amber-700">
                          Needs Approval
                        </span>
                      )}
                      {post.status === "scheduled" && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded border bg-blue-900/40 text-blue-300 border-blue-700">
                          Scheduled{post.scheduled_at ? ` for ${fmtDateTime(post.scheduled_at)}` : ""}
                        </span>
                      )}
                      {post.status === "queued" && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded border bg-green-900/40 text-green-300 border-green-700">
                          Queued
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setConfirmDelete({ id: post.id, label: post.content.slice(0, 40) + (post.content.length > 40 ? "…" : "") })}
                      className="text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <p className="text-sm text-foreground/90 line-clamp-2 mb-2">{post.content}</p>

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-muted-foreground">
                      Created {fmtDate(post.created_at)}
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {post.status === "requires_confirmation" && (
                        <button
                          onClick={() => handleApprove(post.id)}
                          disabled={actionLoading === post.id}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-mono bg-green-900/30 border border-green-700/50 text-green-300 rounded hover:bg-green-900/50 disabled:opacity-50 transition-colors"
                        >
                          {actionLoading === post.id ? <Loader2 size={9} className="animate-spin" /> : <CheckCircle2 size={9} />}
                          Approve
                        </button>
                      )}
                      {scheduleTarget === post.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="datetime-local"
                            value={scheduleDate}
                            onChange={(e) => setScheduleDate(e.target.value)}
                            className="bg-muted/30 border border-border rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                          />
                          <button
                            onClick={() => handleSchedule(post.id)}
                            disabled={scheduleLoading === post.id}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-mono bg-blue-900/30 border border-blue-700/50 text-blue-300 rounded hover:bg-blue-900/50 disabled:opacity-50 transition-colors"
                          >
                            {scheduleLoading === post.id ? <Loader2 size={9} className="animate-spin" /> : <Clock size={9} />}
                            Set
                          </button>
                          <button
                            onClick={() => { setScheduleTarget(null); setScheduleDate(""); }}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setScheduleTarget(post.id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-mono bg-muted/30 border border-border text-muted-foreground rounded hover:border-primary/40 hover:text-primary transition-colors"
                        >
                          <Calendar size={9} /> Schedule
                        </button>
                      )}
                    </div>
                  </div>
                </HudCard>
              </motion.div>
            ))
          )}
        </div>
      )}

      {/* ── Post Calendar Tab (scheduled posts, not real events —
          see the separate Calendar tab for that) ─────────────── */}
      {activeTab === "calendar" && (() => {
        const scheduledPosts = posts.filter((p) => p.scheduled_at);
        // Build a 5-week grid starting from Monday of this week
        const now = new Date();
        const dayOfWeek = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        monday.setHours(0, 0, 0, 0);
        const days: Date[] = [];
        for (let i = 0; i < 35; i++) {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          days.push(d);
        }
        const postsByDay = scheduledPosts.reduce<Record<string, typeof posts>>((acc, p) => {
          const key = p.scheduled_at ? new Date(p.scheduled_at).toISOString().slice(0, 10) : "";
          if (key) (acc[key] = acc[key] ?? []).push(p);
          return acc;
        }, {});
        const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
        return (
          <div className="space-y-2">
            <div className="grid grid-cols-7 gap-1 text-center mb-1">
              {DAY_LABELS.map((d) => (
                <p key={d} className="text-xs font-mono text-muted-foreground">{d}</p>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((day) => {
                const key = day.toISOString().slice(0, 10);
                const dayPosts = postsByDay[key] ?? [];
                const isToday = key === now.toISOString().slice(0, 10);
                return (
                  <div
                    key={key}
                    className={`min-h-[72px] rounded border p-1.5 ${isToday ? "border-primary/40 bg-primary/5" : "border-border bg-muted/10"}`}
                  >
                    <p className={`text-xs font-mono mb-1 ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                      {day.getDate()}
                    </p>
                    {dayPosts.map((p) => (
                      <div
                        key={p.id}
                        className={`text-xs font-mono px-1 py-0.5 rounded mb-0.5 truncate ${PLATFORM_COLORS[p.platform] ?? PLATFORM_COLORS.other}`}
                        title={p.content}
                      >
                        {p.platform} — {p.content.slice(0, 15)}…
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Posted Tab ────────────────────────────────────────── */}
      {activeTab === "posted" && (
        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" size={20} /></div>
          ) : postedPosts.length === 0 ? (
            <HudCard>
              <p className="text-xs font-mono text-muted-foreground text-center py-6">No published posts yet.</p>
            </HudCard>
          ) : (
            postedPosts.map((post, i) => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <HudCard>
                  <div className="flex items-start gap-3">
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded border capitalize shrink-0 ${PLATFORM_COLORS[post.platform] ?? PLATFORM_COLORS.other}`}>
                      {post.platform}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground line-clamp-2">{post.content}</p>
                      <p className="text-xs font-mono text-muted-foreground mt-1">{fmtDateTime(post.created_at)}</p>
                    </div>
                    <CheckCircle2 size={14} className="text-green-400 shrink-0" />
                  </div>
                </HudCard>
              </motion.div>
            ))
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.label}"?`}
        description="This action cannot be undone."
        onConfirm={async () => {
          if (!confirmDelete) return;
          await handleDelete(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
