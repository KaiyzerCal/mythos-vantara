// The Sovereign Sefirot Tree: the Black Sun Monarch at the centre, every auxiliary pathway radiating out as an
// anatomical extension of it, grouped by body mapping. Read-only view of the skills already loaded in the app.
import { useMemo } from "react";
import type { Skill } from "@/hooks/useDataHooks";

const GROUPS: { key: string; label: string; angle: number; color: string }[] = [
  { key: "kinetic_limb", label: "Martial Limbs", angle: -90, color: "#f97316" },
  { key: "skeletal_law", label: "Skeletal Law", angle: -18, color: "#94a3b8" },
  { key: "ocular_sense", label: "Crown Senses", angle: 54, color: "#38bdf8" },
  { key: "primal_magnetism", label: "Primal Magnetism", angle: 126, color: "#f472b6" },
  { key: "quantum_drift", label: "Quantum Drift", angle: 198, color: "#a78bfa" },
  { key: "other", label: "Other Limbs", angle: 270, color: "#64748b" },
];

const pretty = (n: string) => n.replace(/_/g, " ");

export function SefirotTree({ skills }: { skills: Skill[] }) {
  const model = useMemo(() => {
    const beyonder = skills.filter((s) => s.category === "Beyonder");
    const trunk = beyonder.find((s) => s.is_sovereign_trunk && !s.parent_skill_id);
    if (!trunk) return null;
    const seqsOf = (rootId: string) => beyonder.filter((s) => s.parent_skill_id === rootId);
    // Frontier = the end of the unbroken run of unlocked sequences from Seq.9 (tier 1), so a stray unlock higher up
    // can't move where a pathway says you are.
    const active = (rootId: string) => {
      const byTier = new Map(seqsOf(rootId).map((s) => [s.tier, s]));
      let cur: Skill | null = null;
      for (let t = 1; t <= 10; t++) { const s = byTier.get(t); if (!s || !s.unlocked) break; cur = s; }
      return cur;
    };
    // Progress already banked on sequences above the frontier (a head start; capped at 99% until they unlock).
    const banked = (rootId: string, frontierTier: number) =>
      seqsOf(rootId).filter((s) => s.tier > frontierTier && s.proficiency > 0).length;
    const roots = beyonder.filter((s) => !s.parent_skill_id && s.id !== trunk.id);
    const groups = GROUPS.map((g) => ({
      ...g,
      limbs: roots.filter((r) => (g.key === "other" ? !r.body_mapping : r.body_mapping === g.key))
        .map((r) => { const seq = active(r.id); return { root: r, seq, banked: banked(r.id, seq?.tier ?? 0) }; }).sort((a, b) => a.root.name.localeCompare(b.root.name)),
    })).filter((g) => g.limbs.length > 0);
    return { trunk, trunkSeq: active(trunk.id), groups };
  }, [skills]);

  if (!model) return <p className="text-xs font-mono text-muted-foreground">The Sovereign Trunk is not set yet.</p>;

  const size = 360, c = size / 2, r1 = 118, r2 = 158;
  const pos = (deg: number, r: number) => [c + r * Math.cos((deg * Math.PI) / 180), c + r * Math.sin((deg * Math.PI) / 180)];

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-sm mx-auto" role="img" aria-label="Sovereign Sefirot Tree">
        {model.groups.map((g) => {
          const [gx, gy] = pos(g.angle, r1);
          return (
            <g key={g.key}>
              <line x1={c} y1={c} x2={gx} y2={gy} stroke={g.color} strokeOpacity={0.5} strokeWidth={2} />
              <circle cx={gx} cy={gy} r={7} fill={g.color} />
              <text x={pos(g.angle, r2 + 14)[0]} y={pos(g.angle, r2 + 14)[1]} textAnchor="middle" fontSize="9" fill="currentColor" opacity={0.8}>{g.label}</text>
              {g.limbs.map((l, i) => {
                const spread = (i - (g.limbs.length - 1) / 2) * 11;
                const [lx, ly] = pos(g.angle + spread, r2 - 6);
                const pct = Number(l.seq?.proficiency ?? 0);
                return (
                  <g key={l.root.id}>
                    <line x1={gx} y1={gy} x2={lx} y2={ly} stroke={g.color} strokeOpacity={0.35} />
                    <circle cx={lx} cy={ly} r={4.5} fill="none" stroke={g.color} strokeWidth={1.5} />
                    <circle cx={lx} cy={ly} r={4.5 * Math.max(0.15, pct / 100)} fill={g.color} />
                    <title>{`${pretty(l.root.name)}${l.seq ? ` - current: Seq.${10 - l.seq.tier} ${l.seq.name} ${pct}%` : ""}${l.banked ? ` · ${l.banked} higher sequence${l.banked === 1 ? "" : "s"} with banked progress` : ""}`}</title>
                  </g>
                );
              })}
            </g>
          );
        })}
        <circle cx={c} cy={c} r={30} fill="#0b0b10" stroke="#fbbf24" strokeWidth={2} />
        <circle cx={c} cy={c} r={22} fill="#000" />
        <text x={c} y={c - 4} textAnchor="middle" fontSize="8" fill="#fbbf24" fontWeight="bold">BLACK SUN</text>
        <text x={c} y={c + 8} textAnchor="middle" fontSize="7" fill="#fbbf24" opacity={0.85}>{model.trunkSeq ? `Seq.${10 - model.trunkSeq.tier} ${model.trunkSeq.name} ${model.trunkSeq.proficiency}%` : "Sovereign Trunk"}</text>
      </svg>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
        {model.groups.map((g) => (
          <div key={g.key}>
            <p className="uppercase tracking-widest text-muted-foreground mt-1" style={{ color: g.color }}>{g.label}</p>
            {g.limbs.map((l) => (
              <p key={l.root.id} className="flex justify-between gap-2">
                <span className="text-foreground">{pretty(l.root.name)}</span>
                <span className="text-muted-foreground text-right">
                  {l.seq ? `Seq.${10 - l.seq.tier} ${l.seq.name} ${l.seq.proficiency}%` : "locked"}
                  {l.banked > 0 && <span className="opacity-60"> · +{l.banked} banked</span>}
                </span>
              </p>
            ))}
          </div>
        ))}
      </div>
      <p className="text-[11px] font-mono text-muted-foreground text-center">Each limb shows the sequence you are on now. "Banked" is progress already earned on higher sequences; it unlocks when you reach them.</p>
      <p className="text-xs font-display italic text-primary/70 text-center">"Let no limb believe itself severed from the spine."</p>
    </div>
  );
}
