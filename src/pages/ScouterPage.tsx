import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radar, ChevronRight, RotateCcw, Zap } from "lucide-react";
import { PageHeader, HudCard, RankBadge } from "@/components/SharedUI";
import { useAppData } from "@/contexts/AppDataContext";

const SCOUT_QUESTIONS = [
  { id: "combat", label: "Combat / Physical Capability", desc: "Rate their raw fighting ability, athleticism, and physical dominance.", options: ["Civilian", "Trained", "Elite", "Monster", "Godlike"] },
  { id: "intel", label: "Intelligence / Strategy", desc: "How sharp are they? Can they outthink you?", options: ["Average", "Sharp", "Brilliant", "Genius", "Omniscient"] },
  { id: "influence", label: "Social Power / Influence", desc: "How much weight do they carry in their sphere?", options: ["None", "Local", "Regional", "National", "Global"] },
  { id: "willpower", label: "Willpower / Mental Fortitude", desc: "How unbreakable are they under pressure?", options: ["Fragile", "Steady", "Iron", "Unbreakable", "Transcendent"] },
  { id: "threat", label: "Threat Level to You", desc: "If they turned hostile, how dangerous would they be?", options: ["Negligible", "Minor", "Moderate", "Severe", "Catastrophic"] },
];

const SCORE_MAP: Record<string, number> = {
  "Civilian": 1, "Trained": 3, "Elite": 5, "Monster": 8, "Godlike": 10,
  "Average": 1, "Sharp": 3, "Brilliant": 5, "Genius": 8, "Omniscient": 10,
  "None": 1, "Local": 3, "Regional": 5, "National": 8, "Global": 10,
  "Fragile": 1, "Steady": 3, "Iron": 5, "Unbreakable": 8, "Transcendent": 10,
  "Negligible": 1, "Minor": 3, "Moderate": 5, "Severe": 8, "Catastrophic": 10,
};

function getPowerLevel(total: number): { label: string; rank: string; color: string } {
  if (total >= 45) return { label: "CATASTROPHIC THREAT", rank: "SS", color: "text-red-500" };
  if (total >= 35) return { label: "APEX PREDATOR", rank: "S", color: "text-amber-400" };
  if (total >= 25) return { label: "HIGH THREAT", rank: "A", color: "text-primary" };
  if (total >= 15) return { label: "NOTABLE", rank: "B", color: "text-blue-400" };
  return { label: "LOW THREAT", rank: "C", color: "text-muted-foreground" };
}

