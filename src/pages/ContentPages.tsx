// ============================================================
// VANTARA.EXE — Journal, VaultCodex, SkillsPage, InventoryPage
// All with full edit/modify support + auto-seed for skills
// ============================================================
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BookOpen, BookLock, Sparkles, Package, Plus, Trash2, Loader2, Star, Edit2 } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard, RarityBadge, ProgressBar } from "@/components/SharedUI";

// ─── JournalPage ───────────────────────────────────────────
export function JournalPage() {
  const { journalEntries, journalLoading, createJournalEntry, updateJournalEntry, deleteJournalEntry, awardXP, logActivity } = useAppData();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", content: "", category: "personal", importance: "medium", mood: "", tags: "" });

  const resetForm = () => {
    setForm({ title: "", content: "", category: "personal", importance: "medium", mood: "", tags: "" });
    setEditingId(null);
    setShowCreate(false);
  };

  const handleEdit = (e: any) => {
    setForm({ title: e.title, content: e.content, category: e.category, importance: e.importance, mood: e.mood || "", tags: (e.tags || []).join(", ") });
    setEditingId(e.id);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (editingId) {
      await updateJournalEntry(editingId, { ...form, tags, mood: form.mood || null });
    } else {
      const entry = await createJournalEntry({ ...form, tags, mood: form.mood || null, xp_earned: 10 });
      if (entry) {
        await awardXP(10);
        await logActivity("journal_entry", `Journal: ${form.title}`, 10);
      }
    }
    resetForm();
  };

  const importanceColors: Record<string, string> = { low: "text-muted-foreground", medium: "text-blue-400", high: "text-amber-400", critical: "text-red-400" };

  if (journalLoading) return <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin text-primary" size={24} /></div>;

  return (
    <div className="space-y-5">
      <PageHeader title="Journal" subtitle={`${journalEntries.length} entries logged`} icon={<BookOpen size={18} />}
        actions={<button onClick={() => { resetForm(); setShowCreate(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded"><Plus size={12} /> New Entry</button>}
      />
      {showCreate && (
        <HudCard className="border-primary/20">
          <p className="text-[9px] font-mono text-primary uppercase tracking-widest mb-3">{editingId ? "Edit Entry" : "New Entry"}</p>
          <div className="space-y-2">
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title..." className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
            <textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} placeholder="Entry content..." rows={4} className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-sm font-body resize-none focus:outline-none focus:border-primary/40" />
            <div className="grid grid-cols-3 gap-2">
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                {["personal", "business", "fitness", "legal", "reflection"].map((c) => <option key={c}>{c}</option>)}
              </select>
              <select value={form.importance} onChange={(e) => setForm((f) => ({ ...f, importance: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                {["low", "medium", "high", "critical"].map((i) => <option key={i}>{i}</option>)}
              </select>
              <input value={form.mood} onChange={(e) => setForm((f) => ({ ...f, mood: e.target.value }))} placeholder="Mood" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
            </div>
            <input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="Tags (comma-separated)" className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
            <div className="flex gap-2 justify-end">
              <button onClick={resetForm} className="px-3 py-1.5 text-xs font-mono text-muted-foreground border border-border rounded">Cancel</button>
              <button onClick={handleSave} className="px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded">{editingId ? "Save" : "Log Entry (+10 XP)"}</button>
            </div>
          </div>
        </HudCard>
      )}
      <div className="space-y-2">
        {journalEntries.map((e, i) => {
          const isExpanded = expandedId === e.id;
          return (
          <motion.div key={e.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
            <HudCard className={`cursor-pointer transition-all ${isExpanded ? "border-primary/30" : ""}`}>
              <div onClick={() => setExpandedId(isExpanded ? null : e.id)}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="text-sm font-display font-bold">{e.title}</h3>
                      <span className={`text-[9px] font-mono uppercase ${importanceColors[e.importance]}`}>{e.importance}</span>
                      <span className="text-[9px] font-mono text-muted-foreground">{e.category}</span>
                    </div>
                    {e.content && <p className={`text-xs font-body text-muted-foreground ${isExpanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}>{e.content}</p>}
                    {isExpanded && (
                      <div className="mt-3 space-y-1.5 border-t border-border/30 pt-2">
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                          <div><span className="text-muted-foreground">Category:</span> <span className="text-foreground">{e.category}</span></div>
                          <div><span className="text-muted-foreground">Importance:</span> <span className={importanceColors[e.importance]}>{e.importance}</span></div>
                          {e.mood && <div><span className="text-muted-foreground">Mood:</span> <span className="text-foreground">{e.mood}</span></div>}
                          <div><span className="text-muted-foreground">XP Earned:</span> <span className="text-green-400">+{e.xp_earned}</span></div>
                          <div className="col-span-2"><span className="text-muted-foreground">Created:</span> <span className="text-foreground">{new Date(e.created_at).toLocaleString()}</span></div>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {e.tags.map((t) => (
                        <span key={t} className="text-[8px] font-mono text-primary/60 border border-primary/20 rounded px-1.5 py-0.5">#{t}</span>
                      ))}
                      {!isExpanded && e.mood && <span className="text-[9px] font-mono text-muted-foreground ml-auto">mood: {e.mood}</span>}
                      {!isExpanded && <span className="text-[9px] font-mono text-muted-foreground">{new Date(e.created_at).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0" onClick={(ev) => ev.stopPropagation()}>
                    <span className="text-[10px] font-mono text-green-400">+{e.xp_earned} XP</span>
                    <button onClick={() => handleEdit(e)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Edit2 size={12} /></button>
                    <button onClick={() => deleteJournalEntry(e.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={12} /></button>
                  </div>
                </div>
              </div>
            </HudCard>
          </motion.div>
          );
        })}
        {journalEntries.length === 0 && <p className="text-xs font-mono text-muted-foreground text-center py-8">No journal entries yet. Start logging your arc.</p>}
      </div>
    </div>
  );
}

// ─── VaultCodexPage ────────────────────────────────────────
export function VaultCodexPage() {
  const { vaultEntries, vaultLoading, createVaultEntry, updateVaultEntry, deleteVaultEntry } = useAppData();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState("all");
  const [form, setForm] = useState({ title: "", content: "", category: "personal", importance: "medium" });

  const categories = ["all", "legal", "business", "personal", "evidence", "achievement"];
  const filtered = vaultEntries.filter((e) => catFilter === "all" || e.category === catFilter);
  const importanceBorder: Record<string, string> = { critical: "border-red-700/50", high: "border-amber-700/50", medium: "border-border", low: "border-border/50" };
  const importanceColor: Record<string, string> = { critical: "text-red-400", high: "text-amber-400", medium: "text-blue-400", low: "text-muted-foreground" };

  const resetForm = () => { setForm({ title: "", content: "", category: "personal", importance: "medium" }); setEditingId(null); setShowCreate(false); };

  const handleEdit = (e: any) => {
    setForm({ title: e.title, content: e.content, category: e.category, importance: e.importance });
    setEditingId(e.id);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    if (editingId) {
      await updateVaultEntry(editingId, form);
    } else {
      await createVaultEntry({ ...form, attachments: [] });
    }
    resetForm();
  };

  if (vaultLoading) return <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin text-primary" size={24} /></div>;

  return (
    <div className="space-y-5">
      <PageHeader title="Vault Codex" subtitle="Classified knowledge & evidence repository" icon={<BookLock size={18} />}
        actions={<button onClick={() => { resetForm(); setShowCreate(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded"><Plus size={12} /> New Entry</button>}
      />
      {showCreate && (
        <HudCard className="border-primary/20">
          <p className="text-[9px] font-mono text-primary uppercase tracking-widest mb-3">{editingId ? "Edit Entry" : "New Entry"}</p>
          <div className="space-y-2">
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Entry title..." className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
            <textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} placeholder="Vault content (evidence, notes, data)..." rows={4} className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-sm resize-none focus:outline-none" />
            <div className="grid grid-cols-2 gap-2">
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                {["legal", "business", "personal", "evidence", "achievement"].map((c) => <option key={c}>{c}</option>)}
              </select>
              <select value={form.importance} onChange={(e) => setForm((f) => ({ ...f, importance: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                {["low", "medium", "high", "critical"].map((i) => <option key={i}>{i}</option>)}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={resetForm} className="px-3 py-1.5 text-xs font-mono text-muted-foreground border border-border rounded">Cancel</button>
              <button onClick={handleSave} className="px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded">{editingId ? "Save" : "Store"}</button>
            </div>
          </div>
        </HudCard>
      )}
      <div className="flex gap-1.5 flex-wrap">
        {categories.map((c) => (
          <button key={c} onClick={() => setCatFilter(c)} className={`px-2 py-1 text-[10px] font-mono uppercase rounded border transition-all ${catFilter === c ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground"}`}>{c}</button>
        ))}
      </div>
      <div className="space-y-2">
        {filtered.map((e) => {
          const isExpanded = expandedId === e.id;
          return (
          <HudCard key={e.id} className={`cursor-pointer transition-all ${importanceBorder[e.importance]} ${isExpanded ? "border-primary/30" : ""}`}>
            <div onClick={() => setExpandedId(isExpanded ? null : e.id)}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-display font-bold">{e.title}</h3>
                    <span className={`text-[9px] font-mono uppercase ${importanceColor[e.importance]}`}>{e.importance}</span>
                    <span className="text-[9px] font-mono text-muted-foreground">{e.category}</span>
                  </div>
                  {e.content && <p className={`text-xs font-body text-muted-foreground ${isExpanded ? "whitespace-pre-wrap" : "line-clamp-3"}`}>{e.content}</p>}
                  {isExpanded && (
                    <div className="mt-3 space-y-1.5 border-t border-border/30 pt-2">
                      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                        <div><span className="text-muted-foreground">Category:</span> <span className="text-foreground">{e.category}</span></div>
                        <div><span className="text-muted-foreground">Importance:</span> <span className={importanceColor[e.importance]}>{e.importance}</span></div>
                        {e.attachments?.length > 0 && <div className="col-span-2"><span className="text-muted-foreground">Attachments:</span> <span className="text-foreground">{e.attachments.length} files</span></div>}
                        <div className="col-span-2"><span className="text-muted-foreground">Created:</span> <span className="text-foreground">{new Date(e.created_at).toLocaleString()}</span></div>
                        {e.updated_at !== e.created_at && <div className="col-span-2"><span className="text-muted-foreground">Updated:</span> <span className="text-foreground">{new Date(e.updated_at).toLocaleString()}</span></div>}
                      </div>
                    </div>
                  )}
                  {!isExpanded && <p className="text-[9px] font-mono text-muted-foreground/50 mt-1.5">{new Date(e.created_at).toLocaleDateString()}</p>}
                </div>
                <div className="flex flex-col gap-1 shrink-0" onClick={(ev) => ev.stopPropagation()}>
                  <button onClick={() => handleEdit(e)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Edit2 size={12} /></button>
                  <button onClick={() => deleteVaultEntry(e.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          </HudCard>
          );
        })}
        {filtered.length === 0 && <p className="text-xs font-mono text-muted-foreground text-center py-8">Vault empty — classified knowledge awaits.</p>}
      </div>
    </div>
  );
}

// ─── SkillsPage ────────────────────────────────────────────

const DEFAULT_SKILLS = [
  // Combat
  { name: "Striking Mastery", description: "Precision and power in unarmed combat. Muay Thai, boxing, karate foundations.", category: "Combat", energy_type: "Ki", tier: 3, proficiency: 65 },
  { name: "Grappling Arts", description: "Control on the ground. BJJ, wrestling, joint locks and positional dominance.", category: "Combat", energy_type: "Ki", tier: 2, proficiency: 45 },
  { name: "Weapon Proficiency", description: "Mastery of blade, staff, and improvised weapons. Kali/Escrima base.", category: "Combat", energy_type: "Ki", tier: 2, proficiency: 40 },
  { name: "Combat Strategy", description: "Reading opponents, timing attacks, controlling distance and pace.", category: "Combat", energy_type: "Aura", tier: 4, proficiency: 70 },
  { name: "Domain Expansion", description: "Project overwhelming presence — control the space, control the fight.", category: "Combat", energy_type: "Cursed Energy", tier: 5, proficiency: 55 },

  // Mental
  { name: "Strategic Thinking", description: "Long-term planning, systems design, seeing 5 moves ahead.", category: "Mental", energy_type: "Aura", tier: 5, proficiency: 85 },
  { name: "Pattern Recognition", description: "Rapidly identify recurring patterns in data, behavior, and markets.", category: "Mental", energy_type: "Nen", tier: 4, proficiency: 72 },
  { name: "Emotional Alchemy", description: "Transform negative emotions into fuel. Rage → focus, fear → clarity.", category: "Mental", energy_type: "Cursed Energy", tier: 4, proficiency: 68 },
  { name: "Deep Focus", description: "Enter and sustain flow state for extended periods.", category: "Mental", energy_type: "Mana", tier: 3, proficiency: 60 },
  { name: "Memory Palace", description: "Advanced recall through spatial memory architecture.", category: "Mental", energy_type: "Mana", tier: 3, proficiency: 50 },
  { name: "Speed Reading", description: "Process written information at 3-5x normal speed with full comprehension.", category: "Mental", energy_type: "Nen", tier: 2, proficiency: 55 },

  // Business
  { name: "Revenue Architecture", description: "Design and build systems that generate income autonomously.", category: "Business", energy_type: "Emerald Flames", tier: 5, proficiency: 75 },
  { name: "Brand Engineering", description: "Build brands that command attention and loyalty. Positioning, identity, story.", category: "Business", energy_type: "Aura", tier: 4, proficiency: 65 },
  { name: "Negotiation", description: "Win without fighting. Frame control, anchoring, strategic concession.", category: "Business", energy_type: "Haki", tier: 4, proficiency: 70 },
  { name: "AI Systems Design", description: "Build and deploy AI agents, automations, and intelligent workflows.", category: "Business", energy_type: "Emerald Flames", tier: 5, proficiency: 80 },
  { name: "Financial Intelligence", description: "Cash flow management, asset building, tax strategy, investment.", category: "Business", energy_type: "VRIL", tier: 3, proficiency: 55 },
  { name: "Sales Mastery", description: "Convert interest into commitment. Objection handling, closing, relationship building.", category: "Business", energy_type: "Haki", tier: 3, proficiency: 50 },

  // Spiritual
  { name: "Meditation", description: "Still the mind. Access deeper consciousness and intuitive knowing.", category: "Spiritual", energy_type: "Black Heart", tier: 4, proficiency: 72 },
  { name: "Energy Sensing", description: "Feel the energy of rooms, people, and situations before conscious analysis.", category: "Spiritual", energy_type: "Nen", tier: 3, proficiency: 60 },
  { name: "Manifestation", description: "Align thought, emotion, and action to create specific outcomes.", category: "Spiritual", energy_type: "Black Heart", tier: 5, proficiency: 65 },
  { name: "Breath Control", description: "Pranayama, Wim Hof, box breathing. Control physiology through breath.", category: "Spiritual", energy_type: "Chakra", tier: 3, proficiency: 70 },
  { name: "Aura Projection", description: "Consciously project energy and presence into a space.", category: "Spiritual", energy_type: "Aura", tier: 4, proficiency: 58 },

  // Physical
  { name: "Strength Training", description: "Progressive overload. Compound lifts, calisthenics, functional strength.", category: "Physical", energy_type: "Ki", tier: 3, proficiency: 65 },
  { name: "Endurance", description: "Cardiovascular capacity and sustained output. Running, swimming, cycling.", category: "Physical", energy_type: "Ki", tier: 3, proficiency: 55 },
  { name: "Flexibility & Mobility", description: "Joint health, range of motion, yoga, dynamic stretching.", category: "Physical", energy_type: "Chakra", tier: 2, proficiency: 45 },
  { name: "Recovery Science", description: "Sleep optimization, cold exposure, sauna, nutrition timing.", category: "Physical", energy_type: "VRIL", tier: 3, proficiency: 60 },
  { name: "Body Recomposition", description: "Optimize muscle-to-fat ratio through training and nutrition science.", category: "Physical", energy_type: "Ki", tier: 3, proficiency: 50 },

  // Creative
  { name: "Writing", description: "Persuasive, narrative, and technical writing. Words that move people.", category: "Creative", energy_type: "Mana", tier: 4, proficiency: 75 },
  { name: "UI/UX Design", description: "Design interfaces that are intuitive, beautiful, and functional.", category: "Creative", energy_type: "Mana", tier: 3, proficiency: 60 },
  { name: "Music Production", description: "Create sonic landscapes. Beat-making, mixing, sound design.", category: "Creative", energy_type: "Lacrima", tier: 2, proficiency: 35 },
  { name: "Storytelling", description: "Craft narratives that captivate, persuade, and transform.", category: "Creative", energy_type: "Aura", tier: 4, proficiency: 70 },

  // Technical
  { name: "Full-Stack Development", description: "Build complete web applications. React, Node, databases, deployment.", category: "Technical", energy_type: "Emerald Flames", tier: 5, proficiency: 78 },
  { name: "Prompt Engineering", description: "Craft precise AI instructions for optimal output.", category: "Technical", energy_type: "Emerald Flames", tier: 4, proficiency: 85 },
  { name: "Systems Architecture", description: "Design scalable, maintainable systems and infrastructure.", category: "Technical", energy_type: "Emerald Flames", tier: 4, proficiency: 70 },
  { name: "Data Analysis", description: "Extract insights from data. Pattern detection, visualization, prediction.", category: "Technical", energy_type: "Nen", tier: 3, proficiency: 55 },

  // Leadership
  { name: "Sovereign Presence", description: "Walk into any room and own it. Presence that reshapes the atmosphere.", category: "Leadership", energy_type: "Haki", tier: 5, proficiency: 72 },
  { name: "Team Building", description: "Identify talent, assign roles, build culture, maximize output.", category: "Leadership", energy_type: "Aura", tier: 3, proficiency: 55 },
  { name: "Decision Making", description: "Make high-stakes decisions quickly with incomplete information.", category: "Leadership", energy_type: "Haki", tier: 4, proficiency: 68 },
  { name: "Mentorship", description: "Transfer knowledge and wisdom. Accelerate others' growth.", category: "Leadership", energy_type: "Aura", tier: 3, proficiency: 50 },
];

export function SkillsPage() {
  const { skills, skillsLoading, createSkill, updateSkill, deleteSkill } = useAppData();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState("all");
  const [form, setForm] = useState({ name: "", description: "", category: "General", energy_type: "Emerald Flames", tier: 1, proficiency: 0, parent_skill_id: "" });
  const [seeding, setSeeding] = useState(false);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());

  // Auto-seed skills on first load
  useEffect(() => {
    if (!skillsLoading && skills.length === 0 && user && !seeding) {
      setSeeding(true);
      (async () => {
        for (const s of DEFAULT_SKILLS) {
          await createSkill({ ...s, unlocked: true, cost: 0, prerequisites: [], parent_skill_id: null });
        }
        setSeeding(false);
      })();
    }
  }, [skillsLoading, skills.length, user]);

  const parentSkills = skills.filter((s) => !s.parent_skill_id);
  const getSubskills = (parentId: string) => skills.filter((s) => s.parent_skill_id === parentId);
  const categories = ["all", ...Array.from(new Set(skills.map((s) => s.category)))];
  const filtered = parentSkills.filter((s) => catFilter === "all" || s.category === catFilter);

  const resetForm = () => { setForm({ name: "", description: "", category: "General", energy_type: "Emerald Flames", tier: 1, proficiency: 0, parent_skill_id: "" }); setEditingId(null); setShowCreate(false); };

  const handleEdit = (s: any) => {
    setForm({ name: s.name, description: s.description, category: s.category, energy_type: s.energy_type, tier: s.tier, proficiency: s.proficiency, parent_skill_id: s.parent_skill_id || "" });
    setEditingId(s.id);
    setShowCreate(true);
  };

  const handleAddSubskill = (parentId: string) => {
    const parent = skills.find((s) => s.id === parentId);
    resetForm();
    setForm((f) => ({ ...f, category: parent?.category || "General", energy_type: parent?.energy_type || "Emerald Flames", parent_skill_id: parentId }));
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const payload = { ...form, tier: Number(form.tier), proficiency: Number(form.proficiency), parent_skill_id: form.parent_skill_id || null };
    if (editingId) {
      await updateSkill(editingId, payload);
    } else {
      await createSkill({ ...payload, unlocked: true, cost: 0, prerequisites: [] });
    }
    resetForm();
  };

  const toggleExpand = (id: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (skillsLoading || seeding) return <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin text-primary" size={24} /><span className="ml-2 text-xs font-mono text-muted-foreground">{seeding ? "Seeding skill trees..." : "Loading..."}</span></div>;

  return (
    <div className="space-y-5">
      <PageHeader title="Skill Trees" subtitle={`${skills.filter((s) => s.unlocked).length} / ${skills.length} skills unlocked`} icon={<Sparkles size={18} />}
        actions={<button onClick={() => { resetForm(); setShowCreate(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded"><Plus size={12} /> Add Skill</button>}
      />
      {showCreate && (
        <HudCard className="border-primary/20">
          <p className="text-[9px] font-mono text-primary uppercase tracking-widest mb-3">{editingId ? "Edit Skill" : form.parent_skill_id ? "New Subskill" : "New Skill"}</p>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Skill name" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
              <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Category" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none" />
            </div>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description..." rows={2} className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm resize-none focus:outline-none" />
            <div className="grid grid-cols-3 gap-2">
              <input value={form.energy_type} onChange={(e) => setForm((f) => ({ ...f, energy_type: e.target.value }))} placeholder="Energy type" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
              <input type="number" value={form.tier} onChange={(e) => setForm((f) => ({ ...f, tier: Number(e.target.value) }))} placeholder="Tier" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" min={1} max={10} />
              <input type="number" value={form.proficiency} onChange={(e) => setForm((f) => ({ ...f, proficiency: Number(e.target.value) }))} placeholder="Proficiency %" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" min={0} max={100} />
            </div>
            {/* Parent skill selector */}
            <div>
              <p className="text-[9px] font-mono text-muted-foreground uppercase mb-1">Parent Skill (leave empty for top-level)</p>
              <select value={form.parent_skill_id} onChange={(e) => setForm((f) => ({ ...f, parent_skill_id: e.target.value }))} className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                <option value="">None (Top-level skill)</option>
                {parentSkills.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.category})</option>)}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={resetForm} className="px-3 py-1.5 text-xs font-mono text-muted-foreground border border-border rounded">Cancel</button>
              <button onClick={handleSave} className="px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded">{editingId ? "Save" : "Unlock"}</button>
            </div>
          </div>
        </HudCard>
      )}
      <div className="flex gap-1.5 flex-wrap">
        {categories.map((c) => (
          <button key={c} onClick={() => setCatFilter(c)} className={`px-2 py-1 text-[10px] font-mono uppercase rounded border transition-all ${catFilter === c ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground"}`}>{c}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filtered.map((s) => {
          const subs = getSubskills(s.id);
          const isExpanded = expandedSkills.has(s.id);
          return (
            <div key={s.id} className="space-y-1">
              <HudCard className={s.unlocked ? "" : "opacity-50"}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded border border-primary/20 bg-primary/5 flex items-center justify-center shrink-0">
                    <Star size={14} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-display font-bold">{s.name}</p>
                      <span className="text-[9px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">T{s.tier}</span>
                      {subs.length > 0 && (
                        <button onClick={() => toggleExpand(s.id)} className="text-[9px] font-mono text-primary/60 hover:text-primary transition-colors">
                          {isExpanded ? "▾" : "▸"} {subs.length} sub
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] font-mono text-primary/60">{s.energy_type}</p>
                    {s.description && <p className="text-xs font-body text-muted-foreground mt-1 line-clamp-2">{s.description}</p>}
                    {s.proficiency > 0 && (
                      <div className="mt-1.5">
                        <ProgressBar value={s.proficiency} max={100} height="xs" label={`${s.proficiency}% proficiency`} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={() => handleAddSubskill(s.id)} className="p-1 text-muted-foreground hover:text-primary transition-colors" title="Add subskill"><Plus size={12} /></button>
                    <button onClick={() => handleEdit(s)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Edit2 size={12} /></button>
                    <button onClick={() => deleteSkill(s.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={12} /></button>
                  </div>
                </div>
              </HudCard>
              {/* Subskills */}
              {isExpanded && subs.map((sub) => (
                <div key={sub.id} className="ml-6">
                  <HudCard className="border-l-2 border-primary/20">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-display font-bold">{sub.name}</p>
                          <span className="text-[8px] font-mono text-muted-foreground border border-border rounded px-1 py-0.5">T{sub.tier}</span>
                        </div>
                        <p className="text-[9px] font-mono text-primary/60">{sub.energy_type}</p>
                        {sub.description && <p className="text-[10px] font-body text-muted-foreground mt-0.5">{sub.description}</p>}
                        {sub.proficiency > 0 && <ProgressBar value={sub.proficiency} max={100} height="xs" label={`${sub.proficiency}%`} />}
                      </div>
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button onClick={() => handleEdit(sub)} className="p-0.5 text-muted-foreground hover:text-primary transition-colors"><Edit2 size={10} /></button>
                        <button onClick={() => deleteSkill(sub.id)} className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={10} /></button>
                      </div>
                    </div>
                  </HudCard>
                </div>
              ))}
            </div>
          );
        })}
        {filtered.length === 0 && <p className="text-xs font-mono text-muted-foreground text-center py-8 col-span-2">No skills — unlock your first ability.</p>}
      </div>
    </div>
  );
}

// ─── InventoryPage ─────────────────────────────────────────
export function InventoryPage() {
  const { inventory, inventoryLoading, createInventoryItem, updateInventoryItem, deleteInventoryItem, refetchInventory } = useAppData();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [form, setForm] = useState({ name: "", description: "", type: "equipment", rarity: "common", quantity: 1, effect: "" });

  useEffect(() => {
    void refetchInventory();
  }, [refetchInventory]);

  const types = ["all", "equipment", "consumable", "material", "artifact"];
  const filtered = inventory.filter((i) => typeFilter === "all" || i.type === typeFilter);

  const resetForm = () => { setForm({ name: "", description: "", type: "equipment", rarity: "common", quantity: 1, effect: "" }); setEditingId(null); setShowCreate(false); };

  const handleEdit = (item: any) => {
    setForm({ name: item.name, description: item.description, type: item.type, rarity: item.rarity, quantity: item.quantity, effect: item.effect || "" });
    setEditingId(item.id);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editingId) {
      await updateInventoryItem(editingId, { ...form, quantity: Number(form.quantity), effect: form.effect || null });
    } else {
      await createInventoryItem({ ...form, quantity: Number(form.quantity), effect: form.effect || null, slot: null, tier: null, stat_effects: [], is_equipped: false });
    }
    resetForm();
  };

  if (inventoryLoading) return <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin text-primary" size={24} /></div>;

  return (
    <div className="space-y-5">
      <PageHeader title="Inventory" subtitle={`${inventory.length} items — ${inventory.filter((i) => i.is_equipped).length} equipped`} icon={<Package size={18} />}
        actions={<button onClick={() => { resetForm(); setShowCreate(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded"><Plus size={12} /> Add Item</button>}
      />
      {showCreate && (
        <HudCard className="border-primary/20">
          <p className="text-[9px] font-mono text-primary uppercase tracking-widest mb-3">{editingId ? "Edit Item" : "New Item"}</p>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Item name" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
              <input type="number" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))} placeholder="Qty" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none" min={1} />
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                {["equipment", "consumable", "material", "artifact"].map((t) => <option key={t}>{t}</option>)}
              </select>
              <select value={form.rarity} onChange={(e) => setForm((f) => ({ ...f, rarity: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                {["common", "rare", "epic", "legendary", "mythic"].map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description" className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none" />
            <input value={form.effect} onChange={(e) => setForm((f) => ({ ...f, effect: e.target.value }))} placeholder="Effect" className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
            <div className="flex gap-2 justify-end">
              <button onClick={resetForm} className="px-3 py-1.5 text-xs font-mono text-muted-foreground border border-border rounded">Cancel</button>
              <button onClick={handleSave} className="px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded">{editingId ? "Save" : "Add"}</button>
            </div>
          </div>
        </HudCard>
      )}
      <div className="flex gap-1.5 flex-wrap">
        {types.map((t) => (
          <button key={t} onClick={() => setTypeFilter(t)} className={`px-2 py-1 text-[10px] font-mono uppercase rounded border transition-all ${typeFilter === t ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground"}`}>{t}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((item) => {
          const isExpanded = expandedId === item.id;
          return (
          <HudCard key={item.id} className={`cursor-pointer transition-all ${item.is_equipped ? "border-primary/30" : ""} ${isExpanded ? "border-primary/30" : ""}`}>
            <div onClick={() => setExpandedId(isExpanded ? null : item.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <p className="text-sm font-display font-bold">{item.name}</p>
                    {item.is_equipped && <span className="text-[8px] font-mono text-primary border border-primary/30 rounded px-1">EQUIPPED</span>}
                  </div>
                  <RarityBadge rarity={item.rarity} />
                  {item.description && <p className={`text-xs font-body text-muted-foreground mt-1 ${isExpanded ? "" : "line-clamp-2"}`}>{item.description}</p>}
                  {item.effect && <p className="text-[10px] font-mono text-primary/60 mt-0.5">{item.effect}</p>}
                  {isExpanded && (
                    <div className="mt-2 space-y-1 border-t border-border/30 pt-2 text-[10px] font-mono">
                      <div><span className="text-muted-foreground">Type:</span> <span className="text-foreground">{item.type}</span></div>
                      <div><span className="text-muted-foreground">Rarity:</span> <span className="text-foreground">{item.rarity}</span></div>
                      <div><span className="text-muted-foreground">Quantity:</span> <span className="text-foreground">{item.quantity}</span></div>
                      {item.slot && <div><span className="text-muted-foreground">Slot:</span> <span className="text-foreground">{item.slot}</span></div>}
                      {item.tier && <div><span className="text-muted-foreground">Tier:</span> <span className="text-foreground">{item.tier}</span></div>}
                      <div><span className="text-muted-foreground">Obtained:</span> <span className="text-foreground">{new Date(item.obtained_at).toLocaleString()}</span></div>
                    </div>
                  )}
                  {!isExpanded && (
                    <p className="text-[9px] font-mono text-muted-foreground mt-1">
                      {item.type} {item.quantity > 1 ? `× ${item.quantity}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => handleEdit(item)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Edit2 size={12} /></button>
                  <button onClick={() => deleteInventoryItem(item.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          </HudCard>
          );
        })}
        {filtered.length === 0 && <p className="text-xs font-mono text-muted-foreground text-center py-8 col-span-3">Inventory empty.</p>}
      </div>
    </div>
  );
}
