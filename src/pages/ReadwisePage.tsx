// ============================================================
// VANTARA.EXE — ReadwisePage
// Book highlights & reading notes import and browser
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";
import { BookMarked, Upload, Key, FileText, ChevronDown, ChevronRight } from "lucide-react";

interface Highlight {
  id: string;
  title: string;
  content: string;
  tags: string[];
  properties: { author?: string; source?: string; source_url?: string } | null;
  created_at: string;
}

export function ReadwisePage() {
  const { session } = useAuth();
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<"token" | "csv">("token");
  const [importForm, setImportForm] = useState({ readwise_token: "", csv_text: "", source_label: "readwise" });
  const [importing, setImporting] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  const loadHighlights = useCallback(async () => {
    if (!session?.user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("mavis_notes")
      .select("id, title, content, tags, properties, created_at")
      .eq("user_id", session.user.id)
      .contains("tags", ["highlight"])
      .order("created_at", { ascending: false })
      .limit(200);
    setHighlights((data as Highlight[]) ?? []);
    setLoading(false);
  }, [session?.user?.id]);

  useEffect(() => { loadHighlights(); }, [loadHighlights]);

  async function handleImport() {
    if (!session?.access_token) return;
    if (importMode === "token" && !importForm.readwise_token.trim()) {
      toast.error("Enter your Readwise API token");
      return;
    }
    if (importMode === "csv" && !importForm.csv_text.trim()) {
      toast.error("Paste CSV content first");
      return;
    }
    setImporting(true);
    const toastId = toast.loading("Importing highlights...");
    try {
      const body: Record<string, string> = { source_label: importForm.source_label };
      if (importMode === "token") body.readwise_token = importForm.readwise_token;
      else body.csv_text = importForm.csv_text;

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-readwise-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success(`Imported ${data.imported ?? 0} highlights`, { id: toastId });
      setShowImport(false);
      setImportForm({ readwise_token: "", csv_text: "", source_label: "readwise" });
      loadHighlights();
    } catch (err: any) {
      toast.error(err.message ?? "Import failed", { id: toastId });
    } finally {
      setImporting(false);
    }
  }

  // Group by source book
  const grouped = highlights.reduce<Record<string, Highlight[]>>((acc, h) => {
    const source = (h.properties as any)?.source ?? "Unknown";
    (acc[source] = acc[source] ?? []).push(h);
    return acc;
  }, {});

  const uniqueSources = Object.keys(grouped).length;
  const thisWeek = highlights.filter((h) => {
    const d = new Date(h.created_at);
    return Date.now() - d.getTime() < 7 * 86400000;
  }).length;

  const toggleSource = (src: string) =>
    setExpandedSources((prev) => {
      const next = new Set(prev);
      next.has(src) ? next.delete(src) : next.add(src);
      return next;
    });

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <PageHeader
        title="Highlights"
        subtitle="Book highlights & reading notes"
        icon={BookMarked}
        actions={
          <button
            onClick={() => setShowImport(!showImport)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/30 text-xs font-mono text-primary hover:bg-primary/10 transition-colors"
          >
            <Upload size={12} /> Import
          </button>
        }
      />

      {/* Import Panel */}
      <AnimatePresence>
        {showImport && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <HudCard className="space-y-3 p-4">
              <p className="text-xs font-mono text-primary">Import Highlights</p>
              {/* Mode tabs */}
              <div className="flex gap-1">
                {(["token", "csv"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setImportMode(m)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-[10px] font-mono border transition-colors ${
                      importMode === m ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-primary"
                    }`}
                  >
                    {m === "token" ? <Key size={10} /> : <FileText size={10} />}
                    {m === "token" ? "Readwise Token" : "CSV Upload"}
                  </button>
                ))}
              </div>

              {importMode === "token" ? (
                <div className="space-y-2">
                  <input
                    className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary/40"
                    placeholder="Readwise API token"
                    type="password"
                    value={importForm.readwise_token}
                    onChange={(e) => setImportForm((f) => ({ ...f, readwise_token: e.target.value }))}
                  />
                  <p className="text-[9px] font-mono text-muted-foreground">
                    Get your token at readwise.io/access_token
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    rows={6}
                    className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary/40 resize-none"
                    placeholder={"highlight,title,author,source_url\n\"Great quote here\",\"Book Title\",\"Author Name\",\"\""}
                    value={importForm.csv_text}
                    onChange={(e) => setImportForm((f) => ({ ...f, csv_text: e.target.value }))}
                  />
                  <p className="text-[9px] font-mono text-muted-foreground">
                    Columns: highlight, title, author, source_url
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="px-4 py-1.5 rounded border border-primary/30 text-xs font-mono text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  {importing ? "Importing..." : "Import"}
                </button>
                <button
                  onClick={() => setShowImport(false)}
                  className="px-3 py-1.5 rounded border border-border text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <HudCard className="text-center py-3">
          <p className="text-2xl font-display text-primary">{highlights.length}</p>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">TOTAL HIGHLIGHTS</p>
        </HudCard>
        <HudCard className="text-center py-3">
          <p className="text-2xl font-display text-primary">{uniqueSources}</p>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">SOURCES</p>
        </HudCard>
        <HudCard className="text-center py-3">
          <p className="text-2xl font-display text-primary">{thisWeek}</p>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">THIS WEEK</p>
        </HudCard>
      </div>

      {loading ? (
        <HudCard className="text-center py-10">
          <p className="text-xs font-mono text-muted-foreground">Loading highlights...</p>
        </HudCard>
      ) : highlights.length === 0 ? (
        <HudCard className="text-center py-10 space-y-2">
          <BookMarked size={32} className="text-muted-foreground mx-auto" />
          <p className="text-xs font-mono text-muted-foreground">No highlights yet. Import from Readwise or paste a CSV.</p>
        </HudCard>
      ) : (
        <div className="space-y-2">
          {Object.entries(grouped).map(([source, items]) => {
            const isOpen = expandedSources.has(source);
            const author = (items[0]?.properties as any)?.author;
            return (
              <HudCard key={source} className="overflow-hidden p-0">
                <button
                  onClick={() => toggleSource(source)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <BookMarked size={13} className="text-primary shrink-0" />
                    <span className="text-xs font-display text-foreground truncate">{source}</span>
                    {author && <span className="text-[10px] font-mono text-muted-foreground shrink-0">— {author}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                      {items.length}
                    </span>
                    {isOpen ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
                  </div>
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: "auto" }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-border/50 divide-y divide-border/30">
                        {items.map((h) => (
                          <div key={h.id} className="px-4 py-3 space-y-1">
                            <p className="text-xs font-mono text-foreground/90 leading-relaxed italic">
                              "{h.content}"
                            </p>
                            <p className="text-[9px] font-mono text-muted-foreground/50">
                              MAVIS can surface this in semantic searches
                            </p>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </HudCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
