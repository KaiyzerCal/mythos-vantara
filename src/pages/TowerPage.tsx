import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TowerControl, ChevronDown, ChevronRight, ArrowUp, ArrowDown,
  Pencil, Plus, Trash2, X, Check, MapPin,
} from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, HudCard, ProgressBar } from "@/components/SharedUI";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────

interface TowerFloor {
  id: string;
  user_id: string;
  floor_min: number;
  floor_max: number;
  name: string;
  law: string;
  energy: string;
  essence: string;
  function: string;
  ecology: string;
  inhabitants: string;
  dangers: string;
  rewards: string;
}

interface TowerSubarea {
  id: string;
  user_id: string;
  floor_id: string;
  name: string;
  description: string;
  floor_start: number | null;
  floor_end: number | null;
  area_type: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

const ESSENCE_COLORS: Record<string, string> = {
  Survival: "#666666", "Fear Integration": "#4169E1", "Desire Mastery": "#FF69B4",
  Discipline: "#FFD700", Structure: "#00CED1", Balance: "#08C284",
  Mastery: "#9400D3", Sovereignty: "#FF4500",
};

const AREA_TYPES = [
  "location", "dungeon", "settlement", "landmark",
  "boss room", "sanctuary", "ruins", "training ground", "hidden area",
];

const FLOOR_DEFAULTS: Omit<TowerFloor, "id" | "user_id">[] = [
  { floor_min: 1,   floor_max: 10,  name: "The Pit",              law: "Instinct governs order",           energy: "Muddied Ki",               essence: "Survival",         function: "Base instinct training",                 ecology: "Barren wasteland of ash and bone. Gravity shifts unpredictably. Creatures born from raw survival instinct prowl. Weather: Scorching heat waves and freezing cold snaps alternate hourly.", inhabitants: "Broken beginners, feral survivors, instinct-driven entities", dangers: "Environmental extremes, pack predators, gravity anomalies",                                    rewards: "Survival Essence, Basic Combat Skills, Instinct Awakening" },
  { floor_min: 11,  floor_max: 20,  name: "Shadow Mire",          law: "Suffering = identity",             energy: "Leaking Nen",              essence: "Fear Integration", function: "Shadow work & trauma processing",         ecology: "Perpetual twilight swamp where shadows move independently. Black water reflects your deepest fears. Mirror Wraiths and Trauma Serpents dwell here.", inhabitants: "Shadow Workers, Trauma Healers, Fear-Faced Warriors",             dangers: "Confronting inner demons, drowning in shadow water, madness",                              rewards: "Shadow Integration, Fear Transmutation, Trauma Keys" },
  { floor_min: 21,  floor_max: 30,  name: "Hunger Wilds",         law: "Consume or be consumed",           energy: "Ki / Cursed Magoi",        essence: "Desire Mastery",   function: "Control over wants",                     ecology: "Lush jungle of impossible beauty where every plant and creature represents a different desire. Rivers flow with liquid temptation.", inhabitants: "Desire Monks, Addiction Survivors, Pleasure Masters",               dangers: "Permanent entrapment in desire loops, losing sense of self",                              rewards: "Desire Channeling, Want Manipulation, Satisfaction Alchemy" },
  { floor_min: 31,  floor_max: 40,  name: "Forge Fields",         law: "Only what endures fire ascends",   energy: "Ki / Aura (stabilizing)",  essence: "Discipline",       function: "Habit formation",                        ecology: "Massive workshop realm of endless forges and grinding wheels. One day can be one minute or one year. Automatons demonstrate perfect form.", inhabitants: "Master Craftsmen, Discipline Monks, Habit Architects",              dangers: "Eternal repetition curse, discipline titans crushing the undisciplined",                   rewards: "Habit Mastery, Discipline Infusion, Routine Automation" },
  { floor_min: 41,  floor_max: 50,  name: "Domain of Order",      law: "Order defines power",              energy: "Structured Aura / Haki",   essence: "Structure",        function: "System building",                        ecology: "Crystalline mega-city of perfect geometry and sacred mathematics. Buildings grow based on system efficiency.", inhabitants: "System Designers, Architects of Reality, Order Priests",           dangers: "Over-systematization leading to rigidity, trapped in bureaucratic mazes",                 rewards: "System Mastery, Framework Creation, Order Manipulation" },
  { floor_min: 51,  floor_max: 70,  name: "Dominion Plane",       law: "Equilibrium = dominion",           energy: "Emerald–Black Sun flame",  essence: "Balance",          function: "Chaos/Order equilibrium",                ecology: "Vast plateau split down the middle: one side pure chaos, other side sterile order. The middle is a shifting border where both forces clash and dance.", inhabitants: "Balance Masters, Dual-Nature Beings, Chaos Mages, Order Templars", dangers: "Being pulled too far into chaos or order, erasure by imbalance",                            rewards: "Chaos/Order Duality, Balance Mastery, Probability Manipulation" },
  { floor_min: 71,  floor_max: 85,  name: "Celestial Engine",     law: "Will shapes cosmos",               energy: "Aether / VRIL / Ichor",    essence: "Mastery",          function: "Macro-reality engineering",              ecology: "Cosmic workshop where star-forges create new realities. Celestial Architects work with raw spacetime. The laws of physics are suggestions here.", inhabitants: "Reality Engineers, Celestial Craftsmen, Cosmic Architects",        dangers: "Madness from infinite perspective, being unmade by creation energy",                       rewards: "Reality Engineering, Cosmic Mastery, Creation Authority" },
  { floor_min: 86,  floor_max: 99,  name: "Sovereign's Approach", law: "Sovereignty is absolute",          energy: "Black Heart / Emerald Flames", essence: "Sovereignty",  function: "Final preparation for transcendence",    ecology: "Endless white expanse punctuated by crystallized memory pillars — each one a conquered challenge. The air vibrates with pure potential.", inhabitants: "Near-Sovereigns, Transcended Warriors, Memory Keepers",           dangers: "Final tests of identity — who you truly are when everything is stripped away",             rewards: "Pre-Sovereignty State, Complete Self-Mastery, Domain Authority" },
  { floor_min: 100, floor_max: 100, name: "The Throne Room",      law: "You are the law",                  energy: "All Systems Unified",      essence: "Sovereignty",      function: "Sovereign domain establishment",         ecology: "A single vast chamber of mirrored obsidian. Your reflection shows every form you've ever taken. The throne sits empty — waiting.", inhabitants: "Only Sovereigns",                                                 dangers: "None — you become the danger for others",                                                  rewards: "Full Sovereignty, Reality Authority, Black Sun Monarch Title" },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function rangeLabel(f: TowerFloor) {
  return f.floor_min === f.floor_max ? String(f.floor_min) : `${f.floor_min}–${f.floor_max}`;
}
function ec(essence: string) { return ESSENCE_COLORS[essence] ?? "#888"; }

// ── Sub-components ────────────────────────────────────────────────────────

function FormInput({ label, value, onChange, textarea = false, placeholder = "" }: {
  label: string; value: string; onChange: (v: string) => void;
  textarea?: boolean; placeholder?: string;
}) {
  const cls = "w-full bg-background/60 border border-border/60 rounded px-2 text-xs font-mono text-foreground/90 focus:outline-none focus:border-primary/50 transition-colors";
  return (
    <div>
      <p className="text-xs font-mono text-muted-foreground uppercase mb-1">{label}</p>
      {textarea
        ? <textarea rows={3} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls + " py-1.5 resize-none"} />
        : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls + " py-1 h-7"} />
      }
    </div>
  );
}

