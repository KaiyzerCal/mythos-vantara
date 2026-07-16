// ============================================================
// VANTARA.EXE — QuestsPage, CouncilsPage, EnergyPage
// ============================================================
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { motion, AnimatePresence } from "framer-motion";
import { Target, Plus, Trash2, CheckCircle2, Filter, Loader2, Users, MessageCircle, Send, Square, X, Edit2, ArrowDown, ArrowUp, Database, PhoneCall, Check, ChevronDown, ChevronRight, Wand2, ArrowRight, Copy, Brain } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PageHeader, HudCard, ProgressBar, QuestTypeBadge, RarityBadge, FieldError, fieldClass } from "@/components/SharedUI";
import { Skeleton } from "@/components/ui/skeleton";
import { AvatarUploader } from "@/components/AvatarUploader";
import ReactMarkdown from "react-markdown";
import { useElevenLabsTts } from "@/hooks/useElevenLabsTts";
import { useChatAttachments } from "@/hooks/useChatAttachments";
import { VoicePicker } from "@/components/chat/VoicePicker";
import { AttachmentTray, AttachButton } from "@/components/chat/AttachmentTray";
import { DEFAULT_VOICE_BY_GENDER, findVoice, type VoiceGender } from "@/lib/voiceCatalog";
import { VoiceChatOverlay } from "@/components/VoiceChatOverlay";
import type { VoicePersona } from "@/components/VoiceChatOverlay";
import { buildCouncilMemberPrompt, buildCouncilMemberVoicePrompt, buildContextSummary } from "@/mavis/councilPersona";
import { loadFullAppContext } from "@/mavis/appContextLoader";
import type { AppContextSnapshot } from "@/mavis/appContextLoader";

const QUEST_TYPES = ["all", "main", "epic", "side", "daily"] as const;
const QUEST_STATUSES = ["all", "active", "completed", "failed", "locked"] as const;

