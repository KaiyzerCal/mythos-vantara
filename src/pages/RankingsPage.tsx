import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Medal, Plus, Trash2, Edit2, Copy, Loader2 } from "lucide-react";
import { PageHeader, HudCard, RankBadge } from "@/components/SharedUI";
import { useAppData } from "@/contexts/AppDataContext";

const ROLE_COLORS: Record<string, string> = { self: "text-primary", ally: "text-green-400", enemy: "text-red-400", npc: "text-muted-foreground" };

const EMPTY_FORM = { display_name: "", role: "npc", rank: "D", level: 1, jjk_grade: "G4", op_tier: "Local", gpr: 1000, pvp: 5000, influence: "Local", notes: "", is_self: false };

export default function RankingsPage() {
  const { rankings, rankingsLoading, createRanking, updateRanking, deleteRanking } = useAppData();
  const [sortBy, setSortBy] = useState<"gpr" | "pvp" | "level">("gpr");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [detailId, setDetailId] = useState<string | null>(null);

  const resetForm = () => { setForm({ ...EMPTY_FORM }); setEditingId(null); setShowCreate(false); };

  const handleEdit = (entry: any) => {
    setForm({ display_name: entry.display_name, role: entry.role, rank: entry.rank, level: entry.level, jjk_grade: entry.jjk_grade, op_tier: entry.op_tier, gpr: entry.gpr, pvp: entry.pvp, influence: entry.influence, notes: entry.notes, is_self: entry.is_self });
    setEditingId(entry.id);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!form.display_name.trim()) return;
    const payload = { ...form, level: Number(form.level), gpr: Number(form.gpr), pvp: Number(form.pvp) };
    if (editingId) {
      await updateRanking(editingId, payload);
    } else {
      await createRanking(payload);
    }
    resetForm();
  };

  const copyAll = () => {
    const text = sorted.map((r, i) => `#${i + 1} ${r.display_name} [${r.rank}] LV${r.level} | GPR:${r.gpr.toLocaleString()} PVP:${r.pvp.toLocaleString()} | ${r.influence} | ${r.notes}`).join("\n");
    navigator.clipboard.writeText(`VANTARA ROSTER\n${"─".repeat(40)}\n${text}`);
  };

  const sorted = [...rankings].sort((a, b) => sortBy === "gpr" ? b.gpr - a.gpr : sortBy === "pvp" ? b.pvp - a.pvp : b.level - a.level);
  const selfEntry = sorted.find((r) => r.is_self);
  const others = sorted.filter((r) => !r.is_self);
  const detailEntry = detailId ? rankings.find(r => r.id === detailId) : null;

  if (rankingsLoading) return <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin text-primary" size={24} /></div>;

  return (
    <div className="space-y-5">
      <PageHeader title="Rankings" subtitle={`${rankings.length} entities in roster`} icon={<Medal size={18} />}
        actions={
          <div className="flex gap-2">
            <button onClick={copyAll} className="px-3 py-1.5 text-xs font-mono border border-border hover:border-primary/30 hover:text-primary rounded transition-all">Copy All</button>
            <button onClick={() => { resetForm(); setShowCreate(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all"><Plus size={12} /> Add Entry</button>
          </div>
        }
      />

      {/* Detail view */}
      <AnimatePresence>
        {detailEntry && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <HudCard className="border-primary/20">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[9px] font-mono text-primary uppercase tracking-widest">Profile Detail</p>
                <button onClick={() => setDetailId(null)} className="text-[10px] font-mono text-muted-foreground hover:text-primary">Close</button>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-display font-bold ${ROLE_COLORS[detailEntry.role]}`}>{detailEntry.display_name}</span>
                  <RankBadge rank={detailEntry.rank} />
                  <span className="text-xs font-mono text-muted-foreground capitalize">{detailEntry.role}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                  <div><span className="text-muted-foreground">Level:</span> <span className="font-bold">{detailEntry.level}</span></div>
                  <div><span className="text-muted-foreground">GPR:</span> <span className="font-bold text-amber-400">{detailEntry.gpr.toLocaleString()}</span></div>
                  <div><span className="text-muted-foreground">PVP:</span> <span className="font-bold text-red-400">{detailEntry.pvp.toLocaleString()}</span></div>
                  <div><span className="text-muted-foreground">Influence:</span> <span className="font-bold">{detailEntry.influence}</span></div>
                  <div><span className="text-muted-foreground">JJK Grade:</span> <span className="font-bold">{detailEntry.jjk_grade}</span></div>
                  <div><span className="text-muted-foreground">OP Tier:</span> <span className="font-bold">{detailEntry.op_tier}</span></div>
                </div>
                {detailEntry.notes && <p className="text-xs font-body text-muted-foreground mt-2">{detailEntry.notes}</p>}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => { handleEdit(detailEntry); setDetailId(null); }} className="px-3 py-1 text-[10px] font-mono bg-primary/10 border border-primary/30 text-primary rounded">Edit</button>
                  <button onClick={() => { deleteRanking(detailEntry.id); setDetailId(null); }} className="px-3 py-1 text-[10px] font-mono border border-destructive/30 text-destructive rounded">Delete</button>
                </div>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {selfEntry && (
        <HudCard className="border-primary/30 bg-primary/5 cursor-pointer" onClick={() => setDetailId(selfEntry.id)}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
                <span className="font-display text-primary font-bold text-sm">#1</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-base font-bold text-primary">{selfEntry.display_name}</span>
                  <RankBadge rank={selfEntry.rank} />
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">LV{selfEntry.level} • {selfEntry.jjk_grade} • {selfEntry.op_tier}</p>
                {selfEntry.notes && <p className="text-[10px] font-mono text-primary/60 mt-0.5">{selfEntry.notes}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right shrink-0">
                <p className="text-sm font-display font-bold text-amber-400">{selfEntry.gpr.toLocaleString()}</p>
                <p className="text-[9px] font-mono text-muted-foreground">GPR</p>
                <p className="text-xs font-display font-bold text-red-400 mt-0.5">{selfEntry.pvp.toLocaleString()}</p>
                <p className="text-[9px] font-mono text-muted-foreground">PVP</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handleEdit(selfEntry); }} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Edit2 size={14} /></button>
            </div>
          </div>
        </HudCard>
      )}

      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <HudCard className="border-primary/20">
              <p className="text-[9px] font-mono text-primary uppercase tracking-widest mb-3">{editingId ? "Edit Entry" : "New Entry"}</p>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="Display name" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
                  <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                    {["ally", "enemy", "npc", "self"].map((r) => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <input value={form.rank} onChange={(e) => setForm((f) => ({ ...f, rank: e.target.value }))} placeholder="Rank" className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none" />
                  <input type="number" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: Number(e.target.value) }))} placeholder="Level" className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none" />
                  <input type="number" value={form.gpr} onChange={(e) => setForm((f) => ({ ...f, gpr: Number(e.target.value) }))} placeholder="GPR" className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none" />
                  <input type="number" value={form.pvp} onChange={(e) => setForm((f) => ({ ...f, pvp: Number(e.target.value) }))} placeholder="PVP" className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input value={form.jjk_grade} onChange={(e) => setForm((f) => ({ ...f, jjk_grade: e.target.value }))} placeholder="JJK Grade" className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none" />
                  <input value={form.op_tier} onChange={(e) => setForm((f) => ({ ...f, op_tier: e.target.value }))} placeholder="OP Tier" className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none" />
                  <input value={form.influence} onChange={(e) => setForm((f) => ({ ...f, influence: e.target.value }))} placeholder="Influence" className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={form.is_self} onChange={(e) => setForm((f) => ({ ...f, is_self: e.target.checked }))} className="accent-primary" />
                    This is me (Self)
                  </label>
                </div>
                <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes" className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
                <div className="flex gap-2 justify-end">
                  <button onClick={resetForm} className="px-3 py-1.5 text-xs font-mono text-muted-foreground border border-border rounded">Cancel</button>
                  <button onClick={handleSave} className="px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded">{editingId ? "Save" : "Add"}</button>
                </div>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono text-muted-foreground uppercase">Sort:</span>
        {(["gpr", "pvp", "level"] as const).map((s) => (
          <button key={s} onClick={() => setSortBy(s)} className={`px-2 py-1 text-[10px] font-mono uppercase rounded border transition-all ${sortBy === s ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground"}`}>{s}</button>
        ))}
      </div>

      <div className="space-y-2">
        {others.map((entry, i) => (
          <motion.div key={entry.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
            <HudCard className="cursor-pointer hover:border-primary/20 transition-colors" onClick={() => setDetailId(entry.id)}>
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded border flex items-center justify-center text-xs font-display font-bold shrink-0">
                  <span className={ROLE_COLORS[entry.role]}>{i + 2}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-display font-bold ${ROLE_COLORS[entry.role]}`}>{entry.display_name}</span>
                    <RankBadge rank={entry.rank} size="xs" />
                    <span className="text-[9px] font-mono text-muted-foreground">LV{entry.level}</span>
                    <span className="text-[9px] font-mono text-muted-foreground capitalize">{entry.role}</span>
                  </div>
                  <div className="flex gap-3 mt-0.5 flex-wrap">
                    <span className="text-[9px] font-mono text-muted-foreground">{entry.jjk_grade}</span>
                    <span className="text-[9px] font-mono text-muted-foreground">{entry.op_tier}</span>
                    <span className="text-[9px] font-mono text-muted-foreground">{entry.influence}</span>
                    {entry.notes && <span className="text-[9px] font-mono text-muted-foreground/60">— {entry.notes}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-mono text-amber-400">{entry.gpr.toLocaleString()}</p>
                  <p className="text-[9px] font-mono text-muted-foreground">GPR</p>
                  <p className="text-xs font-mono text-red-400 mt-0.5">{entry.pvp.toLocaleString()}</p>
                  <p className="text-[9px] font-mono text-muted-foreground">PVP</p>
                </div>
                <div className="flex flex-col gap-1 shrink-0 ml-1">
                  <button onClick={(e) => { e.stopPropagation(); handleEdit(entry); }} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Edit2 size={12} /></button>
                  <button onClick={(e) => { e.stopPropagation(); deleteRanking(entry.id); }} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={12} /></button>
                </div>
              </div>
            </HudCard>
          </motion.div>
        ))}
        {rankings.length === 0 && <p className="text-xs font-mono text-muted-foreground text-center py-8">No rankings yet. Add your first entry or ask MAVIS.</p>}
      </div>
    </div>
  );
}