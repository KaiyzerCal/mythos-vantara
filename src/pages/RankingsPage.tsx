import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Medal, Plus, Trash2, Edit2, Copy } from "lucide-react";
import { PageHeader, HudCard, RankBadge } from "@/components/SharedUI";
import { useAuth } from "@/contexts/AuthContext";

interface RosterEntry {
  id: string;
  user_id: string;
  display: string;
  role: "ally" | "enemy" | "npc" | "self";
  rank: string;
  level: number;
  jjk_grade: string;
  op_tier: string;
  gpr: number;
  pvp: number;
  influence: string;
  notes: string;
}

const ROLE_COLORS: Record<string, string> = { self: "text-primary", ally: "text-green-400", enemy: "text-red-400", npc: "text-muted-foreground" };

const INITIAL_ROSTER_SEED = [
  { display: "Calvin J. Watkins", role: "self" as const, rank: "SS", level: 90, jjk_grade: "Domain+", op_tier: "Yonko+/Gorosei-", gpr: 8847, pvp: 9300, influence: "National", notes: "Arbiter-Sovereign; Domain 22m" },
  { display: "Judge Darren Schull", role: "ally" as const, rank: "S", level: 55, jjk_grade: "Special", op_tier: "Admiral", gpr: 2100, pvp: 9000, influence: "National", notes: "Gatekeeper figure" },
  { display: "Alana K.", role: "ally" as const, rank: "A", level: 46, jjk_grade: "Special-", op_tier: "Admiral-", gpr: 1720, pvp: 8800, influence: "Regional-National", notes: "Order Operator" },
  { display: "Shenna", role: "ally" as const, rank: "A", level: 48, jjk_grade: "Special-", op_tier: "Admiral-", gpr: 1780, pvp: 8850, influence: "Regional-National", notes: "Stabilizer" },
  { display: "Christopher Watkins", role: "ally" as const, rank: "B", level: 36, jjk_grade: "G1", op_tier: "Commander-", gpr: 1470, pvp: 8200, influence: "Regional", notes: "ATLAS builder node" },
];

const EMPTY_FORM: { display: string; role: "ally" | "enemy" | "npc" | "self"; rank: string; level: number; jjk_grade: string; op_tier: string; gpr: number; pvp: number; influence: string; notes: string } = { display: "", role: "npc", rank: "D", level: 1, jjk_grade: "G4", op_tier: "Local", gpr: 1000, pvp: 5000, influence: "Local", notes: "" };

export default function RankingsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"gpr" | "pvp" | "level">("gpr");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [localRoster, setLocalRoster] = useState<RosterEntry[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("vantara_roster");
    if (stored) {
      setLocalRoster(JSON.parse(stored));
    } else {
      const seeded = INITIAL_ROSTER_SEED.map((e, i) => ({ ...e, id: `r-${i}`, user_id: user?.id ?? "" }));
      setLocalRoster(seeded);
      localStorage.setItem("vantara_roster", JSON.stringify(seeded));
    }
    setLoading(false);
  }, [user]);

  const save = (updated: RosterEntry[]) => {
    setLocalRoster(updated);
    localStorage.setItem("vantara_roster", JSON.stringify(updated));
  };

  const resetForm = () => { setForm({ ...EMPTY_FORM }); setEditingId(null); setShowCreate(false); };

  const handleEdit = (entry: RosterEntry) => {
    setForm({ display: entry.display, role: entry.role as "ally" | "enemy" | "npc" | "self", rank: entry.rank, level: entry.level, jjk_grade: entry.jjk_grade, op_tier: entry.op_tier, gpr: entry.gpr, pvp: entry.pvp, influence: entry.influence, notes: entry.notes });
    setEditingId(entry.id);
    setShowCreate(true);
  };

  const handleSave = () => {
    if (!form.display.trim()) return;
    if (editingId) {
      save(localRoster.map((r) => r.id === editingId ? { ...r, ...form, level: Number(form.level), gpr: Number(form.gpr), pvp: Number(form.pvp) } : r));
    } else {
      const entry: RosterEntry = { ...form, id: `r-${Date.now()}`, user_id: user?.id ?? "", level: Number(form.level), gpr: Number(form.gpr), pvp: Number(form.pvp) };
      save([...localRoster, entry]);
    }
    resetForm();
  };

  const handleDelete = (id: string) => save(localRoster.filter((r) => r.id !== id));

  const copyAll = () => {
    const text = sorted
      .map((r, i) => `#${i + 1} ${r.display} [${r.rank}] LV${r.level} | GPR:${r.gpr.toLocaleString()} PVP:${r.pvp.toLocaleString()} | ${r.influence} | ${r.notes}`)
      .join("\n");
    navigator.clipboard.writeText(`VANTARA ROSTER\n${"─".repeat(40)}\n${text}`);
  };

  const sorted = [...localRoster].sort((a, b) => sortBy === "gpr" ? b.gpr - a.gpr : sortBy === "pvp" ? b.pvp - a.pvp : b.level - a.level);
  const selfEntry = sorted.find((r) => r.role === "self");
  const others = sorted.filter((r) => r.role !== "self");

  return (
    <div className="space-y-5">
      <PageHeader title="Rankings" subtitle={`${localRoster.length} entities in roster`} icon={<Medal size={18} />}
        actions={
          <div className="flex gap-2">
            <button onClick={copyAll} className="px-3 py-1.5 text-xs font-mono border border-border hover:border-primary/30 hover:text-primary rounded transition-all">Copy All</button>
            <button onClick={() => { resetForm(); setShowCreate(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all"><Plus size={12} /> Add Entry</button>
          </div>
        }
      />

      {selfEntry && (
        <HudCard className="border-primary/30 bg-primary/5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
                <span className="font-display text-primary font-bold text-sm">#1</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-base font-bold text-primary">{selfEntry.display}</span>
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
              <button onClick={() => handleEdit(selfEntry)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Edit2 size={14} /></button>
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
                  <input value={form.display} onChange={(e) => setForm((f) => ({ ...f, display: e.target.value }))} placeholder="Display name" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
                  <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as any }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
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
            <HudCard>
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded border flex items-center justify-center text-xs font-display font-bold shrink-0">
                  <span className={ROLE_COLORS[entry.role]}>{i + 2}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-display font-bold ${ROLE_COLORS[entry.role]}`}>{entry.display}</span>
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
                  <button onClick={() => handleEdit(entry)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Edit2 size={12} /></button>
                  <button onClick={() => handleDelete(entry.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={12} /></button>
                </div>
              </div>
            </HudCard>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
