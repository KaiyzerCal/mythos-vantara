// ============================================================
// VANTARA.EXE — StripeManagementPage
// Stripe revenue and subscription overview
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  DollarSign,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Plus,
  Loader2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────
interface RevenueRow {
  id: string;
  amount: number;
  currency: string | null;
  source: string;
  created_at: string | null;
  description: string | null;
}

interface ExpenseRow {
  id: string;
  amount: number;
  currency: string | null;
  source: string | null;
  created_at: string;
  description: string;
}

type Period = "7d" | "30d" | "90d" | "all";

interface RevenueForm {
  source: string;
  amount: string;
  description: string;
  currency: string;
}

interface ExpenseForm {
  source: string;
  amount: string;
  description: string;
  currency: string;
}

// ─── Helpers ────────────────────────────────────────────────
function fmtCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function cutoffDate(period: Period): Date | null {
  if (period === "all") return null;
  const d = new Date();
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  d.setDate(d.getDate() - days);
  return d;
}

function getSourceBadgeClass(source: string): string {
  const s = source.toLowerCase();
  if (s.includes("stripe") || s.includes("subscription")) {
    return "bg-purple-900/50 text-purple-300 border-purple-700";
  }
  if (s.includes("gumroad")) {
    return "bg-orange-900/50 text-orange-300 border-orange-700";
  }
  return "bg-zinc-700/50 text-zinc-300 border-zinc-600";
}

const CURRENCIES = ["USD", "EUR", "GBP"];
const REVENUE_SOURCES = ["stripe", "gumroad", "manual", "consulting", "other"];
const EXPENSE_CATEGORIES = ["general", "software", "marketing", "hosting", "other"];

