// ============================================================
// VANTARA.EXE — ContactsPage
// Real people intelligence tracker
// ============================================================
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Plus, X, Edit2, Trash2, MessageCircle, Phone, Mail, Calendar, Tag, ChevronDown, ChevronUp, Loader2, AlertTriangle, Building2, Copy } from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";

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
  // Present on the live table (the Gmail sync fills them) but missing here, so they were never shown.
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  source?: string | null;
  pipeline_stage?: string | null;
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
const EMPTY_FORM = { name: "", relationship_type: "personal", email: "", phone: "", company: "", notes: "", tags: "", follow_up_date: "" };

const SORTS: Record<string, string> = {
  name: "Name A–Z", recent: "Recently contacted", followup: "Follow-up soonest", interactions: "Most interactions", newest: "Newest added",
};

const RELATIONSHIP_COLORS: Record<string, string> = {
  personal: "text-blue-400 border-blue-700 bg-blue-900/30",
  business: "text-amber-400 border-amber-700 bg-amber-900/30",
  family: "text-green-400 border-green-700 bg-green-900/30",
  mentor: "text-purple-400 border-purple-700 bg-purple-900/30",
  other: "text-zinc-400 border-zinc-600 bg-zinc-800/30",
  // Types that exist in the data but the page did not know, so they all rendered grey and had no filter tab.
  ally: "text-emerald-400 border-emerald-700 bg-emerald-900/30",
  partner: "text-cyan-400 border-cyan-700 bg-cyan-900/30",
  professional: "text-sky-400 border-sky-700 bg-sky-900/30",
  prospect: "text-orange-400 border-orange-700 bg-orange-900/30",
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
  const { lastActionTs } = useAppData();
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
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [sortBy, setSortBy] = useState<string>("name");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const [interactionForm, setInteractionForm] = useState({
    interaction_type: "note",
    notes: "",
    sentiment: "neutral",
  });

  // ─── Load data ─────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    loadContacts();
  }, [session, lastActionTs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadContacts() {
    setLoading(true);
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .order("name", { ascending: true });
    if (error) { toast.error("Failed to load contacts"); setLoading(false); return; }
    setContacts(data || []);
    setLoading(false);
  }

  async function loadInteractions(contactId: string) {
    if (interactions[contactId]) return;
    const { data } = await supabase
      .from("contact_interactions")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(20);
    setInteractions((prev) => ({ ...prev, [contactId]: data || [] }));
  }

  // ─── CRUD ──────────────────────────────────────────────────
  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowCreate(false);
  }

  function handleEdit(c: Contact) {
    setForm({
      name: c.name,
      relationship_type: c.relationship_type,
      email: c.email || "",
      phone: c.phone || "",
      company: c.company || "",
      notes: c.notes || "",
      tags: (c.tags || []).join(", "),
      follow_up_date: c.follow_up_date || "",
    });
    setEditingId(c.id);
    // ensure the card is expanded so the inline form is visible
    setExpandedId(c.id);
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSavingContact(true);
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    const payload = {
      name: form.name.trim(),
      relationship_type: form.relationship_type,
      email: form.email.trim().toLowerCase() || null,
      phone: form.phone.trim() || null,
      company: form.company.trim() || null,
      notes: form.notes,
      tags,
      follow_up_date: form.follow_up_date || null,
      updated_at: new Date().toISOString(),
    };
    if (editingId) {
      const savedId = editingId;
      const { error } = await supabase.from("contacts").update(payload).eq("id", savedId);
      if (error) { toast.error("Failed to update contact"); setSavingContact(false); return; }
      toast.success("Contact updated");
      setSavingContact(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      setExpandedId(savedId); // keep the card open after saving
      loadContacts();
    } else {
      const { error } = await supabase.from("contacts").insert({ ...payload, user_id: session!.user.id });
      if (error) { toast.error("Failed to create contact"); setSavingContact(false); return; }
      toast.success("Contact added");
      setSavingContact(false);
      resetForm();
      loadContacts();
    }
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) { toast.error("Failed to delete contact"); return; }
    toast.success("Contact deleted");
    setContacts((prev) => prev.filter((c) => c.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  async function handleLogInteraction(contactId: string) {
    if (!interactionForm.notes.trim()) return;
    setSavingInteraction(true);
    const { error } = await supabase.from("contact_interactions").insert({
      user_id: session!.user.id,
      contact_id: contactId,
      interaction_type: interactionForm.interaction_type,
      notes: interactionForm.notes.trim(),
      sentiment: interactionForm.sentiment,
    });
    if (error) { toast.error("Failed to log interaction"); setSavingInteraction(false); return; }

    // bump interaction_count + last_contact_at
    await supabase.from("contacts").update({
      interaction_count: (contacts.find((c) => c.id === contactId)?.interaction_count || 0) + 1,
      last_contact_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", contactId).eq("user_id", session!.user.id);

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
  // Tabs come from the data: a relationship type that exists must be reachable.
  const typeCounts = contacts.reduce<Record<string, number>>((m, c) => { const t = c.relationship_type || "other"; m[t] = (m[t] ?? 0) + 1; return m; }, {});
  const typeTabs = ["all", ...Object.keys(typeCounts).sort((x, y) => typeCounts[y] - typeCounts[x])];
  const sources = Array.from(new Set(contacts.map((c) => c.source || "manual")));
  const relOptions = Array.from(new Set([...RELATIONSHIP_TYPES, ...Object.keys(typeCounts), form.relationship_type].filter(Boolean)));

  const q = searchQuery.trim().toLowerCase();
  const filtered = contacts
    .filter((c) => {
      const matchTab = tabFilter === "all" || (c.relationship_type || "other") === tabFilter;
      const matchSource = sourceFilter === "all" || (c.source || "manual") === sourceFilter;
      const matchSearch = !q || [c.name, c.email, c.company, c.phone, c.notes, (c.tags ?? []).join(" ")].some((v) => String(v ?? "").toLowerCase().includes(q));
      return matchTab && matchSource && matchSearch;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "recent": return (b.last_contact_at ?? "").localeCompare(a.last_contact_at ?? "");
        case "followup": return (a.follow_up_date ?? "9999").localeCompare(b.follow_up_date ?? "9999");
        case "interactions": return (b.interaction_count ?? 0) - (a.interaction_count ?? 0);
        case "newest": return (b.created_at ?? "").localeCompare(a.created_at ?? "");
        default: return a.name.localeCompare(b.name);
      }
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
              <p className="text-xs font-mono text-primary uppercase tracking-widest mb-3">
                {editingId ? "Edit Contact" : "New Contact"}
              </p>
              <div className="space-y-2">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Full name..."
                  className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40"
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email" type="email" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40" />
                  <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40" />
                  <input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder="Company" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={form.relationship_type}
                    onChange={(e) => setForm((f) => ({ ...f, relationship_type: e.target.value }))}
                    className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none"
                  >
                    {relOptions.map((r) => <option key={r}>{r}</option>)}
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

      {/* Search + sort + source + type tabs */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, email, company, notes, tags..."
            className="flex-1 bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40"
          />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none" aria-label="Sort contacts">
            {Object.entries(SORTS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {sources.length > 1 && (
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none" aria-label="Filter by source">
              <option value="all">All sources</option>
              {sources.map((src) => <option key={src} value={src}>{src}</option>)}
            </select>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {typeTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setTabFilter(tab)}
              className={`px-2.5 py-1 text-xs font-mono uppercase tracking-widest rounded border transition-colors ${
                tabFilter === tab
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:border-border/60 hover:text-foreground"
              }`}
            >
              {tab}{tab !== "all" && <span className="ml-1 opacity-60">{typeCounts[tab]}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-3 text-xs font-mono text-muted-foreground">
        <span>{filtered.length} contacts</span>
        <span className="text-amber-400">
          {filtered.filter((c) => getFollowUpStatus(c.follow_up_date) !== null).length} need follow-up
        </span>
        {filtered.some((c) => c.source === "gmail") && <span>{filtered.filter((c) => c.source === "gmail").length} from Gmail</span>}
      </div>

      {/* Contacts grid */}
      {filtered.length === 0 ? (
        <HudCard>
          <p className="text-xs font-mono text-muted-foreground text-center py-6">{contacts.length === 0 ? "No contacts yet. Add your first one." : "No contacts match these filters."}</p>
        </HudCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((c, i) => {
            const isExpanded = expandedId === c.id;
            const followUpStatus = getFollowUpStatus(c.follow_up_date);
            const relColor = RELATIONSHIP_COLORS[c.relationship_type || "other"] ?? RELATIONSHIP_COLORS.other;

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
                          <span className={`text-xs font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border ${relColor}`}>
                            {c.relationship_type || "other"}
                          </span>
                          {c.source === "gmail" && <span className="text-xs font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-red-900/40 text-red-300/80 bg-red-950/20">gmail</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2 shrink-0">
                        {c.interaction_count > 0 && (
                          <span className="text-xs font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                            {c.interaction_count}x
                          </span>
                        )}
                        {isExpanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                      </div>
                    </div>

                    {/* Follow-up warning */}
                    {followUpStatus && (
                      <div className={`flex items-center gap-1 mb-2 text-xs font-mono ${followUpStatus === "overdue" ? "text-amber-400" : "text-amber-300"}`}>
                        <AlertTriangle size={10} />
                        {followUpStatus === "overdue" ? "Overdue follow-up" : "Follow-up due soon"}: {formatDate(c.follow_up_date)}
                      </div>
                    )}

                    {/* Who they are: company, email, phone (these were never shown) */}
                    {(c.company || c.email || c.phone) && (
                      <div className="mb-1.5 space-y-0.5 text-xs font-mono text-muted-foreground">
                        {c.company && <div className="flex items-center gap-1"><Building2 size={9} className="shrink-0" /><span className="truncate">{c.company}</span></div>}
                        {c.email && <div className="flex items-center gap-1"><Mail size={9} className="shrink-0" /><span className="truncate">{c.email}</span></div>}
                        {c.phone && <div className="flex items-center gap-1"><Phone size={9} className="shrink-0" /><span className="truncate">{c.phone}</span></div>}
                      </div>
                    )}

                    {/* Last contact */}
                    <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                      <Calendar size={9} />
                      Last contact: {formatDate(c.last_contact_at)}
                    </div>

                    {c.notes && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{c.notes}</p>}

                    {/* Tags */}
                    {c.tags && c.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1.5">
                        {c.tags.map((t) => (
                          <span key={t} className="text-xs font-mono text-muted-foreground bg-muted/30 px-1 py-0.5 rounded">
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
                          {/* Details */}
                          {(c.email || c.phone || c.company || c.pipeline_stage) && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-xs font-mono">
                              {c.email && <div><span className="text-muted-foreground">Email: </span><span className="text-foreground break-all">{c.email}</span></div>}
                              {c.phone && <div><span className="text-muted-foreground">Phone: </span><span className="text-foreground">{c.phone}</span></div>}
                              {c.company && <div><span className="text-muted-foreground">Company: </span><span className="text-foreground">{c.company}</span></div>}
                              {c.pipeline_stage && <div><span className="text-muted-foreground">Stage: </span><span className="text-foreground">{c.pipeline_stage}</span></div>}
                              <div><span className="text-muted-foreground">Added: </span><span className="text-foreground">{formatDate(c.created_at)}{c.source ? ` · ${c.source}` : ""}</span></div>
                            </div>
                          )}

                          {/* Notes */}
                          {c.notes && (
                            <div>
                              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">Notes</p>
                              <p className="text-xs text-foreground whitespace-pre-wrap">{c.notes}</p>
                            </div>
                          )}

                          {/* Inline edit form */}
                          {editingId === c.id ? (
                            <div className="bg-muted/10 border border-primary/20 rounded p-3 space-y-2">
                              <p className="text-xs font-mono text-primary uppercase tracking-widest">Edit Contact</p>
                              <input
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="Full name..."
                                className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40"
                              />
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email" type="email" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40" />
                                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40" />
                                <input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder="Company" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40" />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <select
                                  value={form.relationship_type}
                                  onChange={(e) => setForm((f) => ({ ...f, relationship_type: e.target.value }))}
                                  className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none"
                                >
                                  {relOptions.map((r) => <option key={r}>{r}</option>)}
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
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                          /* Actions */
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEdit(c)}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-muted-foreground border border-border rounded hover:text-foreground hover:border-border/60 transition-colors"
                            >
                              <Edit2 size={9} /> Edit
                            </button>
                            {c.email && (
                              <a href={`mailto:${c.email}`} className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-muted-foreground border border-border rounded hover:text-foreground hover:border-border/60 transition-colors">
                                <Mail size={9} /> Email
                              </a>
                            )}
                            {c.phone && (
                              <a href={`tel:${c.phone}`} className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-muted-foreground border border-border rounded hover:text-foreground hover:border-border/60 transition-colors">
                                <Phone size={9} /> Call
                              </a>
                            )}
                            {c.email && (
                              <button onClick={() => { navigator.clipboard?.writeText(c.email!).then(() => toast.success("Email copied"), () => toast.error("Couldn't copy")); }} className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-muted-foreground border border-border rounded hover:text-foreground hover:border-border/60 transition-colors" title="Copy email">
                                <Copy size={9} /> Copy
                              </button>
                            )}
                            <button
                              onClick={() => setLogContactId(logContactId === c.id ? null : c.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-muted-foreground border border-border rounded hover:text-foreground hover:border-border/60 transition-colors"
                            >
                              <MessageCircle size={9} /> Log Interaction
                            </button>
                            <button
                              onClick={() => setConfirmDelete({ id: c.id, label: c.name })}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-red-400/70 border border-red-900/30 rounded hover:text-red-400 hover:border-red-700/40 transition-colors ml-auto"
                            >
                              <Trash2 size={9} /> Delete
                            </button>
                          </div>
                          )}

                          {/* Log Interaction form */}
                          <AnimatePresence>
                            {logContactId === c.id && (
                              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <div className="bg-muted/10 border border-border/30 rounded p-3 space-y-2">
                                  <p className="text-xs font-mono text-primary uppercase tracking-widest">Log Interaction</p>
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
                                    <button onClick={() => setLogContactId(null)} className="px-2 py-1 text-xs font-mono text-muted-foreground border border-border rounded">
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => handleLogInteraction(c.id)}
                                      disabled={savingInteraction}
                                      className="flex items-center gap-1 px-2 py-1 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
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
                              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">History</p>
                              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                {interactions[c.id].map((ix) => {
                                  const Icon = INTERACTION_ICONS[ix.interaction_type] ?? Tag;
                                  return (
                                    <div key={ix.id} className="flex gap-2 text-xs font-mono">
                                      <Icon size={9} className="text-muted-foreground mt-0.5 shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <span className={`${SENTIMENT_COLORS[ix.sentiment]} mr-1`}>[{ix.interaction_type}]</span>
                                        <span className="text-muted-foreground">{ix.notes}</span>
                                      </div>
                                      <span className="text-muted-foreground shrink-0">{formatDate(ix.created_at)}</span>
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
