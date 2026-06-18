// ============================================================
// VANTARA.EXE — RepurposePage
// Content repurposing pipeline via MAVIS
// ============================================================
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Repeat2, Loader2, Copy, Check, ChevronDown, Database, Twitter, Send } from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ─── Types ──────────────────────────────────────────────────
const PLATFORMS = [
  { key: "twitter_thread", label: "Twitter Thread" },
  { key: "linkedin_post", label: "LinkedIn Post" },
  { key: "instagram_caption", label: "Instagram Caption" },
  { key: "youtube_description", label: "YouTube Description" },
  { key: "short_video_script", label: "Short Video Script (60s)" },
] as const;

type PlatformKey = (typeof PLATFORMS)[number]["key"];

const BRAND_VOICES = ["Default", "Technical", "Conversational", "Bold", "Minimal"] as const;

interface VaultEntry {
  id: string;
  title: string;
  content?: string;
  body?: string;
}

// ─── RepurposePage ──────────────────────────────────────────
export function RepurposePage() {
  const { session } = useAuth();

  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [brandVoice, setBrandVoice] = useState<string>("Default");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<PlatformKey>>(new Set(["twitter_thread"]));
  const [results, setResults] = useState<Record<string, string>>({});
  const [editedResults, setEditedResults] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [queuedKey, setQueuedKey] = useState<string | null>(null);

  // Vault dropdown
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([]);
  const [showVaultDropdown, setShowVaultDropdown] = useState(false);
  const [vaultLoading, setVaultLoading] = useState(false);

  // ─── Load vault entries ────────────────────────────────────
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

  // ─── Platform toggles ─────────────────────────────────────
  function togglePlatform(key: PlatformKey) {
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

  // ─── Repurpose call ───────────────────────────────────────
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

  // ─── Copy ─────────────────────────────────────────────────
  async function handleCopy(key: string) {
    const text = editedResults[key] || results[key] || "";
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedKey(null), 2000);
  }

  // ─── Queue for Nora ───────────────────────────────────────
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
      toast.success("Queued for Nora");
    }
    setQueuedKey(null);
  }

  // ─── Platform label ───────────────────────────────────────
  function platformLabel(key: string) {
    return PLATFORMS.find((p) => p.key === key)?.label || key;
  }

  function charCount(key: string) {
    return (editedResults[key] || results[key] || "").length;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Repurpose"
        subtitle="MAVIS content repurposing pipeline"
        icon={<Repeat2 size={18} />}
      />

      {/* ── Input Section ─────────────────────────────────── */}
      <HudCard className="border-primary/10">
        <p className="text-[9px] font-mono text-primary uppercase tracking-widest mb-3">Source Content</p>
        <div className="space-y-3">
          {/* Title */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Content title (optional)..."
            className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40"
          />

          {/* Content + vault loader */}
          <div className="relative">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste your content here, or load from vault..."
              rows={6}
              className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-primary/40"
            />
            <div className="flex justify-between items-center mt-1">
              <span className="text-[9px] font-mono text-muted-foreground">{content.length} chars</span>
              <div className="relative">
                <button
                  onClick={() => {
                    setShowVaultDropdown((v) => !v);
                    if (vaultEntries.length === 0) loadVaultEntries();
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono text-muted-foreground border border-border rounded hover:text-foreground hover:border-border/60 transition-colors"
                >
                  <Database size={9} /> Load from Vault <ChevronDown size={9} />
                </button>
                {showVaultDropdown && (
                  <div className="absolute right-0 top-full mt-1 w-64 bg-card border border-border rounded shadow-xl z-20 max-h-48 overflow-y-auto">
                    {vaultLoading ? (
                      <div className="flex justify-center py-3"><Loader2 size={14} className="animate-spin text-primary" /></div>
                    ) : vaultEntries.length === 0 ? (
                      <p className="text-[10px] font-mono text-muted-foreground px-3 py-2">No vault entries found</p>
                    ) : (
                      vaultEntries.map((e) => (
                        <button
                          key={e.id}
                          onClick={() => handleSelectVaultEntry(e)}
                          className="w-full text-left px-3 py-2 text-[10px] font-mono hover:bg-muted/30 transition-colors border-b border-border/20 last:border-0"
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

          {/* Brand voice */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-muted-foreground shrink-0">Brand Voice:</span>
            <div className="flex gap-1.5 flex-wrap">
              {BRAND_VOICES.map((v) => (
                <button
                  key={v}
                  onClick={() => setBrandVoice(v)}
                  className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
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

          {/* Platform checkboxes */}
          <div>
            <p className="text-[10px] font-mono text-muted-foreground mb-2">Output Platforms:</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PLATFORMS.map(({ key, label }) => (
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
                  <span className="text-[10px] font-mono">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Repurpose button */}
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

      {/* ── Results ───────────────────────────────────────── */}
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
                      <span className="text-[9px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">
                        {charCount(key)} chars
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {key === "twitter_thread" && (
                        <button
                          onClick={() => handleQueueForNora(key)}
                          disabled={queuedKey === key}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-amber-400 border border-amber-800/40 rounded hover:bg-amber-900/20 disabled:opacity-50 transition-colors"
                        >
                          {queuedKey === key ? <Loader2 size={9} className="animate-spin" /> : <Twitter size={9} />}
                          Queue for Nora
                        </button>
                      )}
                      <button
                        onClick={() => handleCopy(key)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-muted-foreground border border-border rounded hover:text-foreground hover:border-border/60 transition-colors"
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
  );
}
