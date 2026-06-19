// ============================================================
// VANTARA.EXE — ImportPage
// Import notes from Notion, Obsidian, or plain Markdown
// ============================================================
import { useState } from "react";
import { motion } from "framer-motion";
import { FileText, Upload, CheckCircle2, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────
type ImportSource = "notion" | "obsidian" | "markdown";
type ImportStep = "select" | "preview" | "done";

interface ParsedNote {
  title: string;
  content: string;
  tags: string[];
}

interface ImportResult {
  imported: number;
  skipped: number;
}

// ─── Helpers ────────────────────────────────────────────────
const SOURCE_META: Record<
  ImportSource,
  { label: string; icon: string; description: string; instructions: string }
> = {
  notion: {
    label: "Notion",
    icon: "📝",
    description: "JSON or Markdown export",
    instructions:
      "Export page as Markdown & CSV, paste the markdown content",
  },
  obsidian: {
    label: "Obsidian",
    icon: "🔮",
    description: "Paste markdown vault files",
    instructions:
      "Paste multiple .md files separated by `---` (three dashes on own line)",
  },
  markdown: {
    label: "Markdown",
    icon: "📄",
    description: "Any plain markdown text",
    instructions: "Paste any markdown text",
  },
};

function parseNotes(rawInput: string, source: ImportSource): ParsedNote[] {
  if (!rawInput.trim()) return [];

  if (source === "markdown") {
    // Single note — extract first # heading as title
    const lines = rawInput.split("\n");
    const titleLine = lines.find((l) => l.startsWith("# "));
    const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : "Untitled";
    const content = rawInput.trim();
    const tags = extractTags(content);
    return [{ title, content, tags }];
  }

  // notion & obsidian: split on "---" lines
  const sections = rawInput.split(/\n---\n/);
  const notes: ParsedNote[] = [];

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    const lines = trimmed.split("\n");
    const titleLine = lines.find((l) => l.startsWith("# "));
    const title = titleLine
      ? titleLine.replace(/^#\s+/, "").trim()
      : lines[0]?.slice(0, 60) || "Untitled";
    const content = trimmed;
    const tags = extractTags(content);

    notes.push({ title, content, tags });
  }

  return notes;
}

function extractTags(content: string): string[] {
  // Extract hashtag-style tags like #tag or frontmatter tags
  const hashTags = (content.match(/#([a-zA-Z][a-zA-Z0-9_-]*)/g) ?? []).map(
    (t) => t.slice(1).toLowerCase()
  );
  return [...new Set(hashTags)].slice(0, 10);
}

// ─── ImportPage ─────────────────────────────────────────────
export function ImportPage() {
  const { user } = useAuth();
  const [source, setSource] = useState<ImportSource>("notion");
  const [rawInput, setRawInput] = useState("");
  const [parsed, setParsed] = useState<ParsedNote[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [step, setStep] = useState<ImportStep>("select");

  // ─── Select source ──────────────────────────────────────
  function handleSelectSource(s: ImportSource) {
    setSource(s);
    setRawInput("");
    setParsed([]);
    setResult(null);
    setStep("preview");
  }

  // ─── Parse ──────────────────────────────────────────────
  function handleParse() {
    if (!rawInput.trim()) {
      toast.error("Paste some content first");
      return;
    }
    const notes = parseNotes(rawInput, source);
    if (notes.length === 0) {
      toast.error("No notes found in the pasted content");
      return;
    }
    setParsed(notes);
    toast.success(`Parsed ${notes.length} note${notes.length !== 1 ? "s" : ""}`);
  }

  // ─── Import ─────────────────────────────────────────────
  async function handleImport() {
    if (!user || parsed.length === 0) return;
    setImporting(true);

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-import`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            user_id: user.id,
            source,
            notes: parsed,
            generate_embeddings: true,
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "Import failed");
      }

      const data = await res.json();
      setResult({
        imported: data.imported ?? parsed.length,
        skipped: data.skipped ?? 0,
      });
      setStep("done");
      toast.success(`Imported ${data.imported ?? parsed.length} notes to Vault`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Import failed";
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  }

  // ─── Reset ──────────────────────────────────────────────
  function handleReset() {
    setSource("notion");
    setRawInput("");
    setParsed([]);
    setResult(null);
    setStep("select");
  }

  const meta = SOURCE_META[source];
  const previewNotes = parsed.slice(0, 10);
  const extraCount = parsed.length - previewNotes.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import to Vault"
        subtitle="Bring notes from Notion, Obsidian, or Markdown"
        icon={<Upload size={18} />}
      />

      {/* ── Step 1: Select Source ─────────────────────────── */}
      {step === "select" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-4"
        >
          <p className="text-xs font-mono text-muted-foreground">
            Choose your import source to get started.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(Object.keys(SOURCE_META) as ImportSource[]).map((s) => {
              const m = SOURCE_META[s];
              return (
                <HudCard
                  key={s}
                  glowColor="gold"
                  onClick={() => handleSelectSource(s)}
                  className="cursor-pointer group"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{m.icon}</span>
                    <div className="flex-1">
                      <p className="text-sm font-display font-bold text-foreground group-hover:text-primary transition-colors">
                        {m.label}
                      </p>
                      <p className="text-xs font-mono text-muted-foreground mt-0.5">
                        {m.description}
                      </p>
                    </div>
                    <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-0.5" />
                  </div>
                </HudCard>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── Step 2: Preview / Paste ──────────────────────── */}
      {step === "preview" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-4"
        >
          {/* Source badge + back */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStep("select")}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back
            </button>
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary text-xs font-mono uppercase tracking-widest">
              {meta.icon} {meta.label}
            </span>
          </div>

          <HudCard>
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
              Instructions
            </p>
            <p className="text-xs font-mono text-foreground mb-4">
              {meta.instructions}
            </p>

            <label className="text-xs font-mono text-muted-foreground block mb-1">
              Paste content here *
            </label>
            <textarea
              value={rawInput}
              onChange={(e) => {
                setRawInput(e.target.value);
                setParsed([]); // reset parse on edit
              }}
              placeholder={`Paste your ${meta.label} content here...`}
              rows={12}
              className="w-full bg-muted/20 border border-border rounded px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:border-primary/40 placeholder:text-muted-foreground"
            />

            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleParse}
                disabled={!rawInput.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-muted/30 border border-border text-foreground rounded hover:bg-muted/50 disabled:opacity-50 transition-colors"
              >
                <FileText size={11} />
                Parse
              </button>

              {parsed.length > 0 && (
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
                >
                  {importing ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Upload size={11} />
                  )}
                  Import to Vault ({parsed.length})
                </button>
              )}
            </div>
          </HudCard>

          {/* Parsed preview */}
          {parsed.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <p className="text-xs font-mono text-primary uppercase tracking-widest mb-2">
                Preview — {parsed.length} note{parsed.length !== 1 ? "s" : ""} found
              </p>
              <div className="flex flex-wrap gap-2">
                {previewNotes.map((note, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 px-2 py-1 rounded border border-border/60 bg-muted/20 text-xs font-mono"
                  >
                    <span className="text-foreground truncate max-w-[160px]">
                      {note.title}
                    </span>
                    <span className="text-muted-foreground shrink-0">
                      {note.content.length}c
                    </span>
                  </div>
                ))}
                {extraCount > 0 && (
                  <div className="flex items-center px-2 py-1 rounded border border-border/40 bg-muted/10 text-xs font-mono text-muted-foreground">
                    +{extraCount} more
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* ── Step 3: Done ─────────────────────────────────── */}
      {step === "done" && result && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <HudCard glowColor="green" className="text-center py-10">
            <CheckCircle2 size={40} className="text-green-400 mx-auto mb-4" />
            <p className="text-lg font-display font-bold text-foreground mb-1">
              Import Complete
            </p>
            <div className="flex items-center justify-center gap-6 mt-4">
              <div>
                <p className="text-2xl font-display font-bold text-green-400">
                  {result.imported}
                </p>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                  Imported
                </p>
              </div>
              {result.skipped > 0 && (
                <div>
                  <p className="text-2xl font-display font-bold text-amber-400">
                    {result.skipped}
                  </p>
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                    Skipped
                  </p>
                </div>
              )}
            </div>
            <p className="text-xs font-mono text-muted-foreground mt-4">
              Notes are now searchable in your Vault.
            </p>
            <button
              onClick={handleReset}
              className="mt-6 flex items-center gap-1.5 px-4 py-2 text-xs font-mono bg-muted/30 border border-border text-foreground rounded hover:bg-muted/50 transition-colors mx-auto"
            >
              <RotateCcw size={11} />
              Import More
            </button>
          </HudCard>
        </motion.div>
      )}
    </div>
  );
}
