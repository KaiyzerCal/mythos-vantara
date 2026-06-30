import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radar, RotateCcw, Zap, Wifi, RefreshCw, AlertTriangle, MessageSquare, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader, HudCard, RankBadge } from "@/components/SharedUI";
import { useAppData } from "@/contexts/AppDataContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// ─── PvP Assessment constants ───────────────────────────────────────────────

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

// ─── RuView scan helpers ─────────────────────────────────────────────────────

interface RuViewState {
  id?: string;
  user_id?: string;
  present?: boolean;
  n_persons?: number;
  confidence?: number;
  heart_rate?: number;
  breathing_rate?: number;
  hrv?: number;
  stress?: number;
  sleep_stage?: string;
  apnea_events?: number;
  pose_confidence?: number;
  room_id?: string;
  node_id?: string;
  fall_detected?: boolean;
  updated_at?: string;
}

function getScanRank(power: number): string {
  if (power > 11000) return "SS";
  if (power > 9000) return "S";
  if (power > 7000) return "A";
  if (power > 5000) return "B";
  if (power > 3000) return "C";
  return "E";
}

function calcPower(hr: number, stress: number, hrv: number, conf: number): number {
  return Math.round(((hr / 80) * 3000) + ((1 - stress) * 4000) + ((hrv / 50) * 1500) + (conf * 1500));
}

function timeAgo(isoStr?: string): string {
  if (!isoStr) return "—";
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function vitalBar(value: number, max: number, segments = 5): string {
  const filled = Math.round((value / max) * segments);
  return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, segments - filled));
}

const SUBJECT_LABELS = ["A", "B", "C", "D", "E", "F"];

// ─── Animated power counter ──────────────────────────────────────────────────

function AnimatedNumber({ target }: { target: number }) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const start = 0;
    const duration = 1200;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (target - start) * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [target]);

  return <span>{display.toLocaleString()}</span>;
}

// ─── Radar reticle ───────────────────────────────────────────────────────────

function RadarReticle({ active }: { active: boolean }) {
  return (
    <div className="relative flex items-center justify-center w-48 h-48 mx-auto my-6">
      {[1, 1.5, 2].map((scale, i) => (
        <motion.div
          key={i}
          className={`absolute rounded-full ${i === 0 ? "border border-green-500/80" : "border border-dashed border-green-500/40"}`}
          style={{ width: `${scale * 60}px`, height: `${scale * 60}px` }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.7, 0.2, 0.7] }}
          transition={{ duration: 2, delay: i * 0.4, repeat: Infinity }}
        />
      ))}
      {/* sweep line */}
      <motion.div
        className="absolute w-0.5 rounded-full origin-bottom"
        style={{ height: "50%", bottom: "50%", left: "calc(50% - 1px)", background: "linear-gradient(to top, #4ade80, transparent)" }}
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      />
      {/* center dot */}
      <div
        className={`relative z-10 w-4 h-4 rounded-full ${active ? "bg-green-400" : "bg-red-500"}`}
        style={{ boxShadow: active ? "0 0 12px #4ade80, 0 0 24px #4ade8066" : "0 0 12px #ef4444, 0 0 24px #ef444466" }}
      />
    </div>
  );
}

// ─── Subject card ─────────────────────────────────────────────────────────────

