import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TowerControl, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard, ProgressBar } from "@/components/SharedUI";

const TOWER_FLOORS = [
  { range: "1–10", name: "The Pit", law: "Instinct governs order", energy: "Muddied Ki", essence: "Survival", function: "Base instinct training", ecology: "Barren wasteland of ash and bone. Gravity shifts unpredictably. Creatures born from raw survival instinct prowl. Weather: Scorching heat waves and freezing cold snaps alternate hourly.", inhabitants: "Broken beginners, feral survivors, instinct-driven entities", dangers: "Environmental extremes, pack predators, gravity anomalies", rewards: "Survival Essence, Basic Combat Skills, Instinct Awakening", min: 1, max: 10 },
  { range: "11–20", name: "Shadow Mire", law: "Suffering = identity", energy: "Leaking Nen", essence: "Fear Integration", function: "Shadow work & trauma processing", ecology: "Perpetual twilight swamp where shadows move independently. Black water reflects your deepest fears. Mirror Wraiths and Trauma Serpents dwell here.", inhabitants: "Shadow Workers, Trauma Healers, Fear-Faced Warriors", dangers: "Confronting inner demons, drowning in shadow water, madness", rewards: "Shadow Integration, Fear Transmutation, Trauma Keys", min: 11, max: 20 },
  { range: "21–30", name: "Hunger Wilds", law: "Consume or be consumed", energy: "Ki / Cursed Magoi", essence: "Desire Mastery", function: "Control over wants", ecology: "Lush jungle of impossible beauty where every plant and creature represents a different desire. Rivers flow with liquid temptation.", inhabitants: "Desire Monks, Addiction Survivors, Pleasure Masters", dangers: "Permanent entrapment in desire loops, losing sense of self", rewards: "Desire Channeling, Want Manipulation, Satisfaction Alchemy", min: 21, max: 30 },
  { range: "31–40", name: "Forge Fields", law: "Only what endures fire ascends", energy: "Ki / Aura (stabilizing)", essence: "Discipline", function: "Habit formation", ecology: "Massive workshop realm of endless forges and grinding wheels. One day can be one minute or one year. Automatons demonstrate perfect form.", inhabitants: "Master Craftsmen, Discipline Monks, Habit Architects", dangers: "Eternal repetition curse, discipline titans crushing the undisciplined", rewards: "Habit Mastery, Discipline Infusion, Routine Automation", min: 31, max: 40 },
  { range: "41–50", name: "Domain of Order", law: "Order defines power", energy: "Structured Aura / Haki", essence: "Structure", function: "System building", ecology: "Crystalline mega-city of perfect geometry and sacred mathematics. Buildings grow based on system efficiency.", inhabitants: "System Designers, Architects of Reality, Order Priests", dangers: "Over-systematization leading to rigidity, trapped in bureaucratic mazes", rewards: "System Mastery, Framework Creation, Order Manipulation", min: 41, max: 50 },
  { range: "51–70", name: "Dominion Plane", law: "Equilibrium = dominion", energy: "Emerald–Black Sun flame", essence: "Balance", function: "Chaos/Order equilibrium", ecology: "Vast plateau split down the middle: one side pure chaos, other side sterile order. The middle is a shifting border where both forces clash and dance.", inhabitants: "Balance Masters, Dual-Nature Beings, Chaos Mages, Order Templars", dangers: "Being pulled too far into chaos or order, erasure by imbalance", rewards: "Chaos/Order Duality, Balance Mastery, Probability Manipulation", min: 51, max: 70 },
  { range: "71–85", name: "Celestial Engine", law: "Will shapes cosmos", energy: "Aether / VRIL / Ichor", essence: "Mastery", function: "Macro-reality engineering", ecology: "Cosmic workshop where star-forges create new realities. Celestial Architects work with raw spacetime. The laws of physics are suggestions here.", inhabitants: "Reality Engineers, Celestial Craftsmen, Cosmic Architects", dangers: "Madness from infinite perspective, being unmade by creation energy", rewards: "Reality Engineering, Cosmic Mastery, Creation Authority", min: 71, max: 85 },
  { range: "86–99", name: "Sovereign's Approach", law: "Sovereignty is absolute", energy: "Black Heart / Emerald Flames", essence: "Sovereignty", function: "Final preparation for transcendence", ecology: "Endless white expanse punctuated by crystallized memory pillars — each one a conquered challenge. The air vibrates with pure potential.", inhabitants: "Near-Sovereigns, Transcended Warriors, Memory Keepers", dangers: "Final tests of identity — who you truly are when everything is stripped away", rewards: "Pre-Sovereignty State, Complete Self-Mastery, Domain Authority", min: 86, max: 99 },
  { range: "100", name: "The Throne Room", law: "You are the law", energy: "All Systems Unified", essence: "Sovereignty", function: "Sovereign domain establishment", ecology: "A single vast chamber of mirrored obsidian. Your reflection shows every form you've ever taken. The throne sits empty — waiting.", inhabitants: "Only Sovereigns", dangers: "None — you become the danger for others", rewards: "Full Sovereignty, Reality Authority, Black Sun Monarch Title", min: 100, max: 100 },
];

const ESSENCE_COLORS: Record<string, string> = {
  Survival: "#666666", "Fear Integration": "#4169E1", "Desire Mastery": "#FF69B4",
  Discipline: "#FFD700", Structure: "#00CED1", Balance: "#08C284", Mastery: "#9400D3", Sovereignty: "#FF4500",
};

