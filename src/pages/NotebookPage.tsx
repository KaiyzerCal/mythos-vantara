import { useState, useEffect, useRef, useCallback } from "react";
import {
  BookOpen, Plus, Trash2, Link, FileText, Loader2, Send,
  Sparkles, ChevronRight, X, MessageSquare, Edit2, Check,
  Youtube, Copy, RefreshCw, PanelRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Notebook {
  id: string;
  title: string;
  description: string | null;
  emoji: string;
  created_at: string;
}

interface Source {
  id: string;
  notebook_id: string;
  title: string;
  source_type: "text" | "url" | "youtube" | "file";
  content: string | null;
  url: string | null;
  word_count: number;
  created_at: string;
}

interface Note {
  id: string;
  notebook_id: string;
  title: string | null;
  content: string;
  is_ai: boolean;
  created_at: string;
  updated_at: string;
}

interface Chat {
  id: string;
  notebook_id: string;
  title: string;
  created_at: string;
}

interface Message {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const db = supabase as any;
const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

async function getAuthHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return `Bearer ${data.session?.access_token ?? ""}`;
}

async function callLLM(system: string, messages: { role: string; content: string }[], taskType = "chat"): Promise<string> {
  const auth = await getAuthHeader();
  const res = await fetch(`${SB_URL}/functions/v1/mavis-llm-router`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ system, messages, task_type: taskType, max_tokens: 2048 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `LLM error ${res.status}`);
  return data.content ?? "";
}

function buildSourceContext(sources: Source[]): string {
  if (!sources.length) return "No sources have been added to this notebook yet.";
  return sources.map((s, i) => {
    const body = (s.content ?? "").slice(0, 2500);
    const label = s.url ? `[${s.source_type.toUpperCase()}] ${s.title} (${s.url})` : `[TEXT] ${s.title}`;
    return `--- Source ${i + 1}: ${label} ---\n${body}`;
  }).join("\n\n");
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const SOURCE_TYPE_ICON: Record<string, typeof FileText> = {
  text: FileText,
  url: Link,
  youtube: Youtube,
  file: FileText,
};

const SOURCE_TYPE_COLOR: Record<string, string> = {
  text: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  url: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  youtube: "text-red-400 bg-red-500/10 border-red-500/30",
  file: "text-orange-400 bg-orange-500/10 border-orange-500/30",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SourceBadge({ type }: { type: string }) {
  const Icon = SOURCE_TYPE_ICON[type] ?? FileText;
  const color = SOURCE_TYPE_COLOR[type] ?? SOURCE_TYPE_COLOR.text;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${color}`}>
      <Icon size={9} />
      {type.toUpperCase()}
    </span>
  );
}

function NoteCard({ note, onDelete, onEdit }: { note: Note; onDelete: () => void; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-border rounded bg-card/40 hover:bg-card/60 transition-colors group">
      <button
        className="w-full text-left p-3 flex items-start gap-2"
        onClick={() => setExpanded(v => !v)}
      >
        {note.is_ai && <Sparkles size={12} className="text-primary mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-display text-foreground line-clamp-2 leading-relaxed">
            {note.title || note.content.slice(0, 80)}
          </p>
          {!expanded && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 font-body">
              {note.content.slice(0, 100)}
            </p>
          )}
        </div>
        <ChevronRight
          size={12}
          className={`text-muted-foreground mt-0.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <p className="text-xs text-foreground/80 font-body leading-relaxed whitespace-pre-wrap">
            {note.content}
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => { navigator.clipboard.writeText(note.content); toast.success("Copied"); }}
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
            >
              <Copy size={10} /> Copy
            </button>
            <button onClick={onEdit} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
              <Edit2 size={10} /> Edit
            </button>
            <button onClick={onDelete} className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 ml-auto">
              <Trash2 size={10} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function NotebookPage() {
  const { user } = useAuth();

  // Notebooks
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingNb, setCreatingNb] = useState(false);
  const [newNbTitle, setNewNbTitle] = useState("");
  const [nbLoading, setNbLoading] = useState(true);

  // Content
  const [sources, setSources] = useState<Source[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeTab, setActiveTab] = useState<"sources" | "notes">("sources");
  const [contentLoading, setContentLoading] = useState(false);

  // Add source
  const [addMode, setAddMode] = useState<"text" | "url" | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [addContent, setAddContent] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addingSource, setAddingSource] = useState(false);

  // Notes
  const [generatingNote, setGeneratingNote] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");

  // Chat
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const selectedNotebook = notebooks.find(n => n.id === selectedId) ?? null;

  // ── Data loaders ───────────────────────────────────────────────────────────

  const loadNotebooks = useCallback(async () => {
    if (!user) return;
    setNbLoading(true);
    const { data } = await db.from("notebooks").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setNotebooks(data ?? []);
    setNbLoading(false);
  }, [user]);

  const loadContent = useCallback(async (notebookId: string) => {
    setContentLoading(true);
    const [{ data: s }, { data: n }, { data: c }] = await Promise.all([
      db.from("notebook_sources").select("*").eq("notebook_id", notebookId).order("created_at", { ascending: false }),
      db.from("notebook_notes").select("*").eq("notebook_id", notebookId).order("created_at", { ascending: false }),
      db.from("notebook_chats").select("*").eq("notebook_id", notebookId).order("created_at", { ascending: true }),
    ]);
    setSources(s ?? []);
    setNotes(n ?? []);
    const chatList: Chat[] = c ?? [];
    setChats(chatList);

    // Auto-select or create default chat
    if (chatList.length > 0) {
      setSelectedChatId(chatList[chatList.length - 1].id);
    } else {
      // Create a default chat
      const { data: newChat } = await db.from("notebook_chats").insert({
        notebook_id: notebookId,
        user_id: user!.id,
        title: "Chat",
      }).select().single();
      if (newChat) {
        setChats([newChat]);
        setSelectedChatId(newChat.id);
      }
    }
    setContentLoading(false);
  }, [user]);

  const loadMessages = useCallback(async (chatId: string) => {
    const { data } = await db.from("notebook_messages").select("*").eq("chat_id", chatId).order("created_at", { ascending: true });
    setMessages(data ?? []);
  }, []);

  useEffect(() => { loadNotebooks(); }, [loadNotebooks]);

  useEffect(() => {
    if (!selectedId) { setSources([]); setNotes([]); setChats([]); setMessages([]); return; }
    loadContent(selectedId);
  }, [selectedId, loadContent]);

  useEffect(() => {
    if (selectedChatId) loadMessages(selectedChatId);
  }, [selectedChatId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Notebook CRUD ──────────────────────────────────────────────────────────

  async function createNotebook() {
    if (!newNbTitle.trim() || !user) return;
    const { data } = await db.from("notebooks").insert({
      user_id: user.id,
      title: newNbTitle.trim(),
      emoji: "📓",
    }).select().single();
    if (data) {
      setNotebooks(prev => [data, ...prev]);
      setSelectedId(data.id);
      setCreatingNb(false);
      setNewNbTitle("");
    }
  }

  async function deleteNotebook(id: string) {
    await db.from("notebooks").delete().eq("id", id);
    setNotebooks(prev => prev.filter(n => n.id !== id));
    if (selectedId === id) { setSelectedId(null); setSources([]); setNotes([]); setMessages([]); }
  }

  // ── Sources ────────────────────────────────────────────────────────────────

  async function addTextSource() {
    if (!addContent.trim() || !selectedId || !user) return;
    setAddingSource(true);
    const title = addTitle.trim() || `Text snippet (${wordCount(addContent)}w)`;
    const { data } = await db.from("notebook_sources").insert({
      notebook_id: selectedId,
      user_id: user.id,
      title,
      source_type: "text",
      content: addContent.trim(),
      word_count: wordCount(addContent),
    }).select().single();
    if (data) {
      setSources(prev => [data, ...prev]);
      setAddContent("");
      setAddTitle("");
      setAddMode(null);
      toast.success("Source added");
    }
    setAddingSource(false);
  }

  async function addUrlSource() {
    if (!addUrl.trim() || !selectedId || !user) return;
    setAddingSource(true);
    const auth = await getAuthHeader();
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-article-extractor`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ url: addUrl.trim() }),
      });
      const extracted = await res.json();
      const title = (extracted.title || new URL(addUrl).hostname).slice(0, 200);
      const content = extracted.text ?? "";
      const { data } = await db.from("notebook_sources").insert({
        notebook_id: selectedId,
        user_id: user.id,
        title,
        source_type: "url",
        content,
        url: addUrl.trim(),
        word_count: wordCount(content),
      }).select().single();
      if (data) {
        setSources(prev => [data, ...prev]);
        setAddUrl("");
        setAddTitle("");
        setAddMode(null);
        toast.success("URL source extracted");
      }
    } catch {
      toast.error("Failed to extract URL content");
    }
    setAddingSource(false);
  }

  async function addYoutubeSource() {
    if (!addUrl.trim() || !selectedId || !user) return;
    setAddingSource(true);
    const title = addTitle.trim() || `YouTube: ${addUrl.trim()}`;
    const { data } = await db.from("notebook_sources").insert({
      notebook_id: selectedId,
      user_id: user.id,
      title,
      source_type: "youtube",
      url: addUrl.trim(),
      content: "",
      word_count: 0,
    }).select().single();
    if (data) {
      setSources(prev => [data, ...prev]);
      setAddUrl("");
      setAddTitle("");
      setAddMode(null);
      toast.success("YouTube source saved");
    }
    setAddingSource(false);
  }

  async function deleteSource(id: string) {
    await db.from("notebook_sources").delete().eq("id", id);
    setSources(prev => prev.filter(s => s.id !== id));
  }

  // ── Notes ──────────────────────────────────────────────────────────────────

  async function generateNote() {
    if (!selectedId || !user || sources.length === 0) { toast.error("Add sources first"); return; }
    setGeneratingNote(true);
    const context = buildSourceContext(sources);
    try {
      const content = await callLLM(
        `You are an expert research assistant. Analyze the provided sources and generate a comprehensive set of key insights, findings, and important concepts. Format as structured notes with clear sections.`,
        [{ role: "user", content: `Sources:\n\n${context}\n\nGenerate detailed research notes covering the main ideas, key findings, and important details from these sources.` }],
        "complex"
      );
      const { data } = await db.from("notebook_notes").insert({
        notebook_id: selectedId,
        user_id: user.id,
        title: "AI Research Notes",
        content,
        is_ai: true,
        source_ids: sources.map(s => s.id),
      }).select().single();
      if (data) {
        setNotes(prev => [data, ...prev]);
        setActiveTab("notes");
        toast.success("Notes generated");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate notes");
    }
    setGeneratingNote(false);
  }

  async function createManualNote() {
    if (!selectedId || !user) return;
    const { data } = await db.from("notebook_notes").insert({
      notebook_id: selectedId,
      user_id: user.id,
      title: "Note",
      content: "Start writing...",
      is_ai: false,
    }).select().single();
    if (data) {
      setNotes(prev => [data, ...prev]);
      setEditingNote(data);
      setEditTitle(data.title ?? "");
      setEditContent(data.content);
    }
  }

  async function saveEditedNote() {
    if (!editingNote) return;
    const { data } = await db.from("notebook_notes")
      .update({ title: editTitle.trim() || null, content: editContent, updated_at: new Date().toISOString() })
      .eq("id", editingNote.id).select().single();
    if (data) {
      setNotes(prev => prev.map(n => n.id === data.id ? data : n));
    }
    setEditingNote(null);
  }

  async function deleteNote(id: string) {
    await db.from("notebook_notes").delete().eq("id", id);
    setNotes(prev => prev.filter(n => n.id !== id));
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  async function sendMessage() {
    if (!chatInput.trim() || !selectedChatId || !selectedId || !user) return;
    const text = chatInput.trim();
    setChatInput("");

    const userMsg: Message = {
      id: crypto.randomUUID(),
      chat_id: selectedChatId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    // Persist user message
    db.from("notebook_messages").insert({ chat_id: selectedChatId, role: "user", content: text });

    setChatLoading(true);
    const context = buildSourceContext(sources);
    const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }));

    try {
      const system = sources.length > 0
        ? `You are MAVIS, a research assistant. Answer questions grounded in the following notebook sources. Cite specific sources when relevant.\n\n${context}`
        : `You are MAVIS, a research assistant. No sources have been added to this notebook yet. Help the user and suggest they add sources for context.`;

      const reply = await callLLM(system, [...history, { role: "user", content: text }], "chat");

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        chat_id: selectedChatId,
        role: "assistant",
        content: reply,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      db.from("notebook_messages").insert({ chat_id: selectedChatId, role: "assistant", content: reply });
    } catch (e: any) {
      toast.error(e.message ?? "Chat failed");
    }
    setChatLoading(false);
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex overflow-hidden">
      {/* ── Left: Notebook List ─────────────────────────────────────────────── */}
      <div className="w-56 border-r border-border bg-sidebar flex flex-col shrink-0">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-primary" />
            <span className="text-xs font-display text-primary tracking-widest">NOTEBOOKS</span>
          </div>
          <button
            onClick={() => setCreatingNb(true)}
            className="w-6 h-6 rounded border border-border/60 text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors flex items-center justify-center"
          >
            <Plus size={11} />
          </button>
        </div>

        {/* New notebook inline form */}
        {creatingNb && (
          <div className="p-2 border-b border-border/50 bg-primary/5">
            <input
              autoFocus
              value={newNbTitle}
              onChange={e => setNewNbTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") createNotebook(); if (e.key === "Escape") { setCreatingNb(false); setNewNbTitle(""); } }}
              placeholder="Notebook title..."
              className="w-full bg-transparent text-xs font-body text-foreground border-b border-primary/30 focus:outline-none pb-0.5 placeholder:text-muted-foreground"
            />
            <div className="flex gap-1 mt-1.5">
              <button onClick={createNotebook} className="text-[10px] text-primary font-mono px-2 py-0.5 rounded bg-primary/10 hover:bg-primary/20">Create</button>
              <button onClick={() => { setCreatingNb(false); setNewNbTitle(""); }} className="text-[10px] text-muted-foreground font-mono px-2 py-0.5">Cancel</button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto py-1">
          {nbLoading ? (
            <div className="flex justify-center pt-6"><Loader2 size={14} className="animate-spin text-muted-foreground" /></div>
          ) : notebooks.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono text-center pt-6 px-3">No notebooks yet</p>
          ) : (
            notebooks.map(nb => (
              <button
                key={nb.id}
                onClick={() => setSelectedId(nb.id)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 group transition-colors ${selectedId === nb.id ? "bg-primary/10 text-primary border-r-2 border-primary" : "text-foreground hover:bg-sidebar-accent"}`}
              >
                <span className="text-sm shrink-0">{nb.emoji}</span>
                <span className="text-xs font-body truncate flex-1">{nb.title}</span>
                <button
                  onClick={e => { e.stopPropagation(); deleteNotebook(nb.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                >
                  <Trash2 size={10} />
                </button>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Main Content ────────────────────────────────────────────────────── */}
      {!selectedId ? (
        <div className="flex-1 flex items-center justify-center bg-background">
          <div className="text-center max-w-xs">
            <BookOpen size={40} className="text-primary/30 mx-auto mb-3" />
            <h2 className="text-sm font-display text-primary mb-1">Open Notebook</h2>
            <p className="text-xs text-muted-foreground font-body">Select a notebook or create a new one to start organizing your research with AI.</p>
            <button
              onClick={() => setCreatingNb(true)}
              className="mt-4 px-4 py-2 rounded border border-primary/30 text-primary text-xs font-mono hover:bg-primary/10 transition-colors inline-flex items-center gap-2"
            >
              <Plus size={12} /> New Notebook
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex min-w-0 overflow-hidden">
          {/* ── Middle: Sources / Notes ────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-border">
            {/* Header */}
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="text-lg">{selectedNotebook?.emoji}</span>
                <div>
                  <h1 className="text-sm font-display text-foreground">{selectedNotebook?.title}</h1>
                  {selectedNotebook?.description && (
                    <p className="text-xs text-muted-foreground font-body">{selectedNotebook.description}</p>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => setShowChatPanel(v => !v)}
                    className={`w-7 h-7 rounded border flex items-center justify-center transition-colors ${showChatPanel ? "border-primary/30 text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-primary hover:border-primary/30"}`}
                    title="Toggle chat panel"
                  >
                    <PanelRight size={12} />
                  </button>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border px-4">
              {(["sources", "notes"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-2 text-xs font-mono uppercase tracking-wider transition-colors ${activeTab === tab ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {tab} {tab === "sources" ? `(${sources.length})` : `(${notes.length})`}
                </button>
              ))}
            </div>

            {contentLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
              </div>
            ) : activeTab === "sources" ? (
              /* ── Sources Tab ── */
              <div className="flex-1 overflow-y-auto p-4">
                {/* Add source bar */}
                {!addMode ? (
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={() => setAddMode("text")}
                      className="flex-1 px-3 py-2 rounded border border-border/60 text-xs text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors flex items-center justify-center gap-1.5"
                    >
                      <FileText size={11} /> Add Text
                    </button>
                    <button
                      onClick={() => setAddMode("url")}
                      className="flex-1 px-3 py-2 rounded border border-border/60 text-xs text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Link size={11} /> Add URL
                    </button>
                  </div>
                ) : addMode === "text" ? (
                  <div className="mb-4 p-3 rounded border border-primary/20 bg-primary/5 space-y-2">
                    <input
                      value={addTitle}
                      onChange={e => setAddTitle(e.target.value)}
                      placeholder="Title (optional)"
                      className="w-full bg-transparent text-xs font-body text-foreground border-b border-border/50 focus:outline-none focus:border-primary/30 pb-1 placeholder:text-muted-foreground"
                    />
                    <textarea
                      autoFocus
                      value={addContent}
                      onChange={e => setAddContent(e.target.value)}
                      placeholder="Paste your text content here..."
                      rows={6}
                      className="w-full bg-sidebar/50 text-xs font-body text-foreground rounded border border-border/50 focus:outline-none focus:border-primary/30 p-2 resize-none placeholder:text-muted-foreground"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground font-mono">{wordCount(addContent)} words</span>
                      <div className="ml-auto flex gap-2">
                        <button onClick={() => { setAddMode(null); setAddContent(""); setAddTitle(""); }} className="text-xs text-muted-foreground hover:text-foreground font-mono">Cancel</button>
                        <button
                          onClick={addTextSource}
                          disabled={addingSource || !addContent.trim()}
                          className="text-xs px-3 py-1 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 font-mono disabled:opacity-40 flex items-center gap-1"
                        >
                          {addingSource ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Add
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mb-4 p-3 rounded border border-primary/20 bg-primary/5 space-y-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setAddMode("url")}
                        className={`text-xs font-mono px-2 py-0.5 rounded ${addMode === "url" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "text-muted-foreground"}`}
                      >
                        <Link size={10} className="inline mr-1" />URL
                      </button>
                      <button
                        onClick={() => setAddMode("youtube" as any)}
                        className={`text-xs font-mono px-2 py-0.5 rounded ${(addMode as string) === "youtube" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "text-muted-foreground"}`}
                      >
                        <Youtube size={10} className="inline mr-1" />YouTube
                      </button>
                    </div>
                    <input
                      autoFocus
                      value={addUrl}
                      onChange={e => setAddUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") (addMode as string) === "youtube" ? addYoutubeSource() : addUrlSource(); }}
                      placeholder={(addMode as string) === "youtube" ? "https://youtube.com/watch?v=..." : "https://example.com/article"}
                      className="w-full bg-sidebar/50 text-xs font-body text-foreground rounded border border-border/50 focus:outline-none focus:border-primary/30 p-2 placeholder:text-muted-foreground"
                    />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { setAddMode(null); setAddUrl(""); setAddTitle(""); }} className="text-xs text-muted-foreground hover:text-foreground font-mono">Cancel</button>
                      <button
                        onClick={() => (addMode as string) === "youtube" ? addYoutubeSource() : addUrlSource()}
                        disabled={addingSource || !addUrl.trim()}
                        className="text-xs px-3 py-1 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 font-mono disabled:opacity-40 flex items-center gap-1"
                      >
                        {addingSource ? <Loader2 size={10} className="animate-spin" /> : <Link size={10} />} Extract
                      </button>
                    </div>
                  </div>
                )}

                {/* Source list */}
                {sources.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText size={28} className="text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground font-mono">No sources yet</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">Add text or URLs to ground your AI chat</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sources.map(src => (
                      <div key={src.id} className="flex items-start gap-2 p-3 rounded border border-border bg-card/30 hover:bg-card/50 transition-colors group">
                        <SourceBadge type={src.source_type} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-display text-foreground line-clamp-1">{src.title}</p>
                          {src.url && <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">{src.url}</p>}
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{src.word_count} words</p>
                          {src.content && (
                            <p className="text-[10px] text-muted-foreground/60 line-clamp-2 mt-1 font-body">{src.content.slice(0, 120)}...</p>
                          )}
                        </div>
                        <button
                          onClick={() => deleteSource(src.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* ── Notes Tab ── */
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={generateNote}
                    disabled={generatingNote || sources.length === 0}
                    className="flex-1 px-3 py-2 rounded border border-primary/30 text-primary text-xs font-mono hover:bg-primary/10 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40"
                  >
                    {generatingNote ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                    Generate AI Notes
                  </button>
                  <button
                    onClick={createManualNote}
                    className="px-3 py-2 rounded border border-border/60 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors flex items-center gap-1.5"
                  >
                    <Edit2 size={11} /> Manual
                  </button>
                </div>

                {/* Edit note panel */}
                {editingNote && (
                  <div className="mb-4 p-3 rounded border border-primary/20 bg-primary/5 space-y-2">
                    <input
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      placeholder="Note title"
                      className="w-full bg-transparent text-xs font-display text-foreground border-b border-border/50 focus:outline-none focus:border-primary/30 pb-1 placeholder:text-muted-foreground"
                    />
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      rows={8}
                      className="w-full bg-sidebar/50 text-xs font-body text-foreground rounded border border-border/50 focus:outline-none focus:border-primary/30 p-2 resize-none"
                    />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingNote(null)} className="text-xs text-muted-foreground hover:text-foreground font-mono">Cancel</button>
                      <button onClick={saveEditedNote} className="text-xs px-3 py-1 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 font-mono flex items-center gap-1">
                        <Check size={10} /> Save
                      </button>
                    </div>
                  </div>
                )}

                {notes.length === 0 ? (
                  <div className="text-center py-12">
                    <Sparkles size={28} className="text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground font-mono">No notes yet</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">Generate AI notes from your sources or write manually</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {notes.map(note => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        onDelete={() => deleteNote(note.id)}
                        onEdit={() => { setEditingNote(note); setEditTitle(note.title ?? ""); setEditContent(note.content); }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Right: Chat Panel ──────────────────────────────────────────── */}
          {showChatPanel && (
            <div className="w-80 flex flex-col shrink-0">
              <div className="p-3 border-b border-border flex items-center gap-2">
                <MessageSquare size={12} className="text-primary" />
                <span className="text-xs font-mono text-primary tracking-wider">CHAT WITH SOURCES</span>
                <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                  {sources.length} src{sources.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.length === 0 && (
                  <div className="text-center py-8">
                    <MessageSquare size={24} className="text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {sources.length === 0 ? "Add sources to enable grounded chat" : "Ask anything about your sources"}
                    </p>
                  </div>
                )}

                {messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded px-3 py-2 text-xs font-body leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary/15 border border-primary/20 text-foreground"
                        : "bg-card border border-border text-foreground/90"
                    }`}>
                      {msg.role === "assistant" && (
                        <div className="flex items-center gap-1 mb-1">
                          <Sparkles size={9} className="text-primary" />
                          <span className="text-[9px] font-mono text-primary">MAVIS</span>
                        </div>
                      )}
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))}

                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-card border border-border rounded px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Sparkles size={9} className="text-primary" />
                        <Loader2 size={9} className="animate-spin text-muted-foreground" />
                        <span className="text-[9px] font-mono text-muted-foreground">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-3 border-t border-border">
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={chatInputRef}
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="Ask about your sources..."
                    rows={2}
                    className="flex-1 bg-sidebar/60 text-xs font-body text-foreground rounded border border-border/60 focus:outline-none focus:border-primary/30 p-2 resize-none placeholder:text-muted-foreground"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={chatLoading || !chatInput.trim()}
                    className="w-8 h-8 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center justify-center disabled:opacity-40 shrink-0"
                  >
                    {chatLoading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  </button>
                </div>
                <p className="text-[9px] text-muted-foreground font-mono mt-1">Enter to send · Shift+Enter for newline</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
