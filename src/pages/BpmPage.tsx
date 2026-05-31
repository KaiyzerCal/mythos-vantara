import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Activity, Minus, Plus, Save, TrendingUp } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard, ProgressBar } from "@/components/SharedUI";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Suggest a form based on BPM + transformation data
function suggestForm(bpm: number, forms: any[]): string | null {
  for (const f of forms) {
    const match = (f.bpm_range || "").match(/(\d+)[–\-](\d+)/);
    if (match) {
      const min = parseInt(match[1], 10);
      const max = parseInt(match[2], 10);
      if (bpm >= min && bpm <= max) return f.name;
    }
  }
  return null;
}

// BPM zone label
function bpmZone(bpm: number): { label: string; color: string } {
  if (bpm < 60) return { label: "Rest / Recovery", color: "#00CED1" };
  if (bpm < 75) return { label: "Base State", color: "#08C284" };
  if (bpm < 90) return { label: "Focused Flow", color: "#FFD700" };
  if (bpm < 110) return { label: "Elevated Power", color: "#FF8C00" };
  if (bpm < 140) return { label: "Combat Ready", color: "#DC143C" };
  if (bpm < 170) return { label: "Rage State", color: "#9400D3" };
  return { label: "Limit Break", color: "#FF4500" };
}

export default function BpmPage() {
  const { user } = useAuth();
  const { profile, updateProfile, bpmSessions, logBpmSession, logActivity, awardXP } = useAppData();

  const [manualBpm, setManualBpm] = useState(profile.current_bpm);
  const [mood, setMood] = useState("");
  const [notes, setNotes] = useState("");
  const [forms, setForms] = useState<any[]>([]);
  const [saved, setSaved] = useState(false);

  // Load forms for suggestion
  useEffect(() => {
    if (!user) return;
    supabase.from("transformations").select("name, bpm_range").eq("user_id", user.id).then(({ data }) => {
      if (data) setForms(data);
    });
  }, [user]);

  const adjust = (delta: number) =>
    setManualBpm((v) => Math.max(40, Math.min(400, v + delta)));

  const handleSave = async () => {
    await updateProfile({ current_bpm: manualBpm });
    await logBpmSession({
      bpm: manualBpm,
      form: profile.current_form,
      duration: 0,
      mood: mood || null,
      notes: notes || null,
    });
    await awardXP(5);
    await logActivity("bpm_logged", `BPM logged: ${manualBpm}`, 5);
    setMood("");
    setNotes("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const zone = bpmZone(manualBpm);
  const suggested = suggestForm(manualBpm, forms);
  const recentSessions = bpmSessions.slice(0, 10);

  // Average BPM from last 7 sessions
  const avgBpm =
    recentSessions.length > 0
      ? Math.round(recentSessions.slice(0, 7).reduce((s, r) => s + r.bpm, 0) / Math.min(7, recentSessions.length))
      : 0;

  return (
    <div className="space-y-5 max-w-2xl">
      <PageHeader
        title="BPM Tracker"
        subtitle="Biometric pulse mapping — form & energy correlation"
        icon={<Activity size={18} />}
      />

      {/* Current BPM dial */}
      <HudCard className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
        <div className="relative flex flex-col items-center py-4">
          {/* Big number */}
          <div className="relative">
            <motion.p
              key={manualBpm}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-7xl font-display font-black"
              style={{ color: zone.color }}
            >
              {manualBpm}
            </motion.p>
            <p className="text-[10px] font-mono text-muted-foreground text-center uppercase tracking-widest">BPM</p>
          </div>

          {/* Zone badge */}
          <div
            className="mt-2 px-3 py-1 rounded-full border text-xs font-mono uppercase tracking-wider"
            style={{ borderColor: zone.color + "55", color: zone.color, background: zone.color + "15" }}
          >
            {zone.label}
          </div>

          {/* Suggested form */}
          {suggested && (
            <div className="mt-2 text-xs font-mono text-primary/70">
              ↗ Suggested Form: <span className="text-primary font-bold">{suggested}</span>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-6 mt-6">
            <button onClick={() => adjust(-5)} className="w-10 h-10 rounded-full border border-border bg-muted/30 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/30 transition-all font-mono text-xs">-5</button>
            <button onClick={() => adjust(-1)} className="w-9 h-9 rounded-full border border-border bg-muted/30 flex items-center justify-center hover:text-primary hover:border-primary/30 transition-all">
              <Minus size={14} />
            </button>
            <input
              type="number"
              value={manualBpm}
              onChange={(e) => setManualBpm(Math.max(40, Math.min(400, Number(e.target.value))))}
              className="w-20 text-center bg-muted/30 border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-primary/40"
            />
            <button onClick={() => adjust(1)} className="w-9 h-9 rounded-full border border-border bg-muted/30 flex items-center justify-center hover:text-primary hover:border-primary/30 transition-all">
              <Plus size={14} />
            </button>
            <button onClick={() => adjust(5)} className="w-10 h-10 rounded-full border border-border bg-muted/30 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/30 transition-all font-mono text-xs">+5</button>
          </div>

          {/* BPM range visual */}
          <div className="w-full max-w-xs mt-4">
            <div className="flex justify-between mb-1">
              <span className="text-[9px] font-mono text-muted-foreground">40</span>
              <span className="text-[9px] font-mono text-muted-foreground">400</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden relative">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${((manualBpm - 40) / 360) * 100}%`, background: zone.color }}
              />
            </div>
          </div>
        </div>
      </HudCard>

      {/* Session notes */}
      <HudCard>
        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-3">Log Session</p>
        <div className="space-y-2">
          <input
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            placeholder="Mood / state..."
            className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Session notes..."
            rows={2}
            className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm resize-none focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-mono text-muted-foreground">Current form: {profile.current_form}</p>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all"
            >
              <Save size={12} />
              {saved ? "Logged! (+5 XP)" : "Log BPM"}
            </button>
          </div>
        </div>
      </HudCard>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <HudCard className="text-center">
          <p className="text-2xl font-display font-bold text-primary">{profile.current_bpm}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Current</p>
        </HudCard>
        <HudCard className="text-center">
          <p className="text-2xl font-display font-bold text-amber-400">{avgBpm || "—"}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">7-Day Avg</p>
        </HudCard>
        <HudCard className="text-center">
          <p className="text-2xl font-display font-bold text-purple-400">{bpmSessions.length}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Sessions</p>
        </HudCard>
      </div>

      {/* Recent sessions */}
      {recentSessions.length > 0 && (
        <HudCard>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
            <TrendingUp size={10} /> Recent Sessions
          </p>
          <div className="space-y-2">
            {recentSessions.map((s) => {
              const z = bpmZone(s.bpm);
              return (
                <div key={s.id} className="flex items-center gap-3">
                  <span className="text-sm font-display font-bold w-10 shrink-0" style={{ color: z.color }}>
                    {s.bpm}
                  </span>
                  <div className="flex-1">
                    <div className="h-1 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${((s.bpm - 40) / 360) * 100}%`, background: z.color }} />
                    </div>
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground w-20 shrink-0">{s.form}</span>
                  {s.mood && <span className="text-[9px] font-mono text-muted-foreground">{s.mood}</span>}
                  <span className="text-[9px] font-mono text-muted-foreground ml-auto shrink-0">
                    {new Date(s.created_at).toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>
        </HudCard>
      )}
    </div>
  );
}
