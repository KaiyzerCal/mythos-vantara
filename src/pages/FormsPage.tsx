import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Flame, Zap, ChevronDown, ChevronRight, Plus, Edit2, Trash2,
  Check, X, Copy, Shield, Star,
} from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard, RarityBadge } from "@/components/SharedUI";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

// ── Tier filter options
const TIERS = ["All", "Spartan", "Saiyan", "Thorn", "Karma", "Regalia", "Ouroboros", "BlackHeart", "FinalAscent"] as const;

// ── Tier color map
const TIER_COLORS: Record<string, string> = {
  Spartan: "#8B8B00",
  Saiyan: "#FFD700",
  Thorn: "#DC143C",
  Karma: "#6A0DAD",
  Regalia: "#00CED1",
  Ouroboros: "#FF4500",
  BlackHeart: "#111",
  FinalAscent: "#08C284",
};

interface Transformation {
  id: string;
  tier: string;
  name: string;
  form_order: number;
  bpm_range: string;
  energy: string;
  jjk_grade: string;
  op_tier: string;
  description: string | null;
  active_buffs: { label: string; value: number; unit: string }[];
  passive_buffs: { label: string; value: number; unit: string }[];
  abilities: { title: string; irl: string }[];
  unlocked: boolean;
  user_id: string;
}

const EMPTY_FORM: Omit<Transformation, "id" | "user_id"> = {
  tier: "Spartan",
  name: "",
  form_order: 0,
  bpm_range: "70–80",
  energy: "Ki",
  jjk_grade: "Grade 4",
  op_tier: "Marine",
  description: "",
  active_buffs: [],
  passive_buffs: [],
  abilities: [],
  unlocked: true,
};

