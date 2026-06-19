import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/SharedUI";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Network, Plus, Search, Link2, Trash2, Save,
  X, Edit3, Clock, Hash, ArrowRight, ArrowLeft, List, GitGraph,
  BookOpen, ExternalLink, Loader2, Download,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import KnowledgeGraphCanvas from "@/components/KnowledgeGraphCanvas";

const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  properties: Record<string, unknown>;
  aliases: string[];
  created_at: string;
  updated_at: string;
}

interface NoteLink {
  id: string;
  source_note_id: string;
  target_note_id: string;
  type: string;
  description: string | null;
  created_at: string;
}

interface NoteVersion {
  id: string;
  note_id: string;
  title: string;
  content: string;
  version_number: number;
  created_at: string;
}

const LINK_TYPES = ["relates_to", "see_also", "depends_on", "child_of", "inspired_by", "contradicts"];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function kgCall(action: string, params: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("mavis-knowledge", {
    body: { action, ...params },
  });
  if (error) {
    // FunctionsHttpError.context is the raw Response — extract the real message.
    let detail = error.message;
    try {
      const body = await (error as any).context?.json?.();
      if (body?.error) detail = body.error;
      else if (body?.message) detail = body.message;
    } catch { /* body already consumed or not JSON */ }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function KnowledgeGraph() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";

  const [notes, setNotes]           = useState<Note[]>([]);
  const [selected, setSelected]     = useState<Note | null>(null);
  const [links, setLinks]           = useState<NoteLink[]>([]);
  const [versions, setVersions]     = useState<NoteVersion[]>([]);
  const [search, setSearch]         = useState("");
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [editing, setEditing]       = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkTarget, setLinkTarget] = useState("");
  const [linkType, setLinkType]     = useState("relates_to");
  const [linkDesc, setLinkDesc]     = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags]   = useState("");
  const [dbError, setDbError]       = useState<string | null>(null);
  const [syncing, setSyncing]       = useState(false);
  const [view, setView]             = useState<"list" | "graph">("list");
  const [allLinks, setAllLinks]     = useState<NoteLink[]>([]);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [filterTag, setFilterTag]   = useState<string>("");
  const [confirmDeleteNote, setConfirmDeleteNote] = useState<{ id: string; title: string } | null>(null);
  const [confirmDeleteLink, setConfirmDeleteLink] = useState<{ id: string } | null>(null);
  const [showArxiv, setShowArxiv]   = useState(false);
  const [arxivQuery, setArxivQuery] = useState("");
  const [arxivResults, setArxivResults] = useState<any[]>([]);
  const [arxivLoading, setArxivLoading] = useState(false);
  const [savingArxiv, setSavingArxiv] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const result = await kgCall("list_notes");
      setNotes((result.notes ?? []) as Note[]);
      setDbError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[KnowledgeGraph] loadNotes:", msg);
      setDbError(`Failed to load notes: ${msg}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const loadNoteDetail = useCallback(async (note: Note) => {
    setSelected(note);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setDraftTags(note.tags.join(", "));
    setEditing(false);
    setShowVersions(false);

    try {
      const [linksRes, versionsRes] = await Promise.all([
        kgCall("get_links", { note_id: note.id }),
        kgCall("get_versions", { note_id: note.id }),
      ]);
      setLinks((linksRes.links ?? []) as NoteLink[]);
      setVersions((versionsRes.versions ?? []) as NoteVersion[]);
    } catch (e) {
      console.error("[KnowledgeGraph] loadNoteDetail:", e);
    }
  }, []);

  const createNote = async () => {
    try {
      const result = await kgCall("create_note", {
        title: "Untitled Note",
        content: "",
        tags: [],
        properties: {},
        aliases: [],
      });
      const note = result.note as Note;
      setNotes(prev => [note, ...prev]);
      loadNoteDetail(note);
      setEditing(true);
      setTimeout(() => textareaRef.current?.focus(), 100);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[KnowledgeGraph] createNote:", msg);
      toast.error(`Failed to create note: ${msg}`);
    }
  };

  const syncEmbeddings = async () => {
    setSyncing(true);
    try {
      let total = 0;
      for (let i = 0; i < 10; i++) {
        const result = await kgCall("backfill_embeddings");
        total += result.backfilled ?? 0;
        if (!result.backfilled || result.message === "All notes already embedded") break;
      }
      if (total > 0) toast.success(`Embedded ${total} note${total !== 1 ? "s" : ""} — MAVIS memory upgraded`);
      else toast.success("All notes already have embeddings");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Sync failed: ${msg}`);
    }
    setSyncing(false);
  };

  const switchToGraph = async () => {
    setView("graph");
    if (allLinks.length > 0) return; // already loaded
    setLoadingGraph(true);
    try {
      const result = await kgCall("list_links");
      setAllLinks((result.links ?? []) as NoteLink[]);
    } catch (e) {
      toast.error("Couldn't load graph links");
    }
    setLoadingGraph(false);
  };

  const saveNote = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const tags = draftTags.split(",").map(t => t.trim()).filter(Boolean);
      const result = await kgCall("update_note", {
        note_id: selected.id,
        title: draftTitle,
        content: draftContent,
        tags,
      });
      const updated = result.note as Note;
      setSelected(updated);
      setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
      setEditing(false);
      toast.success("Note saved");
      loadNoteDetail(updated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[KnowledgeGraph] saveNote:", msg);
      toast.error(`Failed to save: ${msg}`);
    }
    setSaving(false);
  };

  const deleteNote = async (id: string) => {
    try {
      await kgCall("delete_note", { note_id: id });
      setNotes(prev => prev.filter(n => n.id !== id));
      if (selected?.id === id) { setSelected(null); setLinks([]); setVersions([]); }
      toast.success("Note deleted");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to delete note: ${msg}`);
    }
  };

  const addLink = async () => {
    if (!selected || !linkTarget) return;
    const target = notes.find(n => n.title.toLowerCase().includes(linkTarget.toLowerCase()) && n.id !== selected.id);
    if (!target) { toast.error(`No note found matching "${linkTarget}"`); return; }
    try {
      await kgCall("create_link", {
        source_note_id: selected.id,
        target_note_id: target.id,
        type: linkType,
        description: linkDesc || null,
      });
      toast.success(`Linked to "${target.title}"`);
      setShowLinkModal(false);
      setLinkTarget(""); setLinkDesc(""); setLinkType("relates_to");
      loadNoteDetail(selected);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("unique") || msg.includes("duplicate")) toast.error("Link already exists");
      else toast.error(`Failed to create link: ${msg}`);
    }
  };

  const searchArxiv = async () => {
    if (!arxivQuery.trim()) return;
    setArxivLoading(true);
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-arxiv`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "search", query: arxivQuery.trim(), max_results: 10 }),
      });
      const data = await res.json().catch(() => ({}));
      setArxivResults(data.papers ?? []);
    } catch (e: any) {
      toast.error(`arXiv search failed: ${e.message}`);
    } finally {
      setArxivLoading(false);
    }
  };

  const saveArxivToVault = async (paper: any) => {
    setSavingArxiv(paper.id);
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-arxiv`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "save_to_vault", paper_id: paper.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        toast.success(data.skipped ? "Already in vault" : `Saved "${paper.title}" to Vault`);
        if (!data.skipped) loadNotes();
      } else {
        toast.error(data.error ?? "Failed to save");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingArxiv(null);
    }
  };

  const removeLink = async (linkId: string) => {
    try {
      await kgCall("delete_link", { link_id: linkId });
      setLinks(prev => prev.filter(l => l.id !== linkId));
      toast.success("Link removed");
    } catch (e) {
      toast.error("Failed to remove link");
    }
  };

  const restoreVersion = (v: NoteVersion) => {
    setDraftTitle(v.title);
    setDraftContent(v.content);
    setEditing(true);
    setShowVersions(false);
    toast.message(`Restored v${v.version_number} — save to confirm`);
  };

  const filtered = notes.filter(n =>
    n.title.toLowerCase().includes(search.toLowerCase()) ||
    n.tags.some(t => t.toLowerCase().includes(search.toLowerCase())) ||
    n.aliases.some(a => a.toLowerCase().includes(search.toLowerCase()))
  );

  const allTags = Array.from(new Set(notes.flatMap(n => n.tags))).sort();

  const outgoingLinks = links
    .filter(l => l.source_note_id === selected?.id)
    .map(l => ({ link: l, other: notes.find(n => n.id === l.target_note_id) }))
    .filter(x => x.other);

  const backlinks = links
    .filter(l => l.target_note_id === selected?.id)
    .map(l => ({ link: l, other: notes.find(n => n.id === l.source_note_id) }))
    .filter(x => x.other);

  return (
    <div className="flex flex-col gap-0 h-full">
      <div className="px-1">
        <PageHeader
          title="Knowledge Graph"
          subtitle="MAVIS native knowledge base — notes, links, versions"
          icon={<Network size={18} />}
          actions={
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div className="flex items-center border border-border rounded overflow-hidden">
                <button onClick={() => setView("list")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono transition-colors ${view === "list" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  <List size={11} /> List
                </button>
                <button onClick={switchToGraph}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono transition-colors border-l border-border ${view === "graph" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  <GitGraph size={11} /> Graph
                </button>
              </div>
              <button onClick={() => setShowArxiv(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-muted/20 border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors">
                <BookOpen size={12} /> arXiv
              </button>
              <button onClick={syncEmbeddings} disabled={syncing} title="Generate semantic embeddings so MAVIS searches by meaning"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-muted/20 border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50">
                {syncing ? <span className="w-3 h-3 rounded-full border border-primary border-t-transparent animate-spin" /> : <Network size={12} />}
                {syncing ? "Syncing…" : "Sync Embeddings"}
              </button>
              <button onClick={createNote} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors">
                <Plus size={12} /> New Note
              </button>
            </div>
          }
        />
      </div>

      {dbError && (
        <div className="mt-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono flex items-start gap-2">
          <span className="shrink-0 font-bold">ERROR</span>
          <span>{dbError}</span>
        </div>
      )}

      {/* ── GRAPH VIEW ─────────────────────────────────────── */}
      {view === "graph" && (
        <div className="flex flex-col flex-1 gap-2 mt-2">
          <div className="flex items-center gap-2">
            <Hash size={11} className="text-muted-foreground" />
            <select
              value={filterTag}
              onChange={e => setFilterTag(e.target.value)}
              className="text-xs font-mono bg-muted/20 border border-border rounded px-2 py-1 text-muted-foreground focus:outline-none focus:border-primary/50"
            >
              <option value="">All tags</option>
              {allTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {filterTag && (
              <button onClick={() => setFilterTag("")} className="text-xs font-mono text-muted-foreground hover:text-foreground">
                clear
              </button>
            )}
          </div>
          <div className="flex-1 border border-border rounded-lg overflow-hidden" style={{ minHeight: 580 }}>
            {loadingGraph ? (
              <div className="flex items-center justify-center h-full">
                <span className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            ) : (
              <KnowledgeGraphCanvas
                notes={notes}
                links={allLinks}
                selectedId={selected?.id}
                filterTag={filterTag || undefined}
                onSelectNote={(canvasNote) => {
                  const full = notes.find(n => n.id === canvasNote.id);
                  if (full) { loadNoteDetail(full); setView("list"); }
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── LIST VIEW ─────────────────────────────────────── */}
      {view === "list" && <div className="flex flex-1 gap-0 border border-border rounded-lg overflow-hidden mt-2" style={{ minHeight: 600 }}>
        {/* ── LEFT PANEL: Note list ── */}
        <div className="w-64 shrink-0 border-r border-border flex flex-col bg-sidebar">
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 bg-muted/20 rounded px-2 py-1.5 border border-border">
              <Search size={12} className="text-muted-foreground shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search notes..."
                className="bg-transparent text-xs font-mono text-foreground placeholder:text-muted-foreground outline-none flex-1 min-w-0"
              />
              {search && <button onClick={() => setSearch("")}><X size={10} className="text-muted-foreground" /></button>}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-xs font-mono text-muted-foreground text-center py-8 px-4">
                {search ? "No notes match." : "No notes yet.\nCreate your first note."}
              </p>
            ) : (
              filtered.map(note => (
                <button
                  key={note.id}
                  onClick={() => loadNoteDetail(note)}
                  className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors hover:bg-muted/20 ${selected?.id === note.id ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                >
                  <p className="text-xs font-mono font-medium truncate text-foreground">{note.title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">{timeAgo(note.updated_at)}</span>
                    {note.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-xs font-mono px-1 py-0.5 rounded bg-primary/10 text-primary/80">{tag}</span>
                    ))}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="p-2 border-t border-border">
            <p className="text-xs font-mono text-muted-foreground text-center">
              {notes.length} note{notes.length !== 1 ? "s" : ""} · {outgoingLinks.length + backlinks.length} links
            </p>
          </div>
        </div>

        {/* ── MAIN PANEL: Note editor ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
              <Network size={40} className="text-muted-foreground" />
              <div>
                <p className="text-sm font-mono text-muted-foreground">Select a note or create one</p>
                <p className="text-xs font-mono text-muted-foreground mt-1">MAVIS can also create notes via chat using create_note actions</p>
              </div>
              <button onClick={createNote} className="flex items-center gap-2 px-4 py-2 rounded border border-primary/30 text-primary text-xs font-mono hover:bg-primary/10 transition-colors">
                <Plus size={12} /> Create First Note
              </button>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Note toolbar */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/10">
                {editing ? (
                  <>
                    <input
                      value={draftTitle}
                      onChange={e => setDraftTitle(e.target.value)}
                      className="flex-1 bg-transparent text-sm font-mono font-bold text-foreground outline-none border-b border-primary/30 pb-0.5"
                    />
                    <button onClick={saveNote} disabled={saving} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-50">
                      <Save size={10} /> {saving ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => { setEditing(false); setDraftTitle(selected.title); setDraftContent(selected.content); setDraftTags(selected.tags.join(", ")); }}
                      className="text-xs font-mono text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border">
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className="flex-1 text-sm font-mono font-bold truncate">{selected.title}</h2>
                    <button onClick={() => setEditing(true)} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono text-muted-foreground hover:text-primary border border-border hover:border-primary/30 transition-colors">
                      <Edit3 size={10} /> Edit
                    </button>
                    <button onClick={() => setShowLinkModal(true)} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono text-muted-foreground hover:text-primary border border-border hover:border-primary/30 transition-colors">
                      <Link2 size={10} /> Link
                    </button>
                    <button onClick={() => setShowVersions(!showVersions)} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono text-muted-foreground hover:text-primary border border-border hover:border-primary/30 transition-colors">
                      <Clock size={10} /> v{versions.length}
                    </button>
                    <button onClick={() => setConfirmDeleteNote({ id: selected.id, title: selected.title })}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono text-red-400 hover:bg-red-500/10 border border-border hover:border-red-500/30 transition-colors">
                      <Trash2 size={10} />
                    </button>
                  </>
                )}
              </div>

              <div className="flex flex-1 min-h-0">
                {/* Content area */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                  {editing ? (
                    <div className="flex flex-col flex-1 p-4 gap-3">
                      <div>
                        <label className="text-xs font-mono text-muted-foreground uppercase tracking-widest block mb-1">Tags (comma separated)</label>
                        <input
                          value={draftTags}
                          onChange={e => setDraftTags(e.target.value)}
                          placeholder="ai, productivity, systems"
                          className="w-full bg-muted/10 border border-border rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-primary/50"
                        />
                      </div>
                      <div className="flex-1 flex flex-col">
                        <label className="text-xs font-mono text-muted-foreground uppercase tracking-widest block mb-1">Content (Markdown)</label>
                        <textarea
                          ref={textareaRef}
                          value={draftContent}
                          onChange={e => setDraftContent(e.target.value)}
                          placeholder="Write in Markdown..."
                          className="flex-1 bg-muted/10 border border-border rounded p-3 text-xs font-mono outline-none focus:border-primary/50 resize-none leading-relaxed"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto p-4">
                      {selected.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-4">
                          {selected.tags.map(tag => (
                            <span key={tag} className="flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary/80">
                              <Hash size={8} /> {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      {selected.content ? (
                        <pre className="text-xs font-mono text-foreground/90 whitespace-pre-wrap leading-relaxed">
                          {selected.content}
                        </pre>
                      ) : (
                        <p className="text-xs font-mono text-muted-foreground italic">Empty note — click Edit to add content.</p>
                      )}
                      <p className="text-xs font-mono text-muted-foreground mt-6">
                        Created {timeAgo(selected.created_at)} · Updated {timeAgo(selected.updated_at)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Right panel: links + versions */}
                <div className="w-56 shrink-0 border-l border-border flex flex-col overflow-hidden">
                  {showVersions ? (
                    <div className="flex flex-col h-full">
                      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                        <span className="text-xs font-mono text-muted-foreground">Version History</span>
                        <button onClick={() => setShowVersions(false)}><X size={10} className="text-muted-foreground" /></button>
                      </div>
                      <div className="flex-1 overflow-y-auto">
                        {versions.length === 0 ? (
                          <p className="text-xs font-mono text-muted-foreground text-center py-6">No saved versions yet.</p>
                        ) : versions.map(v => (
                          <button key={v.id} onClick={() => restoreVersion(v)}
                            className="w-full text-left px-3 py-2 border-b border-border/50 hover:bg-muted/20 transition-colors">
                            <p className="text-xs font-mono font-medium">v{v.version_number}</p>
                            <p className="text-xs font-mono text-muted-foreground">{timeAgo(v.created_at)}</p>
                            <p className="text-xs font-mono text-muted-foreground truncate">{v.title}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col h-full overflow-y-auto">
                      {/* Outgoing links */}
                      <div className="px-3 py-2 border-b border-border bg-muted/5 flex items-center gap-1.5">
                        <ArrowRight size={9} className="text-primary" />
                        <span className="text-xs font-mono text-muted-foreground">Links ({outgoingLinks.length})</span>
                      </div>
                      {outgoingLinks.length === 0 ? (
                        <div className="px-3 py-3 border-b border-border/40">
                          <p className="text-xs font-mono text-muted-foreground text-center">No outgoing links.</p>
                        </div>
                      ) : outgoingLinks.map(({ link, other }) => (
                        <div key={link.id} className="px-3 py-2 border-b border-border/40 group">
                          <div className="flex items-start gap-1.5">
                            <ArrowRight size={9} className="shrink-0 mt-0.5 text-primary" />
                            <div className="flex-1 min-w-0">
                              <button onClick={() => other && loadNoteDetail(other)} className="text-xs font-mono text-foreground hover:text-primary transition-colors text-left truncate block w-full">
                                {other?.title}
                              </button>
                              <span className="text-xs font-mono text-muted-foreground">{link.type.replace(/_/g, " ")}</span>
                              {link.description && <p className="text-xs font-mono text-muted-foreground truncate">{link.description}</p>}
                            </div>
                            <button onClick={() => setConfirmDeleteLink({ id: link.id })} className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <X size={8} className="text-red-400" />
                            </button>
                          </div>
                        </div>
                      ))}

                      {/* Backlinks */}
                      <div className="px-3 py-2 border-b border-border bg-muted/5 flex items-center gap-1.5">
                        <ArrowLeft size={9} className="text-muted-foreground" />
                        <span className="text-xs font-mono text-muted-foreground">Backlinks ({backlinks.length})</span>
                      </div>
                      {backlinks.length === 0 ? (
                        <div className="px-3 py-3">
                          <p className="text-xs font-mono text-muted-foreground text-center">Nothing links here yet.</p>
                        </div>
                      ) : backlinks.map(({ link, other }) => (
                        <div key={link.id} className="px-3 py-2 border-b border-border/40 group">
                          <div className="flex items-start gap-1.5">
                            <ArrowLeft size={9} className="shrink-0 mt-0.5 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <button onClick={() => other && loadNoteDetail(other)} className="text-xs font-mono text-foreground hover:text-primary transition-colors text-left truncate block w-full">
                                {other?.title}
                              </button>
                              <span className="text-xs font-mono text-muted-foreground">{link.type.replace(/_/g, " ")} · referenced here</span>
                              {link.description && <p className="text-xs font-mono text-muted-foreground truncate">{link.description}</p>}
                            </div>
                          </div>
                        </div>
                      ))}

                      {outgoingLinks.length === 0 && backlinks.length === 0 && (
                        <div className="flex flex-col items-center gap-2 py-6 px-3">
                          <Link2 size={16} className="text-muted-foreground" />
                          <p className="text-xs font-mono text-muted-foreground text-center">No links yet. Use the Link button or ask MAVIS to link notes.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>}

      {/* ── arXiv Search Modal ── */}
      <AnimatePresence>
        {showArxiv && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowArxiv(false); }}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-background border border-border rounded-lg p-5 w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-mono font-bold flex items-center gap-2">
                  <BookOpen size={14} className="text-primary" /> arXiv Paper Search
                </h3>
                <button onClick={() => setShowArxiv(false)}><X size={14} className="text-muted-foreground" /></button>
              </div>
              <form onSubmit={e => { e.preventDefault(); searchArxiv(); }} className="flex gap-2 mb-4">
                <input
                  value={arxivQuery}
                  onChange={e => setArxivQuery(e.target.value)}
                  placeholder="Search papers… e.g. 'transformer attention mechanism'"
                  autoFocus
                  className="flex-1 bg-muted/10 border border-border rounded px-3 py-2 text-xs font-mono outline-none focus:border-primary/50"
                />
                <button type="submit" disabled={arxivLoading || !arxivQuery.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-mono bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-50">
                  {arxivLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                  Search
                </button>
              </form>
              <div className="flex-1 overflow-y-auto space-y-3">
                {arxivLoading && (
                  <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
                )}
                {!arxivLoading && arxivResults.length === 0 && arxivQuery && (
                  <p className="text-xs font-mono text-muted-foreground text-center py-8">No results — try different keywords</p>
                )}
                {!arxivLoading && arxivResults.length === 0 && !arxivQuery && (
                  <p className="text-xs font-mono text-muted-foreground text-center py-8">Search arXiv and save papers directly to your Vault</p>
                )}
                {arxivResults.map((p: any) => (
                  <div key={p.id} className="border border-border rounded-lg p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-mono font-semibold text-foreground leading-snug">{p.title}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <a href={p.arxiv_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                          <ExternalLink size={12} />
                        </a>
                        <button
                          onClick={() => saveArxivToVault(p)}
                          disabled={savingArxiv === p.id}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
                        >
                          {savingArxiv === p.id ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                          Save
                        </button>
                      </div>
                    </div>
                    <p className="text-xs font-mono text-muted-foreground">
                      {p.authors?.slice(0, 3).join(", ")}{p.authors?.length > 3 ? " et al." : ""} · {p.published ? new Date(p.published).getFullYear() : ""}
                    </p>
                    {p.primary_category && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary/80">{p.primary_category}</span>
                    )}
                    <p className="text-xs font-mono text-muted-foreground line-clamp-3 leading-relaxed">{p.abstract}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Link Modal ── */}
      <AnimatePresence>
        {showLinkModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowLinkModal(false); }}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-background border border-border rounded-lg p-5 w-full max-w-sm shadow-2xl">
              <h3 className="text-sm font-mono font-bold mb-4 flex items-center gap-2">
                <Link2 size={14} className="text-primary" /> Link Note
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-mono text-muted-foreground uppercase tracking-widest block mb-1">Target Note (type to search)</label>
                  <input value={linkTarget} onChange={e => setLinkTarget(e.target.value)}
                    placeholder="Note title..."
                    className="w-full bg-muted/10 border border-border rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-primary/50" />
                  {linkTarget && (
                    <div className="mt-1 border border-border rounded overflow-hidden max-h-28 overflow-y-auto">
                      {notes.filter(n => n.title.toLowerCase().includes(linkTarget.toLowerCase()) && n.id !== selected?.id).slice(0, 5).map(n => (
                        <button key={n.id} onClick={() => setLinkTarget(n.title)}
                          className="w-full text-left px-2 py-1.5 text-xs font-mono hover:bg-muted/30 transition-colors border-b border-border/50 last:border-0">
                          {n.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-mono text-muted-foreground uppercase tracking-widest block mb-1">Link Type</label>
                  <select value={linkType} onChange={e => setLinkType(e.target.value)}
                    className="w-full bg-muted/10 border border-border rounded px-2 py-1.5 text-xs font-mono outline-none">
                    {LINK_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-mono text-muted-foreground uppercase tracking-widest block mb-1">Description (optional)</label>
                  <input value={linkDesc} onChange={e => setLinkDesc(e.target.value)}
                    placeholder="Why are these linked?"
                    className="w-full bg-muted/10 border border-border rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-primary/50" />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={addLink} className="flex-1 py-1.5 rounded text-xs font-mono bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors">
                    Create Link
                  </button>
                  <button onClick={() => setShowLinkModal(false)} className="px-3 py-1.5 rounded text-xs font-mono border border-border text-muted-foreground hover:text-foreground transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmDeleteNote !== null}
        title={`Delete "${confirmDeleteNote?.title}"?`}
        description="This will permanently delete the note and all its links."
        onConfirm={() => {
          if (!confirmDeleteNote) return;
          deleteNote(confirmDeleteNote.id);
          setConfirmDeleteNote(null);
        }}
        onCancel={() => setConfirmDeleteNote(null)}
      />

      <ConfirmDialog
        open={confirmDeleteLink !== null}
        title="Remove this link?"
        description="This action cannot be undone."
        onConfirm={() => {
          if (!confirmDeleteLink) return;
          removeLink(confirmDeleteLink.id);
          setConfirmDeleteLink(null);
        }}
        onCancel={() => setConfirmDeleteLink(null)}
      />
    </div>
  );
}
