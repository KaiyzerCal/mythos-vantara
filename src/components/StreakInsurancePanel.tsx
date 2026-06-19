// ============================================================
// VANTARA.EXE — StreakInsurancePanel
// XP-powered streak protection activation UI
// ============================================================
import { useState, useEffect } from "react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, ShieldCheck, Flame, Loader2 } from "lucide-react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────
interface StreakInsurance {
  id: string;
  user_id: string;
  streak_type: string;
  current_streak: number;
  insurance_active: boolean;
  insurance_expires_at: string | null;
  activation_cost_xp: number;
  created_at: string;
}

// ─── Helpers ────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function formatStreakType(raw: string) {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return true;
  return new Date(expiresAt) < new Date();
}

// ─── StreakInsurancePanel ────────────────────────────────────
export function StreakInsurancePanel() {
  const { user } = useAuth();
  const [insurances, setInsurances] = useState<StreakInsurance[]>([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);

  async function loadInsurances() {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("streak_insurance")
        .select("*")
        .eq("user_id", user.id)
        .order("streak_type");
      if (error) throw error;
      setInsurances(data ?? []);
    } catch (err: any) {
      toast.error("Failed to load streak insurances: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadInsurances(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  async function activateInsurance(ins: StreakInsurance) {
    setActivating(ins.id);
    try {
      // Deduct XP
      const { error: xpErr } = await supabase.rpc("award_xp", {
        amount: -ins.activation_cost_xp,
        reason: "streak_insurance",
      });
      if (xpErr) throw xpErr;

      // Activate 7-day protection
      const { error } = await supabase
        .from("streak_insurance")
        .update({
          insurance_active: true,
          insurance_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq("id", ins.id);
      if (error) throw error;

      toast.success(`Streak protected for 7 days — ${ins.activation_cost_xp} XP spent`);
      await loadInsurances();
    } catch (err: any) {
      toast.error("Activation failed: " + err.message);
    } finally {
      setActivating(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (insurances.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        No streak insurances found. Complete quests to unlock streak protection.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {insurances.map((ins) => {
        const active = ins.insurance_active && !isExpired(ins.insurance_expires_at);
        return (
          <Card
            key={ins.id}
            className={`border transition-colors ${
              active
                ? "border-emerald-500/40 bg-emerald-950/10"
                : "border-border/50 bg-card/50"
            }`}
          >
            <CardContent className="px-4 py-3">
              <div className="flex items-center gap-3">
                {/* Shield icon */}
                <div className={`p-1.5 rounded-md ${active ? "bg-emerald-900/30" : "bg-zinc-800/50"}`}>
                  {active ? (
                    <ShieldCheck size={16} className="text-emerald-400" />
                  ) : (
                    <Shield size={16} className="text-zinc-500" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-foreground">
                      {formatStreakType(ins.streak_type)}
                    </span>
                    <Badge
                      className={`text-xs border shrink-0 ${
                        active
                          ? "bg-emerald-900/40 text-emerald-300 border-emerald-700"
                          : "bg-zinc-800/40 text-zinc-400 border-zinc-600"
                      }`}
                    >
                      {active ? "Protected" : "Unprotected"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Flame size={10} className="text-orange-400" />
                      {ins.current_streak} day streak
                    </span>
                    {active && ins.insurance_expires_at && (
                      <span className="text-emerald-400/70 font-mono">
                        Protected until {fmtDate(ins.insurance_expires_at)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Activate button */}
                {!active && (
                  <Button
                    size="sm"
                    onClick={() => activateInsurance(ins)}
                    disabled={activating === ins.id}
                    className="shrink-0 bg-emerald-700 hover:bg-emerald-600 text-white text-xs gap-1 h-8"
                  >
                    {activating === ins.id ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <ShieldCheck size={11} />
                    )}
                    Protect for {ins.activation_cost_xp} XP
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── StreakInsurancePanelCard ─── (wrapped with header card for easy embedding)
export function StreakInsurancePanelCard() {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck size={14} className="text-emerald-400" />
          Streak Insurance
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <StreakInsurancePanel />
      </CardContent>
    </Card>
  );
}

export default StreakInsurancePanel;
