// ============================================================
// VANTARA.EXE — AlliesPage & StorePage (fully editable, DB-persisted)
// ============================================================
import { useState } from "react";
import { motion } from "framer-motion";
import { Shield, Plus, Trash2, Heart, Loader2, Edit2, ShoppingBag, Lock, CheckCircle2 } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard, ProgressBar, RarityBadge } from "@/components/SharedUI";

export function AlliesPage() {
  const { allies, alliesLoading, createAlly, updateAlly, deleteAlly } = useAppData();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({ name: "", relationship: "ally", level: 1, specialty: "General", affinity: 50, notes: "" });

  const RELATIONSHIP_COLORS: Record<string, string> = { ally: "text-green-400", council: "text-blue-400", rival: "text-red-400" };
  const filtered = allies.filter((a) => filter === "all" || a.relationship === filter);

  const resetForm = () => {
    setForm({ name: "", relationship: "ally", level: 1, specialty: "General", affinity: 50, notes: "" });
    setEditingId(null);
    setShowCreate(false);
  };

  const handleEdit = (a: any) => {
    setForm({ name: a.name, relationship: a.relationship, level: a.level, specialty: a.specialty, affinity: a.affinity, notes: a.notes });
    setEditingId(a.id);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editingId) {
      await updateAlly(editingId, { ...form, level: Number(form.level), affinity: Number(form.affinity) });
    } else {
      await createAlly({ ...form, level: Number(form.level), affinity: Number(form.affinity), avatar: null });
    }
    resetForm();
  };

  const adjustAffinity = async (id: string, current: number, delta: number) => {
    const next = Math.max(0, Math.min(100, current + delta));
    await updateAlly(id, { affinity: next });
  };

  if (alliesLoading) return <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin text-primary" size={24} /></div>;

  return (
    <div className="space-y-5">
      <PageHeader title="Allies" subtitle={`${allies.length} entities in network`} icon={<Shield size={18} />}
        actions={<button onClick={() => { resetForm(); setShowCreate(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all"><Plus size={12} /> Add Ally</button>}
      />

      {showCreate && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <HudCard className="border-primary/20">
            <p className="text-[9px] font-mono text-primary uppercase tracking-widest mb-3">{editingId ? "Edit Ally" : "New Ally"}</p>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
                <select value={form.relationship} onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                  {["ally", "council", "rival"].map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input type="number" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: Number(e.target.value) }))} placeholder="Level" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
                <input value={form.specialty} onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))} placeholder="Specialty" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-mono text-muted-foreground shrink-0">Affinity:</label>
                  <input type="number" value={form.affinity} onChange={(e) => setForm((f) => ({ ...f, affinity: Number(e.target.value) }))} min={0} max={100} className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none" />
                </div>
              </div>
              <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes..." className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
              <div className="flex gap-2 justify-end">
                <button onClick={resetForm} className="px-3 py-1.5 text-xs font-mono text-muted-foreground border border-border rounded">Cancel</button>
                <button onClick={handleSave} className="px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded">{editingId ? "Save" : "Add"}</button>
              </div>
            </div>
          </HudCard>
        </motion.div>
      )}

      <div className="flex gap-1.5">
        {["all", "ally", "council", "rival"].map((r) => (
          <button key={r} onClick={() => setFilter(r)} className={`px-2 py-1 text-[10px] font-mono uppercase rounded border transition-all ${filter === r ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground"}`}>{r}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filtered.map((ally) => (
          <HudCard key={ally.id}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center font-display font-bold shrink-0 ${RELATIONSHIP_COLORS[ally.relationship]}`}
                style={{ borderColor: "currentColor", opacity: 0.8, background: "currentColor", color: "hsl(var(--background))" }}>
                {ally.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-display font-bold ${RELATIONSHIP_COLORS[ally.relationship]}`}>{ally.name}</p>
                  <span className={`text-[9px] font-mono uppercase ${RELATIONSHIP_COLORS[ally.relationship]}`}>{ally.relationship}</span>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">LV{ally.level} • {ally.specialty}</p>
                {ally.notes && <p className="text-xs font-body text-muted-foreground mt-0.5 line-clamp-1">{ally.notes}</p>}
                <div className="mt-2 flex items-center gap-2">
                  <Heart size={10} className={ally.affinity > 70 ? "text-red-400" : "text-muted-foreground"} />
                  <div className="flex-1">
                    <ProgressBar value={ally.affinity} max={100} height="xs" colorClass={ally.affinity > 70 ? "bg-red-400" : ally.affinity > 40 ? "bg-amber-400" : "bg-muted-foreground"} />
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground w-6 text-right">{ally.affinity}</span>
                  <div className="flex gap-0.5">
                    <button onClick={() => adjustAffinity(ally.id, ally.affinity, -5)} className="text-[10px] text-muted-foreground hover:text-destructive px-0.5">−</button>
                    <button onClick={() => adjustAffinity(ally.id, ally.affinity, 5)} className="text-[10px] text-muted-foreground hover:text-primary px-0.5">+</button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button onClick={() => handleEdit(ally)} className="p-1 text-muted-foreground hover:text-primary transition-colors" title="Edit">
                  <Edit2 size={12} />
                </button>
                <button onClick={() => deleteAlly(ally.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </HudCard>
        ))}
        {filtered.length === 0 && <p className="text-xs font-mono text-muted-foreground text-center py-8 col-span-2">No allies — expand your network.</p>}
      </div>
    </div>
  );
}

// ============================================================
// StorePage — Full CRUD, persisted to database
// ============================================================

const CATEGORY_FILTERS = ["all", "consumable", "material", "upgrade", "artifact"] as const;
const EMPTY_STORE_FORM = { name: "", description: "", price: 100, currency: "Codex Points", rarity: "common", category: "consumable", effect: "", reqLevel: "", reqRank: "" };

export function StorePage() {
  const { profile, storeItems, storeLoading, createStoreItem, updateStoreItem, deleteStoreItem } = useAppData();
  const [catFilter, setCatFilter] = useState("all");
  const [purchased, setPurchased] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_STORE_FORM });

  const filtered = storeItems.filter((i) => catFilter === "all" || i.category === catFilter);

  const resetForm = () => {
    setForm({ ...EMPTY_STORE_FORM });
    setEditingId(null);
    setShowCreate(false);
  };

  const handleEdit = (item: any) => {
    setForm({
      name: item.name, description: item.description, price: item.price, currency: item.currency,
      rarity: item.rarity, category: item.category, effect: item.effect || "",
      reqLevel: item.req_level?.toString() || "", reqRank: item.req_rank || "",
    });
    setEditingId(item.id);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name, description: form.description, price: Number(form.price), currency: form.currency,
      rarity: form.rarity, category: form.category, effect: form.effect || null,
      req_level: form.reqLevel ? Number(form.reqLevel) : null,
      req_rank: form.reqRank || null,
    };
    if (editingId) {
      await updateStoreItem(editingId, payload);
    } else {
      await createStoreItem(payload);
    }
    resetForm();
  };

  const canPurchase = (item: any) => {
    if (!item.req_level && !item.req_rank) return true;
    if (item.req_level && profile.level < item.req_level) return false;
    return true;
  };

  const handleBuy = (id: string) => setPurchased((prev) => new Set([...prev, id]));

  if (storeLoading) return <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin text-primary" size={24} /></div>;

  return (
    <div className="space-y-5">
      <PageHeader title="Store" subtitle="Exchange currencies for items, upgrades & artifacts" icon={<ShoppingBag size={18} />}
        actions={<button onClick={() => { resetForm(); setShowCreate(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all"><Plus size={12} /> Add Item</button>}
      />

      {showCreate && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <HudCard className="border-primary/20">
            <p className="text-[9px] font-mono text-primary uppercase tracking-widest mb-3">{editingId ? "Edit Store Item" : "New Store Item"}</p>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Item name" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
                <input type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))} placeholder="Price" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none" />
              </div>
              <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description" className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none" />
              <div className="grid grid-cols-3 gap-2">
                <input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} placeholder="Currency" className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none" />
                <select value={form.rarity} onChange={(e) => setForm((f) => ({ ...f, rarity: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                  {["common", "rare", "epic", "legendary", "mythic"].map((r) => <option key={r}>{r}</option>)}
                </select>
                <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                  {["consumable", "material", "upgrade", "artifact"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <input value={form.effect} onChange={(e) => setForm((f) => ({ ...f, effect: e.target.value }))} placeholder="Effect" className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
              <div className="grid grid-cols-2 gap-2">
                <input value={form.reqLevel} onChange={(e) => setForm((f) => ({ ...f, reqLevel: e.target.value }))} placeholder="Required level (optional)" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
                <input value={form.reqRank} onChange={(e) => setForm((f) => ({ ...f, reqRank: e.target.value }))} placeholder="Required rank (optional)" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={resetForm} className="px-3 py-1.5 text-xs font-mono text-muted-foreground border border-border rounded">Cancel</button>
                <button onClick={handleSave} className="px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded">{editingId ? "Save" : "Add"}</button>
              </div>
            </div>
          </HudCard>
        </motion.div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {CATEGORY_FILTERS.map((c) => (
          <button key={c} onClick={() => setCatFilter(c)} className={`px-2 py-1 text-[10px] font-mono uppercase rounded border transition-all ${catFilter === c ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground"}`}>{c}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((item) => {
          const locked = !canPurchase(item);
          const bought = purchased.has(item.id);
          return (
            <HudCard key={item.id} className={locked ? "opacity-50" : ""}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <p className="text-sm font-display font-bold">{item.name}</p>
                    <RarityBadge rarity={item.rarity} />
                  </div>
                  <p className="text-xs font-body text-muted-foreground line-clamp-2">{item.description}</p>
                  {item.effect && <p className="text-[10px] font-mono text-primary/60 mt-0.5">⟡ {item.effect}</p>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-xs font-mono font-bold text-primary">{item.price} {item.currency}</span>
                    <span className="text-[9px] font-mono text-muted-foreground">{item.category}</span>
                    {item.req_level && <span className="text-[9px] font-mono text-amber-400">LV{item.req_level}+</span>}
                    {item.req_rank && <span className="text-[9px] font-mono text-amber-400">{item.req_rank}+</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {locked ? (
                    <Lock size={14} className="text-muted-foreground" />
                  ) : bought ? (
                    <CheckCircle2 size={14} className="text-green-400" />
                  ) : (
                    <button onClick={() => handleBuy(item.id)} className="px-2 py-1 text-[9px] font-mono text-primary border border-primary/30 rounded hover:bg-primary/10 transition-all">Buy</button>
                  )}
                  <button onClick={() => handleEdit(item)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Edit2 size={12} /></button>
                  <button onClick={() => deleteStoreItem(item.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={12} /></button>
                </div>
              </div>
            </HudCard>
          );
        })}
        {filtered.length === 0 && <p className="text-xs font-mono text-muted-foreground text-center py-8 col-span-3">No store items. Add your first item above.</p>}
      </div>
    </div>
  );
}