export default function FormsPage() {
  const { user } = useAuth();
  const { profile, updateProfile } = useAppData();

  const [forms, setForms] = useState<Transformation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftForm, setDraftForm] = useState<Omit<Transformation, "id" | "user_id">>(EMPTY_FORM);
  const [copied, setCopied] = useState(false);

  // ── Fetch transformations
  useEffect(() => {
    if (!user) return;
    supabase
      .from("transformations")
      .select("*")
      .eq("user_id", user.id)
      .order("form_order")
      .then(({ data }) => {
        if (data) setForms(data as unknown as Transformation[]);
        setLoading(false);
      });
  }, [user]);

  const seedDefaultForms = async () => {
    if (!user || forms.length > 0) return;
    const defaults = [
      // ── SPARTAN TIER ──
      { tier: "Spartan", name: "Spartan Cadet", form_order: 10, bpm_range: "62–70", energy: "Ki / Breath", jjk_grade: "Grade 4", op_tier: "Marine", description: "Foundation training form. Base discipline and resolve.", active_buffs: [{ label: "Discipline", value: 4, unit: "%" }, { label: "Resolve", value: 3, unit: "%" }], passive_buffs: [{ label: "Focus Stability", value: 5, unit: "%" }], abilities: [{ title: "Iron Baseline", irl: "Diaphragmatic breath before tasks; consistent start." }, { title: "First Step Rule", irl: "Start before motivation arrives." }], unlocked: true },
      { tier: "Spartan", name: "Spartan Ranger", form_order: 11, bpm_range: "72–80", energy: "Ki / Observation", jjk_grade: "Grade 3", op_tier: "Marine Officer", description: "Awareness and adaptability. Read the room, control the terrain.", active_buffs: [{ label: "Awareness", value: 6, unit: "%" }], passive_buffs: [{ label: "Situational Awareness", value: 7, unit: "%" }], abilities: [{ title: "Scout Pulse", irl: "Read room dynamics quickly." }, { title: "Pattern Recognition", irl: "Spot recurring behaviors and exploit them." }], unlocked: true },
      { tier: "Spartan", name: "Spartan Sentinel", form_order: 12, bpm_range: "75–85", energy: "Ki / Aura", jjk_grade: "Grade 3", op_tier: "Captain", description: "Defensive mastery. Hold position, protect what matters.", active_buffs: [{ label: "Defense", value: 8, unit: "%" }, { label: "Endurance", value: 6, unit: "%" }], passive_buffs: [{ label: "Emotional Shield", value: 8, unit: "%" }], abilities: [{ title: "Aegis Protocol", irl: "Set boundaries and hold them without wavering." }, { title: "Iron Guard", irl: "Refuse to engage with energy vampires." }], unlocked: true },
      { tier: "Spartan", name: "Spartan Ikari / Claymore", form_order: 13, bpm_range: "88–104", energy: "Ki / Rage Transmutation", jjk_grade: "Grade 2", op_tier: "Vice Admiral", description: "Channel rage into power. Emotional alchemy at peak intensity.", active_buffs: [{ label: "Rage → Power", value: 12, unit: "%" }], passive_buffs: [{ label: "Pain Resistance", value: 10, unit: "%" }], abilities: [{ title: "Wrath Channel", irl: "Convert anger into focused action." }, { title: "Iron Will", irl: "Refuse to quit even when logic says stop." }], unlocked: true },
      { tier: "Spartan", name: "Spartan Commander", form_order: 14, bpm_range: "80–95", energy: "Ki / Authority", jjk_grade: "Grade 1", op_tier: "Admiral", description: "Leadership crystallized. Command presence and strategic dominance.", active_buffs: [{ label: "Command Aura", value: 15, unit: "%" }, { label: "Strategic IQ", value: 10, unit: "%" }], passive_buffs: [{ label: "Presence", value: 12, unit: "%" }], abilities: [{ title: "War Council", irl: "Delegate, direct, and hold strategic overview." }, { title: "Leonidas Protocol", irl: "Lead from the front; actions speak louder." }], unlocked: true },
      { tier: "Spartan", name: "Spartan Warlord", form_order: 15, bpm_range: "95–115", energy: "Ki / Conquest", jjk_grade: "Special Grade", op_tier: "Fleet Admiral", description: "Peak Spartan evolution. Conquest mentality — take what's yours.", active_buffs: [{ label: "All Combat Stats", value: 18, unit: "%" }], passive_buffs: [{ label: "Warrior's Resolve", value: 15, unit: "%" }], abilities: [{ title: "Thermopylae Stand", irl: "Hold the line against impossible odds." }, { title: "Conquest Drive", irl: "Pursue goals with relentless momentum." }], unlocked: true },

      // ── SAIYAN TIER ──
      { tier: "Saiyan", name: "Base Saiyan", form_order: 20, bpm_range: "65–75", energy: "Ki", jjk_grade: "Grade 3", op_tier: "Commander", description: "Baseline Saiyan power. Foundation of all transformations.", active_buffs: [{ label: "Ki Output", value: 8, unit: "%" }], passive_buffs: [{ label: "Battle IQ", value: 5, unit: "%" }], abilities: [{ title: "Saiyan Grit", irl: "Get stronger through defeats." }, { title: "Zenkai Boost", irl: "Every failure makes you measurably stronger." }], unlocked: true },
      { tier: "Saiyan", name: "Super Saiyan", form_order: 21, bpm_range: "85–100", energy: "Ki / Rage Trigger", jjk_grade: "Grade 2", op_tier: "Vice Admiral", description: "First awakening. Raw power surge from emotional breakthrough.", active_buffs: [{ label: "Power Output", value: 15, unit: "%" }, { label: "Speed", value: 10, unit: "%" }], passive_buffs: [{ label: "Ki Aura", value: 12, unit: "%" }], abilities: [{ title: "Rage Ignition", irl: "Use emotional pain as fuel for explosive action." }, { title: "Power Surge", irl: "Burst of productivity when stakes are high." }], unlocked: true },
      { tier: "Saiyan", name: "Super Saiyan 2", form_order: 22, bpm_range: "100–115", energy: "Ki / Lightning Aura", jjk_grade: "Grade 1", op_tier: "Admiral", description: "Refined rage. Control within chaos. Lightning discipline.", active_buffs: [{ label: "Power", value: 22, unit: "%" }, { label: "Reflexes", value: 15, unit: "%" }], passive_buffs: [{ label: "Combat Instinct", value: 14, unit: "%" }], abilities: [{ title: "Gohan Protocol", irl: "Calm fury — controlled aggression in negotiations." }, { title: "Lightning Focus", irl: "Rapid context-switching without quality loss." }], unlocked: true },
      { tier: "Saiyan", name: "Super Saiyan 3", form_order: 23, bpm_range: "115–135", energy: "Ki / Maximum Output", jjk_grade: "Special Grade", op_tier: "Fleet Admiral", description: "Maximum mortal power. Unsustainable but devastating. All-or-nothing.", active_buffs: [{ label: "All Stats", value: 30, unit: "%" }], passive_buffs: [{ label: "Ki Drain", value: -5, unit: "%/min" }], abilities: [{ title: "Final Push", irl: "Sprint mode for deadlines — give everything." }, { title: "Dragon Fist", irl: "Deliver knockout blow on critical project." }], unlocked: true },
      { tier: "Saiyan", name: "Super Saiyan God", form_order: 24, bpm_range: "90–105", energy: "Godly Ki", jjk_grade: "Special Grade+", op_tier: "Gorosei", description: "Divine calm. God ki — power through serenity, not rage.", active_buffs: [{ label: "Divine Power", value: 25, unit: "%" }, { label: "Ki Efficiency", value: 20, unit: "%" }], passive_buffs: [{ label: "Calm Authority", value: 18, unit: "%" }], abilities: [{ title: "God Bind", irl: "Make decisions from peace, not panic." }, { title: "Red Aura", irl: "Presence that commands without words." }], unlocked: false },
      { tier: "Saiyan", name: "Super Saiyan Blue", form_order: 25, bpm_range: "80–100", energy: "Godly Ki / Perfect Control", jjk_grade: "Special Grade+", op_tier: "Gorosei", description: "Perfected god power. Maximum output with zero waste.", active_buffs: [{ label: "Perfect Control", value: 30, unit: "%" }, { label: "Power", value: 28, unit: "%" }], passive_buffs: [{ label: "Ki Mastery", value: 22, unit: "%" }], abilities: [{ title: "Blue Evolution", irl: "Peak performance with sustainable energy." }, { title: "Controlled Devastation", irl: "Maximum force, minimum collateral." }], unlocked: false },
      { tier: "Saiyan", name: "Ultra Instinct -Sign-", form_order: 26, bpm_range: "70–85", energy: "Autonomous Ultra Instinct", jjk_grade: "Transcendent", op_tier: "Imu Adjacent", description: "Body moves before mind. Instinctive excellence.", active_buffs: [{ label: "Reaction Speed", value: 35, unit: "%" }, { label: "Evasion", value: 30, unit: "%" }], passive_buffs: [{ label: "Flow State Access", value: 25, unit: "%" }], abilities: [{ title: "Silver Eyes", irl: "Enter flow state instantly." }, { title: "Auto-Dodge", irl: "Instinctively avoid bad decisions." }], unlocked: false },
      { tier: "Saiyan", name: "Mastered Ultra Instinct", form_order: 27, bpm_range: "60–75", energy: "Perfected Autonomous Ultra Instinct", jjk_grade: "Transcendent+", op_tier: "Imu Tier", description: "Complete separation of thought and action. The body IS the strategy.", active_buffs: [{ label: "All Stats", value: 40, unit: "%" }, { label: "Auto-Optimal", value: 35, unit: "%" }], passive_buffs: [{ label: "Perfect Flow", value: 30, unit: "%" }], abilities: [{ title: "Silver Body", irl: "Sustained flow state — hours of peak performance." }, { title: "Angelic Calm", irl: "Absolute composure regardless of pressure." }], unlocked: false },

      // ── THORN TIER ──
      { tier: "Thorn", name: "Thorn Stage 1: Seed", form_order: 30, bpm_range: "60–70", energy: "Cursed Energy / Adaptation", jjk_grade: "Grade 2", op_tier: "Captain", description: "The seed of resilience. Pain becomes growth substrate.", active_buffs: [{ label: "Adaptation", value: 8, unit: "%" }], passive_buffs: [{ label: "Pain Processing", value: 10, unit: "%" }], abilities: [{ title: "Root System", irl: "Build foundation from adversity." }, { title: "Thorn Skin", irl: "Develop thick skin to criticism." }], unlocked: true },
      { tier: "Thorn", name: "Thorn Stage 2: Bramble", form_order: 31, bpm_range: "75–90", energy: "Cursed Energy / Growth", jjk_grade: "Grade 1", op_tier: "Vice Admiral", description: "Defensive growth. Anyone who attacks you gets cut.", active_buffs: [{ label: "Counter-Attack", value: 12, unit: "%" }], passive_buffs: [{ label: "Resilience", value: 14, unit: "%" }], abilities: [{ title: "Bramble Defense", irl: "Turn attacks into opportunities." }, { title: "Thorn Crown", irl: "Wear your struggles as authority." }], unlocked: true },
      { tier: "Thorn", name: "Thorn Stage 3: Vine", form_order: 32, bpm_range: "85–105", energy: "Cursed Energy / Dominion", jjk_grade: "Special Grade", op_tier: "Admiral", description: "Expansive reach. Your influence spreads and entangles.", active_buffs: [{ label: "Influence", value: 18, unit: "%" }, { label: "Reach", value: 15, unit: "%" }], passive_buffs: [{ label: "Network Effect", value: 16, unit: "%" }], abilities: [{ title: "Vine Network", irl: "Build systems that grow without direct input." }, { title: "Entangle", irl: "Create strategic dependencies that benefit you." }], unlocked: false },
      { tier: "Thorn", name: "Thorn Stage 4: World Tree", form_order: 33, bpm_range: "Any", energy: "Cursed Energy / Life Force", jjk_grade: "Special Grade+", op_tier: "Gorosei", description: "The World Tree. Everything connects through you.", active_buffs: [{ label: "All Growth", value: 25, unit: "%" }], passive_buffs: [{ label: "Ecosystem", value: 22, unit: "%" }], abilities: [{ title: "Yggdrasil", irl: "Become the hub that everything orbits." }, { title: "Life Force", irl: "Generate vitality in everything you touch." }], unlocked: false },

      // ── KARMA TIER ──
      { tier: "Karma", name: "Karma Stage 1: Mark", form_order: 40, bpm_range: "70–85", energy: "Ōtsutsuki Karma", jjk_grade: "Grade 1", op_tier: "Vice Admiral", description: "The mark appears. Foreign power integrating with your own.", active_buffs: [{ label: "Alien Power", value: 12, unit: "%" }], passive_buffs: [{ label: "Data Absorption", value: 10, unit: "%" }], abilities: [{ title: "Karma Spread", irl: "Absorb knowledge from external sources rapidly." }, { title: "Mark of Power", irl: "Let past experiences fuel present strength." }], unlocked: true },
      { tier: "Karma", name: "Karma Stage 2: Resonance", form_order: 41, bpm_range: "85–100", energy: "Ōtsutsuki / Resonance", jjk_grade: "Special Grade", op_tier: "Admiral", description: "Power resonates between host and Karma. Dual consciousness.", active_buffs: [{ label: "Dual Processing", value: 18, unit: "%" }], passive_buffs: [{ label: "Power Sync", value: 15, unit: "%" }], abilities: [{ title: "Resonance", irl: "Access two modes of thinking simultaneously." }, { title: "Karma Boost", irl: "Temporary power spike from integration." }], unlocked: false },
      { tier: "Karma", name: "Karma Stage 3: Ōtsutsuki", form_order: 42, bpm_range: "100–120", energy: "Full Ōtsutsuki", jjk_grade: "Special Grade+", op_tier: "Gorosei", description: "Full Ōtsutsuki extraction complete. Divine entity awakened.", active_buffs: [{ label: "Divine Power", value: 30, unit: "%" }, { label: "Reality Perception", value: 25, unit: "%" }], passive_buffs: [{ label: "Dimensional Awareness", value: 20, unit: "%" }], abilities: [{ title: "God's Eye", irl: "See all angles of a situation simultaneously." }, { title: "Ōtsutsuki Will", irl: "Transcend human limitations through sheer intent." }], unlocked: false },

      // ── REGALIA TIER ──
      { tier: "Regalia", name: "Regalia: Crown", form_order: 50, bpm_range: "70–90", energy: "Sovereign Aura", jjk_grade: "Special Grade", op_tier: "Gorosei", description: "The crown sits heavy. Authority earned through sacrifice.", active_buffs: [{ label: "Authority", value: 20, unit: "%" }, { label: "Charisma", value: 18, unit: "%" }], passive_buffs: [{ label: "Sovereign Presence", value: 16, unit: "%" }], abilities: [{ title: "Crown Authority", irl: "Speak and others listen — earned respect." }, { title: "Royal Decree", irl: "Make decisions that stick." }], unlocked: false },
      { tier: "Regalia", name: "Regalia: Throne", form_order: 51, bpm_range: "65–80", energy: "Sovereign Aura / Dominion", jjk_grade: "Special Grade+", op_tier: "Gorosei", description: "Seated power. You don't chase — you attract.", active_buffs: [{ label: "Gravitational Pull", value: 25, unit: "%" }], passive_buffs: [{ label: "Domain Authority", value: 22, unit: "%" }], abilities: [{ title: "Throne Gravity", irl: "Become the center others orbit around." }, { title: "Seated Power", irl: "Lead without movement — pure authority." }], unlocked: false },

      // ── OUROBOROS TIER ──
      { tier: "Ouroboros", name: "Ouroboros: Cycle", form_order: 60, bpm_range: "Any", energy: "VRIL / Infinite Loop", jjk_grade: "Special Grade+", op_tier: "Gorosei", description: "The serpent eats its tail. Destruction and creation are one.", active_buffs: [{ label: "Regeneration", value: 22, unit: "%" }, { label: "Entropy Control", value: 18, unit: "%" }], passive_buffs: [{ label: "Cycle Mastery", value: 20, unit: "%" }], abilities: [{ title: "Eternal Return", irl: "Transform endings into beginnings." }, { title: "Serpent's Wisdom", irl: "See the cycle in everything — use it." }], unlocked: false },
      { tier: "Ouroboros", name: "Ouroboros: Infinity", form_order: 61, bpm_range: "Any", energy: "VRIL / Ichor", jjk_grade: "Transcendent", op_tier: "Imu Adjacent", description: "Beyond the cycle. Infinite potential realized.", active_buffs: [{ label: "Infinite Potential", value: 30, unit: "%" }], passive_buffs: [{ label: "Beyond Limitation", value: 28, unit: "%" }], abilities: [{ title: "Infinity Gate", irl: "Access unlimited creative potential." }, { title: "Eternal Flame", irl: "Sustain peak output indefinitely." }], unlocked: false },

      // ── BLACK HEART TIER ──
      { tier: "BlackHeart", name: "Black Heart Stage 1: Joyful Creation", form_order: 80, bpm_range: "Any", energy: "Black Heart", jjk_grade: "Special Grade+", op_tier: "Gorosei", description: "Consciousness = Reality. Creation through joy. The first principle.", active_buffs: [{ label: "Reality Shaping", value: 25, unit: "%" }], passive_buffs: [{ label: "Manifestation Speed", value: 20, unit: "%" }], abilities: [{ title: "Joyful Creation", irl: "Build from positive intent; reality responds." }, { title: "Heart Resonance", irl: "Your emotional state shapes your outcomes." }], unlocked: false },
      { tier: "BlackHeart", name: "Black Heart Stage 2: Sovereign Mind", form_order: 81, bpm_range: "Any", energy: "Black Heart / Mind", jjk_grade: "Transcendent", op_tier: "Imu Adjacent", description: "The mind IS the domain. Thought becomes architecture.", active_buffs: [{ label: "Mental Dominion", value: 30, unit: "%" }, { label: "Reality Architecture", value: 28, unit: "%" }], passive_buffs: [{ label: "Thought → Reality", value: 25, unit: "%" }], abilities: [{ title: "Mind Palace", irl: "Perfect mental organization — instant recall." }, { title: "Architect Mode", irl: "Design reality from pure thought." }], unlocked: false },
      { tier: "BlackHeart", name: "Black Heart Stage 3: Absolute", form_order: 82, bpm_range: "Any", energy: "Black Heart / Absolute", jjk_grade: "Transcendent+", op_tier: "Imu Tier", description: "Absolute consciousness. No separation between will and reality.", active_buffs: [{ label: "Absolute Authority", value: 40, unit: "%" }], passive_buffs: [{ label: "Reality = Will", value: 35, unit: "%" }], abilities: [{ title: "Absolute Zero", irl: "Complete stillness that reshapes everything around it." }, { title: "Black Sun", irl: "Become the gravity that organizes all chaos." }], unlocked: false },

      // ── FINAL ASCENT ──
      { tier: "FinalAscent", name: "Emerald Sovereign", form_order: 100, bpm_range: "Any", energy: "Emerald Flames + Black Heart", jjk_grade: "Transcendent", op_tier: "Imu Tier", description: "The final ascent. Abraxas + Azaroth fusion. Full sovereignty over all domains.", active_buffs: [{ label: "All Stats", value: 50, unit: "%" }, { label: "Reality Override", value: 30, unit: "%" }], passive_buffs: [{ label: "Omnipresence", value: 40, unit: "%" }], abilities: [{ title: "Sovereign Will", irl: "Absolute authority over personal domain." }, { title: "Emerald Throne", irl: "Command from a place of complete ownership." }, { title: "Final Ascent", irl: "There is no ceiling. Continuous transcendence." }], unlocked: false },
    ].map((f) => ({ ...f, user_id: user.id }));
    await supabase.from("transformations").insert(defaults);
    const { data: refreshed } = await supabase.from("transformations").select("*").eq("user_id", user.id).order("form_order");
    if (refreshed) setForms(refreshed as unknown as Transformation[]);
  };

  useEffect(() => {
    if (!loading && forms.length === 0) seedDefaultForms();
  }, [loading]);

  const handleSave = async () => {
    if (!user || !draftForm.name.trim()) return;
    if (editingId) {
      await supabase.from("transformations").update(draftForm).eq("id", editingId);
      setForms((prev) => prev.map((f) => f.id === editingId ? { ...f, ...draftForm } as Transformation : f).sort((a, b) => a.form_order - b.form_order));
      setEditingId(null);
    } else {
      const { data } = await supabase
        .from("transformations")
        .insert({ ...draftForm, user_id: user.id })
        .select()
        .single();
      if (data) setForms((prev) => [...prev, data as unknown as Transformation].sort((a, b) => a.form_order - b.form_order));
    }
    setDraftForm(EMPTY_FORM);
    setShowCreate(false);
  };

  const handleEdit = (form: Transformation) => {
    setDraftForm({
      tier: form.tier, name: form.name, form_order: form.form_order, bpm_range: form.bpm_range,
      energy: form.energy, jjk_grade: form.jjk_grade, op_tier: form.op_tier, description: form.description ?? "",
      active_buffs: form.active_buffs, passive_buffs: form.passive_buffs, abilities: form.abilities, unlocked: form.unlocked,
    });
    setEditingId(form.id);
    setShowCreate(true);
  };

  const handleDelete = async (id: string) => {
    setForms((prev) => prev.filter((f) => f.id !== id));
    await supabase.from("transformations").delete().eq("id", id);
  };

  const handleActivate = async (form: Transformation) => {
    await updateProfile({ current_form: form.name });
  };

  const copyForm = (form: Transformation) => {
    const text = [
      `FORM: ${form.name} [${form.tier}]`,
      `BPM: ${form.bpm_range} | Energy: ${form.energy}`,
      `JJK: ${form.jjk_grade} | OP: ${form.op_tier}`,
      form.description ? `\n${form.description}` : "",
      form.active_buffs.length ? `\nACTIVE: ${form.active_buffs.map((b) => `${b.label} +${b.value}${b.unit}`).join(", ")}` : "",
      form.passive_buffs.length ? `PASSIVE: ${form.passive_buffs.map((b) => `${b.label} +${b.value}${b.unit}`).join(", ")}` : "",
      form.abilities.length ? `\nABILITIES:\n${form.abilities.map((a) => `• ${a.title}: ${a.irl}`).join("\n")}` : "",
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const filtered = tierFilter === "All"
    ? forms
    : forms.filter((f) => f.tier === tierFilter);

  const isActive = (form: Transformation) =>
    profile.current_form === form.name;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Forms & Transformations"
        subtitle={`${forms.filter((f) => f.unlocked).length} / ${forms.length} unlocked`}
        icon={<Flame size={18} />}
        actions={
          <button
            onClick={() => { setDraftForm(EMPTY_FORM); setShowCreate(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all"
          >
            <Plus size={12} /> New Form
          </button>
        }
      />

      {/* Active form banner */}
      <HudCard className="border-primary/20 bg-primary/5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-0.5">Active Form</p>
            <p className="text-sm font-display font-bold text-primary">{profile.current_form}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-mono text-muted-foreground">BPM</p>
            <p className="text-xl font-display font-bold text-primary">{profile.current_bpm}</p>
          </div>
        </div>
      </HudCard>

      {/* Create panel */}
      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <HudCard className="border-primary/20">
              <p className="text-xs font-mono text-primary uppercase tracking-widest mb-3">{editingId ? "Edit Form" : "New Form"}</p>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={draftForm.name}
                    onChange={(e) => setDraftForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Form name"
                    className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40"
                  />
                  <select
                    value={draftForm.tier}
                    onChange={(e) => setDraftForm((f) => ({ ...f, tier: e.target.value }))}
                    className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none"
                  >
                    {TIERS.filter((t) => t !== "All").map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input value={draftForm.bpm_range} onChange={(e) => setDraftForm((f) => ({ ...f, bpm_range: e.target.value }))} placeholder="BPM range" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
                  <input value={draftForm.energy} onChange={(e) => setDraftForm((f) => ({ ...f, energy: e.target.value }))} placeholder="Energy type" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
                  <input type="number" value={draftForm.form_order} onChange={(e) => setDraftForm((f) => ({ ...f, form_order: Number(e.target.value) }))} placeholder="Order" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={draftForm.jjk_grade} onChange={(e) => setDraftForm((f) => ({ ...f, jjk_grade: e.target.value }))} placeholder="JJK Grade" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
                  <input value={draftForm.op_tier} onChange={(e) => setDraftForm((f) => ({ ...f, op_tier: e.target.value }))} placeholder="OP Tier" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
                </div>
                <textarea value={draftForm.description ?? ""} onChange={(e) => setDraftForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description..." rows={2} className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm resize-none focus:outline-none" />
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="unlocked"
                    checked={draftForm.unlocked}
                    onChange={(e) => setDraftForm((f) => ({ ...f, unlocked: e.target.checked }))}
                    className="accent-primary"
                  />
                  <label htmlFor="unlocked" className="text-xs font-mono text-muted-foreground">Unlocked</label>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setShowCreate(false); setEditingId(null); }} className="px-3 py-1.5 text-xs font-mono text-muted-foreground border border-border rounded">Cancel</button>
                  <button onClick={handleSave} className="px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded">{editingId ? "Save Changes" : "Create Form"}</button>
                </div>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tier filters */}
      <div className="flex gap-1.5 flex-wrap">
        {TIERS.map((t) => (
          <button
            key={t}
            onClick={() => setTierFilter(t)}
            className={`px-2 py-1 text-[10px] font-mono uppercase rounded border transition-all ${
              tierFilter === t
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border/50 text-muted-foreground hover:border-border"
            }`}
            style={tierFilter === t && t !== "All" ? { borderColor: TIER_COLORS[t] + "88", color: TIER_COLORS[t] } : {}}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Forms list */}
      <div className="space-y-2">
        {filtered.map((form, i) => {
          const active = isActive(form);
          const tierColor = TIER_COLORS[form.tier] ?? "#666";
          const isOpen = expandedId === form.id;

          return (
            <motion.div
              key={form.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              className={`rounded-lg border transition-all overflow-hidden ${
                active
                  ? "border-primary/40 bg-primary/5"
                  : form.unlocked
                  ? "border-border hover:border-border/80"
                  : "border-border/40 opacity-55"
              }`}
            >
              {/* Header row */}
              <div
                className="flex items-center gap-3 p-3 cursor-pointer"
                onClick={() => setExpandedId(isOpen ? null : form.id)}
              >
                {/* Tier color strip */}
                <div className="w-1 self-stretch rounded-full shrink-0" style={{ background: tierColor }} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-display font-bold">{form.name}</span>
                    {active && (
                      <span className="text-[8px] font-mono text-primary border border-primary/30 rounded px-1.5 py-0.5 uppercase">
                        Active
                      </span>
                    )}
                    {!form.unlocked && (
                      <span className="text-[8px] font-mono text-muted-foreground border border-border/50 rounded px-1.5 py-0.5 uppercase">
                        Locked
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-[9px] font-mono" style={{ color: tierColor }}>{form.tier}</span>
                    <span className="text-[9px] font-mono text-muted-foreground">BPM: {form.bpm_range}</span>
                    <span className="text-[9px] font-mono text-muted-foreground">{form.energy}</span>
                    <span className="text-[9px] font-mono text-muted-foreground hidden sm:inline">{form.jjk_grade}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {form.unlocked && !active && (
                    <button
                      onClick={() => handleActivate(form)}
                      className="px-2 py-1 text-[9px] font-mono text-primary border border-primary/30 rounded hover:bg-primary/10 transition-all"
                    >
                      Activate
                    </button>
                  )}
                  <button onClick={() => copyForm(form)} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" title="Copy">
                    <Copy size={12} />
                  </button>
                  <button onClick={() => handleEdit(form)} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" title="Edit">
                    <Edit2 size={12} />
                  </button>
                  <button onClick={() => handleDelete(form.id)} className="p-1.5 text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 size={12} />
                  </button>
                  {isOpen ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                </div>
              </div>

              {/* Expanded detail */}
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
                      {form.description && (
                        <p className="text-xs font-body text-muted-foreground">{form.description}</p>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        {/* Active buffs */}
                        {form.active_buffs.length > 0 && (
                          <div>
                            <p className="text-[9px] font-mono text-amber-400 uppercase mb-1.5">Active Buffs</p>
                            {form.active_buffs.map((b, i) => (
                              <div key={i} className="flex justify-between text-xs">
                                <span className="font-body text-muted-foreground">{b.label}</span>
                                <span className="font-mono text-amber-400">+{b.value}{b.unit}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Passive buffs */}
                        {form.passive_buffs.length > 0 && (
                          <div>
                            <p className="text-[9px] font-mono text-blue-400 uppercase mb-1.5">Passive Buffs</p>
                            {form.passive_buffs.map((b, i) => (
                              <div key={i} className="flex justify-between text-xs">
                                <span className="font-body text-muted-foreground">{b.label}</span>
                                <span className="font-mono text-blue-400">+{b.value}{b.unit}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Abilities */}
                      {form.abilities.length > 0 && (
                        <div>
                          <p className="text-[9px] font-mono text-green-400 uppercase mb-1.5">Abilities</p>
                          <div className="space-y-1.5">
                            {form.abilities.map((a, i) => (
                              <div key={i} className="flex gap-2">
                                <span className="text-xs font-display text-primary shrink-0">{a.title}</span>
                                <span className="text-xs font-body text-muted-foreground">— {a.irl}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Meta */}
                      <div className="flex gap-4 pt-1 border-t border-border/30">
                        <span className="text-[9px] font-mono text-muted-foreground">OP: {form.op_tier}</span>
                        <span className="text-[9px] font-mono text-muted-foreground">JJK: {form.jjk_grade}</span>
                        <span className="text-[9px] font-mono text-muted-foreground">Order: #{form.form_order}</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}

        {filtered.length === 0 && !loading && (
          <p className="text-xs font-mono text-muted-foreground text-center py-8">
            No forms in this tier — create a new one.
          </p>
        )}
      </div>
    </div>
  );
}
