// ============================================================
// VANTARA.EXE — ForecastPage
// Financial forecasting dashboard — trailing 4-week projections
// ============================================================
import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Loader2, BarChart3, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";

// ─── Types ──────────────────────────────────────────────────
interface WeekBucket {
  week: string;
  revenue: number;
  expenses: number;
}

type ForecastMonths = 3 | 6 | 12;

// ─── Helpers ────────────────────────────────────────────────
function fmtCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Get ISO week-start string (YYYY-MM-DD, Monday) for a date string */
function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getNinetyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function fmtWeekLabel(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── ForecastPage ───────────────────────────────────────────
export function ForecastPage() {
  const { user } = useAuth();
  const [revenueHistory, setRevenueHistory] = useState<{ date: string; amount: number }[]>([]);
  const [expenseHistory, setExpenseHistory] = useState<{ date: string; amount: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [forecastMonths, setForecastMonths] = useState<ForecastMonths>(3);

  // ─── Fetch ───────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const cutoff = getNinetyDaysAgo();

    const [revRes, expRes] = await Promise.all([
      (supabase as any)
        .from("mavis_revenue")
        .select("created_at, amount")
        .eq("user_id", user.id)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true }),
      (supabase as any)
        .from("mavis_expenses" as any)
        .select("created_at, amount")
        .eq("user_id", user.id)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true }),
    ]);

    if (revRes.data) {
      setRevenueHistory(
        (revRes.data as { created_at: string; amount: number }[]).map((r) => ({
          date: r.created_at?.slice(0, 10) ?? "",
          amount: Number(r.amount),
        }))
      );
    }
    if (expRes.data) {
      setExpenseHistory(
        (expRes.data as { created_at: string; amount: number }[]).map((r) => ({
          date: r.created_at?.slice(0, 10) ?? "",
          amount: Number(r.amount),
        }))
      );
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Group into weekly buckets ────────────────────────────
  const weeklyBuckets = useMemo((): WeekBucket[] => {
    const map: Record<string, WeekBucket> = {};

    for (const r of revenueHistory) {
      if (!r.date) continue;
      const wk = getWeekStart(r.date);
      if (!map[wk]) map[wk] = { week: wk, revenue: 0, expenses: 0 };
      map[wk].revenue += r.amount;
    }
    for (const e of expenseHistory) {
      if (!e.date) continue;
      const wk = getWeekStart(e.date);
      if (!map[wk]) map[wk] = { week: wk, revenue: 0, expenses: 0 };
      map[wk].expenses += e.amount;
    }

    return Object.values(map).sort((a, b) => a.week.localeCompare(b.week));
  }, [revenueHistory, expenseHistory]);

  // ─── Rolling 4-week average ───────────────────────────────
  const last4 = weeklyBuckets.slice(-4);
  const prior4 = weeklyBuckets.slice(-8, -4);

  const weeklyAvgRevenue = mean(last4.map((w) => w.revenue));
  const weeklyAvgExpense = mean(last4.map((w) => w.expenses));

  const forecastWeeks = forecastMonths * 4;
  const projectedRevenue = weeklyAvgRevenue * forecastWeeks;
  const projectedExpenses = weeklyAvgExpense * forecastWeeks;
  const projectedNet = projectedRevenue - projectedExpenses;

  // ─── Trend vs prior 4 weeks ───────────────────────────────
  const priorAvgRev = mean(prior4.map((w) => w.revenue));
  const trendPct =
    priorAvgRev > 0
      ? Math.round(((weeklyAvgRevenue - priorAvgRev) / priorAvgRev) * 100)
      : null;
  const trendUp = trendPct !== null && trendPct >= 0;

  // ─── Chart data: last 8 weeks + 4 projected ───────────────
  const chartHistorical = weeklyBuckets.slice(-8);
  const projectedWeeks: WeekBucket[] = Array.from({ length: 4 }, (_, i) => {
    // projected week labels based on next 4 Mondays after last historical
    const lastDate =
      chartHistorical.length > 0
        ? chartHistorical[chartHistorical.length - 1].week
        : new Date().toISOString().slice(0, 10);
    const d = new Date(lastDate + "T00:00:00");
    d.setDate(d.getDate() + 7 * (i + 1));
    return {
      week: d.toISOString().slice(0, 10),
      revenue: weeklyAvgRevenue,
      expenses: weeklyAvgExpense,
    };
  });

  const allChartBars = [...chartHistorical, ...projectedWeeks];
  const maxBarVal = Math.max(
    ...allChartBars.map((w) => Math.max(w.revenue, w.expenses)),
    1
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial Forecast"
        subtitle="Projection based on trailing 4-week average"
        icon={<BarChart3 size={18} />}
      />

      {/* ── Forecast Period Selector ─────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mr-1">
          Period
        </span>
        {([3, 6, 12] as ForecastMonths[]).map((m) => (
          <button
            key={m}
            onClick={() => setForecastMonths(m)}
            className={`px-3 py-1 text-xs font-mono rounded border transition-colors ${
              forecastMonths === m
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:border-border/80"
            }`}
          >
            {m}M
          </button>
        ))}

        {/* Trend indicator */}
        {trendPct !== null && (
          <span
            className={`ml-4 flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border ${
              trendUp
                ? "text-green-400 border-green-700/40 bg-green-900/20"
                : "text-red-400 border-red-700/40 bg-red-900/20"
            }`}
          >
            {trendUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {trendUp ? "+" : ""}
            {trendPct}% vs prior 4 wks
          </span>
        )}
      </div>

      {/* ── Stat Cards ──────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-primary" size={20} />
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        >
          <HudCard glowColor="green">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">
              Projected Revenue
            </p>
            <p className="text-xl font-display font-bold text-green-400">
              {fmtCurrency(projectedRevenue)}
            </p>
            <p className="text-[9px] font-mono text-muted-foreground mt-0.5">
              over {forecastMonths}M ({forecastWeeks} wks)
            </p>
          </HudCard>

          <HudCard glowColor="red">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">
              Projected Expenses
            </p>
            <p className="text-xl font-display font-bold text-red-400">
              {fmtCurrency(projectedExpenses)}
            </p>
            <p className="text-[9px] font-mono text-muted-foreground mt-0.5">
              over {forecastMonths}M ({forecastWeeks} wks)
            </p>
          </HudCard>

          <HudCard glowColor="purple">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">
              Projected Net
            </p>
            <p
              className={`text-xl font-display font-bold ${
                projectedNet >= 0 ? "text-primary" : "text-red-400"
              }`}
            >
              {fmtCurrency(projectedNet)}
            </p>
            <p className="text-[9px] font-mono text-muted-foreground mt-0.5">
              {projectedNet >= 0 ? "surplus" : "deficit"}
            </p>
          </HudCard>

          <HudCard>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">
              Weekly Run Rate
            </p>
            <p className="text-xl font-display font-bold text-cyan-400">
              {fmtCurrency(weeklyAvgRevenue - weeklyAvgExpense)}
            </p>
            <p className="text-[9px] font-mono text-muted-foreground mt-0.5">
              net / week
            </p>
          </HudCard>
        </motion.div>
      )}

      {/* ── Runway Note ──────────────────────────────────────── */}
      <div className="text-[10px] font-mono text-muted-foreground">
        Runway:{" "}
        <span className="text-amber-400">
          N/A — add balance in Finance
        </span>
      </div>

      {/* ── Weekly Bar Chart ─────────────────────────────────── */}
      {!loading && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">
            Weekly Revenue vs Expenses
          </h2>
          <HudCard>
            <div className="space-y-2">
              {allChartBars.length === 0 ? (
                <p className="text-xs font-mono text-muted-foreground text-center py-4">
                  No data yet — log revenue and expenses to see the chart.
                </p>
              ) : (
                allChartBars.map((bar, idx) => {
                  const isProjected = idx >= chartHistorical.length;
                  const revPct = maxBarVal > 0 ? (bar.revenue / maxBarVal) * 100 : 0;
                  const expPct = maxBarVal > 0 ? (bar.expenses / maxBarVal) * 100 : 0;

                  return (
                    <div key={bar.week} className="group">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className={`text-[9px] font-mono w-16 shrink-0 ${
                            isProjected
                              ? "text-primary/50"
                              : "text-muted-foreground"
                          }`}
                        >
                          {fmtWeekLabel(bar.week)}
                          {isProjected && (
                            <span className="ml-1 text-[7px] text-primary/40 uppercase">
                              proj
                            </span>
                          )}
                        </span>

                        {/* Revenue bar */}
                        <div className="flex-1 flex flex-col gap-0.5">
                          <div className="flex items-center gap-1">
                            <div className="w-8 text-[8px] font-mono text-green-400 text-right shrink-0">
                              {bar.revenue > 0 ? `$${Math.round(bar.revenue)}` : ""}
                            </div>
                            <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${
                                  isProjected
                                    ? "bg-green-500/30 border border-dashed border-green-500/50"
                                    : "bg-green-500/60"
                                }`}
                                style={{ width: `${revPct}%` }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-8 text-[8px] font-mono text-red-400 text-right shrink-0">
                              {bar.expenses > 0 ? `$${Math.round(bar.expenses)}` : ""}
                            </div>
                            <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${
                                  isProjected
                                    ? "bg-red-500/30 border border-dashed border-red-500/50"
                                    : "bg-red-500/60"
                                }`}
                                style={{ width: `${expPct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/30">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 rounded bg-green-500/60" />
                <span className="text-[9px] font-mono text-muted-foreground">Revenue</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 rounded bg-red-500/60" />
                <span className="text-[9px] font-mono text-muted-foreground">Expenses</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 rounded opacity-40 border border-dashed border-muted-foreground" />
                <span className="text-[9px] font-mono text-muted-foreground">Projected</span>
              </div>
            </div>
          </HudCard>
        </motion.div>
      )}

      {/* ── Info Note ────────────────────────────────────────── */}
      <div className="flex items-start gap-2 px-3 py-2 rounded border border-border/40 bg-muted/10">
        <Info size={12} className="text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[10px] font-mono text-muted-foreground">
          Forecast uses trailing 4-week average. Add entries in Finance to improve accuracy.
        </p>
      </div>
    </div>
  );
}
