import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, Cpu, Target, Crosshair, Plug } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface Step {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  href: string;
  check: (data: AppSnapshot) => boolean;
}

interface AppSnapshot {
  hasProfile: boolean;
  hasGoal: boolean;
  hasQuest: boolean;
  hasIntegration: boolean;
}

const STEPS: Step[] = [
  {
    id: "persona",
    label: "Name your MAVIS persona",
    description: "Set your operator identity in Character settings",
    icon: Cpu,
    href: "/character",
    check: (d) => d.hasProfile,
  },
  {
    id: "goal",
    label: "Create your first goal",
    description: "Define a high-level objective for MAVIS to track",
    icon: Crosshair,
    href: "/goals",
    check: (d) => d.hasGoal,
  },
  {
    id: "quest",
    label: "Add your first quest",
    description: "Break a goal into actionable missions",
    icon: Target,
    href: "/quests",
    check: (d) => d.hasQuest,
  },
  {
    id: "integration",
    label: "Connect an integration",
    description: "Link Google, Notion, Stripe, or another service",
    icon: Plug,
    href: "/integrations",
    check: (d) => d.hasIntegration,
  },
];

const DISMISSED_KEY = "mavis_onboarding_dismissed";

export function OnboardingWidget({ userId }: { userId: string }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(DISMISSED_KEY));
  const navigate = useNavigate();

  useEffect(() => {
    if (dismissed) return;
    async function load() {
      const sb = supabase as any;
      const [{ count: goalCount }, { count: questCount }, { data: profile }, { count: integCount }] = await Promise.all([
        sb.from("mavis_goals").select("*", { count: "exact", head: true }).eq("user_id", userId),
        sb.from("quests").select("*", { count: "exact", head: true }).eq("user_id", userId),
        sb.from("profiles").select("inscribed_name").eq("id", userId).single(),
        sb.from("mavis_user_integrations").select("*", { count: "exact", head: true }).eq("user_id", userId),
      ]);
      setSnapshot({
        hasProfile: !!(profile?.inscribed_name && profile.inscribed_name !== "Operator"),
        hasGoal: (goalCount ?? 0) > 0,
        hasQuest: (questCount ?? 0) > 0,
        hasIntegration: (integCount ?? 0) > 0,
      });
    }
    load();
  }, [userId, dismissed]);

  if (dismissed || !snapshot) return null;

  const completed = STEPS.filter(s => s.check(snapshot)).length;
  const allDone = completed === STEPS.length;

  if (allDone) return null;

  const progress = Math.round((completed / STEPS.length) * 100);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="hud-border rounded-lg overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Cpu size={13} className="text-primary" />
              <span className="text-xs font-mono font-semibold text-foreground tracking-wide">MAVIS SETUP</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-1 w-24 bg-muted rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
              <span className="text-xs font-mono text-muted-foreground">{completed}/{STEPS.length}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCollapsed(c => !c)}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            >
              {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </button>
            <button
              onClick={() => { setDismissed(true); localStorage.setItem(DISMISSED_KEY, "1"); }}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Steps */}
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {STEPS.map((step) => {
                  const done = step.check(snapshot);
                  const Icon = step.icon;
                  return (
                    <button
                      key={step.id}
                      onClick={() => !done && navigate(step.href)}
                      disabled={done}
                      className={`flex items-start gap-3 p-3 rounded border text-left transition-all duration-150 group ${
                        done
                          ? "border-primary/20 bg-primary/5 opacity-60 cursor-default"
                          : "border-border hover:border-primary/40 hover:bg-muted/40 cursor-pointer active:scale-[0.98]"
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {done
                          ? <CheckCircle2 size={15} className="text-primary" />
                          : <Circle size={15} className="text-muted-foreground group-hover:text-primary transition-colors" />
                        }
                      </div>
                      <div>
                        <p className={`text-xs font-mono font-medium ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                          {step.label}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                      </div>
                      {!done && (
                        <div className="ml-auto shrink-0 mt-0.5">
                          <Icon size={12} className="text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