function SubjectCard({ label, data }: { label: string; data: RuViewState }) {
  const hr = data.heart_rate ?? 72;
  const br = data.breathing_rate ?? 14;
  const hrv = data.hrv ?? 45;
  const stress = data.stress ?? 0.3;
  const conf = data.confidence ?? 0.8;
  const power = calcPower(hr, stress, hrv, conf);
  const rank = getScanRank(power);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-black/40 border border-green-500/30 rounded font-mono text-xs text-green-400/90 p-3 space-y-2"
    >
      <div className="flex items-center justify-between border-b border-green-500/20 pb-1.5">
        <span className="font-bold tracking-widest text-green-300">SUBJECT-{label}</span>
        <RankBadge rank={rank} size="xs" />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div className="flex justify-between gap-2">
          <span className="text-green-500/60">HEART RATE</span>
          <span>{hr} BPM <span className="text-green-600">{vitalBar(hr, 120)}</span></span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-green-500/60">BREATHING</span>
          <span>{br} BPM <span className="text-green-600">{vitalBar(br, 25)}</span></span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-green-500/60">HRV</span>
          <span>{hrv} ms</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-green-500/60">STRESS</span>
          <span>{Math.round(stress * 100)}% <span className="text-green-600">{vitalBar(stress * 100, 100)}</span></span>
        </div>
      </div>

      <div className="border-t border-green-500/20 pt-1.5 flex items-center justify-between">
        <span className="text-green-500/60 tracking-widest">POWER LEVEL</span>
        <span className="text-base font-bold text-green-300">
          <AnimatedNumber target={power} />
        </span>
      </div>

      {power > 9000 && (
        <motion.p
          className="text-center text-yellow-400 font-bold tracking-widest"
          animate={{ opacity: [1, 0.5, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        >
          IT'S OVER 9000!
        </motion.p>
      )}
    </motion.div>
  );
}

// ─── SCAN tab ─────────────────────────────────────────────────────────────────

function ScanTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [scanData, setScanData] = useState<RuViewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [alertMode, setAlertMode] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("mavis_ruview_state")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      setScanData(data as RuViewState | null);
      setLastRefresh(new Date());
    } catch {
      // silently ignore network errors during polling
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [user]);

  const handleNarrate = () => {
    navigate("/mavis", { state: { prefill: "Narrate what the RuView scanner is currently detecting." } });
  };

  const alertTriggered = alertMode && scanData?.present && (scanData?.n_persons ?? 0) > 1;

  // ── Fall detected banner ──
  const fallBanner = scanData?.fall_detected ? (
    <motion.div
      className="flex items-center gap-2 bg-red-950/80 border border-red-500 rounded px-3 py-2 text-xs font-mono text-red-400"
      animate={{ opacity: [1, 0.6, 1] }}
      transition={{ duration: 1, repeat: Infinity }}
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span>FALL DETECTED — {timeAgo(scanData.updated_at)} — CHECK IMMEDIATELY</span>
    </motion.div>
  ) : null;

  // ── Alert mode banner ──
  const alertBanner = alertTriggered ? (
    <motion.div
      className="flex items-center gap-2 bg-amber-950/80 border border-amber-500 rounded px-3 py-2 text-xs font-mono text-amber-400"
      animate={{ opacity: [1, 0.6, 1] }}
      transition={{ duration: 1.2, repeat: Infinity }}
    >
      <Shield size={14} className="shrink-0" />
      <span>ALERT MODE — UNEXPECTED PRESENCE DETECTED ({scanData?.n_persons} subjects)</span>
    </motion.div>
  ) : null;

  // ── No sensor state ──
  if (!loading && scanData === null) {
    return (
      <div className="space-y-4">
        <HudCard className="border-green-500/20 bg-black/30">
          <div className="flex flex-col items-center py-6 space-y-4">
            <div className="opacity-30">
              <RadarReticle active={false} />
            </div>
            <div className="text-center space-y-1">
              <p className="font-mono text-sm font-bold text-muted-foreground tracking-widest">NO RUVIEW SENSOR CONFIGURED</p>
              <p className="font-mono text-xs text-muted-foreground/60">Configure a RuView WiFi node and point its webhook at:</p>
              <p className="font-mono text-xs text-green-500/70 bg-black/40 border border-green-500/20 rounded px-3 py-1 mt-1 inline-block">
                /functions/v1/mavis-ruview-bridge
              </p>
            </div>
          </div>
        </HudCard>
      </div>
    );
  }

  const nPersons = scanData?.n_persons ?? 0;
  const confidence = scanData?.confidence ?? 0;

  return (
    <div className="space-y-4">
      {fallBanner}
      {alertBanner}

      {/* Main scan panel */}
      <HudCard className="border-green-500/20 bg-black/30">
        <p className="text-xs font-mono text-green-400/80 uppercase tracking-widest mb-1">⟡ RUVIEW SENSOR — LIVE SCAN</p>

        <RadarReticle active={scanData?.present ?? false} />

        <p className="text-center font-mono text-sm tracking-[0.3em] mb-4">
          {scanData?.present
            ? <span className="text-green-400">SIGNAL ACQUIRED</span>
            : <motion.span
                className="text-green-600/60"
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >SCANNING...</motion.span>
          }
        </p>

        {/* Status bar */}
        <div className="grid grid-cols-3 gap-2 text-xs font-mono text-green-400/70 bg-black/30 border border-green-500/15 rounded p-3 mb-2">
          <div>
            <p className="text-green-500/40 uppercase text-[10px] tracking-widest">PRESENCE</p>
            <p className={scanData?.present ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
              {scanData?.present ? "DETECTED" : "NOT DETECTED"}
            </p>
          </div>
          <div>
            <p className="text-green-500/40 uppercase text-[10px] tracking-widest">SUBJECTS</p>
            <p className="font-bold">{nPersons}</p>
          </div>
          <div>
            <p className="text-green-500/40 uppercase text-[10px] tracking-widest">CONFIDENCE</p>
            <p className="font-bold">{Math.round(confidence * 100)}%</p>
          </div>
          <div>
            <p className="text-green-500/40 uppercase text-[10px] tracking-widest">ROOM</p>
            <p className="font-bold">{scanData?.room_id || "UNKNOWN"}</p>
          </div>
          <div>
            <p className="text-green-500/40 uppercase text-[10px] tracking-widest">NODE</p>
            <p className="font-bold">{scanData?.node_id || "—"}</p>
          </div>
          <div>
            <p className="text-green-500/40 uppercase text-[10px] tracking-widest">UPDATED</p>
            <p className="font-bold">{timeAgo(scanData?.updated_at)}</p>
          </div>
        </div>
      </HudCard>

      {/* Subject cards */}
      {nPersons > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-mono text-green-500/60 uppercase tracking-widest">DETECTED SUBJECTS</p>
          {Array.from({ length: nPersons }).map((_, i) => (
            <SubjectCard key={i} label={SUBJECT_LABELS[i] ?? String(i + 1)} data={scanData!} />
          ))}
        </div>
      )}

      {/* Vitals grid (extended data) */}
      {scanData?.present && (scanData.sleep_stage || scanData.apnea_events != null || scanData.pose_confidence != null) && (
        <HudCard className="border-green-500/20 bg-black/20">
          <p className="text-xs font-mono text-green-500/60 uppercase tracking-widest mb-2">EXTENDED VITALS</p>
          <div className="grid grid-cols-3 gap-3 text-xs font-mono text-green-400/80">
            {scanData.sleep_stage && (
              <div>
                <p className="text-green-500/40 text-[10px] uppercase tracking-widest">SLEEP STAGE</p>
                <p className="font-bold">{scanData.sleep_stage.toUpperCase()}</p>
              </div>
            )}
            {scanData.apnea_events != null && (
              <div>
                <p className="text-green-500/40 text-[10px] uppercase tracking-widest">APNEA EVENTS</p>
                <p className={`font-bold ${scanData.apnea_events > 5 ? "text-red-400" : ""}`}>{scanData.apnea_events}</p>
              </div>
            )}
            {scanData.pose_confidence != null && (
              <div>
                <p className="text-green-500/40 text-[10px] uppercase tracking-widest">POSE CONF.</p>
                <p className="font-bold">{Math.round(scanData.pose_confidence * 100)}%</p>
              </div>
            )}
          </div>
        </HudCard>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleNarrate}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono bg-green-950/40 border border-green-500/30 text-green-400 rounded hover:bg-green-900/40 transition-all"
        >
          <MessageSquare size={12} /> NARRATE
        </button>
        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono bg-black/30 border border-green-500/20 text-green-500/70 rounded hover:border-green-500/40 hover:text-green-400 transition-all"
        >
          <RefreshCw size={12} /> REFRESH
        </button>
        <button
          onClick={() => setAlertMode(v => !v)}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-mono border rounded transition-all ${
            alertMode
              ? "bg-amber-950/40 border-amber-500/40 text-amber-400"
              : "bg-black/30 border-green-500/20 text-green-500/50 hover:border-green-500/40 hover:text-green-400"
          }`}
        >
          <Shield size={12} /> ALERT MODE {alertMode ? "ON" : "OFF"}
        </button>
        {lastRefresh && (
          <span className="ml-auto text-[10px] font-mono text-green-500/30">
            last poll {lastRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ScouterPage() {
  const { profile, rankings, createRanking } = useAppData();
  const [activeTab, setActiveTab] = useState<"assess" | "scan">("assess");
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

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-muted/20 border border-border rounded">
        <button
          onClick={() => setActiveTab("assess")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-mono rounded transition-all tracking-widest ${
            activeTab === "assess"
              ? "bg-primary/10 border border-primary/30 text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Radar size={12} /> ASSESS
        </button>
        <button
          onClick={() => setActiveTab("scan")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-mono rounded transition-all tracking-widest ${
            activeTab === "scan"
              ? "bg-green-950/40 border border-green-500/30 text-green-400"
              : "text-muted-foreground hover:text-green-400/70"
          }`}
        >
          <Wifi size={12} /> SCAN
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "assess" ? (
          <motion.div
            key="assess"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="space-y-5"
          >
            {/* My PvP Stats */}
            <HudCard className="border-primary/30 bg-primary/5">
              <p className="text-xs font-mono text-primary uppercase tracking-widest mb-3">⟡ YOUR COMBAT DATA</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs font-mono text-muted-foreground">RANK</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <RankBadge rank={profile.rank} />
                    <span className="font-display text-sm font-bold">LV.{profile.level}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-mono text-muted-foreground">GPR</p>
                  <p className="font-display text-lg font-bold text-amber-400">{profile.gpr.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-mono text-muted-foreground">PVP RATING</p>
                  <p className="font-display text-lg font-bold text-red-400">{profile.pvp_rating.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-mono text-muted-foreground">COWL SYNC</p>
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
                    <p className="text-xs font-mono text-muted-foreground">{s.label}</p>
                    <p className="text-xs font-display font-bold">{s.value}</p>
                  </div>
                ))}
              </div>
            </HudCard>

            {/* Scout Section */}
            <HudCard>
              <p className="text-xs font-mono text-primary uppercase tracking-widest mb-3">⟡ SCOUT TARGET</p>
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
                        <p className="text-xs font-mono text-muted-foreground uppercase">{q.id}</p>
                        <p className="text-xs font-mono font-bold">{result.answers[q.id]}</p>
                        <p className="text-xs font-mono text-primary">{SCORE_MAP[result.answers[q.id]]}/10</p>
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
                    <p className="text-xs font-mono text-primary">{step + 1} / {SCOUT_QUESTIONS.length}</p>
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
                  <button onClick={resetScout} className="text-xs font-mono text-muted-foreground hover:text-destructive transition-colors">Cancel</button>
                </motion.div>
              )}
            </HudCard>

            {/* Recent Scouted in Rankings */}
            {rankings.filter(r => !r.is_self).length > 0 && (
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">SCOUTED PROFILES IN RANKINGS</p>
                <div className="space-y-1.5">
                  {rankings.filter(r => !r.is_self).slice(0, 5).map(r => (
                    <HudCard key={r.id} className="py-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-display font-bold">{r.display_name}</span>
                          <RankBadge rank={r.rank} size="xs" />
                          <span className="text-xs font-mono text-muted-foreground">LV{r.level}</span>
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
          </motion.div>
        ) : (
          <motion.div
            key="scan"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <ScanTab />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
