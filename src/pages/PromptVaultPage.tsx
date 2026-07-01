import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight, ChevronDown, Search, RefreshCw, Loader2,
  FileText, FolderOpen, Folder, ExternalLink, Clock,
  AlertCircle, Copy, Check, MessageSquare,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
interface TreeItem {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  children?: TreeItem[];
}

interface SearchResult {
  name: string;
  path: string;
  score: number;
}

interface Commit {
  sha: string;
  message: string;
  date: string;
}

// ── API helper ─────────────────────────────────────────────────────────────
async function callVault(action: string, params: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-prompt-vault`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...params }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

// ── Provider icon map ──────────────────────────────────────────────────────
const PROVIDER_COLORS: Record<string, string> = {
  Anthropic:  "#d97706",
  OpenAI:     "#10b981",
  Google:     "#3b82f6",
  xAI:        "#8b5cf6",
  Microsoft:  "#0ea5e9",
  Meta:       "#f59e0b",
  Mistral:    "#ec4899",
  Cursor:     "#6366f1",
  Perplexity: "#14b8a6",
  Notion:     "#94a3b8",
  Qwen:       "#f97316",
  Misc:       "#64748b",
};

function providerColor(name: string) {
  return PROVIDER_COLORS[name] ?? "#64748b";
}

// ── Markdown renderer (lightweight) ───────────────────────────────────────
function MarkdownViewer({ content }: { content: string }) {
  // Very light transform: code blocks, headers, bold, italic, links, hr
  const lines = content.split("\n");
  let inCode = false;
  let codeBuffer: string[] = [];
  let codeLang = "";
  const result: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    if (line.startsWith("```")) {
      if (!inCode) {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeBuffer = [];
      } else {
        inCode = false;
        result.push(
          <pre key={i} className="my-3 p-3 rounded border border-border bg-muted/30 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words">
            <code>{codeBuffer.join("\n")}</code>
          </pre>
        );
        codeBuffer = [];
        codeLang = "";
      }
      return;
    }
    if (inCode) { codeBuffer.push(line); return; }

    if (/^#{1,3} /.test(line)) {
      const level = line.match(/^(#+)/)?.[1].length ?? 1;
      const text = line.replace(/^#+\s*/, "");
      const cls = level === 1
        ? "text-primary font-display font-bold tracking-widest text-sm mt-4 mb-1"
        : level === 2
          ? "text-foreground font-bold text-sm mt-3 mb-1"
          : "text-muted-foreground font-bold text-xs mt-2 mb-0.5";
      result.push(<p key={i} className={cls}>{text}</p>);
    } else if (/^---+$/.test(line.trim())) {
      result.push(<hr key={i} className="my-3 border-border" />);
    } else if (line.trim() === "") {
      result.push(<div key={i} className="h-1.5" />);
    } else if (/^[-*] /.test(line)) {
      result.push(
        <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground my-0.5">
          <span className="text-primary mt-1 shrink-0">·</span>
          <span>{line.replace(/^[-*] /, "")}</span>
        </div>
      );
    } else {
      result.push(
        <p key={i} className="text-sm text-muted-foreground leading-relaxed my-0.5 break-words">
          {line}
        </p>
      );
    }
  });

  return <div className="space-y-0">{result}</div>;
}