function FloorEditForm({ draft, onChange, onSave, onCancel, saving }: {
  draft: TowerFloor;
  onChange: (patch: Partial<TowerFloor>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const f = (key: keyof TowerFloor) => (v: string) => onChange({ [key]: v });
  return (
    <div className="p-4 space-y-2 border-t border-border/40">
      <p className="text-xs font-mono text-primary/60 uppercase tracking-widest mb-3">Editing Floor Data</p>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2"><FormInput label="Name" value={draft.name} onChange={f("name")} /></div>
        <FormInput label="Essence" value={draft.essence} onChange={f("essence")} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <FormInput label="Law" value={draft.law} onChange={f("law")} />
        <FormInput label="Energy" value={draft.energy} onChange={f("energy")} />
      </div>
      <FormInput label="Function" value={draft.function} onChange={f("function")} />
      <FormInput label="Ecology" value={draft.ecology} onChange={f("ecology")} textarea />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <FormInput label="Inhabitants" value={draft.inhabitants} onChange={f("inhabitants")} textarea />
        <FormInput label="Dangers" value={draft.dangers} onChange={f("dangers")} textarea />
        <FormInput label="Rewards" value={draft.rewards} onChange={f("rewards")} textarea />
      </div>
      <div className="flex gap-2 pt-2">
        <button disabled={saving} onClick={onSave}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary/20 border border-primary/40 text-primary text-xs font-mono hover:bg-primary/30 transition-all disabled:opacity-50"
        >
          <Check size={12} />{saving ? "Saving…" : "Save Floor"}
        </button>
        <button onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-muted/20 border border-border/40 text-muted-foreground text-xs font-mono hover:bg-muted/40 transition-all"
        >
          <X size={12} />Cancel
        </button>
      </div>
    </div>
  );
}

function SubareaCard({ sub, editMode, onEdit, onDelete }: {
  sub: TowerSubarea; editMode: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const rangeStr = sub.floor_start != null
    ? (sub.floor_end != null && sub.floor_end !== sub.floor_start
      ? `fl.${sub.floor_start}–${sub.floor_end}` : `fl.${sub.floor_start}`)
    : null;
  return (
    <div className="flex items-start gap-2 p-2.5 rounded border border-border/30 bg-background/30 group">
      <MapPin size={10} className="text-primary/40 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono font-semibold text-foreground/85">{sub.name}</span>
          <span className="text-xs font-mono text-muted-foreground border border-border/30 rounded px-1.5 py-0.5 capitalize">{sub.area_type}</span>
          {rangeStr && <span className="text-xs font-mono text-muted-foreground">{rangeStr}</span>}
        </div>
        {sub.description && <p className="text-xs font-body text-muted-foreground mt-0.5 leading-relaxed">{sub.description}</p>}
      </div>
      {editMode && (
        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="p-1 text-muted-foreground hover:text-primary rounded transition-colors"><Pencil size={10} /></button>
          <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"><Trash2 size={10} /></button>
        </div>
      )}
    </div>
  );
}

function SubareaForm({ draft, onChange, onSave, onCancel, saving, floor }: {
  draft: Partial<TowerSubarea>;
  onChange: (patch: Partial<TowerSubarea>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  floor: TowerFloor;
}) {
  return (
    <div className="p-3 rounded border border-primary/20 bg-primary/5 space-y-2">
      <p className="text-xs font-mono text-primary/60 uppercase tracking-wider">
        {draft.id ? "Edit Sub-Area" : "New Sub-Area"}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs font-mono text-muted-foreground uppercase mb-1">Name</p>
          <input value={draft.name ?? ""} onChange={e => onChange({ name: e.target.value })} placeholder="Sub-area name"
            className="w-full bg-background/60 border border-border/60 rounded px-2 py-1 h-7 text-xs font-mono text-foreground/90 focus:outline-none focus:border-primary/50"
          />
        </div>
        <div>
          <p className="text-xs font-mono text-muted-foreground uppercase mb-1">Type</p>
          <select value={draft.area_type ?? "location"} onChange={e => onChange({ area_type: e.target.value })}
            className="w-full bg-background/60 border border-border/60 rounded px-2 h-7 text-xs font-mono text-foreground/90 focus:outline-none focus:border-primary/50"
          >
            {AREA_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
          </select>
        </div>
        <div>
          <p className="text-xs font-mono text-muted-foreground uppercase mb-1">Floor Start</p>
          <input type="number" min={floor.floor_min} max={floor.floor_max}
            value={draft.floor_start ?? ""} onChange={e => onChange({ floor_start: e.target.value ? Number(e.target.value) : null })}
            placeholder={String(floor.floor_min)}
            className="w-full bg-background/60 border border-border/60 rounded px-2 py-1 h-7 text-xs font-mono text-foreground/90 focus:outline-none focus:border-primary/50"
          />
        </div>
        <div>
          <p className="text-xs font-mono text-muted-foreground uppercase mb-1">Floor End</p>
          <input type="number" min={floor.floor_min} max={floor.floor_max}
            value={draft.floor_end ?? ""} onChange={e => onChange({ floor_end: e.target.value ? Number(e.target.value) : null })}
            placeholder={String(floor.floor_max)}
            className="w-full bg-background/60 border border-border/60 rounded px-2 py-1 h-7 text-xs font-mono text-foreground/90 focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="col-span-2">
          <p className="text-xs font-mono text-muted-foreground uppercase mb-1">Description</p>
          <textarea rows={2} value={draft.description ?? ""} onChange={e => onChange({ description: e.target.value })}
            placeholder="Describe this sub-area…"
            className="w-full bg-background/60 border border-border/60 rounded px-2 py-1.5 text-xs font-body text-foreground/90 focus:outline-none focus:border-primary/50 resize-none"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button disabled={saving || !draft.name?.trim()} onClick={onSave}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary/20 border border-primary/40 text-primary text-xs font-mono hover:bg-primary/30 transition-all disabled:opacity-50"
        >
          <Check size={12} />{saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-muted/20 border border-border/40 text-muted-foreground text-xs font-mono hover:bg-muted/40 transition-all"
        >
          <X size={12} />Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function TowerPage() {
  const { profile, updateProfile } = useAppData();
  const [floors, setFloors]             = useState<TowerFloor[]>([]);
  const [subareas, setSubareas]         = useState<TowerSubarea[]>([]);
  const [loading, setLoading]           = useState(true);
  const [editMode, setEditMode]         = useState(false);
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  // Floor editing
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null);
  const [floorDraft, setFloorDraft]     = useState<TowerFloor | null>(null);
  // Subarea editing
  const [subEditId, setSubEditId]       = useState<string | null>(null); // id or "new"
  const [subEditFloorId, setSubEditFloorId] = useState<string | null>(null);
  const [subDraft, setSubDraft]         = useState<Partial<TowerSubarea>>({});

  const [saving, setSaving] = useState(false);

  const currentFloor = profile.current_floor;
  const currentZone  = floors.find(f => currentFloor >= f.floor_min && currentFloor <= f.floor_max);

  const floorStatus = (f: TowerFloor) => {
    if (currentFloor > f.floor_max) return "cleared";
    if (currentFloor >= f.floor_min) return "active";
    return "locked";
  };

  // ── Load ───────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { setLoading(false); return; }
    const uid = session.user.id;

    const { data: rows } = await (supabase as any)
      .from("tower_floors")
      .select("*")
      .eq("user_id", uid)
      .order("floor_min");

    if (!rows?.length) {
      const { data: seeded } = await (supabase as any)
        .from("tower_floors")
        .insert(FLOOR_DEFAULTS.map(d => ({ ...d, user_id: uid })))
        .select();
      setFloors((seeded ?? []) as TowerFloor[]);
      setSubareas([]);
      setLoading(false);
      return;
    }

    setFloors(rows as TowerFloor[]);
    const ids = (rows as TowerFloor[]).map(f => f.id);
    const { data: subs } = await (supabase as any)
      .from("tower_subareas")
      .select("*")
      .in("floor_id", ids)
      .order("floor_start");
    setSubareas((subs ?? []) as TowerSubarea[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Floor advance ──────────────────────────────────────────────────────
  const advanceFloor = async (delta: number) => {
    const next = Math.max(1, Math.min(100, currentFloor + delta));
    await updateProfile({ current_floor: next });
  };

  // ── Floor edit ─────────────────────────────────────────────────────────
  const startEditFloor = (floor: TowerFloor) => {
    setEditingFloorId(floor.id);
    setFloorDraft({ ...floor });
    setExpandedId(floor.id);
    setSubEditId(null);
  };

  const cancelEditFloor = () => {
    setEditingFloorId(null);
    setFloorDraft(null);
  };

  const saveFloor = async () => {
    if (!floorDraft) return;
    setSaving(true);
    try {
      const { id, user_id, created_at, ...fields } = floorDraft as any;
      const { error } = await (supabase as any)
        .from("tower_floors")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      setFloors(prev => prev.map(f => f.id === id ? floorDraft : f));
      cancelEditFloor();
      toast.success("Floor updated");
    } catch {
      toast.error("Failed to save floor");
    } finally {
      setSaving(false);
    }
  };

  // ── Subarea CRUD ───────────────────────────────────────────────────────
  const startAddSubarea = (floorId: string) => {
    setSubEditId("new");
    setSubEditFloorId(floorId);
    setSubDraft({ area_type: "location", name: "", description: "" });
    setExpandedId(floorId);
    setEditingFloorId(null);
  };

  const startEditSubarea = (sub: TowerSubarea) => {
    setSubEditId(sub.id);
    setSubEditFloorId(sub.floor_id);
    setSubDraft({ ...sub });
    setExpandedId(sub.floor_id);
  };

  const cancelSubarea = () => {
    setSubEditId(null);
    setSubEditFloorId(null);
    setSubDraft({});
  };

  const saveSubarea = async () => {
    if (!subDraft.name?.trim() || !subEditFloorId) return;
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) { setSaving(false); return; }
    try {
      if (subEditId === "new") {
        const { data, error } = await (supabase as any)
          .from("tower_subareas")
          .insert({ ...subDraft, user_id: uid, floor_id: subEditFloorId })
          .select()
          .single();
        if (error) throw error;
        setSubareas(prev => [...prev, data as TowerSubarea]);
        toast.success("Sub-area added");
      } else {
        const { id, user_id, floor_id, created_at, ...fields } = subDraft as any;
        const { error } = await (supabase as any)
          .from("tower_subareas")
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", subEditId);
        if (error) throw error;
        setSubareas(prev => prev.map(s => s.id === subEditId ? { ...s, ...subDraft } as TowerSubarea : s));
        toast.success("Sub-area updated");
      }
      cancelSubarea();
    } catch {
      toast.error("Failed to save sub-area");
    } finally {
      setSaving(false);
    }
  };

  const deleteSubarea = async (id: string) => {
    await (supabase as any).from("tower_subareas").delete().eq("id", id).catch(() => {});
    setSubareas(prev => prev.filter(s => s.id !== id));
    toast.success("Sub-area removed");
  };

  const toggleEditMode = () => {
    setEditMode(m => !m);
    cancelEditFloor();
    cancelSubarea();
  };

  // ── Render ─────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="space-y-5">
      <PageHeader title="Tower of Ascent" subtitle="Loading…" icon={<TowerControl size={18} />} />
      <p className="text-xs font-mono text-muted-foreground text-center py-8 animate-pulse">Loading tower data…</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header row with edit toggle */}
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          title="Tower of Ascent"
          subtitle={`Floor ${currentFloor} — ${currentZone?.name ?? "Unknown Zone"}`}
          icon={<TowerControl size={18} />}
        />
        <button
          onClick={toggleEditMode}
          className={`mt-1 shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-mono transition-all ${
            editMode
              ? "bg-primary/15 border-primary/50 text-primary"
              : "bg-muted/10 border-border/40 text-muted-foreground hover:text-foreground hover:border-border/70"
          }`}
        >
          <Pencil size={11} />{editMode ? "DONE EDITING" : "EDIT MAP"}
        </button>
      </div>

      {/* Current zone card */}
      {currentZone && (
        <HudCard className="border-primary/20 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: ec(currentZone.essence) }} />
          <div className="pl-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase">Current Zone</p>
                <h2 className="text-lg font-display font-bold" style={{ color: ec(currentZone.essence) }}>{currentZone.name}</h2>
                <p className="text-xs font-mono text-muted-foreground italic">"{currentZone.law}"</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <button onClick={() => advanceFloor(1)} className="p-1 text-primary hover:bg-primary/10 rounded transition-all" title="Advance floor"><ArrowUp size={14} /></button>
                  <button onClick={() => advanceFloor(-1)} className="p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded transition-all" title="Drop floor"><ArrowDown size={14} /></button>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-display font-black text-primary">{currentFloor}</p>
                  <p className="text-xs font-mono text-muted-foreground">/ 100</p>
                </div>
              </div>
            </div>
            <ProgressBar value={currentFloor} max={100} colorClass="bg-primary" height="sm" />
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-mono text-muted-foreground">Essence</p>
                <p className="text-xs font-mono" style={{ color: ec(currentZone.essence) }}>{currentZone.essence}</p>
              </div>
              <div>
                <p className="text-xs font-mono text-muted-foreground">Energy</p>
                <p className="text-xs font-mono text-foreground">{currentZone.energy}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">Jump to:</span>
              <input
                type="number" min={1} max={100} defaultValue={currentFloor}
                onKeyDown={async e => {
                  if (e.key === "Enter") {
                    const v = Number((e.target as HTMLInputElement).value);
                    if (v >= 1 && v <= 100) await updateProfile({ current_floor: v });
                  }
                }}
                className="w-16 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono text-center focus:outline-none focus:border-primary/40"
              />
            </div>
          </div>
        </HudCard>
      )}

      {/* Floor list */}
      <div className="space-y-2">
        {floors.map(floor => {
          const status     = floorStatus(floor);
          const isActive   = status === "active";
          const isCleared  = status === "cleared";
          const isOpen     = expandedId === floor.id;
          const isEditing  = editingFloorId === floor.id;
          const color      = ec(floor.essence);
          const floorSubs  = subareas.filter(s => s.floor_id === floor.id);
          const isAddingSub = subEditFloorId === floor.id && subEditId === "new";

          return (
            <motion.div
              key={floor.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-lg border transition-all overflow-hidden ${
                isActive  ? "border-primary/40" :
                isCleared ? "border-green-900/40 opacity-75" :
                            "border-border/40 opacity-55"
              }`}
            >
              {/* Row header */}
              <div
                className="flex items-center gap-3 p-3 cursor-pointer select-none"
                onClick={() => setExpandedId(isOpen ? null : floor.id)}
              >
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${isActive ? "animate-pulse" : ""}`}
                  style={{ background: isCleared ? "#22c55e" : isActive ? color : "#444" }}
                />
                <div
                  className="shrink-0 min-w-[52px] text-center px-2 py-0.5 rounded border text-xs font-mono"
                  style={{ borderColor: color + "44", color, background: color + "11" }}
                >
                  {rangeLabel(floor)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-display font-bold ${isActive ? "text-foreground" : "text-muted-foreground"}`}>{floor.name}</span>
                    {isActive  && <span className="text-xs font-mono text-primary border border-primary/30 rounded px-1.5 py-0.5">CURRENT</span>}
                    {isCleared && <span className="text-xs font-mono text-green-400 border border-green-900/40 rounded px-1.5 py-0.5">CLEARED</span>}
                    {floorSubs.length > 0 && (
                      <span className="text-xs font-mono text-muted-foreground">
                        {floorSubs.length} area{floorSubs.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-mono text-muted-foreground italic truncate">"{floor.law}"</p>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <p className="text-xs font-mono" style={{ color }}>{floor.essence}</p>
                  <p className="text-xs font-mono text-muted-foreground">{floor.function}</p>
                </div>
                {editMode && (
                  <button
                    onClick={e => { e.stopPropagation(); isEditing ? cancelEditFloor() : startEditFloor(floor); }}
                    className={`shrink-0 p-1.5 rounded border transition-all ${
                      isEditing
                        ? "border-primary/50 text-primary bg-primary/10"
                        : "border-border/40 text-muted-foreground hover:text-primary hover:border-primary/30"
                    }`}
                    title="Edit floor"
                  >
                    <Pencil size={12} />
                  </button>
                )}
                {isOpen
                  ? <ChevronDown  size={14} className="text-muted-foreground shrink-0" />
                  : <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                }
              </div>

              {/* Expanded content */}
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    {isEditing && floorDraft ? (
                      <FloorEditForm
                        draft={floorDraft}
                        onChange={patch => setFloorDraft(prev => prev ? { ...prev, ...patch } : prev)}
                        onSave={saveFloor}
                        onCancel={cancelEditFloor}
                        saving={saving}
                      />
                    ) : (
                      <div className="border-t border-border/40 p-4 space-y-3">
                        {/* Ecology */}
                        <p className="text-xs font-body text-muted-foreground leading-relaxed">{floor.ecology}</p>

                        {/* Inhabitants / Dangers / Rewards */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <p className="text-xs font-mono text-muted-foreground uppercase mb-1">Inhabitants</p>
                            <p className="text-xs font-body text-foreground">{floor.inhabitants}</p>
                          </div>
                          <div>
                            <p className="text-xs font-mono text-red-400 uppercase mb-1">Dangers</p>
                            <p className="text-xs font-body text-foreground">{floor.dangers}</p>
                          </div>
                          <div>
                            <p className="text-xs font-mono text-green-400 uppercase mb-1">Rewards</p>
                            <p className="text-xs font-body text-foreground">{floor.rewards}</p>
                          </div>
                        </div>

                        {/* Energy / Function footer */}
                        <div className="flex gap-4 pt-1 border-t border-border/30">
                          <span className="text-xs font-mono text-muted-foreground">Energy: {floor.energy}</span>
                          <span className="text-xs font-mono text-muted-foreground">Function: {floor.function}</span>
                        </div>

                        {/* Sub-areas section */}
                        {(floorSubs.length > 0 || editMode) && (
                          <div className="pt-2 border-t border-border/20 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                                Sub-Areas {floorSubs.length > 0 && `(${floorSubs.length})`}
                              </p>
                              {editMode && (
                                <button
                                  onClick={() => isAddingSub ? cancelSubarea() : startAddSubarea(floor.id)}
                                  className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-mono transition-all ${
                                    isAddingSub
                                      ? "border-muted/40 text-muted-foreground bg-muted/10"
                                      : "border-primary/20 text-primary/70 hover:bg-primary/10 hover:text-primary"
                                  }`}
                                >
                                  {isAddingSub ? <><X size={9} />Cancel</> : <><Plus size={9} />Add Sub-Area</>}
                                </button>
                              )}
                            </div>

                            {floorSubs.map(sub =>
                              subEditId === sub.id ? (
                                <SubareaForm
                                  key={sub.id}
                                  draft={subDraft}
                                  onChange={patch => setSubDraft(prev => ({ ...prev, ...patch }))}
                                  onSave={saveSubarea}
                                  onCancel={cancelSubarea}
                                  saving={saving}
                                  floor={floor}
                                />
                              ) : (
                                <SubareaCard
                                  key={sub.id}
                                  sub={sub}
                                  editMode={editMode}
                                  onEdit={() => startEditSubarea(sub)}
                                  onDelete={() => deleteSubarea(sub.id)}
                                />
                              )
                            )}

                            {isAddingSub && (
                              <SubareaForm
                                draft={subDraft}
                                onChange={patch => setSubDraft(prev => ({ ...prev, ...patch }))}
                                onSave={saveSubarea}
                                onCancel={cancelSubarea}
                                saving={saving}
                                floor={floor}
                              />
                            )}

                            {floorSubs.length === 0 && !isAddingSub && editMode && (
                              <p className="text-xs font-mono text-muted-foreground italic">
                                No sub-areas yet — click + Add Sub-Area above.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
