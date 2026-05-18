// ============================================================
// VANTARA.EXE — ContactsPage
// Real people intelligence tracker
// ============================================================
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Plus, X, Edit2, Trash2, MessageCircle, Phone, Mail, Calendar, Tag, ChevronDown, ChevronUp, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────
interface Contact {
  id: string;
  name: string;
  relationship_type: string;
  last_contact_at: string | null;
  follow_up_date: string | null;
  notes: string;
  tags: string[];
  interaction_count: number;
  created_at: string;
}

interface ContactInteraction {
  id: string;
  contact_id: string;
  interaction_type: string;
  notes: string;
  sentiment: string;
  created_at: string;
}

const RELATIONSHIP_TYPES = ["personal", "business", "family", "mentor", "other"] as const;
const INTERACTION_TYPES = ["call", "message", "meeting", "email", "note"] as const;
const SENTIMENTS = ["positive", "neutral", "negative"] as const;
const TAB_FILTERS = ["all", "personal", "business", "family", "mentor", "other"] as const;

const RELATIONSHIP_COLORS: Record<string, string> = {
  personal: "text-blue-400 border-blue-700 bg-blue-900/30",
  business: "text-amber-400 border-amber-700 bg-amber-900/30",
  family: "text-green-400 border-green-700 bg-green-900/30",
  mentor: "text-purple-400 border-purple-700 bg-purple-900/30",
  other: "text-zinc-400 border-zinc-600 bg-zinc-800/30",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "text-green-400",
  neutral: "text-muted-foreground",
  negative: "text-red-400",
};

const INTERACTION_ICONS: Record<string, typeof Phone> = {
  call: Phone,
  message: MessageCircle,
  meeting: Users,
  email: Mail,
  note: Tag,
};

