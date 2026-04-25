import { useEffect, useState, useCallback } from "react";
import { HeartPulse, Loader2, MessageCircle, ChevronDown, ChevronUp, Users, Brain } from "lucide-react";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ──────────────────────────────────────────────────
interface PersonaRow {
  id: string;
  name: string;
  role: string;
  archetype: string;
  model: string;
  is_active: boolean;
}

interface RelRow {
  persona_id: string;
  bond_level: number;
  trust_level: number;
  current_mood: string;
  mood_reason: string | null;
  total_interactions: number;
  last_interaction_at: string | null;
}

interface ConvRow {
  id: string;
  persona_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface MemoryRow {
  id: string;
  persona_id: string;
  memory_type: string;
  content: string;
  importance: number;
}

interface RowAggregate {
  persona: PersonaRow;
  rel: RelRow | null;
  msgCount: number;
  recent: ConvRow[];
  memories: MemoryRow[];
}

// ─── Helpers ────────────────────────────────────────────────
const moodColor = (m: string) => {
  const map: Record<string, string> = {
    happy: "text-neon-green",
    excited: "text-primary",
    loving: "text-neon-pink",
    playful: "text-neon-cyan",
    neutral: "text-muted-foreground",
    sad: "text-neon-blue",
    distant: "text-muted-foreground",
    frustrated: "text-neon-orange",
  };
  return map[m] ?? "text-muted-foreground";
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "never";
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

// ─── Bar Component ──────────────────────────────────────────
function StatBar({ label, value, max = 100, color }: { label: string; value: number; max?: number; color: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className="text-[10px] font-mono" style={{ color }}>{value}/{max}</span>
      </div>
      <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
        <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ─── Row Component ──────────────────────────────────────────
function RelationshipRow({ row }: { row: RowAggregate }) {
  const [expanded, setExpanded] = useState(false);
  const { persona, rel, msgCount, recent, memories } = row;

  const bond = rel?.bond_level ?? 0;
  const trust = rel?.trust_level ?? 50;
  const mood = rel?.current_mood ?? "neutral";

  return (
    <HudCard>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-display text-sm font-bold text-foreground truncate">{persona.name}</p>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 uppercase">
              {persona.role}
            </span>
            {!persona.is_active && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                archived
              </span>
            )}
          </div>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
            {persona.archetype} · {persona.model}
          </p>
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-primary transition-colors"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <StatBar label="Trust" value={trust} color="hsl(var(--primary))" />
        <StatBar label="Bond" value={bond} color="hsl(330 80% 60%)" />
      </div>

      {/* Meta strip */}
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border/40">
        <div>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Mood</p>
          <p className={`text-xs font-display capitalize ${moodColor(mood)}`}>{mood}</p>
        </div>
        <div>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Messages</p>
          <p className="text-xs font-display text-foreground">{msgCount}</p>
        </div>
        <div>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Last Talk</p>
          <p className="text-xs font-mono text-foreground truncate">{fmtDate(rel?.last_interaction_at ?? null)}</p>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border/40 space-y-3">
          {rel?.mood_reason && (
            <div>
              <p className="text-[9px] font-mono text-muted-foreground uppercase mb-1">Mood Reason</p>
              <p className="text-xs font-body text-foreground italic">"{rel.mood_reason}"</p>
            </div>
          )}

          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <MessageCircle size={11} className="text-primary" />
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                Conversation Linkage ({rel?.total_interactions ?? 0} turns)
              </p>
            </div>
            {recent.length === 0 ? (
              <p className="text-[10px] font-mono text-muted-foreground">No conversation yet.</p>
            ) : (
              <div className="space-y-1.5">
                {recent.map((m) => (
                  <div key={m.id} className="text-[11px] font-body p-2 rounded bg-muted/30 border border-border/30">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className={`text-[9px] font-mono uppercase ${m.role === "user" ? "text-primary" : "text-neon-cyan"}`}>
                        {m.role === "user" ? "You" : persona.name}
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground">
                        {new Date(m.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    </div>
                    <p className="text-foreground line-clamp-2">{m.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {memories.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Brain size={11} className="text-primary" />
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  Top Memories
                </p>
              </div>
              <div className="space-y-1">
                {memories.map((mem) => (
                  <div key={mem.id} className="flex items-start gap-2 text-[11px] font-body p-1.5 rounded bg-muted/20">
                    <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-primary/10 text-primary uppercase shrink-0">
                      {mem.memory_type}
                    </span>
                    <span className="text-foreground flex-1">{mem.content}</span>
                    <span className="text-[9px] font-mono text-muted-foreground shrink-0">i:{mem.importance}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </HudCard>
  );
}

// ─── Page ───────────────────────────────────────────────────
export default function PersonaRelationshipsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<RowAggregate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [pRes, rRes, cRes, mRes] = await Promise.all([
      supabase.from("personas").select("id, name, role, archetype, model, is_active").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("relationship_states").select("persona_id, bond_level, trust_level, current_mood, mood_reason, total_interactions, last_interaction_at").eq("user_id", user.id),
      supabase.from("persona_conversations").select("id, persona_id, role, content, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500),
      supabase.from("persona_memories").select("id, persona_id, memory_type, content, importance").eq("user_id", user.id).order("importance", { ascending: false }).limit(200),
    ]);

    const personas = (pRes.data ?? []) as PersonaRow[];
    const rels = (rRes.data ?? []) as RelRow[];
    const convs = (cRes.data ?? []) as ConvRow[];
    const mems = (mRes.data ?? []) as MemoryRow[];

    const relByPersona = new Map(rels.map((r) => [r.persona_id, r]));
    const convByPersona = new Map<string, ConvRow[]>();
    const countByPersona = new Map<string, number>();
    for (const c of convs) {
      countByPersona.set(c.persona_id, (countByPersona.get(c.persona_id) ?? 0) + 1);
      const arr = convByPersona.get(c.persona_id) ?? [];
      if (arr.length < 5) arr.push(c);
      convByPersona.set(c.persona_id, arr);
    }
    const memByPersona = new Map<string, MemoryRow[]>();
    for (const m of mems) {
      const arr = memByPersona.get(m.persona_id) ?? [];
      if (arr.length < 5) arr.push(m);
      memByPersona.set(m.persona_id, arr);
    }

    const aggregated: RowAggregate[] = personas.map((p) => ({
      persona: p,
      rel: relByPersona.get(p.id) ?? null,
      msgCount: countByPersona.get(p.id) ?? 0,
      recent: convByPersona.get(p.id) ?? [],
      memories: memByPersona.get(p.id) ?? [],
    }));

    setRows(aggregated);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Aggregate stats
  const totals = rows.reduce(
    (acc, r) => {
      acc.bond += r.rel?.bond_level ?? 0;
      acc.trust += r.rel?.trust_level ?? 50;
      acc.msgs += r.msgCount;
      return acc;
    },
    { bond: 0, trust: 0, msgs: 0 }
  );
  const avgBond = rows.length ? Math.round(totals.bond / rows.length) : 0;
  const avgTrust = rows.length ? Math.round(totals.trust / rows.length) : 0;

  if (!user) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="PERSONA RELATIONSHIPS"
        subtitle="Bond, trust, and conversation linkage across your forged personas"
        icon={<HeartPulse size={16} />}
      />

      {/* Aggregate strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <HudCard>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Personas</p>
          <p className="font-display text-xl text-foreground mt-1 flex items-center gap-1.5">
            <Users size={14} className="text-primary" /> {rows.length}
          </p>
        </HudCard>
        <HudCard>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Avg Trust</p>
          <p className="font-display text-xl text-primary mt-1">{avgTrust}</p>
        </HudCard>
        <HudCard>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Avg Bond</p>
          <p className="font-display text-xl mt-1" style={{ color: "hsl(330 80% 60%)" }}>{avgBond}</p>
        </HudCard>
        <HudCard>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Total Messages</p>
          <p className="font-display text-xl text-foreground mt-1">{totals.msgs}</p>
        </HudCard>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <Loader2 className="animate-spin text-primary mx-auto mb-2" size={24} />
            <p className="text-xs font-mono text-muted-foreground">Loading relationships...</p>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <HudCard>
          <div className="text-center py-8">
            <HeartPulse size={28} className="text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-sm font-display text-muted-foreground">No personas to inspect.</p>
            <p className="text-[10px] font-mono text-muted-foreground mt-1">
              Forge a persona to begin tracking relationship dynamics.
            </p>
          </div>
        </HudCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {rows.map((row) => <RelationshipRow key={row.persona.id} row={row} />)}
        </div>
      )}
    </div>
  );
}