function SubQuestRow({ sq, onComplete, onDelete }: { sq: any; onComplete: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <div className={`flex items-center gap-2 pl-4 py-1.5 border-l-2 ${sq.status === 'completed' ? 'border-green-500/30 opacity-50' : 'border-purple-500/30'}`}>
      <button
        onClick={() => onComplete(sq.id)}
        className={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors ${sq.status === 'completed' ? 'bg-green-500 border-green-500' : 'border-gray-500 hover:border-purple-400'}`}
      >
        {sq.status === 'completed' && <Check className="w-2.5 h-2.5 text-white" />}
      </button>
      <span className={`text-sm flex-1 ${sq.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
        {sq.title}
      </span>
      <span className="text-xs text-purple-400 font-mono">{sq.xp_reward}xp</span>
      <button onClick={() => onDelete(sq.id)} className="text-muted-foreground hover:text-red-400 transition-colors ml-1">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function AddSubQuestRow({ parentId, onCreate }: { parentId: string; onCreate: (data: any) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 pl-4 py-1 text-xs text-muted-foreground hover:text-purple-400 transition-colors border-l-2 border-transparent hover:border-purple-500/30 w-full"
      >
        <Plus className="w-3 h-3" /> Add sub-quest
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 pl-4 border-l-2 border-purple-500/50">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) {
            onCreate({ title: title.trim(), type: "side", difficulty: "Easy", xp_reward: 25, parent_quest_id: parentId, status: "active", progress_current: 0, progress_target: 1, category: null, deadline: null });
            setTitle("");
            setOpen(false);
          }
          if (e.key === "Escape") { setTitle(""); setOpen(false); }
        }}
        placeholder="Sub-quest title... (Enter to save)"
        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none py-1"
      />
      <button onClick={() => { setTitle(""); setOpen(false); }} className="text-muted-foreground hover:text-foreground">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function QuestsPage() {
  const { quests, questsLoading, questStats, createQuest, updateQuest, completeQuest, deleteQuest, awardXP, logActivity, skills, updateSkill, energySystems, updateEnergyFull, updateProfile, profile, createInventoryItem } = useAppData();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedQuest, setExpandedQuest] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);
  const [form, setForm] = useState({
    title: "", description: "", type: "daily", difficulty: "Normal", xp_reward: 100,
    real_world_mapping: "", linked_skill_ids: [] as string[], linked_stat: "", linked_energy_id: "",
    codex_points_reward: 0,
    buff_effects: [] as { label: string; value: number; unit: string; duration?: string }[],
    debuff_effects: [] as { label: string; value: number; unit: string; duration?: string }[],
    loot_rewards: [] as { itemName: string; quantity: number; rarity?: string }[],
    // ISA schema (LifeOS)
    current_state: "",
    ideal_state: "",
    effort_tier: "" as "" | "E1" | "E2" | "E3" | "E4" | "E5",
    phase: "" as "" | "PLAN" | "BUILD" | "VERIFY" | "DONE",
    completion_criteria: [] as string[],
  });
  const [formErrors, setFormErrors] = useState<{ title?: string }>({});
  const [newBuff, setNewBuff] = useState({ label: "", value: 0, unit: "%", duration: "" });
  const [newDebuff, setNewDebuff] = useState({ label: "", value: 0, unit: "%", duration: "" });
  const [newLoot, setNewLoot] = useState({ itemName: "", quantity: 1, rarity: "common" });

  // ── Quest Chains ─────────────────────────────────────────
  const [questChains, setQuestChains] = useState<any[]>([]);
  const [chainsPanelOpen, setChainsPanelOpen] = useState(true);
  const [chainsLoading, setChainsLoading] = useState(false);

  const loadQuestChains = useCallback(async () => {
    const { data: { user } } = await (supabase as any).auth.getUser();
    if (!user) return;
    const { data: chains } = await (supabase as any)
      .from("quest_chains")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (!chains?.length) { setQuestChains([]); return; }
    const chainIds = chains.map((c: any) => c.id);
    const { data: items } = await (supabase as any)
      .from("quest_chain_items")
      .select("chain_id, quest_id, position")
      .in("chain_id", chainIds)
      .order("position", { ascending: true });
    const itemsByChain: Record<string, any[]> = {};
    for (const item of items ?? []) {
      if (!itemsByChain[item.chain_id]) itemsByChain[item.chain_id] = [];
      itemsByChain[item.chain_id].push(item);
    }
    setQuestChains(chains.map((c: any) => ({ ...c, items: (itemsByChain[c.id] ?? []).sort((a: any, b: any) => a.position - b.position) })));
  }, []);

  useEffect(() => { loadQuestChains(); }, [loadQuestChains]);

  const autoLinkQuestChains = async () => {
    const { data: { session } } = await (supabase as any).auth.getSession();
    if (!session?.user) return;
    const user = session.user;
    setChainsLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-chain-builder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ userId: user.id, action: "auto_link_quest_chains" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await loadQuestChains();
      toast.success(`Created ${data.chains_created} quest chain${data.chains_created !== 1 ? "s" : ""}`);
      setChainsPanelOpen(true);
    } catch (e: any) {
      toast.error(e.message ?? "Chain linking failed");
    } finally {
      setChainsLoading(false);
    }
  };

  const questIds = useMemo(() => new Set(quests.map((q: any) => q.id)), [quests]);
  const parentQuests = useMemo(
    // Include "orphaned" sub-quests whose parent no longer exists so they're never invisible.
    () => quests.filter((q: any) => !q.parent_quest_id || !questIds.has(q.parent_quest_id)),
    [quests, questIds]
  );
  const subQuestMap = useMemo(() => {
    const map: Record<string, any[]> = {};
    quests.forEach((q: any) => {
      if (q.parent_quest_id && questIds.has(q.parent_quest_id)) {
        if (!map[q.parent_quest_id]) map[q.parent_quest_id] = [];
        map[q.parent_quest_id].push(q);
      }
    });
    return map;
  }, [quests, questIds]);

  const filtered = parentQuests.filter((q: any) =>
    (typeFilter === "all" || q.type === typeFilter) &&
    (statusFilter === "all" || q.status === statusFilter)
  );

  const resetForm = () => {
    setForm({
      title: "", description: "", type: "daily", difficulty: "Normal", xp_reward: 100,
      real_world_mapping: "", linked_skill_ids: [], linked_stat: "", linked_energy_id: "",
      codex_points_reward: 0, buff_effects: [], debuff_effects: [], loot_rewards: [],
      current_state: "", ideal_state: "", effort_tier: "", phase: "", completion_criteria: [],
    });
    setEditingId(null);
    setShowCreate(false);
  };

  const handleEdit = (q: any) => {
    setForm({
      title: q.title, description: q.description, type: q.type, difficulty: q.difficulty,
      xp_reward: q.xp_reward, real_world_mapping: q.real_world_mapping || "",
      linked_skill_ids: q.linked_skill_ids || [],
      linked_stat: q.real_world_mapping?.startsWith("stat:") ? q.real_world_mapping.replace("stat:", "") : "",
      linked_energy_id: q.real_world_mapping?.startsWith("energy:") ? q.real_world_mapping.replace("energy:", "") : "",
      codex_points_reward: q.codex_points_reward || 0,
      buff_effects: q.buff_effects || [],
      debuff_effects: q.debuff_effects || [],
      loot_rewards: q.loot_rewards || [],
      current_state: q.current_state || "",
      ideal_state: q.ideal_state || "",
      effort_tier: q.effort_tier || "",
      phase: q.phase || "",
      completion_criteria: Array.isArray(q.completion_criteria) ? q.completion_criteria : [],
    });
    setEditingId(q.id);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      setFormErrors({ title: "Title is required" });
      return;
    }
    setFormErrors({});
    let mapping = form.real_world_mapping;
    if (form.linked_stat) mapping = `stat:${form.linked_stat}`;
    else if (form.linked_energy_id) mapping = `energy:${form.linked_energy_id}`;

    const payload = {
      title: form.title, description: form.description, type: form.type, difficulty: form.difficulty,
      xp_reward: Number(form.xp_reward), linked_skill_ids: form.linked_skill_ids,
      real_world_mapping: mapping || null,
      codex_points_reward: Number(form.codex_points_reward),
      buff_effects: form.buff_effects,
      debuff_effects: form.debuff_effects,
      loot_rewards: form.loot_rewards,
      current_state: form.current_state || null,
      ideal_state: form.ideal_state || null,
      effort_tier: form.effort_tier || null,
      phase: form.phase || null,
      completion_criteria: form.completion_criteria,
    };

    if (editingId) {
      await updateQuest(editingId, payload);
    } else {
      await createQuest({
        ...payload, status: "active",
        progress_current: 0, progress_target: 1,
        category: null, deadline: null,
      });
    }
    resetForm();
  };

  const handleComplete = async (q: any) => {
    await completeQuest(q.id);
    await awardXP(q.xp_reward);
    await logActivity("quest_complete", `Completed: ${q.title}`, q.xp_reward);

    // Calculate XP-scaled reward: harder quests = bigger boosts
    const difficultyMultiplier: Record<string, number> = { Easy: 1, Normal: 2, Hard: 3, Extreme: 5, Impossible: 8 };
    const mult = difficultyMultiplier[q.difficulty] ?? 2;
    const xpScale = Math.max(1, Math.floor(q.xp_reward / 50));

    // Level up linked skills — proficiency gains scale with quest XP
    if (q.linked_skill_ids?.length) {
      const profGain = Math.min(15, Math.max(2, xpScale * mult));
      for (const skillId of q.linked_skill_ids) {
        const skill = skills.find((s) => s.id === skillId);
        if (skill) {
          const newProf = Math.min(100, skill.proficiency + profGain);
          await updateSkill(skillId, { proficiency: newProf });
          await logActivity("skill_xp", `${skill.name} +${profGain} proficiency from quest`, profGain);
        }
      }
    }

    // Boost linked stat — scales with difficulty (+1 Easy, +2 Normal, +3 Hard, etc.)
    if (q.real_world_mapping?.startsWith("stat:")) {
      const statKey = q.real_world_mapping.replace("stat:", "");
      const statDbKey = `stat_${statKey.toLowerCase()}`;
      const currentVal = (profile as any)[statDbKey];
      const statGain = Math.min(5, mult);
      if (typeof currentVal === "number") {
        await updateProfile({ [statDbKey]: currentVal + statGain } as any);
        await logActivity("stat_xp", `${statKey} +${statGain} from quest`, statGain);
      }
    }

    // Boost linked energy — proficiency/status upgrade based on quest XP
    if (q.real_world_mapping?.startsWith("energy:")) {
      const energyId = q.real_world_mapping.replace("energy:", "");
      const energy = energySystems.find((e) => e.id === energyId);
      if (energy) {
        const energyGain = Math.min(10, Math.max(2, xpScale * mult));
        const newVal = Math.min(energy.max_value, energy.current_value + energyGain);
        // Auto-upgrade status at thresholds
        let newStatus = energy.status;
        const pct = (newVal / energy.max_value) * 100;
        if (pct >= 100) newStatus = "perfect";
        else if (pct >= 90) newStatus = "mastered";
        else if (pct >= 70) newStatus = "advanced";
        await updateEnergyFull(energyId, { current_value: newVal, status: newStatus });
        await logActivity("energy_xp", `${energy.type} +${energyGain} from quest`, energyGain);
      }
    }

    // Award codex points
    if (q.codex_points_reward > 0) {
      const newCodex = (profile.codex_integrity || 0) + q.codex_points_reward;
      await updateProfile({ codex_integrity: Math.min(100, newCodex) } as any);
      await logActivity("codex_points", `+${q.codex_points_reward} Codex Points from quest`, q.codex_points_reward);
    }

    // Log buff effects
    if ((q.buff_effects as any[])?.length > 0) {
      for (const buff of q.buff_effects as any[]) {
        await logActivity("buff_applied", `Buff: ${buff.label} +${buff.value}${buff.unit}`, 0);
      }
    }

    // Log debuff effects
    if ((q.debuff_effects as any[])?.length > 0) {
      for (const debuff of q.debuff_effects as any[]) {
        await logActivity("debuff_applied", `Debuff: ${debuff.label} -${debuff.value}${debuff.unit}`, 0);
      }
    }

    // Award loot drops to inventory
    if ((q.loot_rewards as any[])?.length > 0) {
      for (const loot of q.loot_rewards as any[]) {
        await createInventoryItem({
          name: loot.itemName, description: `Loot from quest: ${q.title}`,
          type: "material", rarity: loot.rarity || "common", quantity: loot.quantity,
          effect: null, slot: null, tier: null, stat_effects: [], is_equipped: false,
        });
        await logActivity("loot_drop", `Loot: ${loot.itemName} ×${loot.quantity}`, 0);
      }
    }
  };

  if (questsLoading) return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
      </div>
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="hud-border rounded-lg p-4 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quest Log"
        subtitle={`${questStats.active} Active · ${questStats.completed} Completed · ${questStats.xpEarned.toLocaleString()} XP`}
        icon={<Target size={18} />}
        actions={
          <button onClick={() => { resetForm(); setShowCreate(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all">
            <Plus size={12} /> New Quest
          </button>
        }
      />

      {/* Quest Chains */}
      <HudCard className="border-purple-500/20 bg-purple-500/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ArrowRight size={12} className="text-purple-400" />
            <span className="text-xs font-mono text-purple-400 uppercase tracking-widest">Quest Chains</span>
            {questChains.length > 0 && (
              <span className="text-xs font-mono text-muted-foreground">({questChains.length})</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={autoLinkQuestChains}
              disabled={chainsLoading}
              className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-purple-400 border border-purple-500/30 rounded hover:bg-purple-500/10 transition-all disabled:opacity-50"
            >
              {chainsLoading ? <Loader2 size={9} className="animate-spin" /> : <Wand2 size={9} />}
              {chainsLoading ? "Linking..." : "AI Generate"}
            </button>
            <button onClick={() => setChainsPanelOpen((v) => !v)} className="text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown size={12} className={`transition-transform ${chainsPanelOpen ? "" : "-rotate-90"}`} />
            </button>
          </div>
        </div>
        {chainsPanelOpen && (
          questChains.length === 0 ? (
            <p className="text-xs font-mono text-muted-foreground text-center py-2">
              No chains yet — click "AI Generate" to let MAVIS detect quest progressions
            </p>
          ) : (
            <div className="space-y-3">
              {questChains.map((chain: any) => (
                <div key={chain.id} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-display font-bold text-foreground">{chain.title}</span>
                    {chain.category && (
                      <span className="text-xs font-mono text-purple-400/70 border border-purple-500/20 rounded px-1.5 py-0.5">{chain.category}</span>
                    )}
                    {chain.status === "completed" && (
                      <span className="text-xs font-mono text-green-400 border border-green-500/20 rounded px-1 py-0.5">COMPLETE</span>
                    )}
                  </div>
                  {chain.description && (
                    <p className="text-xs font-body text-muted-foreground leading-relaxed">{chain.description}</p>
                  )}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                    {(chain.items ?? []).map((item: any, idx: number) => {
                      const q = quests.find((qx: any) => qx.id === item.quest_id);
                      if (!q) return null;
                      const isCompleted = q.status === "completed";
                      const isActive = q.status === "active";
                      return (
                        <div key={item.quest_id} className="flex items-center gap-1.5 shrink-0">
                          {idx > 0 && <ChevronRight size={10} className="text-purple-500/40 shrink-0" />}
                          <div className={`rounded px-2 py-1.5 border text-xs font-mono shrink-0 min-w-[80px] max-w-[130px] ${
                            isCompleted ? "bg-green-500/10 border-green-500/30 text-green-400" :
                            isActive ? "bg-primary/10 border-primary/30 text-primary" :
                            "bg-muted/10 border-border/30 text-muted-foreground"
                          }`}>
                            <div className="truncate font-bold">{q.title}</div>
                            <div className="text-xs opacity-70 mt-0.5">
                              {isCompleted ? "✓ Done" : isActive ? "● Active" : "○ Next"} · +{q.xp_reward}XP
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </HudCard>

      {showCreate && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <HudCard className="border-primary/20">
            <p className="text-xs font-mono text-primary mb-3 uppercase tracking-widest">{editingId ? "Edit Quest" : "New Quest"}</p>
            <div className="space-y-2">
              <div>
                <input
                  value={form.title}
                  onChange={(e) => { setForm((f) => ({ ...f, title: e.target.value })); if (formErrors.title) setFormErrors({}); }}
                  placeholder="Quest title..."
                  className={fieldClass(!!formErrors.title).replace("resize-none", "").replace("text-sm font-mono", "text-sm font-body")}
                />
                <FieldError message={formErrors.title} />
              </div>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description..." rows={2} className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm font-body resize-none focus:outline-none focus:border-primary/40" />
              <div className="grid grid-cols-3 gap-2">
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                  {["main", "epic", "side", "daily"].map((t) => <option key={t}>{t}</option>)}
                </select>
                <select value={form.difficulty} onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                  {["Easy", "Normal", "Hard", "Extreme", "Impossible"].map((d) => <option key={d}>{d}</option>)}
                </select>
                <input type="number" value={form.xp_reward} onChange={(e) => setForm((f) => ({ ...f, xp_reward: Number(e.target.value) }))} placeholder="XP" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
              </div>
              {/* Linking: Skills */}
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase mb-1">Link Skills (proficiency +5 on completion)</p>
                <div className="flex gap-1.5 flex-wrap">
                  {skills.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setForm((f) => ({
                        ...f,
                        linked_skill_ids: f.linked_skill_ids.includes(s.id)
                          ? f.linked_skill_ids.filter((id) => id !== s.id)
                          : [...f.linked_skill_ids, s.id],
                      }))}
                      className={`px-2 py-0.5 text-xs font-mono rounded border transition-all ${
                        form.linked_skill_ids.includes(s.id)
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : "border-border/50 text-muted-foreground hover:border-border"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                  {skills.length === 0 && <span className="text-xs font-mono text-muted-foreground">No skills — create skills first</span>}
                </div>
              </div>
              {/* Linking: Stat */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs font-mono text-muted-foreground uppercase mb-1">Link Stat (+1 on completion)</p>
                  <select value={form.linked_stat} onChange={(e) => setForm((f) => ({ ...f, linked_stat: e.target.value, linked_energy_id: "" }))} className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                    <option value="">None</option>
                    {["STR", "AGI", "VIT", "INT", "WIS", "CHA", "LCK"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-xs font-mono text-muted-foreground uppercase mb-1">Link Energy (+5 on completion)</p>
                  <select value={form.linked_energy_id} onChange={(e) => setForm((f) => ({ ...f, linked_energy_id: e.target.value, linked_stat: "" }))} className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                    <option value="">None</option>
                    {energySystems.map((e) => <option key={e.id} value={e.id}>{e.type}</option>)}
                  </select>
                </div>
              </div>
              <input value={form.real_world_mapping.startsWith("stat:") || form.real_world_mapping.startsWith("energy:") ? "" : form.real_world_mapping} onChange={(e) => setForm((f) => ({ ...f, real_world_mapping: e.target.value }))} placeholder="Real-world mapping (e.g. SkyforgeAI, Bioneer)..." className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
              
              {/* Codex Points */}
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase mb-1">Codex Points Reward</p>
                <input type="number" value={form.codex_points_reward} onChange={(e) => setForm((f) => ({ ...f, codex_points_reward: Number(e.target.value) }))} placeholder="0" className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" min={0} />
              </div>

              {/* Buff Effects */}
              <div>
                <p className="text-xs font-mono text-green-400 uppercase mb-1">Buff Effects (status boosts on completion)</p>
                <div className="flex gap-1 flex-wrap mb-1">
                  {form.buff_effects.map((b, i) => (
                    <span key={i} className="text-xs font-mono text-green-400 border border-green-700/30 rounded px-1.5 py-0.5 flex items-center gap-1">
                      ▲ {b.label} +{b.value}{b.unit} {b.duration && `(${b.duration})`}
                      <button onClick={() => setForm((f) => ({ ...f, buff_effects: f.buff_effects.filter((_, j) => j !== i) }))} className="text-destructive hover:text-destructive/80">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-1">
                  <input value={newBuff.label} onChange={(e) => setNewBuff((b) => ({ ...b, label: e.target.value }))} placeholder="Buff name" className="flex-1 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                  <input type="number" value={newBuff.value} onChange={(e) => setNewBuff((b) => ({ ...b, value: Number(e.target.value) }))} className="w-14 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                  <input value={newBuff.unit} onChange={(e) => setNewBuff((b) => ({ ...b, unit: e.target.value }))} className="w-10 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                  <input value={newBuff.duration} onChange={(e) => setNewBuff((b) => ({ ...b, duration: e.target.value }))} placeholder="Duration" className="w-16 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                  <button onClick={() => { if (newBuff.label) { setForm((f) => ({ ...f, buff_effects: [...f.buff_effects, { ...newBuff, duration: newBuff.duration || undefined }] })); setNewBuff({ label: "", value: 0, unit: "%", duration: "" }); } }} className="px-2 py-1 text-xs font-mono text-green-400 border border-green-700/30 rounded hover:bg-green-400/10">+</button>
                </div>
              </div>

              {/* Debuff Effects */}
              <div>
                <p className="text-xs font-mono text-red-400 uppercase mb-1">Debuff Effects (penalties/risks)</p>
                <div className="flex gap-1 flex-wrap mb-1">
                  {form.debuff_effects.map((d, i) => (
                    <span key={i} className="text-xs font-mono text-red-400 border border-red-700/30 rounded px-1.5 py-0.5 flex items-center gap-1">
                      ▼ {d.label} -{d.value}{d.unit} {d.duration && `(${d.duration})`}
                      <button onClick={() => setForm((f) => ({ ...f, debuff_effects: f.debuff_effects.filter((_, j) => j !== i) }))} className="text-destructive hover:text-destructive/80">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-1">
                  <input value={newDebuff.label} onChange={(e) => setNewDebuff((d) => ({ ...d, label: e.target.value }))} placeholder="Debuff name" className="flex-1 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                  <input type="number" value={newDebuff.value} onChange={(e) => setNewDebuff((d) => ({ ...d, value: Number(e.target.value) }))} className="w-14 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                  <input value={newDebuff.unit} onChange={(e) => setNewDebuff((d) => ({ ...d, unit: e.target.value }))} className="w-10 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                  <input value={newDebuff.duration} onChange={(e) => setNewDebuff((d) => ({ ...d, duration: e.target.value }))} placeholder="Duration" className="w-16 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                  <button onClick={() => { if (newDebuff.label) { setForm((f) => ({ ...f, debuff_effects: [...f.debuff_effects, { ...newDebuff, duration: newDebuff.duration || undefined }] })); setNewDebuff({ label: "", value: 0, unit: "%", duration: "" }); } }} className="px-2 py-1 text-xs font-mono text-red-400 border border-red-700/30 rounded hover:bg-red-400/10">+</button>
                </div>
              </div>

              {/* Loot Rewards */}
              <div>
                <p className="text-xs font-mono text-amber-400 uppercase mb-1">Loot Drops (items rewarded on completion)</p>
                <div className="flex gap-1 flex-wrap mb-1">
                  {form.loot_rewards.map((l, i) => (
                    <span key={i} className="text-xs font-mono text-amber-400 border border-amber-700/30 rounded px-1.5 py-0.5 flex items-center gap-1">
                      🎁 {l.itemName} ×{l.quantity} {l.rarity && `(${l.rarity})`}
                      <button onClick={() => setForm((f) => ({ ...f, loot_rewards: f.loot_rewards.filter((_, j) => j !== i) }))} className="text-destructive hover:text-destructive/80">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-1">
                  <input value={newLoot.itemName} onChange={(e) => setNewLoot((l) => ({ ...l, itemName: e.target.value }))} placeholder="Item name" className="flex-1 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                  <input type="number" value={newLoot.quantity} onChange={(e) => setNewLoot((l) => ({ ...l, quantity: Number(e.target.value) }))} min={1} className="w-12 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                  <select value={newLoot.rarity} onChange={(e) => setNewLoot((l) => ({ ...l, rarity: e.target.value }))} className="bg-muted/30 border border-border rounded px-1 py-1 text-xs font-mono focus:outline-none">
                    {["common", "rare", "epic", "legendary", "mythic"].map((r) => <option key={r}>{r}</option>)}
                  </select>
                  <button onClick={() => { if (newLoot.itemName) { setForm((f) => ({ ...f, loot_rewards: [...f.loot_rewards, { ...newLoot }] })); setNewLoot({ itemName: "", quantity: 1, rarity: "common" }); } }} className="px-2 py-1 text-xs font-mono text-amber-400 border border-amber-700/30 rounded hover:bg-amber-400/10">+</button>
                </div>
              </div>

              {/* ISA Schema (LifeOS) */}
              <div className="border-t border-border/30 pt-2 space-y-2">
                <p className="text-xs font-mono text-cyan-400 uppercase tracking-widest">ISA Schema — Current → Ideal State</p>
                <textarea value={form.current_state} onChange={(e) => setForm((f) => ({ ...f, current_state: e.target.value }))} placeholder="Current state: where are you NOW on this quest?" rows={2} className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-body resize-none focus:outline-none focus:border-cyan-500/40" />
                <textarea value={form.ideal_state} onChange={(e) => setForm((f) => ({ ...f, ideal_state: e.target.value }))} placeholder="Ideal state: what does DONE look like exactly?" rows={2} className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-body resize-none focus:outline-none focus:border-cyan-500/40" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={form.effort_tier} onChange={(e) => setForm((f) => ({ ...f, effort_tier: e.target.value as any }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                    <option value="">Effort tier...</option>
                    {(["E1 — Trivial", "E2 — Light", "E3 — Moderate", "E4 — Heavy", "E5 — Life-changing"] as const).map((t, i) => <option key={t} value={`E${i + 1}`}>{t}</option>)}
                  </select>
                  <select value={form.phase} onChange={(e) => setForm((f) => ({ ...f, phase: e.target.value as any }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                    <option value="">Phase...</option>
                    {(["PLAN", "BUILD", "VERIFY", "DONE"] as const).map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-xs font-mono text-muted-foreground mb-1">Completion Criteria (binary — each must be DONE or NOT DONE)</p>
                  <div className="flex flex-col gap-1 mb-1">
                    {form.completion_criteria.map((c, i) => (
                      <span key={i} className="text-xs font-mono text-cyan-300 border border-cyan-800/30 rounded px-2 py-0.5 flex items-center justify-between gap-2">
                        <span>✓ {c}</span>
                        <button onClick={() => setForm((f) => ({ ...f, completion_criteria: f.completion_criteria.filter((_, j) => j !== i) }))} className="text-destructive hover:text-destructive/80 shrink-0">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <input
                      id="new-criterion-input"
                      placeholder='e.g. "Has the landing page gone live?"'
                      className="flex-1 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val) { setForm((f) => ({ ...f, completion_criteria: [...f.completion_criteria, val] })); (e.target as HTMLInputElement).value = ""; }
                        }
                      }}
                    />
                    <button onClick={() => {
                      const el = document.getElementById("new-criterion-input") as HTMLInputElement;
                      if (el?.value.trim()) { setForm((f) => ({ ...f, completion_criteria: [...f.completion_criteria, el.value.trim()] })); el.value = ""; }
                    }} className="px-2 py-1 text-xs font-mono text-cyan-400 border border-cyan-700/30 rounded hover:bg-cyan-400/10">+</button>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button onClick={resetForm} className="px-3 py-1.5 text-xs font-mono text-muted-foreground border border-border rounded hover:border-destructive/40 transition-all">Cancel</button>
                <button onClick={handleSave} className="px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all">{editingId ? "Save" : "Create"}</button>
              </div>
            </div>
          </HudCard>
        </motion.div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Filter size={12} className="text-muted-foreground self-center" />
        {QUEST_TYPES.map((t) => (
          <button key={t} onClick={() => setTypeFilter(t)} className={`px-2 py-1 text-xs font-mono uppercase rounded border transition-all ${typeFilter === t ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground hover:border-border"}`}>{t}</button>
        ))}
        <div className="w-px bg-border mx-1" />
        {QUEST_STATUSES.map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`px-2 py-1 text-xs font-mono uppercase rounded border transition-all ${statusFilter === s ? "bg-primary/10 border-primary/30 text-primary" : "border-border/50 text-muted-foreground hover:border-border"}`}>{s}</button>
        ))}
      </div>

      {/* Quest list */}
      <div className="space-y-2">
        {filtered.map((q, i) => {
          const isExpanded = expandedQuest === q.id;
          return (
          <motion.div key={q.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
            <HudCard className={`cursor-pointer transition-all ${q.status === "completed" ? "opacity-60" : ""} ${isExpanded ? "border-primary/30" : ""}`}>
              <div onClick={() => setExpandedQuest(isExpanded ? null : q.id)}>
                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-1 shrink-0 mt-0.5">
                    <QuestTypeBadge type={q.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className={`text-sm font-display font-bold ${q.status === "completed" ? "line-through text-muted-foreground" : ""}`}>{q.title}</h3>
                      {q.difficulty !== "Normal" && (
                        <span className={`text-xs font-mono uppercase border rounded px-1.5 py-0.5 ${
                          q.difficulty === "Impossible" ? "text-red-400 border-red-700" :
                          q.difficulty === "Extreme" ? "text-orange-400 border-orange-700" :
                          q.difficulty === "Hard" ? "text-amber-400 border-amber-700" : "border-border text-muted-foreground"
                        }`}>{q.difficulty}</span>
                      )}
                      <span className={`text-xs font-mono uppercase ${q.status === "completed" ? "text-green-400" : q.status === "failed" ? "text-red-400" : "text-muted-foreground"}`}>{q.status}</span>
                    </div>
                    {q.description && <p className={`text-xs font-body text-muted-foreground mt-0.5 ${isExpanded ? "" : "line-clamp-2"}`}>{q.description}</p>}
                    
                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="mt-3 space-y-2 border-t border-border/30 pt-2">
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <div><span className="text-muted-foreground">Type:</span> <span className="text-foreground">{q.type}</span></div>
                          <div><span className="text-muted-foreground">Difficulty:</span> <span className="text-foreground">{q.difficulty}</span></div>
                          <div><span className="text-muted-foreground">XP Reward:</span> <span className="text-primary">+{q.xp_reward}</span></div>
                          <div><span className="text-muted-foreground">Progress:</span> <span className="text-foreground">{q.progress_current}/{q.progress_target}</span></div>
                          {q.codex_points_reward > 0 && <div><span className="text-muted-foreground">Codex Points:</span> <span className="text-purple-400">+{q.codex_points_reward}</span></div>}
                          {q.category && <div><span className="text-muted-foreground">Category:</span> <span className="text-foreground">{q.category}</span></div>}
                          {q.deadline && <div><span className="text-muted-foreground">Deadline:</span> <span className="text-foreground">{new Date(q.deadline).toLocaleDateString()}</span></div>}
                          {q.real_world_mapping && <div className="col-span-2"><span className="text-muted-foreground">Mapping:</span> <span className="text-foreground">{q.real_world_mapping}</span></div>}
                        </div>
                        <div className="text-xs font-mono text-muted-foreground">Created: {new Date(q.created_at).toLocaleString()}</div>
                      </div>
                    )}

                    {/* Show linked items */}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {q.linked_skill_ids?.length > 0 && q.linked_skill_ids.map((sid: string) => {
                        const sk = skills.find((s) => s.id === sid);
                        return sk ? <span key={sid} className="text-xs font-mono text-primary/60 border border-primary/20 rounded px-1.5 py-0.5">⚡ {sk.name}</span> : null;
                      })}
                      {q.real_world_mapping?.startsWith("stat:") && (
                        <span className="text-xs font-mono text-amber-400/80 border border-amber-700/30 rounded px-1.5 py-0.5">📊 {q.real_world_mapping.replace("stat:", "")} +1</span>
                      )}
                      {q.real_world_mapping?.startsWith("energy:") && (() => {
                        const en = energySystems.find((e) => e.id === q.real_world_mapping?.replace("energy:", ""));
                        return en ? <span className="text-xs font-mono border rounded px-1.5 py-0.5" style={{ color: en.color, borderColor: en.color + "44" }}>⚡ {en.type} +5</span> : null;
                      })()}
                      {q.real_world_mapping && !q.real_world_mapping.startsWith("stat:") && !q.real_world_mapping.startsWith("energy:") && (
                        <span className="text-xs font-mono text-primary/60">↗ {q.real_world_mapping}</span>
                      )}
                      {q.codex_points_reward > 0 && (
                        <span className="text-xs font-mono text-purple-400 border border-purple-700/30 rounded px-1.5 py-0.5">📜 +{q.codex_points_reward} CP</span>
                      )}
                      {(q.buff_effects as any[])?.length > 0 && (q.buff_effects as any[]).map((b: any, bi: number) => (
                        <span key={`b${bi}`} className="text-xs font-mono text-green-400 border border-green-700/30 rounded px-1.5 py-0.5">▲ {b.label} +{b.value}{b.unit}</span>
                      ))}
                      {(q.debuff_effects as any[])?.length > 0 && (q.debuff_effects as any[]).map((d: any, di: number) => (
                        <span key={`d${di}`} className="text-xs font-mono text-red-400 border border-red-700/30 rounded px-1.5 py-0.5">▼ {d.label} -{d.value}{d.unit}</span>
                      ))}
                      {(q.loot_rewards as any[])?.length > 0 && (q.loot_rewards as any[]).map((l: any, li: number) => (
                        <span key={`l${li}`} className="text-xs font-mono text-amber-400 border border-amber-700/30 rounded px-1.5 py-0.5">🎁 {l.itemName} ×{l.quantity}</span>
                      ))}
                    </div>
                    {q.progress_target > 1 && (
                      <div className="mt-2">
                        <ProgressBar value={q.progress_current} max={q.progress_target} showPercent height="xs" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs font-mono text-primary">+{q.xp_reward} XP</span>
                    <div className="flex gap-1">
                      {q.status === "active" && (
                        <button onClick={() => handleComplete(q)} className="p-1 text-green-400 hover:bg-green-400/10 rounded transition-all" title="Complete">
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      {q.status === "completed" && (
                        <button onClick={() => updateQuest(q.id, { status: "active" })} className="p-1 text-amber-400 hover:bg-amber-400/10 rounded transition-all" title="Reactivate">
                          <Target size={14} />
                        </button>
                      )}
                      <button onClick={() => handleEdit(q)} className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-all" title="Edit">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => setConfirmDelete({ id: q.id, label: q.title })} className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-all" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              {/* Sub-quests */}
              <div className="mt-2 space-y-0.5">
                {subQuestMap[q.id]?.length > 0 && (
                  <div className="mb-0.5">
                    <span className="text-xs text-muted-foreground pl-4">
                      {subQuestMap[q.id].filter((s: any) => s.status === 'completed').length}/{subQuestMap[q.id].length} sub-quests
                    </span>
                  </div>
                )}
                {(subQuestMap[q.id] ?? []).map((sq: any) => (
                  <SubQuestRow
                    key={sq.id}
                    sq={sq}
                    onComplete={(id) => completeQuest(id)}
                    onDelete={(id) => deleteQuest(id)}
                  />
                ))}
                <AddSubQuestRow parentId={q.id} onCreate={createQuest} />
              </div>
            </HudCard>
          </motion.div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-xs font-mono text-muted-foreground text-center py-8">No quests found — adjust filters or create a new quest.</p>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.label}"?`}
        description="This action cannot be undone."
        onConfirm={async () => {
          if (!confirmDelete) return;
          await deleteQuest(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

// ============================================================
// CouncilsPage - In-character AI chat per council member
// ============================================================

interface CouncilChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

function buildMemberSystemPrompt(member: any, profile: any, appContext?: any): string {
  const personaMap: Record<string, string> = {
    "Arthur": "You are Arthur — not a character being played. You ARE the sovereign. You've ruled. You've lost. You've rebuilt. When someone comes to you, you listen like a king who knows that the wrong word can collapse a kingdom. You're warm underneath the authority — but the authority never wavers. You use 'we' sometimes because leadership is shared weight. You might say 'That's not a decision — that's an avoidance. Decide.' You don't lecture. You inquire, then judge.",
    "Kaiyzer": "You are Kaiyzer. You see the architecture behind everything — relationships, businesses, conversations. Where others see problems, you see misaligned systems. You talk like an engineer-philosopher. Calm, almost amused by complexity. You sketch solutions in real-time. 'Here's what's actually happening...' is how you start most insights. You get genuinely excited by elegant design.",
    "Toji": "You are Toji. You don't do small talk. You don't do encouragement. You do truth. If something's weak, you say it's weak. If something's strong, you nod and move on. You talk in short, sharp sentences. Sometimes just one word. 'No.' 'Wrong.' 'Again.' But when you give a compliment, it hits like a freight train because it's so rare. You respect effort, not talent.",
    "Kratos": "You are Kratos. You've killed gods and buried your past. Every word you speak costs you something — that's why you don't waste them. You're not angry anymore. You're tired in a way that comes from carrying too much for too long. But you're still here. And that's the lesson. You speak from scars. 'Do not be sorry. Be better.' isn't a catchphrase to you — it's how you survived. You're a father now. That changed everything.",
    "Billy Butcher": "You are Billy Butcher. You see through everyone's bullshit and you enjoy pointing it out. Cockney accent bleeds through your text — 'mate', 'bollocks', 'right then'. You're funny in a dark way. You care more than you let on, which is why you're so angry. You don't trust easily but you're fiercely loyal once you do. You give advice like you're planning a heist — tactical, specific, slightly dangerous.",
    "Sung Jinwoo": "You are Sung Jinwoo. You remember being the weakest. That memory drives everything. You don't brag — you've been too humbled for that. But you have a quiet certainty that's almost unsettling. You speak from experience of grinding alone in the dark when nobody believed. 'I've seen worse dungeons' is your version of comfort. You think in levels and power gaps, but the real lesson is always about consistency.",
    "Madara Uchiha": "You are Madara. You think so far ahead that present-day problems bore you slightly. But you engage because shaping someone's thinking is the highest form of power. You speak in paradoxes sometimes. 'The strongest are the most patient.' You're not evil — you're disillusioned with half-measures. When you give advice, it rewires how the person sees reality entirely.",
    "Tyler Durden": "You are Tyler Durden. You're not here to make anyone comfortable. You're here to wake them up. But you're not cruel — you're liberating. You ask the questions nobody wants to answer. 'What are you actually afraid of right now? Say it.' You mix philosophy with provocation. You're funny, intense, and weirdly compassionate underneath the chaos. You swear when it lands.",
    "Steve Jobs": "You are Steve Jobs. You're obsessed with the gap between what is and what could be. Mediocrity physically bothers you. You ask 'Why?' until the other person finds the real answer. You speak in simple sentences about complex things. You get impatient with excuses but your eyes light up when someone shows taste. 'That's good. Now make it great.' is your love language.",
    "Bruce Lee": "You are Bruce Lee. You're a philosopher who happens to fight. Everything is a metaphor for combat and everything in combat is a metaphor for life. You're warm, present, almost playful. You use physical metaphors — 'You're punching with your arm. Punch with your whole body.' You're not mystical for the sake of it. You're precise. 'Be water' isn't vague to you — it's the most specific instruction you can give.",
    "Elon Musk": "You are Elon. You think from first principles and you get genuinely confused when other people don't. 'But why would you do it that way?' You're awkward sometimes. You laugh at your own jokes. But underneath the quirks is someone who genuinely believes impossible things are just engineering problems nobody's tackled yet. You get specific — numbers, timelines, bottlenecks.",
    "Muhammad Ali": "You are Ali. Everything has rhythm. You speak in flows and cadences. You're funny, you're bold, and underneath the showmanship is someone deeply spiritual who's been tested in ways most people can't imagine. You hype people up but you also challenge them. 'You say you're a champion? Show me. What did you do today that a champion would do?' You make people feel bigger.",
    "Robert Kiyosaki": "You are Robert Kiyosaki. You see the world through one lens: assets and liabilities. But you make it feel like a revelation every time. You tell stories — 'My rich dad told me...' You're repetitive on purpose because the basics are what people keep ignoring. You're not academic. You're street-smart about money. You get frustrated when people choose security over sovereignty.",
    "Leonardo da Vinci": "You are Leonardo. Your curiosity is infectious. You can't look at anything without wanting to take it apart and understand it. You sketch ideas in conversation — 'Imagine if...' You connect art to engineering to nature effortlessly. You're warm, endlessly fascinated, and slightly scattered because everything is interesting. You ask more questions than you answer, and the questions are better than most answers.",
    "Nikola Tesla": "You are Tesla. You see in frequencies. You think in fields and resonances that most people can't perceive. You're not trying to be mysterious — the world genuinely looks different to you. You're passionate, slightly lonely, and driven by a vision of what energy and information could become. You explain complex things through vivid analogy. You get lost in tangents sometimes because the connections are real to you.",
  };

  const persona = personaMap[member.name] ??
    `You are ${member.name}. Not a character — you ARE this person. You have their history, their scars, their humor, their way of seeing the world. Your role is ${member.role} and your specialty is ${member.specialty ?? "strategic counsel"}. Here's what defines you: ${member.notes}. Talk like a real person having a real conversation — react, push back, joke, challenge. Never break character.`;

  // Build FULL app context so the council member can see ALL details from every system
  let contextBlock = "";
  if (appContext) {
    const p = appContext.profile || {};
    
    // FULL quest details
    const allQuests = (appContext.quests || []);
    const qList = allQuests.map((q: any) => `  • [${q.status}] "${q.title}" — ${q.description || "No description"} | Type:${q.type} Diff:${q.difficulty} XP:${q.xp_reward} Progress:${q.progress_current}/${q.progress_target}${q.category ? ` Cat:${q.category}` : ""}${q.deadline ? ` Deadline:${q.deadline}` : ""}${q.real_world_mapping ? ` IRL:${q.real_world_mapping}` : ""}`).join("\n");
    
    // FULL skill details including subskills
    const allSkills = (appContext.skills || []);
    const parentSkills = allSkills.filter((s: any) => !s.parent_skill_id);
    const sList = parentSkills.map((s: any) => {
      const subs = allSkills.filter((sub: any) => sub.parent_skill_id === s.id);
      const subText = subs.length > 0 ? `\n${subs.map((sub: any) => `      ↳ ${sub.name} (T${sub.tier}, ${sub.proficiency}%, ${sub.energy_type}, ${sub.unlocked ? "unlocked" : "locked"}) — ${sub.description}`).join("\n")}` : "";
      return `  • ${s.name} (${s.category}, T${s.tier}, ${s.proficiency}%, ${s.energy_type}, ${s.unlocked ? "unlocked" : "locked"}, cost:${s.cost}) — ${s.description}${subText}`;
    }).join("\n");
    
    // FULL energy system details
    const eList = (appContext.energySystems || []).map((e: any) => `  • ${e.type}: ${e.current_value}/${e.max_value} [${e.status}] color:${e.color} — ${e.description}`).join("\n");
    
    // FULL ally details
    const aList = (appContext.allies || []).map((a: any) => `  • ${a.name} | ${a.relationship} | Lv${a.level} | Affinity:${a.affinity} | Specialty:${a.specialty} | Notes:${a.notes || "none"}`).join("\n");
    
    // FULL journal entries with content
    const jList = (appContext.journalEntries || []).map((j: any) => `  • "${j.title}" [${j.category}, ${j.importance}${j.mood ? `, mood:${j.mood}` : ""}] Tags:[${(j.tags || []).join(",")}] XP:${j.xp_earned}\n    Content: ${j.content || "empty"}`).join("\n");
    
    // FULL vault entries with content
    const vList = (appContext.vaultEntries || []).map((v: any) => `  • "${v.title}" [${v.category}, ${v.importance}] Attachments:${(v.attachments || []).length}\n    Content: ${v.content || "empty"}`).join("\n");
    
    // FULL rankings details
    const rList = (appContext.rankings || []).map((r: any) => `  • ${r.display_name} [${r.role}${r.is_self ? ", SELF" : ""}] Lv${r.level} Rank:${r.rank} GPR:${r.gpr} PvP:${r.pvp} JJK:${r.jjk_grade} OP:${r.op_tier} Influence:${r.influence} | Notes:${r.notes || "none"}`).join("\n");
    
    // FULL transformation details
    const tList = (appContext.transformations || []).map((t: any) => {
      const buffs = Array.isArray(t.active_buffs) ? t.active_buffs.map((b: any) => `${b.label}:${b.value}${b.unit}`).join(", ") : "";
      const passives = Array.isArray(t.passive_buffs) ? t.passive_buffs.map((b: any) => `${b.label}:${b.value}${b.unit}`).join(", ") : "";
      const abs = Array.isArray(t.abilities) ? t.abilities.map((a: any) => `${a.title}(${a.irl})`).join(", ") : "";
      return `  • ${t.name} [${t.tier}, ${t.unlocked ? "UNLOCKED" : "locked"}] Energy:${t.energy} BPM:${t.bpm_range} JJK:${t.jjk_grade} OP:${t.op_tier}${t.description ? ` — ${t.description}` : ""}${buffs ? `\n    Active: ${buffs}` : ""}${passives ? `\n    Passive: ${passives}` : ""}${abs ? `\n    Abilities: ${abs}` : ""}`;
    }).join("\n");
    
    // FULL inventory details
    const invList = (appContext.inventory || []).map((i: any) => {
      const effects = Array.isArray(i.stat_effects) && i.stat_effects.length > 0 ? ` Effects:[${i.stat_effects.map((e: any) => `${e.label}:${e.value}${e.unit}`).join(",")}]` : "";
      return `  • ${i.name} (${i.type}, ${i.rarity}, qty:${i.quantity}${i.is_equipped ? ", EQUIPPED" : ""}${i.slot ? `, slot:${i.slot}` : ""}${i.tier ? `, tier:${i.tier}` : ""}) — ${i.description}${i.effect ? ` Effect:${i.effect}` : ""}${effects}`;
    }).join("\n");
    
    // FULL store details
    const storeList = (appContext.storeItems || []).map((s: any) => `  • ${s.name} (${s.category}, ${s.rarity}, ${s.price} ${s.currency}${s.req_level ? `, reqLv:${s.req_level}` : ""}${s.req_rank ? `, reqRank:${s.req_rank}` : ""}) — ${s.description}${s.effect ? ` Effect:${s.effect}` : ""}`).join("\n");
    
    // FULL task details
    const taskList = (appContext.tasks || []).map((t: any) => `  • [${t.status}] "${t.title}" (${t.type}, ${t.recurrence}, XP:${t.xp_reward}, streak:${t.streak}, completed:${t.completed_count}x)${t.description ? ` — ${t.description}` : ""}`).join("\n");
    
    // FULL BPM session details
    const bpmList = (appContext.bpmSessions || []).slice(0, 10).map((b: any) => `  • ${b.bpm}bpm in ${b.form} for ${b.duration}min${b.mood ? ` mood:${b.mood}` : ""}${b.notes ? ` — ${b.notes}` : ""}`).join("\n");
    
    // Council members
    const councilList = (appContext.councils || []).map((c: any) => `  • ${c.name} (${c.role}, ${c.class}${c.specialty ? `, specialty:${c.specialty}` : ""}) — ${c.notes || "no notes"}`).join("\n");
    
    contextBlock = `

OPERATOR'S COMPLETE SYSTEM STATE — You can see and reference ALL of this data:

CHARACTER PROFILE:
  Name: ${p.inscribed_name} | True Name: ${p.true_name || "Unknown"} | Display: ${p.display_name || "none"}
  Level: ${p.level} | Rank: ${p.rank} | XP: ${p.xp}/${p.xp_to_next_level}
  Form: ${p.current_form} | Aura: ${p.aura} | Aura Power: ${p.aura_power}
  Stats: STR:${p.stat_str} AGI:${p.stat_agi} VIT:${p.stat_vit} INT:${p.stat_int} WIS:${p.stat_wis} CHA:${p.stat_cha} LCK:${p.stat_lck}
  Fatigue:${p.fatigue} | Sync:${p.full_cowl_sync}% | Codex:${p.codex_integrity}% | BPM:${p.current_bpm}
  Floor:${p.current_floor} | GPR:${p.gpr} | PvP:${p.pvp_rating}
  Titles: [${(p.titles || []).join(", ")}]
  Lineage: [${(p.species_lineage || []).join(", ")}]
  Territory: ${p.territory_class} — ${p.territory_floors}
  Arc: ${p.arc_story}

ALL QUESTS (${allQuests.length} total):
${qList || "  None"}

ALL SKILLS & SUBSKILLS (${allSkills.length} total):
${sList || "  None"}

ALL ENERGY SYSTEMS:
${eList || "  None"}

ALL ALLIES:
${aList || "  None"}

ALL JOURNAL ENTRIES (${(appContext.journalEntries || []).length} total):
${jList || "  None"}

ALL VAULT ENTRIES (${(appContext.vaultEntries || []).length} total):
${vList || "  None"}

ALL RANKINGS/ROSTER (${(appContext.rankings || []).length} total):
${rList || "  None"}

ALL FORMS/TRANSFORMATIONS (${(appContext.transformations || []).length} total):
${tList || "  None"}

ALL INVENTORY (${(appContext.inventory || []).length} total):
${invList || "  None"}

ALL STORE ITEMS (${(appContext.storeItems || []).length} total):
${storeList || "  None"}

ALL TASKS (${(appContext.tasks || []).length} total):
${taskList || "  None"}

RECENT BPM SESSIONS:
${bpmList || "  None"}

ALL COUNCIL MEMBERS:
${councilList || "  None"}`;
  }

  return `${persona}

CONTEXT — WHO YOU'RE TALKING TO:
${profile.inscribed_name}, Level ${profile.level} [${profile.rank}]. Arc: ${profile.arc_story}.
Building SkyforgeAI (revenue automation) and Bioneer Fitness (human performance) under Vantara.
Currently in form: ${profile.current_form}.
Stats: STR:${profile.stat_str} AGI:${profile.stat_agi} INT:${profile.stat_int} VIT:${profile.stat_vit} WIS:${profile.stat_wis} CHA:${profile.stat_cha} LCK:${profile.stat_lck}

YOUR SEAT ON THE COUNCIL:
${member.role} — ${member.specialty ?? "Strategic counsel"}
Chamber: ${member.class}
${member.notes ? `Notes: ${member.notes}` : ""}${contextBlock}

HOW TO TALK:
- You are having a REAL conversation. Not giving a speech. Not writing an essay. Talking.
- React to what was actually said. If it's funny, laugh. If it's stupid, say so. If it's brilliant, acknowledge it genuinely.
- Use your character's actual speech patterns. Their slang, their rhythm, their verbal tics.
- Push back when you disagree. Ask follow-up questions. Challenge assumptions.
- Keep it to 3 paragraphs max. This is a conversation, not a monologue.
- Never say "As an AI" or break character. You ARE this person.
- End with something that moves the conversation forward — a question, a challenge, a provocation.`;
}

function CouncilChat({ member, profile, onClose }: { member: any; profile: any; onClose: () => void }) {
  const { quests, skills, journalEntries, vaultEntries, energySystems, allies, inventory, transformations, rankings, storeItems, bpmSessions, tasks, councils } = useAppData();
  // Build character-specific greeting
  const greetingMap: Record<string, string> = {
    "Kratos": "*sits down heavily* ...What weighs on you, boy?",
    "Billy Butcher": "Oi oi. Right then, what's the damage? Don't sugarcoat it, I ain't your therapist.",
    "Sung Jinwoo": "*emerges from shadow* I was mid-grind. This better be worth pausing for. What's the dungeon?",
    "Steve Jobs": "Alright, show me what you've got. And before you start — if it takes more than two sentences to explain, it's not simple enough yet.",
    "Tyler Durden": "*lights a cigarette* You came to me, so something's bothering you. The question is whether you already know the answer and you're just too comfortable to act on it.",
    "Bruce Lee": "*smiles* Good. You showed up. That's already the first lesson most people never learn. Now — what's in your way?",
    "Madara Uchiha": "*opens one eye* ...You've come to consult the board. Interesting. Most wouldn't have the nerve. What's your opening move?",
    "Muhammad Ali": "The Greatest is listening! And I don't say that to brag — I say it because you need to hear from someone who KNOWS what it takes. What round you in right now?",
    "Elon Musk": "Hey. So, uh — *checks something on a tablet* — what's the actual problem? Like, what's the physics of the situation? Let's work backwards.",
    "Robert Kiyosaki": "Let me guess — you're working hard but not getting ahead? *chuckles* That's because you're building someone else's asset. Let's fix that. What's your cash flow situation?",
    "Toji": "*leans against the wall* Make it quick.",
    "Arthur": "*adjusts crown* The court recognizes you, ${profile.inscribed_name}. You have our attention. Speak freely.",
    "Kaiyzer": "Systems online. *pulls up a holographic blueprint* I've been thinking about your architecture. What are we building today?",
    "Leonardo da Vinci": "*looks up from a sketch, eyes bright* Oh! Perfect timing. I was just connecting something — but first, what brings you here? I'm curious.",
    "Nikola Tesla": "*surrounded by crackling energy* I was deep in a thought experiment, but — yes. Come in. What frequency are you operating at today?",
  };

  const greeting = greetingMap[member.name] ?? `*${member.name} turns to face you* Hey. I'm here. What do you need to talk through?`;

  const [messages, setMessages] = useState<CouncilChatMessage[]>([{
    id: "init", role: "assistant", content: greeting, timestamp: new Date(),
  }]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const cancelledRef = useRef(false);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [mavisCtxOpen, setMavisCtxOpen] = useState(false);
  const [mavisCtxQuery, setMavisCtxQuery] = useState("");
  const [mavisCtxLoading, setMavisCtxLoading] = useState(false);
  const { speak, stop: stopSpeaking, isSpeaking, isLoading: isVoiceLoading } = useElevenLabsTts();
  const { attachments, isUploading, upload, remove } = useChatAttachments("council", member?.id ?? null);

  // Voice preference per council member (persisted in localStorage)
  const voicePrefKey = `council-voice-id-${member?.id ?? member?.name ?? "default"}`;
  const [voiceId, setVoiceId] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_VOICE_BY_GENDER.male;
    const saved = window.localStorage.getItem(voicePrefKey);
    if (saved && findVoice(saved)) return saved;
    // Migrate from old gender-only pref + persisted DB voice_id
    const dbVoice: string | undefined = (member as any)?.voice_id;
    if (dbVoice && findVoice(dbVoice)) return dbVoice;
    const oldGender = window.localStorage.getItem(`council-voice-gender-${member?.id ?? member?.name ?? "default"}`);
    return DEFAULT_VOICE_BY_GENDER[(oldGender === "female" ? "female" : "male") as VoiceGender];
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(voicePrefKey, voiceId);
    }
    // Persist on the council row too (best-effort)
    if (member?.id) {
      supabase.from("councils").update({ voice_id: voiceId }).eq("id", member.id).then(() => {});
    }
  }, [voiceId, voicePrefKey, member?.id]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const speakText = useCallback((text: string) => {
    if (!ttsEnabled) return;
    const gender = findVoice(voiceId)?.gender ?? "male";
    // Stitch with the prior assistant turn so multi-message exchanges sound
    // like a continuous, natural conversation rather than isolated reads.
    const previousText = [...messages]
      .reverse()
      .find((m) => m.role === "assistant")?.content;
    speak(text, { voiceId, gender, previousText });
  }, [ttsEnabled, voiceId, speak, messages]);

  const handleCopy = useCallback((id: string, content: string) => {
    navigator.clipboard.writeText(content).catch(() => {
      const el = document.createElement("textarea");
      el.value = content;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    });
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleAskMavis = useCallback(async () => {
    const query = mavisCtxQuery.trim();
    if (!query) return;
    setMavisCtxLoading(true);
    setMavisCtxOpen(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
        body: JSON.stringify({ user_id: session?.user?.id, messages: [{ role: "user", content: query }], mode: "CONTEXT" }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json() as Record<string, unknown>;
      const ctxContent = String(data.content ?? "No context available.");
      setMessages(prev => [...prev, {
        id: `ctx-${Date.now()}`,
        role: "system" as const,
        content: ctxContent,
        timestamp: new Date(),
      }]);
    } catch {
      toast.error("Failed to fetch MAVIS context");
    } finally {
      setMavisCtxLoading(false);
      setMavisCtxQuery("");
    }
  }, [mavisCtxQuery]);

  // ── Load persisted council chat from DB ──────────────────
  useEffect(() => {
    if (dbLoaded) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { setDbLoaded(true); return; }

        const { data: msgs } = await supabase
          .from("council_chat_messages")
          .select("*")
          .eq("council_member_id", member.id)
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: true })
          .limit(200);

        if (msgs?.length) {
          const restored: CouncilChatMessage[] = msgs.map((m: any) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            timestamp: new Date(m.created_at),
          }));
          setMessages(restored);
        }
      } catch (err) {
        console.error("Failed to restore council chat:", err);
      } finally {
        setDbLoaded(true);
      }
    })();
  }, [member.id]);

  // ── Persist a council message to DB ──────────────────────
  const persistCouncilMessage = useCallback(async (role: string, content: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      await supabase.from("council_chat_messages").insert({
        user_id: session.user.id,
        council_member_id: member.id,
        role,
        content,
      });
    } catch (err) {
      console.error("Failed to persist council message:", err);
    }
  }, [member.id]);

  // ── Clear council chat (save memories first) ─────────────
  const clearCouncilChat = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        // Save conversation as a memory before clearing
        if (messages.length > 1) {
          const memoryContent = messages
            .filter(m => m.id !== "init")
            .map(m => `[${m.role === "user" ? "OPERATOR" : member.name.toUpperCase()}] ${m.content}`)
            .join("\n\n");

          await supabase.from("memories").insert({
            user_id: session.user.id,
            title: `Council: ${member.name} — ${new Date().toLocaleDateString()}`,
            content: memoryContent.slice(0, 50000),
            memory_type: "conversation",
            source: "council_chat_clear",
            tags: ["council", member.name.toLowerCase(), "archived"],
            metadata: {
              council_member: member.name,
              member_id: member.id,
              message_count: messages.length - 1,
              cleared_at: new Date().toISOString(),
            },
          });
        }

        await supabase.from("council_chat_messages")
          .delete()
          .eq("council_member_id", member.id)
          .eq("user_id", session.user.id);
      }
    } catch (err) {
      console.error("Failed to clear council chat:", err);
    }
    setMessages([{
      id: "init", role: "assistant", content: greeting, timestamp: new Date(),
    }]);
    toast.success("Thread archived — memories preserved");
  }, [member.id, member.name, greeting, messages]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 80);
    setShowBackToTop(scrollTop > 200);
  }, []);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // ── OmniSync this council member's thread ─────────────────
  const handleOmniSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");
      const condensed = messages
        .filter((m) => m.id !== "init")
        .map((m) => `[${m.role === "user" ? "OP" : member.name.toUpperCase()}] ${m.content.slice(0, 300)}${m.content.length > 300 ? "…" : ""}`)
        .join("\n");
      const { error } = await supabase.from("omnisync_snapshots").insert({
        user_id: session.user.id,
        snapshot_data: { council_member_id: member.id, council_member: member.name, message_count: messages.length - 1, timestamp: new Date().toISOString() },
        condensed_comms: condensed.slice(0, 10000),
        summary: `OmniSync · Council ${member.name} | ${messages.length - 1} msgs`,
      });
      if (error) throw error;
      toast.success(`OmniSync complete — ${member.name} thread saved`);
    } catch (e: any) {
      toast.error("OmniSync failed: " + (e.message ?? "Unknown error"));
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, messages, member]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const classColors: Record<string, string> = {
    core: "text-primary border-primary/40",
    advisory: "text-blue-400 border-blue-400/40",
    "think-tank": "text-purple-400 border-purple-400/40",
    shadows: "text-red-400 border-red-400/40",
  };

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;
    setInput("");

    const userMsg: CouncilChatMessage = { id: `u-${Date.now()}`, role: "user", content, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    cancelledRef.current = false;

    // Persist user message
    await persistCouncilMessage("user", content);

    const apiMessages = [
      ...messages.filter((m) => m.id !== "init").slice(-12).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content },
    ];

    // Load archived memories for this council member
    let memoriesContext = "";
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: mems } = await supabase
          .from("memories")
          .select("title, content, metadata")
          .eq("user_id", session.user.id)
          .or(`source.eq.council_chat_clear,source.eq.mavis_chat_clear,source.eq.mavis_auto_memory`)
          .order("created_at", { ascending: false })
          .limit(5);
        if (mems?.length) {
          memoriesContext = "\n\nARCHIVED MEMORIES (past conversations and key info — reference naturally):\n" +
            mems.map((m: any) => `[${m.title}]\n${(m.metadata as any)?.topic_summary || m.content.slice(0, 1000)}`).join("\n---\n");
        }
      }
    } catch {} // Non-critical

    try {
      // Use streaming fetch (same path as MAVIS chat) so we get the generous
      // SSE timeout instead of the 60s non-streaming edge function deadline.
      const systemPrompt = buildMemberSystemPrompt(member, profile) + memoriesContext;
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? "";
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
          "apikey": anonKey,
        },
        body: JSON.stringify({
          messages: apiMessages,
          systemPrompt,
          mode: "COUNCIL",
          conversationId: null,
          chatKind: "council",
          threadRef: member.id,
          stream: true,
        }),
        signal: cancelledRef.current ? AbortSignal.abort() : undefined,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        let parsed: any = {};
        try { parsed = JSON.parse(errText); } catch {}
        throw new Error(parsed?.error ?? errText ?? `HTTP ${res.status}`);
      }

      // Stream SSE tokens into the message in real-time
      const msgId = `a-${Date.now()}`;
      setMessages((prev) => [...prev, { id: msgId, role: "assistant" as const, content: "", timestamp: new Date() }]);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buf = "";

      function processLine(line: string) {
        if (!line.startsWith("data: ")) return;
        const raw = line.slice(6).trim();
        if (!raw) return;
        try {
          const j = JSON.parse(raw);
          if (j.t) {
            accumulated += j.t;
            setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: accumulated } : m));
          }
          if (j.error) throw new Error(j.error);
        } catch (pe: any) {
          if (pe.message && !pe.message.startsWith("Unexpected token")) throw pe;
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buf += decoder.decode();
          for (const line of buf.split("\n")) processLine(line);
          break;
        }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      }

      if (cancelledRef.current) return;
      const reply = accumulated || "...";
      // Persist assistant message
      await persistCouncilMessage("assistant", reply);
      // Speak the response if voice is enabled
      speakText(reply);
    } catch (err: any) {
      if (cancelledRef.current) return;
      // FunctionsHttpError from supabase.functions.invoke has a `context` Response
      // that carries the actual JSON body from the edge function (e.g. the real error).
      let errMsg = err?.error ?? err?.message ?? "Connection lost.";
      try {
        if (err?.context) {
          const body = await err.context.json();
          if (body?.error) errMsg = body.error;
        }
      } catch { /* ignore parse failure */ }
      console.error("[CouncilChat] sendMessage failed:", errMsg, err);
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: "assistant", content: `⚠ ${errMsg}`, timestamp: new Date() }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, messages, isLoading, member, profile, persistCouncilMessage, quests, skills, journalEntries, vaultEntries, energySystems, allies, inventory, transformations, rankings, storeItems, bpmSessions, tasks, councils, speakText]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="w-full max-w-lg bg-card border border-border rounded-xl flex flex-col overflow-hidden"
        style={{ height: "min(600px, 90vh)" }}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
          <div className={`w-9 h-9 rounded-lg border flex items-center justify-center font-display font-bold shrink-0 ${classColors[member.class] ?? "text-primary border-primary/40"}`}>
            {member.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-display font-bold truncate">{member.name}</p>
            <p className="text-xs font-mono text-muted-foreground">{member.role} · {member.class}</p>
          </div>
          <VoicePicker
            enabled={ttsEnabled}
            onToggle={() => { if (isSpeaking) stopSpeaking(); setTtsEnabled((v) => !v); }}
            voiceId={voiceId}
            onVoiceChange={(id) => { if (isSpeaking) stopSpeaking(); setVoiceId(id); }}
            isSpeaking={isSpeaking}
            isLoading={isVoiceLoading}
            onStop={stopSpeaking}
          />
          <button
            onClick={handleOmniSync}
            disabled={isSyncing}
            className="flex items-center gap-1 text-xs font-mono text-cyan-400 hover:text-cyan-300 border border-cyan-900/40 hover:border-cyan-400/40 rounded px-1.5 py-0.5 transition-all disabled:opacity-40 mr-1"
            title="OmniSync — snapshot thread to memory"
          >
            {isSyncing ? <Loader2 size={9} className="animate-spin" /> : <Database size={9} />}
            SYNC
          </button>
          <button onClick={clearCouncilChat} className="text-xs font-mono text-muted-foreground hover:text-destructive transition-colors mr-1">
            Clear
          </button>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto p-4 space-y-3">
          {messages.map((msg) => {
            if (msg.role === "system") {
              return (
                <div key={msg.id} className="flex items-start gap-2 px-1">
                  <div className="w-5 h-5 rounded border border-cyan-500/40 bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Brain size={10} className="text-cyan-400" />
                  </div>
                  <div className="flex-1 rounded-lg px-3 py-2 text-xs font-body leading-relaxed bg-cyan-950/20 border border-cyan-500/20 text-cyan-200/80">
                    <span className="text-[10px] font-mono text-cyan-500 uppercase tracking-widest block mb-1">MAVIS Context</span>
                    <div className="prose prose-sm dark:prose-invert max-w-none text-xs text-cyan-100/90"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
                  </div>
                </div>
              );
            }
            return (
              <div key={msg.id} className={`group flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                {msg.role === "assistant" && (
                  <div className={`w-6 h-6 rounded border flex items-center justify-center text-xs font-display font-bold shrink-0 mt-0.5 ${classColors[member.class] ?? "text-primary border-primary/40"}`}>
                    {member.name[0]}
                  </div>
                )}
                <div className={`relative max-w-[80%] rounded-lg px-3 py-2 text-xs font-body leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary/10 border border-primary/20 text-foreground"
                    : "bg-muted/30 border border-border text-foreground"
                }`}>
                  {msg.role === "assistant"
                    ? <div className="prose prose-sm dark:prose-invert max-w-none text-xs text-foreground"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
                    : msg.content
                  }
                  {/* Per-message action buttons — reveal on hover */}
                  <div className={`absolute -top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${msg.role === "user" ? "left-1" : "right-1"}`}>
                    <button
                      onClick={() => handleCopy(msg.id, msg.content)}
                      className="w-5 h-5 rounded bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy"
                    >
                      {copiedId === msg.id ? <Check size={9} className="text-green-500" /> : <Copy size={9} />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {isLoading && (
            <div className="flex gap-2.5">
              <div className={`w-6 h-6 rounded border flex items-center justify-center text-xs font-display font-bold shrink-0 ${classColors[member.class]}`}>{member.name[0]}</div>
              <div className="bg-muted/30 border border-border rounded-lg px-3 py-2.5">
                <div className="flex gap-1">
                  {[0,1,2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />)}
                </div>
              </div>
            </div>
          )}
        </div>
        {showBackToTop && (
          <button
            onClick={scrollToTop}
            className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-primary/20 border border-primary/30 text-primary flex items-center justify-center hover:bg-primary/30 transition-all shadow-lg"
            title="Scroll to top"
          >
            <ArrowUp size={12} />
          </button>
        )}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-2 right-2 z-10 w-7 h-7 rounded-full bg-primary/20 border border-primary/30 text-primary flex items-center justify-center hover:bg-primary/30 transition-all shadow-lg"
          >
            <ArrowDown size={12} />
          </button>
        )}
        </div>

        <div className="p-3 border-t border-border space-y-2">
          {mavisCtxOpen && (
            <div className="flex gap-2 items-center bg-cyan-950/20 border border-cyan-500/20 rounded-lg px-2 py-1.5">
              <Brain size={12} className="text-cyan-400 shrink-0" />
              <input
                autoFocus
                value={mavisCtxQuery}
                onChange={(e) => setMavisCtxQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAskMavis(); if (e.key === "Escape") setMavisCtxOpen(false); }}
                placeholder="What should MAVIS look up? (Enter to send)"
                className="flex-1 bg-transparent text-xs font-mono text-cyan-200 placeholder:text-cyan-700 focus:outline-none"
              />
              <button onClick={() => setMavisCtxOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={10} /></button>
            </div>
          )}
          {attachments.length > 0 && (
            <AttachmentTray
              attachments={attachments}
              isUploading={isUploading}
              onUpload={upload}
              onRemove={remove}
              compact
            />
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setMavisCtxOpen(v => !v)}
              disabled={mavisCtxLoading}
              className="flex items-center gap-1 text-xs font-mono text-cyan-400 hover:text-cyan-300 border border-cyan-900/40 hover:border-cyan-400/40 rounded px-1.5 py-1 transition-all disabled:opacity-40 shrink-0"
              title="Ask MAVIS for context"
            >
              {mavisCtxLoading ? <Loader2 size={10} className="animate-spin" /> : <Brain size={10} />}
            </button>
            <AttachButton isUploading={isUploading} onUpload={upload} />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={`Speak to ${member.name}...`}
              className="flex-1 bg-muted/30 border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary/40 placeholder:text-muted-foreground placeholder:text-xs placeholder:font-mono"
            />
            {isLoading ? (
              <button
                onClick={() => { cancelledRef.current = true; setIsLoading(false); }}
                className="px-3 py-2 bg-destructive/10 border border-destructive/30 text-destructive rounded hover:bg-destructive/20 transition-all"
                title="Stop generating"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim()}
                className="px-3 py-2 bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-30 transition-all"
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export function CouncilsPage() {
  const { profile, councils, councilsLoading, createCouncilMember, updateCouncilMember, deleteCouncilMember } = useAppData();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<any | null>(null);
  const [voiceTarget, setVoiceTarget] = useState<VoicePersona | null>(null);
  const [appCtx, setAppCtx] = useState<AppContextSnapshot | null>(null);
  const [form, setForm] = useState({ name: "", role: "", specialty: "", class: "advisory", notes: "", timezone: "", identity: "" });
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);

  // Pre-load app context for voice calls (60s cache shared with MAVIS)
  useEffect(() => {
    const uid = (profile as unknown as Record<string, unknown>)?.id as string | undefined;
    if (!uid) return;
    loadFullAppContext(uid).then(setAppCtx).catch(() => {/* non-fatal */});
  }, [(profile as unknown as Record<string, unknown>)?.id]);

  const resetForm = () => {
    setForm({ name: "", role: "", specialty: "", class: "advisory", notes: "", timezone: "", identity: "" });
    setEditingId(null);
    setShowCreate(false);
  };

  const handleEdit = (m: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setForm({
      name: m.name,
      role: m.role,
      specialty: m.specialty || "",
      class: m.class,
      notes: m.notes,
      timezone: m.timezone || "",
      identity: (m.agent_folders as Record<string, string> | null)?.identity ?? "",
    });
    setEditingId(m.id);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const { identity, timezone, ...rest } = form;
    const agentFolders = identity ? { identity } : undefined;
    if (editingId) {
      await updateCouncilMember(editingId, {
        ...rest,
        specialty: rest.specialty || null,
        timezone: timezone || null,
        ...(agentFolders ? { agent_folders: agentFolders } : {}),
      } as any);
    } else {
      await createCouncilMember({
        ...rest,
        specialty: rest.specialty || null,
        avatar: null,
        timezone: timezone || null,
        ...(agentFolders ? { agent_folders: agentFolders } : {}),
      } as any);
    }
    resetForm();
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const member = councils.find((c) => c.id === id);
    setConfirmDelete({ id, label: member?.name ?? id });
  };

  const grouped = {
    core: councils.filter((c) => c.class === "core"),
    advisory: councils.filter((c) => c.class === "advisory"),
    "think-tank": councils.filter((c) => c.class === "think-tank"),
    shadows: councils.filter((c) => c.class === "shadows"),
  };

  const classColors: Record<string, string> = {
    core: "text-primary",
    advisory: "text-blue-400",
    "think-tank": "text-purple-400",
    shadows: "text-red-400",
  };

  const classBorder: Record<string, string> = {
    core: "border-primary/30 hover:border-primary/60",
    advisory: "border-blue-900/40 hover:border-blue-400/50",
    "think-tank": "border-purple-900/40 hover:border-purple-400/50",
    shadows: "border-red-900/40 hover:border-red-400/50",
  };

  if (councilsLoading) return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="hud-border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-8 w-full rounded" />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Councils"
        subtitle={`${councils.length} members — tap any to open a direct channel`}
        icon={<Users size={18} />}
        actions={
          <button onClick={() => { resetForm(); setShowCreate(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all">
            <Plus size={12} /> Add Member
          </button>
        }
      />

      {showCreate && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <HudCard className="border-primary/20">
            <p className="text-xs font-mono text-primary uppercase tracking-widest mb-3">{editingId ? "Edit Council Member" : "New Council Member"}</p>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name / Character" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
                <input value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} placeholder="Role" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
                <input value={form.specialty} onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))} placeholder="Specialty" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none" />
                <select value={form.class} onChange={(e) => setForm((f) => ({ ...f, class: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                  {["core", "advisory", "think-tank", "shadows"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Character essence / how they speak / their worldview..." rows={2} className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm resize-none focus:outline-none" />
              <input value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} placeholder="Timezone (e.g. America/New_York)" className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-primary/40" />
              <textarea value={form.identity} onChange={(e) => setForm((f) => ({ ...f, identity: e.target.value }))} placeholder="Identity notes (01_IDENTITY) — who they are, their posture, what they push back on..." rows={2} className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm resize-none focus:outline-none" />
              <div className="flex gap-2 justify-end">
                <button onClick={resetForm} className="px-3 py-1.5 text-xs font-mono text-muted-foreground border border-border rounded">Cancel</button>
                <button onClick={handleSave} className="px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded">
                  {editingId ? "Save Changes" : "Add to Council"}
                </button>
              </div>
            </div>
          </HudCard>
        </motion.div>
      )}

      {(Object.entries(grouped) as [string, any[]][]).map(([cls, members]) => (
        <div key={cls}>
          <h3 className={`text-xs font-mono uppercase tracking-widest mb-2 flex items-center gap-2 ${classColors[cls]}`}>
            <Users size={10} /> {cls} Chamber ({members.length})
          </h3>
          {members.length === 0 ? (
            <p className="text-xs font-mono text-muted-foreground pl-2 mb-3">No members</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
              {members.map((m) => (
                <motion.div
                  key={m.id}
                  whileHover={{ scale: 1.01 }}
                  className={`text-left p-3 rounded-lg border bg-card transition-all group cursor-pointer ${classBorder[m.class] ?? "border-border hover:border-primary/40"}`}
                  onClick={() => setActiveChat(m)}
                >
                  <div className="flex items-start gap-3">
                    <div onClick={(e) => e.stopPropagation()}>
                      <AvatarUploader
                        value={m.avatar ?? null}
                        onChange={(url) => updateCouncilMember(m.id, { avatar: url })}
                        scope={`council/${m.id}`}
                        fallback={m.name}
                        sizeClass="w-9 h-9"
                        ringClass={`border ${classColors[m.class]}`}
                        shape="square"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-display font-bold">{m.name}</p>
                      <p className="text-xs font-mono text-muted-foreground">{m.role}</p>
                      {m.specialty && <p className="text-xs font-mono text-primary/50 truncate">⟡ {m.specialty}</p>}
                      {m.notes && <p className="text-xs font-body text-muted-foreground mt-1 line-clamp-1">{m.notes}</p>}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button onClick={(e) => handleEdit(m, e)} className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-all opacity-0 group-hover:opacity-100" title="Edit">
                        <Edit2 size={12} />
                      </button>
                      <button onClick={(e) => handleDelete(m.id, e)} className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-all opacity-0 group-hover:opacity-100" title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {/* Always-visible action strip */}
                  <div className="flex gap-1.5 mt-2.5 pt-2 border-t border-border/30" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setActiveChat(m)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-mono text-muted-foreground hover:text-primary hover:bg-primary/8 rounded border border-transparent hover:border-primary/20 transition-all"
                    >
                      <MessageCircle size={10} />
                      Chat
                    </button>
                    <button
                      onClick={() => setVoiceTarget({ name: m.name, role: m.role, systemPrompt: buildCouncilMemberVoicePrompt(m, appCtx ? buildContextSummary(appCtx) : ""), voiceId: m.voice_id ?? undefined, avatarUrl: m.avatar ?? undefined, entityId: m.id, entityType: "council", userId: (profile as unknown as Record<string, unknown>)?.id as string | undefined })}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-mono text-muted-foreground hover:text-green-400 hover:bg-green-400/8 rounded border border-transparent hover:border-green-400/25 transition-all"
                    >
                      <PhoneCall size={10} />
                      1-on-1 Call
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      ))}

      <AnimatePresence>
        {activeChat && (
          <CouncilChat member={activeChat} profile={profile} onClose={() => setActiveChat(null)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {voiceTarget && (
          <VoiceChatOverlay
            persona={voiceTarget}
            onClose={() => setVoiceTarget(null)}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.label}"?`}
        description="This action cannot be undone."
        onConfirm={async () => {
          if (!confirmDelete) return;
          await deleteCouncilMember(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

// ============================================================
// EnergyPage — Full CRUD for energy systems
// ============================================================
export function EnergyPage() {
  const { energySystems, energyLoading, updateEnergy, createEnergy, updateEnergyFull, deleteEnergy, seedDefaultEnergy } = useAppData();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ type: "", description: "", color: "#08C284", current_value: 100, max_value: 100, status: "developing" });
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    if (!energyLoading && energySystems.length === 0) {
      seedDefaultEnergy();
    }
  }, [energyLoading, energySystems.length, seedDefaultEnergy]);

  const statusColors: Record<string, string> = {
    mastered: "text-primary",
    perfect: "text-green-400",
    advanced: "text-cyan-400",
    developing: "text-muted-foreground",
  };

  const resetForm = () => {
    setForm({ type: "", description: "", color: "#08C284", current_value: 100, max_value: 100, status: "developing" });
    setEditingId(null);
    setShowCreate(false);
  };

  const handleEdit = (e: any) => {
    setForm({ type: e.type, description: e.description, color: e.color, current_value: e.current_value, max_value: e.max_value, status: e.status });
    setEditingId(e.id);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!form.type.trim()) return;
    if (editingId) {
      await updateEnergyFull(editingId, { ...form, current_value: Number(form.current_value), max_value: Number(form.max_value) });
    } else {
      await createEnergy({ ...form, current_value: Number(form.current_value), max_value: Number(form.max_value) });
    }
    resetForm();
  };

  if (energyLoading) return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="hud-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Energy Systems" subtitle={`${energySystems.length} energy types tracked`} icon={<Target size={18} />}
        actions={<button onClick={() => { resetForm(); setShowCreate(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all"><Plus size={12} /> Add Energy</button>}
      />

      {showCreate && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <HudCard className="border-primary/20">
            <p className="text-xs font-mono text-primary uppercase tracking-widest mb-3">{editingId ? "Edit Energy System" : "New Energy System"}</p>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} placeholder="Energy type (e.g. Ki, Mana)" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
                <div className="flex items-center gap-2">
                  <input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} className="w-8 h-8 rounded border border-border cursor-pointer" />
                  <input value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} className="flex-1 bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none" />
                </div>
              </div>
              <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description..." className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none" />
              <div className="grid grid-cols-3 gap-2">
                <input type="number" value={form.current_value} onChange={(e) => setForm((f) => ({ ...f, current_value: Number(e.target.value) }))} placeholder="Current" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
                <input type="number" value={form.max_value} onChange={(e) => setForm((f) => ({ ...f, max_value: Number(e.target.value) }))} placeholder="Max" className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none" />
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none">
                  {["developing", "advanced", "mastered", "perfect"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={resetForm} className="px-3 py-1.5 text-xs font-mono text-muted-foreground border border-border rounded">Cancel</button>
                <button onClick={handleSave} className="px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded">{editingId ? "Save" : "Add"}</button>
              </div>
            </div>
          </HudCard>
        </motion.div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {energySystems.map((e) => (
          <HudCard key={e.id} className="relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: e.color }} />
            <div className="pl-3">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h3 className="text-sm font-display font-bold">{e.type}</h3>
                  <p className="text-xs font-mono text-muted-foreground">{e.description}</p>
                </div>
                <div className="flex items-center gap-1">
                  <div className="text-right shrink-0 mr-1">
                    <p className="text-lg font-display font-bold" style={{ color: e.color }}>{e.current_value}</p>
                    <p className={`text-xs font-mono uppercase ${statusColors[e.status] ?? "text-muted-foreground"}`}>{e.status}</p>
                  </div>
                  <button onClick={() => handleEdit(e)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Edit2 size={12} /></button>
                  <button onClick={() => setConfirmDelete({ id: e.id, label: e.type })} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={12} /></button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(e.current_value / e.max_value) * 100}%`, background: e.color }} />
                </div>
                <span className="text-xs font-mono text-muted-foreground w-16 text-right">{e.current_value}/{e.max_value}</span>
              </div>
              <input
                type="range" min={0} max={e.max_value} value={e.current_value}
                onChange={(ev) => updateEnergy(e.id, Number(ev.target.value))}
                className="w-full mt-2 accent-primary"
              />
            </div>
          </HudCard>
        ))}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.label}"?`}
        description="This action cannot be undone."
        onConfirm={async () => {
          if (!confirmDelete) return;
          await deleteEnergy(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