function getFollowUpStatus(followUpDate: string | null): "overdue" | "soon" | null {
  if (!followUpDate) return null;
  const today = new Date();
  const due = new Date(followUpDate);
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "overdue";
  if (diffDays <= 3) return "soon";
  return null;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── ContactsPage ───────────────────────────────────────────
export function ContactsPage() {
  const { session } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [interactions, setInteractions] = useState<Record<string, ContactInteraction[]>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tabFilter, setTabFilter] = useState<string>("all");
  const [savingContact, setSavingContact] = useState(false);
  const [logContactId, setLogContactId] = useState<string | null>(null);
  const [savingInteraction, setSavingInteraction] = useState(false);

  const [form, setForm] = useState({
    name: "",
    relationship_type: "personal",
    notes: "",
    tags: "",
    follow_up_date: "",
  });

  const [interactionForm, setInteractionForm] = useState({
    interaction_type: "note",
    notes: "",
    sentiment: "neutral",
  });

  // ─── Load data ─────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    loadContacts();
  }, [session]);

  async function loadContacts() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("contacts")
      .select("*")
      .order("name", { ascending: true });
    if (error) { toast.error("Failed to load contacts"); setLoading(false); return; }
    setContacts((data as any) || []);
    setLoading(false);
  }

  async function loadInteractions(contactId: string) {
    if (interactions[contactId]) return;
    const { data } = await (supabase as any)
      .from("contact_interactions")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(20);
    setInteractions((prev) => ({ ...prev, [contactId]: (data as any) || [] }));
  }

  // ─── CRUD ──────────────────────────────────────────────────
  function resetForm() {
    setForm({ name: "", relationship_type: "personal", notes: "", tags: "", follow_up_date: "" });
    setEditingId(null);
    setShowCreate(false);
  }

  function handleEdit(c: Contact) {
    setForm({
      name: c.name,
      relationship_type: c.relationship_type,
      notes: c.notes || "",
      tags: (c.tags || []).join(", "),
      follow_up_date: c.follow_up_date || "",
    });
    setEditingId(c.id);
    setShowCreate(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSavingContact(true);
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    const payload = {
      name: form.name.trim(),
      relationship_type: form.relationship_type,
      notes: form.notes,
      tags,
      follow_up_date: form.follow_up_date || null,
      updated_at: new Date().toISOString(),
    };
    if (editingId) {
      const { error } = await (supabase as any).from("contacts").update(payload).eq("id", editingId);
      if (error) { toast.error("Failed to update contact"); setSavingContact(false); return; }
      toast.success("Contact updated");
    } else {
      const { error } = await (supabase as any).from("contacts").insert({ ...payload, user_id: session!.user.id });
      if (error) { toast.error("Failed to create contact"); setSavingContact(false); return; }
      toast.success("Contact added");
    }
    setSavingContact(false);
    resetForm();
    loadContacts();
  }

  async function handleDelete(id: string) {
    const { error } = await (supabase as any).from("contacts").delete().eq("id", id);
    if (error) { toast.error("Failed to delete contact"); return; }
    toast.success("Contact deleted");
    setContacts((prev) => prev.filter((c) => c.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  async function handleLogInteraction(contactId: string) {
    if (!interactionForm.notes.trim()) return;
    setSavingInteraction(true);
    const { error } = await (supabase as any).from("contact_interactions").insert({
      user_id: session!.user.id,
      contact_id: contactId,
      interaction_type: interactionForm.interaction_type,
      notes: interactionForm.notes.trim(),
      sentiment: interactionForm.sentiment,
    });
    if (error) { toast.error("Failed to log interaction"); setSavingInteraction(false); return; }

    // bump interaction_count + last_contact_at
    await (supabase as any).from("contacts").update({
      interaction_count: (contacts.find((c) => c.id === contactId)?.interaction_count || 0) + 1,
      last_contact_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", contactId);

    toast.success("Interaction logged");
    setInteractionForm({ interaction_type: "note", notes: "", sentiment: "neutral" });
    setLogContactId(null);
    setSavingInteraction(false);
    // refresh interactions cache
    setInteractions((prev) => {
      const existing = prev[contactId] || [];
      return {
        ...prev,
        [contactId]: [
          { id: crypto.randomUUID(), contact_id: contactId, ...interactionForm, notes: interactionForm.notes.trim(), created_at: new Date().toISOString() },
          ...existing,
        ],
      };
    });
    loadContacts();
  }

  // ─── Filtering ─────────────────────────────────────────────
  const filtered = contacts.filter((c) => {
    const matchTab = tabFilter === "all" || c.relationship_type === tabFilter;
    const matchSearch = !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchTab && matchSearch;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader
        title="Contacts"
        subtitle="Real people intelligence"
        icon={<Users size={18} />}
        actions={
          <button
            onClick={() => { resetForm(); setShowCreate(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
          >
            <Plus size={12} /> New Contact
          </button>
        }
      />

      {/* Create/Edit Form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <HudCard className="border-primary/20">
              <p className="text-[9px] font-mono text-primary uppercase tracking-widest mb-3">
                {editingId ? "Edit Contact" : "New Contact"}
              </p>
              <div className="space-y-2">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Full name..."
                  className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={form.relationship_type}
                    onChange={(e) => setForm((f) => ({ ...f, relationship_type: e.target.value }))}
                    className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none"
                  >
                    {RELATIONSHIP_TYPES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                  <input
                    type="date"
                    value={form.follow_up_date}
                    onChange={(e) => setForm((f) => ({ ...f, follow_up_date: e.target.value }))}
                    className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none"
                  />
                </div>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Notes about this person..."
                  rows={3}
                  className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-primary/40"
                />
                <input
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="Tags (comma-separated)"
                  className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={resetForm} className="px-3 py-1.5 text-xs font-mono text-muted-foreground border border-border rounded hover:bg-muted/30">
                    Cancel
                  </button>
                  <button onClick={handleSave} disabled={savingContact} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50">
                    {savingContact && <Loader2 size={10} className="animate-spin" />}
                    {editingId ? "Save" : "Add Contact"}
                  </button>
                </div>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search + Tab filters */}
      <div className="space-y-2">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search contacts..."
          className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40"
        />
        <div className="flex gap-1.5 flex-wrap">
          {TAB_FILTERS.map((tab) => (
            <button
              key={tab}
              onClick={() => setTabFilter(tab)}
              className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest rounded border transition-colors ${
                tabFilter === tab
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:border-border/60 hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-3 text-[10px] font-mono text-muted-foreground">
        <span>{filtered.length} contacts</span>
        <span className="text-amber-400">
          {filtered.filter((c) => getFollowUpStatus(c.follow_up_date) !== null).length} need follow-up
        </span>
      </div>

      {/* Contacts grid */}
      {filtered.length === 0 ? (
        <HudCard>
          <p className="text-xs font-mono text-muted-foreground text-center py-6">No contacts found. Add your first one.</p>
        </HudCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((c, i) => {
            const isExpanded = expandedId === c.id;
            const followUpStatus = getFollowUpStatus(c.follow_up_date);
            const relColor = RELATIONSHIP_COLORS[c.relationship_type] ?? RELATIONSHIP_COLORS.other;

            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <HudCard className={`transition-all ${isExpanded ? "border-primary/30" : ""}`}>
                  {/* Card header */}
                  <div
                    className="cursor-pointer"
                    onClick={() => {
                      setExpandedId(isExpanded ? null : c.id);
                      if (!isExpanded) loadInteractions(c.id);
                    }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-display font-bold truncate">{c.name}</h3>
                          <span className={`text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border ${relColor}`}>
                            {c.relationship_type}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2 shrink-0">
                        {c.interaction_count > 0 && (
                          <span className="text-[9px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                            {c.interaction_count}x
                          </span>
                        )}
                        {isExpanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                      </div>
                    </div>

                    {/* Follow-up warning */}
                    {followUpStatus && (
                      <div className={`flex items-center gap-1 mb-2 text-[9px] font-mono ${followUpStatus === "overdue" ? "text-amber-400" : "text-amber-300"}`}>
                        <AlertTriangle size={10} />
                        {followUpStatus === "overdue" ? "Overdue follow-up" : "Follow-up due soon"}: {formatDate(c.follow_up_date)}
                      </div>
                    )}

                    {/* Last contact */}
                    <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                      <Calendar size={9} />
                      Last contact: {formatDate(c.last_contact_at)}
                    </div>

                    {/* Tags */}
                    {c.tags && c.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1.5">
                        {c.tags.map((t) => (
                          <span key={t} className="text-[8px] font-mono text-muted-foreground bg-muted/30 px-1 py-0.5 rounded">
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Expanded section */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 pt-3 border-t border-border/30 space-y-3">
                          {/* Notes */}
                          {c.notes && (
                            <div>
                              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Notes</p>
                              <p className="text-xs text-foreground/80 whitespace-pre-wrap">{c.notes}</p>
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEdit(c)}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-muted-foreground border border-border rounded hover:text-foreground hover:border-border/60 transition-colors"
                            >
                              <Edit2 size={9} /> Edit
                            </button>
                            <button
                              onClick={() => setLogContactId(logContactId === c.id ? null : c.id)}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-muted-foreground border border-border rounded hover:text-foreground hover:border-border/60 transition-colors"
                            >
                              <MessageCircle size={9} /> Log Interaction
                            </button>
                            <button
                              onClick={() => handleDelete(c.id)}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-red-400/70 border border-red-900/30 rounded hover:text-red-400 hover:border-red-700/40 transition-colors ml-auto"
                            >
                              <Trash2 size={9} /> Delete
                            </button>
                          </div>

                          {/* Log Interaction form */}
                          <AnimatePresence>
                            {logContactId === c.id && (
                              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <div className="bg-muted/10 border border-border/30 rounded p-3 space-y-2">
                                  <p className="text-[9px] font-mono text-primary uppercase tracking-widest">Log Interaction</p>
                                  <div className="grid grid-cols-2 gap-2">
                                    <select
                                      value={interactionForm.interaction_type}
                                      onChange={(e) => setInteractionForm((f) => ({ ...f, interaction_type: e.target.value }))}
                                      className="bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none"
                                    >
                                      {INTERACTION_TYPES.map((t) => <option key={t}>{t}</option>)}
                                    </select>
                                    <select
                                      value={interactionForm.sentiment}
                                      onChange={(e) => setInteractionForm((f) => ({ ...f, sentiment: e.target.value }))}
                                      className="bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none"
                                    >
                                      {SENTIMENTS.map((s) => <option key={s}>{s}</option>)}
                                    </select>
                                  </div>
                                  <textarea
                                    value={interactionForm.notes}
                                    onChange={(e) => setInteractionForm((f) => ({ ...f, notes: e.target.value }))}
                                    placeholder="What happened?"
                                    rows={2}
                                    className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs resize-none focus:outline-none focus:border-primary/40"
                                  />
                                  <div className="flex gap-2 justify-end">
                                    <button onClick={() => setLogContactId(null)} className="px-2 py-1 text-[10px] font-mono text-muted-foreground border border-border rounded">
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => handleLogInteraction(c.id)}
                                      disabled={savingInteraction}
                                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
                                    >
                                      {savingInteraction && <Loader2 size={9} className="animate-spin" />}
                                      Log
                                    </button>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Interaction history */}
                          {interactions[c.id] && interactions[c.id].length > 0 && (
                            <div>
                              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">History</p>
                              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                {interactions[c.id].map((ix) => {
                                  const Icon = INTERACTION_ICONS[ix.interaction_type] ?? Tag;
                                  return (
                                    <div key={ix.id} className="flex gap-2 text-[10px] font-mono">
                                      <Icon size={9} className="text-muted-foreground mt-0.5 shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <span className={`${SENTIMENT_COLORS[ix.sentiment]} mr-1`}>[{ix.interaction_type}]</span>
                                        <span className="text-foreground/70">{ix.notes}</span>
                                      </div>
                                      <span className="text-muted-foreground/50 shrink-0">{formatDate(ix.created_at)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </HudCard>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