export default function ScouterPage() {
  const { profile, rankings, createRanking } = useAppData();
  const [scouting, setScouting] = useState(false);
  const [scoutName, setScoutName] = useState("");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ name: string; total: number; answers: Record<string, string> } | null>(null);

  const startScout = () => {
    if (!scoutName.trim()) return;
    setScouting(true);
    setStep(0);
    setAnswers({});
    setResult(null);
  };

  const selectAnswer = (value: string) => {
    const q = SCOUT_QUESTIONS[step];
    const newAnswers = { ...answers, [q.id]: value };
    setAnswers(newAnswers);
    if (step < SCOUT_QUESTIONS.length - 1) {
      setStep(step + 1);
    } else {
      const total = Object.values(newAnswers).reduce((sum, v) => sum + (SCORE_MAP[v] || 0), 0);
      setResult({ name: scoutName, total, answers: newAnswers });
    }
  };

  const saveToRankings = async () => {
    if (!result) return;
    const power = getPowerLevel(result.total);
    await createRanking({
      display_name: result.name,
      role: "npc",
      rank: power.rank,
      level: Math.round(result.total * 2),
      gpr: result.total * 200,
      pvp: result.total * 180,
      jjk_grade: result.total >= 40 ? "Special Grade" : result.total >= 30 ? "G1" : result.total >= 20 ? "G2" : "G4",
      op_tier: result.total >= 40 ? "Yonko" : result.total >= 30 ? "Admiral" : result.total >= 20 ? "Commander" : "Local",
      influence: result.answers.influence || "Local",
      notes: `Scouted: Combat(${result.answers.combat}), Intel(${result.answers.intel}), Will(${result.answers.willpower}), Threat(${result.answers.threat})`,
      is_self: false,
    });
    resetScout();
  };

  const resetScout = () => {
    setScouting(false);
    setScoutName("");
    setStep(0);
    setAnswers({});
    setResult(null);
  };

  const selfRanking = rankings.find(r => r.is_self);

  return (
    <div className="space-y-5">
      <PageHeader title="Scouter" subtitle="PvP Intelligence & Combat Assessment" icon={<Radar size={18} />} />

      {/* My PvP Stats */}
      <HudCard className="border-primary/30 bg-primary/5">
        <p className="text-[9px] font-mono text-primary uppercase tracking-widest mb-3">⟡ YOUR COMBAT DATA</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-[9px] font-mono text-muted-foreground">RANK</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <RankBadge rank={profile.rank} />
              <span className="font-display text-sm font-bold">LV.{profile.level}</span>
            </div>
          </div>
          <div>
            <p className="text-[9px] font-mono text-muted-foreground">GPR</p>
            <p className="font-display text-lg font-bold text-amber-400">{profile.gpr.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[9px] font-mono text-muted-foreground">PVP RATING</p>
            <p className="font-display text-lg font-bold text-red-400">{profile.pvp_rating.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[9px] font-mono text-muted-foreground">COWL SYNC</p>
            <p className="font-display text-lg font-bold text-primary">{profile.full_cowl_sync}%</p>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2 mt-3">
          {[
            { label: "STR", value: profile.stat_str },
            { label: "AGI", value: profile.stat_agi },
            { label: "VIT", value: profile.stat_vit },
            { label: "INT", value: profile.stat_int },
            { label: "WIS", value: profile.stat_wis },
            { label: "CHA", value: profile.stat_cha },
            { label: "LCK", value: profile.stat_lck },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className="text-[8px] font-mono text-muted-foreground">{s.label}</p>
              <p className="text-xs font-display font-bold">{s.value}</p>
            </div>
          ))}
        </div>
      </HudCard>

      {/* Scout Section */}
      <HudCard>
        <p className="text-[9px] font-mono text-primary uppercase tracking-widest mb-3">⟡ SCOUT TARGET</p>
        {!scouting && !result ? (
          <div className="flex gap-2">
            <input value={scoutName} onChange={(e) => setScoutName(e.target.value)} placeholder="Enter target name..."
              className="flex-1 bg-muted/30 border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary/40"
              onKeyDown={(e) => e.key === "Enter" && startScout()}
            />
            <button onClick={startScout} disabled={!scoutName.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all disabled:opacity-50">
              <Radar size={14} /> Scout
            </button>
          </div>
        ) : result ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="text-center py-4">
              <p className="text-xs font-mono text-muted-foreground mb-1">TARGET: {result.name}</p>
              <p className={`text-2xl font-display font-bold ${getPowerLevel(result.total).color}`}>
                POWER LEVEL: {result.total * 200}
              </p>
              <div className="flex items-center justify-center gap-2 mt-1">
                <RankBadge rank={getPowerLevel(result.total).rank} />
                <span className={`text-sm font-mono font-bold ${getPowerLevel(result.total).color}`}>
                  {getPowerLevel(result.total).label}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {SCOUT_QUESTIONS.map(q => (
                <div key={q.id} className="text-center">
                  <p className="text-[8px] font-mono text-muted-foreground uppercase">{q.id}</p>
                  <p className="text-xs font-mono font-bold">{result.answers[q.id]}</p>
                  <p className="text-[9px] font-mono text-primary">{SCORE_MAP[result.answers[q.id]]}/10</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-center">
              <button onClick={saveToRankings} className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all">
                <Zap size={12} /> Save to Rankings
              </button>
              <button onClick={resetScout} className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono text-muted-foreground border border-border rounded hover:text-primary transition-all">
                <RotateCcw size={12} /> Scout Another
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-mono text-muted-foreground">Scouting: <span className="text-foreground font-bold">{scoutName}</span></p>
              <p className="text-[9px] font-mono text-primary">{step + 1} / {SCOUT_QUESTIONS.length}</p>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${((step + 1) / SCOUT_QUESTIONS.length) * 100}%` }} />
            </div>
            <div>
              <p className="text-sm font-display font-bold mb-1">{SCOUT_QUESTIONS[step].label}</p>
              <p className="text-xs font-body text-muted-foreground mb-3">{SCOUT_QUESTIONS[step].desc}</p>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                {SCOUT_QUESTIONS[step].options.map((opt) => (
                  <button key={opt} onClick={() => selectAnswer(opt)}
                    className="px-3 py-2.5 text-xs font-mono border border-border rounded hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all text-center">
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={resetScout} className="text-[10px] font-mono text-muted-foreground hover:text-destructive transition-colors">Cancel</button>
          </motion.div>
        )}
      </HudCard>

      {/* Recent Scouted in Rankings */}
      {rankings.filter(r => !r.is_self).length > 0 && (
        <div>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">SCOUTED PROFILES IN RANKINGS</p>
          <div className="space-y-1.5">
            {rankings.filter(r => !r.is_self).slice(0, 5).map(r => (
              <HudCard key={r.id} className="py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-display font-bold">{r.display_name}</span>
                    <RankBadge rank={r.rank} size="xs" />
                    <span className="text-[9px] font-mono text-muted-foreground">LV{r.level}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-amber-400">{r.gpr.toLocaleString()} GPR</span>
                    <span className="text-red-400">{r.pvp.toLocaleString()} PVP</span>
                  </div>
                </div>
              </HudCard>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}