export default function TowerPage() {
  const { profile, updateProfile } = useAppData();
  const [expandedRange, setExpandedRange] = useState<string | null>(null);

  const currentFloor = profile.current_floor;
  const currentZone = TOWER_FLOORS.find((f) => currentFloor >= f.min && currentFloor <= f.max);

  const getFloorStatus = (floor: typeof TOWER_FLOORS[0]) => {
    if (currentFloor > floor.max) return "cleared";
    if (currentFloor >= floor.min) return "active";
    return "locked";
  };

  const advanceFloor = async (delta: number) => {
    const next = Math.max(1, Math.min(100, currentFloor + delta));
    await updateProfile({ current_floor: next });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tower of Ascent"
        subtitle={`Floor ${currentFloor} — ${currentZone?.name ?? "Unknown Zone"}`}
        icon={<TowerControl size={18} />}
      />

      {currentZone && (
        <HudCard className="border-primary/20 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: ESSENCE_COLORS[currentZone.essence] ?? "#666" }} />
          <div className="pl-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Current Zone</p>
                <h2 className="text-lg font-display font-bold" style={{ color: ESSENCE_COLORS[currentZone.essence] }}>{currentZone.name}</h2>
                <p className="text-xs font-mono text-muted-foreground italic">"{currentZone.law}"</p>
              </div>
              <div className="text-right flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <button onClick={() => advanceFloor(1)} className="p-1 text-primary hover:bg-primary/10 rounded transition-all" title="Advance floor"><ArrowUp size={14} /></button>
                  <button onClick={() => advanceFloor(-1)} className="p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded transition-all" title="Drop floor"><ArrowDown size={14} /></button>
                </div>
                <div>
                  <p className="text-3xl font-display font-black text-primary">{currentFloor}</p>
                  <p className="text-[9px] font-mono text-muted-foreground">/ 100</p>
                </div>
              </div>
            </div>
            <ProgressBar value={currentFloor} max={100} colorClass="bg-primary" height="sm" />
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[9px] font-mono text-muted-foreground">Essence</p>
                <p className="text-xs font-mono" style={{ color: ESSENCE_COLORS[currentZone.essence] }}>{currentZone.essence}</p>
              </div>
              <div>
                <p className="text-[9px] font-mono text-muted-foreground">Energy</p>
                <p className="text-xs font-mono text-foreground/80">{currentZone.energy}</p>
              </div>
            </div>
            {/* Quick jump */}
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[9px] font-mono text-muted-foreground">Jump to:</span>
              <input
                type="number" min={1} max={100} defaultValue={currentFloor}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    const val = Number((e.target as HTMLInputElement).value);
                    if (val >= 1 && val <= 100) await updateProfile({ current_floor: val });
                  }
                }}
                className="w-16 bg-muted/30 border border-border rounded px-2 py-1 text-xs font-mono text-center focus:outline-none focus:border-primary/40"
              />
            </div>
          </div>
        </HudCard>
      )}

      <div className="space-y-2">
        {TOWER_FLOORS.map((floor) => {
          const status = getFloorStatus(floor);
          const isActive = status === "active";
          const isCleared = status === "cleared";
          const isOpen = expandedRange === floor.range;
          const essenceColor = ESSENCE_COLORS[floor.essence] ?? "#666";

          return (
            <motion.div key={floor.range} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className={`rounded-lg border transition-all overflow-hidden ${isActive ? "border-primary/40" : isCleared ? "border-green-900/40 opacity-70" : "border-border/40 opacity-50"}`}
            >
              <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => setExpandedRange(isOpen ? null : floor.range)}>
                <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? "animate-pulse" : ""}`} style={{ background: isCleared ? "#22c55e" : isActive ? essenceColor : "#444" }} />
                <div className="shrink-0 min-w-[52px] text-center px-2 py-0.5 rounded border text-[9px] font-mono" style={{ borderColor: essenceColor + "44", color: essenceColor, background: essenceColor + "11" }}>{floor.range}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-display font-bold ${isActive ? "text-foreground" : "text-foreground/70"}`}>{floor.name}</span>
                    {isActive && <span className="text-[8px] font-mono text-primary border border-primary/30 rounded px-1.5 py-0.5">CURRENT</span>}
                    {isCleared && <span className="text-[8px] font-mono text-green-400 border border-green-900/40 rounded px-1.5 py-0.5">CLEARED</span>}
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground/60 italic truncate">"{floor.law}"</p>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <p className="text-[10px] font-mono" style={{ color: essenceColor }}>{floor.essence}</p>
                  <p className="text-[9px] font-mono text-muted-foreground">{floor.function}</p>
                </div>
                {isOpen ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
              </div>

              <AnimatePresence>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border/40">
                    <div className="p-4 space-y-3">
                      <p className="text-xs font-body text-muted-foreground leading-relaxed">{floor.ecology}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <p className="text-[9px] font-mono text-muted-foreground uppercase mb-1">Inhabitants</p>
                          <p className="text-xs font-body text-foreground/80">{floor.inhabitants}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-mono text-red-400 uppercase mb-1">Dangers</p>
                          <p className="text-xs font-body text-foreground/80">{floor.dangers}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-mono text-green-400 uppercase mb-1">Rewards</p>
                          <p className="text-xs font-body text-foreground/80">{floor.rewards}</p>
                        </div>
                      </div>
                      <div className="flex gap-4 pt-1 border-t border-border/30">
                        <span className="text-[9px] font-mono text-muted-foreground">Energy: {floor.energy}</span>
                        <span className="text-[9px] font-mono text-muted-foreground">Function: {floor.function}</span>
                      </div>
                    </div>
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