// ── Tree node ──────────────────────────────────────────────────────────────
function TreeNode({
  item,
  depth,
  selectedPath,
  onSelect,
}: {
  item: TreeItem;
  depth: number;
  selectedPath: string;
  onSelect: (item: TreeItem) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const [children, setChildren] = useState<TreeItem[]>(item.children ?? []);
  const [loading, setLoading] = useState(false);

  const isSelected = selectedPath === item.path;
  const isDir = item.type === "dir";

  const handleClick = async () => {
    if (!isDir) { onSelect(item); return; }
    if (open) { setOpen(false); return; }
    if (children.length === 0) {
      setLoading(true);
      try {
        const res = await callVault("list", { path: item.path });
        setChildren(res.items ?? []);
      } catch { /* ignore */ } finally { setLoading(false); }
    }
    setOpen(true);
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-xs transition-colors
          ${isSelected ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {isDir ? (
          open ? <FolderOpen size={12} className="shrink-0" /> : <Folder size={12} className="shrink-0" />
        ) : (
          <FileText size={12} className="shrink-0 opacity-60" />
        )}
        <span className="flex-1 truncate font-mono">{item.name}</span>
        {loading && <Loader2 size={10} className="animate-spin shrink-0" />}
        {isDir && !loading && (open ? <ChevronDown size={10} className="shrink-0 opacity-40" /> : <ChevronRight size={10} className="shrink-0 opacity-40" />)}
      </button>
      {isDir && open && children.length > 0 && (
        <div>
          {children.map(c => (
            <TreeNode
              key={c.path}
              item={c}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Copy button ────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="p-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors" title="Copy">
      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
    </button>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function PromptVaultPage() {
  const [rootItems, setRootItems] = useState<TreeItem[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [treeLoading, setTreeLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentCommits, setRecentCommits] = useState<Commit[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load root tree on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await callVault("list", { path: "" });
        const dirs = (res.items as TreeItem[]).filter(i => i.type === "dir" && !i.name.startsWith("."));
        const files = (res.items as TreeItem[]).filter(i => i.type === "file" && i.name.endsWith(".md"));
        setRootItems([...dirs, ...files]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setTreeLoading(false);
      }
    })();
  }, []);

  const loadFile = useCallback(async (item: TreeItem) => {
    setSelectedPath(item.path);
    setFileName(item.name);
    setFileContent("");
    setSearchResults([]);
    setSearchQuery("");
    setContentLoading(true);
    setError("");
    try {
      const res = await callVault("read", { path: item.path });
      setFileContent(res.content ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setContentLoading(false);
    }
  }, []);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await callVault("search", { query: q.trim(), limit: 12 });
        setSearchResults(res.results ?? []);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 600);
  }, []);

  const handleRecent = async () => {
    if (recentCommits.length) { setShowRecent(s => !s); return; }
    try {
      const res = await callVault("recent", { limit: 10 });
      setRecentCommits(res.commits ?? []);
      setShowRecent(true);
    } catch { /* ignore */ }
  };

  const promptForMavis = `Tell me about the system prompt at: ${selectedPath}. Fetch it with prompt_vault and analyze what it reveals about how ${fileName.replace(".md", "")} is instructed.`;

  return (
    <div className="flex h-full overflow-hidden gap-0">
      {/* ── Left sidebar: tree + search ─────────────────────────────────── */}
      <aside className="w-64 shrink-0 flex flex-col border-r border-border bg-sidebar h-full overflow-hidden">
        {/* Header */}
        <div className="p-3 border-b border-border">
          <h2 className="font-display text-primary font-bold tracking-widest text-xs">PROMPT VAULT</h2>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">leaked AI system prompts</p>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-border/50">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search models…"
              className="w-full bg-muted/40 border border-border rounded pl-7 pr-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
            />
            {searching && <Loader2 size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {/* Search results */}
        {searchResults.length > 0 && (
          <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
            <p className="px-2 py-1 text-xs font-mono text-muted-foreground">{searchResults.length} results</p>
            {searchResults.map(r => (
              <button
                key={r.path}
                onClick={() => loadFile({ name: r.name, path: r.path, type: "file", size: 0 })}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left text-xs transition-colors
                  ${selectedPath === r.path ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}
              >
                <FileText size={11} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono truncate">{r.name}</p>
                  <p className="text-muted-foreground/60 truncate">{r.path.split("/").slice(0, -1).join("/")}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Tree (shown when not searching) */}
        {!searchResults.length && (
          <div className="flex-1 overflow-y-auto p-1">
            {treeLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin text-primary" size={16} />
              </div>
            ) : (
              rootItems.map(item => (
                <TreeNode
                  key={item.path}
                  item={item}
                  depth={0}
                  selectedPath={selectedPath}
                  onSelect={loadFile}
                />
              ))
            )}
          </div>
        )}

        {/* Recent changes footer */}
        <div className="border-t border-border p-2">
          <button
            onClick={handleRecent}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-primary hover:bg-muted/30 transition-colors font-mono"
          >
            <Clock size={11} /> Recent Updates
          </button>
          {showRecent && recentCommits.length > 0 && (
            <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
              {recentCommits.map(c => (
                <div key={c.sha} className="px-2 py-1 text-xs text-muted-foreground/70 border-l border-border ml-2">
                  <p className="font-mono text-foreground/60 truncate">{c.message}</p>
                  <p className="font-mono text-muted-foreground/40">{new Date(c.date).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ── Right panel: viewer ──────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {!selectedPath ? (
          /* Welcome / provider grid */
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-6">
              <div>
                <h1 className="font-display text-primary font-bold tracking-widest text-sm">AI SYSTEM PROMPT LIBRARY</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Browse and analyze leaked system prompts from Claude, ChatGPT, Gemini, Grok, Copilot, and 10+ other AI products.
                  All content from{" "}
                  <a
                    href="https://github.com/KaiyzerCal/system_prompts_leaks"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    KaiyzerCal/system_prompts_leaks <ExternalLink size={11} />
                  </a>
                  {" "}· CC0 license.
                </p>
              </div>

              {/* Provider cards */}
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">Providers</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(PROVIDER_COLORS).map(([name, color]) => (
                    <button
                      key={name}
                      onClick={async () => {
                        // Expand the tree item for this provider if it exists
                        const item = rootItems.find(i => i.name === name && i.type === "dir");
                        if (!item) return;
                        // Load directory listing
                        try {
                          const res = await callVault("list", { path: item.path });
                          const files = (res.items as TreeItem[]).filter(i => i.type === "file" && i.name.endsWith(".md"));
                          if (files.length > 0) loadFile(files[0]);
                        } catch { /* ignore */ }
                      }}
                      className="flex items-center gap-2 p-3 rounded border border-border bg-muted/20 hover:border-primary/20 hover:bg-muted/40 transition-colors text-left"
                    >
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="font-mono text-xs text-foreground">{name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Ask MAVIS CTA */}
              <div className="p-4 rounded border border-primary/20 bg-primary/5">
                <p className="text-xs font-mono text-primary mb-2 uppercase tracking-widest">MAVIS Integration</p>
                <p className="text-sm text-muted-foreground">
                  Ask MAVIS to compare system prompts, analyze instructions, or explain the design philosophy behind any AI product.
                </p>
                <button
                  onClick={() => navigate("/mavis?q=Compare Claude and ChatGPT's system prompts. What are the key differences in how they're instructed?")}
                  className="mt-3 flex items-center gap-2 px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary text-xs hover:bg-primary/20 transition-colors"
                >
                  <MessageSquare size={12} /> Compare Claude vs ChatGPT prompts
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* File viewer */
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-xs font-bold text-foreground truncate">{fileName}</p>
                <p className="font-mono text-xs text-muted-foreground/60 truncate">{selectedPath}</p>
              </div>
              {fileContent && <CopyButton text={fileContent} />}
              <a
                href={`https://github.com/KaiyzerCal/system_prompts_leaks/blob/main/${selectedPath}`}
                target="_blank"
                rel="noreferrer"
                className="p-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
                title="Open on GitHub"
              >
                <ExternalLink size={13} />
              </a>
              <button
                onClick={() => navigate(`/mavis?q=${encodeURIComponent(promptForMavis)}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary text-xs hover:bg-primary/20 transition-colors whitespace-nowrap"
              >
                <MessageSquare size={12} /> Ask MAVIS
              </button>
              <button
                onClick={() => { setSelectedPath(""); setFileName(""); setFileContent(""); }}
                className="p-1.5 rounded border border-border text-muted-foreground hover:text-primary transition-colors"
                title="Back to overview"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            {error && (
              <div className="m-4 flex items-center gap-2 p-3 rounded border border-destructive/30 bg-destructive/10 text-destructive text-sm">
                <AlertCircle size={14} /> {error}
              </div>
            )}
            {contentLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="animate-spin text-primary" size={22} />
              </div>
            ) : fileContent ? (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-3xl mx-auto">
                  <MarkdownViewer content={fileContent} />
                </div>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