// ─── StripeManagementPage ────────────────────────────────────
export function StripeManagementPage() {
  const { user } = useAuth();
  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("30d");
  const [stripeConfigured, setStripeConfigured] = useState(false);

  const [showRevenueForm, setShowRevenueForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [submittingRev, setSubmittingRev] = useState(false);
  const [submittingExp, setSubmittingExp] = useState(false);

  const [revenueForm, setRevenueForm] = useState<RevenueForm>({
    source: "manual",
    amount: "",
    description: "",
    currency: "USD",
  });
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>({
    source: "manual",
    amount: "",
    description: "",
    currency: "USD",
  });

  // ─── Fetch ───────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // Check Stripe configured
    const { data: intData } = await (supabase as any)
      .from("mavis_user_integrations")
      .select("provider")
      .eq("user_id", user.id)
      .eq("provider", "stripe")
      .limit(1);

    setStripeConfigured(Array.isArray(intData) && intData.length > 0);

    // Fetch revenue
    const { data: revData, error: revErr } = await supabase
      .from("mavis_revenue")
      .select("id, amount, currency, source, created_at, description")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (revErr) {
      toast.error("Failed to load revenue");
    } else {
      setRevenue((revData as RevenueRow[]) ?? []);
    }

    // Fetch expenses
    const { data: expData, error: expErr } = await (supabase as any)
      .from("mavis_expenses")
      .select("id, amount, currency, source, created_at, description")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (expErr) {
      toast.error("Failed to load expenses");
    } else {
      setExpenses((expData as ExpenseRow[]) ?? []);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Period filter ────────────────────────────────────────
  const cutoff = cutoffDate(period);

  const filteredRevenue = revenue.filter((r) => {
    if (!cutoff || !r.created_at) return true;
    return new Date(r.created_at) >= cutoff;
  });

  const filteredExpenses = expenses.filter((e) => {
    if (!cutoff || !e.created_at) return true;
    return new Date(e.created_at) >= cutoff;
  });

  const totalRevenue = filteredRevenue.reduce((s, r) => s + Number(r.amount), 0);
  const totalExpenses = filteredExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const netIncome = totalRevenue - totalExpenses;

  // Running total for table
  let runningTotal = 0;
  const revenueWithRunning = [...filteredRevenue].reverse().map((r) => {
    runningTotal += Number(r.amount);
    return { ...r, runningTotal };
  }).reverse();

  // ─── Log Revenue ─────────────────────────────────────────
  async function handleLogRevenue() {
    if (!user) return;
    if (!revenueForm.description.trim()) {
      toast.error("Description required");
      return;
    }
    const amt = parseFloat(revenueForm.amount);
    if (isNaN(amt) || amt <= 0) {
      toast.error("Valid amount required");
      return;
    }
    setSubmittingRev(true);
    const { error } = await supabase.from("mavis_revenue").insert({
      user_id: user.id,
      amount: amt,
      currency: revenueForm.currency,
      source: revenueForm.source,
      description: revenueForm.description.trim(),
    });
    if (error) {
      toast.error("Failed to log revenue");
    } else {
      toast.success("Revenue logged");
      setRevenueForm({ source: "manual", amount: "", description: "", currency: "USD" });
      setShowRevenueForm(false);
      fetchData();
    }
    setSubmittingRev(false);
  }

  // ─── Log Expense ──────────────────────────────────────────
  async function handleLogExpense() {
    if (!user) return;
    if (!expenseForm.description.trim()) {
      toast.error("Description required");
      return;
    }
    const amt = parseFloat(expenseForm.amount);
    if (isNaN(amt) || amt <= 0) {
      toast.error("Valid amount required");
      return;
    }
    setSubmittingExp(true);
    const { error } = await (supabase as any).from("mavis_expenses").insert({
      user_id: user.id,
      amount: amt,
      currency: expenseForm.currency,
      source: expenseForm.source,
      description: expenseForm.description.trim(),
      expense_date: new Date().toISOString().slice(0, 10),
      category: "general",
    });
    if (error) {
      toast.error("Failed to log expense");
    } else {
      toast.success("Expense logged");
      setExpenseForm({ source: "manual", amount: "", description: "", currency: "USD" });
      setShowExpenseForm(false);
      fetchData();
    }
    setSubmittingExp(false);
  }

  const PERIOD_LABELS: Record<Period, string> = {
    "7d": "7D",
    "30d": "30D",
    "90d": "90D",
    all: "ALL",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revenue Operations"
        subtitle="Stripe + all revenue sources"
        icon={<DollarSign size={18} />}
      />

      {/* ── Stripe Banner ────────────────────────────────────── */}
      {!stripeConfigured && (
        <div className="flex items-start gap-2 px-4 py-3 rounded border border-amber-700/40 bg-amber-900/10">
          <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs font-mono text-amber-300">
            Connect Stripe in{" "}
            <span className="text-amber-200 font-bold">Settings → Integrations</span>{" "}
            to sync subscription data automatically.
          </p>
        </div>
      )}

      {/* ── Period Selector ──────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mr-1">
          Period
        </span>
        {(["7d", "30d", "90d", "all"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1 text-xs font-mono rounded border transition-colors ${
              period === p
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:border-border/80"
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
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
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          <HudCard glowColor="green">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">
              Total Revenue
            </p>
            <p className="text-xl font-display font-bold text-green-400">
              {fmtCurrency(totalRevenue)}
            </p>
            <p className="text-[9px] font-mono text-muted-foreground mt-0.5">
              {filteredRevenue.length} transaction{filteredRevenue.length !== 1 ? "s" : ""}
            </p>
          </HudCard>

          <HudCard glowColor="red">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">
              Total Expenses
            </p>
            <p className="text-xl font-display font-bold text-red-400">
              {fmtCurrency(totalExpenses)}
            </p>
            <p className="text-[9px] font-mono text-muted-foreground mt-0.5">
              {filteredExpenses.length} transaction{filteredExpenses.length !== 1 ? "s" : ""}
            </p>
          </HudCard>

          <HudCard glowColor="purple">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">
              Net Income
            </p>
            <p
              className={`text-xl font-display font-bold ${
                netIncome >= 0 ? "text-primary" : "text-red-400"
              }`}
            >
              {fmtCurrency(netIncome)}
            </p>
            <p className="text-[9px] font-mono text-muted-foreground mt-0.5">
              {netIncome >= 0 ? "profit" : "loss"}
            </p>
          </HudCard>
        </motion.div>
      )}

      {/* ── Revenue Table ────────────────────────────────────── */}
      {!loading && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">
            Revenue Breakdown
          </h2>
          <HudCard className="overflow-x-auto">
            {revenueWithRunning.length === 0 ? (
              <p className="text-xs font-mono text-muted-foreground text-center py-6">
                No revenue records for this period.
              </p>
            ) : (
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border/40">
                    {["Date", "Source", "Amount", "Running Total"].map((h) => (
                      <th
                        key={h}
                        className="text-[9px] text-muted-foreground uppercase tracking-widest text-left pb-2 pr-4"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {revenueWithRunning.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border/20 hover:bg-muted/10 transition-colors"
                    >
                      <td className="py-2 pr-4 text-muted-foreground">
                        {fmtDate(r.created_at)}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wide ${getSourceBadgeClass(
                            r.source
                          )}`}
                        >
                          {r.source}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-green-400 font-bold">
                        {fmtCurrency(Number(r.amount), r.currency ?? "USD")}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {fmtCurrency(r.runningTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </HudCard>
        </motion.div>
      )}

      {/* ── Quick-Add Forms ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Log Revenue */}
        <div>
          <button
            onClick={() => setShowRevenueForm((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 transition-colors mb-2"
          >
            {showRevenueForm ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <Plus size={11} /> Log Revenue
          </button>
          {showRevenueForm && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <HudCard glowColor="green">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[9px] font-mono text-green-400 uppercase tracking-widest">
                    Log Revenue Entry
                  </p>
                  <button
                    onClick={() => setShowRevenueForm(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">
                      Description *
                    </label>
                    <input
                      type="text"
                      value={revenueForm.description}
                      onChange={(e) =>
                        setRevenueForm((f) => ({ ...f, description: e.target.value }))
                      }
                      placeholder="e.g. Gumroad sale..."
                      className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">
                      Amount *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={revenueForm.amount}
                      onChange={(e) =>
                        setRevenueForm((f) => ({ ...f, amount: e.target.value }))
                      }
                      placeholder="0.00"
                      className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">
                      Source
                    </label>
                    <select
                      value={revenueForm.source}
                      onChange={(e) =>
                        setRevenueForm((f) => ({ ...f, source: e.target.value }))
                      }
                      className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                    >
                      {REVENUE_SOURCES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">
                      Currency
                    </label>
                    <select
                      value={revenueForm.currency}
                      onChange={(e) =>
                        setRevenueForm((f) => ({ ...f, currency: e.target.value }))
                      }
                      className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex justify-end mt-3">
                  <button
                    onClick={handleLogRevenue}
                    disabled={submittingRev}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-green-900/30 border border-green-700/40 text-green-300 rounded hover:bg-green-900/50 disabled:opacity-50 transition-colors"
                  >
                    {submittingRev ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Plus size={11} />
                    )}
                    Log Revenue
                  </button>
                </div>
              </HudCard>
            </motion.div>
          )}
        </div>

        {/* Log Expense */}
        <div>
          <button
            onClick={() => setShowExpenseForm((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-mono text-red-400 hover:text-red-300 transition-colors mb-2"
          >
            {showExpenseForm ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <Plus size={11} /> Log Expense
          </button>
          {showExpenseForm && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <HudCard glowColor="red">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[9px] font-mono text-red-400 uppercase tracking-widest">
                    Log Expense Entry
                  </p>
                  <button
                    onClick={() => setShowExpenseForm(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">
                      Description *
                    </label>
                    <input
                      type="text"
                      value={expenseForm.description}
                      onChange={(e) =>
                        setExpenseForm((f) => ({ ...f, description: e.target.value }))
                      }
                      placeholder="e.g. AWS hosting..."
                      className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">
                      Amount *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={expenseForm.amount}
                      onChange={(e) =>
                        setExpenseForm((f) => ({ ...f, amount: e.target.value }))
                      }
                      placeholder="0.00"
                      className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">
                      Category
                    </label>
                    <select
                      value={expenseForm.source}
                      onChange={(e) =>
                        setExpenseForm((f) => ({ ...f, source: e.target.value }))
                      }
                      className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                    >
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">
                      Currency
                    </label>
                    <select
                      value={expenseForm.currency}
                      onChange={(e) =>
                        setExpenseForm((f) => ({ ...f, currency: e.target.value }))
                      }
                      className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex justify-end mt-3">
                  <button
                    onClick={handleLogExpense}
                    disabled={submittingExp}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-red-900/30 border border-red-700/40 text-red-300 rounded hover:bg-red-900/50 disabled:opacity-50 transition-colors"
                  >
                    {submittingExp ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Plus size={11} />
                    )}
                    Log Expense
                  </button>
                </div>
              </HudCard>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
