// ============================================================
// VANTARA.EXE — FinancePage
// Financial analytics dashboard — expenses, charts, categories
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { DollarSign, TrendingDown, Plus, Trash2, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard, ProgressBar } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────
interface Expense {
  id: string;
  user_id: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  source: string | null;
  expense_date: string;
  created_at: string;
}

interface AddForm {
  description: string;
  amount: string;
  currency: string;
  category: string;
  expense_date: string;
}

// ─── Helpers ────────────────────────────────────────────────
const CATEGORIES = ["general", "food", "tech", "travel", "marketing", "software", "fitness", "health", "other"];
const CURRENCIES = ["USD", "EUR", "GBP"];

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthStart() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function get30DaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Returns last 6 months as ["YYYY-MM", ...] newest last
function last6Months(): string[] {
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

// ─── FinancePage ────────────────────────────────────────────
export function FinancePage() {
  const { user } = useAuth();
  const { lastActionTs } = useAppData();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>({
    description: "",
    amount: "",
    currency: "USD",
    category: "general",
    expense_date: todayStr(),
  });

  // ─── Fetch ─────────────────────────────────────────────────
  const fetchExpenses = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("mavis_expenses")
      .select("*")
      .eq("user_id", user.id)
      .order("expense_date", { ascending: false });
    if (error) {
      toast.error("Failed to load expenses");
    } else {
      setExpenses((data as Expense[]) || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);
  useEffect(() => { if (lastActionTs) fetchExpenses(); }, [lastActionTs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Computed stats ────────────────────────────────────────
  const totalSpend = expenses.reduce((s, e) => s + Number(e.amount), 0);

  const monthStart = getMonthStart();
  const thisMonth = expenses
    .filter((e) => new Date(e.expense_date) >= monthStart)
    .reduce((s, e) => s + Number(e.amount), 0);

  const weekStart = getWeekStart();
  const thisWeek = expenses
    .filter((e) => new Date(e.expense_date) >= weekStart)
    .reduce((s, e) => s + Number(e.amount), 0);

  const thirtyAgo = get30DaysAgo();
  const last30Sum = expenses
    .filter((e) => new Date(e.expense_date) >= thirtyAgo)
    .reduce((s, e) => s + Number(e.amount), 0);
  const avgPerDay = last30Sum / 30;

  // ─── Monthly chart data (last 6 months) ────────────────────
  const months = last6Months();
  const monthlyTotals = months.map((m) =>
    expenses.filter((e) => e.expense_date.startsWith(m)).reduce((s, e) => s + Number(e.amount), 0)
  );
  const maxMonthly = Math.max(...monthlyTotals, 1);

  // ─── Category breakdown ────────────────────────────────────
  const categoryMap: Record<string, number> = {};
  expenses.forEach((e) => {
    categoryMap[e.category] = (categoryMap[e.category] || 0) + Number(e.amount);
  });
  const sortedCategories = Object.entries(categoryMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // ─── Add expense ───────────────────────────────────────────
  async function handleAddExpense() {
    if (!user) return;
    if (!addForm.description.trim()) { toast.error("Description required"); return; }
    if (!addForm.amount || isNaN(parseFloat(addForm.amount))) { toast.error("Valid amount required"); return; }
    setSubmitting(true);
    const { error } = await supabase.from("mavis_expenses").insert({
      user_id: user.id,
      description: addForm.description.trim(),
      amount: parseFloat(addForm.amount),
      currency: addForm.currency,
      category: addForm.category,
      expense_date: addForm.expense_date,
      source: "manual",
    });
    if (error) {
      toast.error("Failed to log expense");
    } else {
      toast.success("Expense logged");
      setAddForm({ description: "", amount: "", currency: "USD", category: "general", expense_date: todayStr() });
      setShowAddForm(false);
      fetchExpenses();
    }
    setSubmitting(false);
  }

  // ─── Delete expense ────────────────────────────────────────
  async function handleDelete(id: string) {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    const { error } = await supabase.from("mavis_expenses").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete expense");
      fetchExpenses();
    } else {
      toast.success("Expense deleted");
    }
  }

  const recentExpenses = expenses.slice(0, 30);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance Ledger"
        subtitle="Expense tracking and financial analytics"
        icon={<DollarSign size={18} />}
        actions={
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
          >
            <Plus size={12} /> Add Expense
          </button>
        }
      />

      {/* ── Summary Cards ────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      >
        {[
          { label: "Total Spend", value: fmtCurrency(totalSpend), color: "text-primary" },
          { label: "This Month", value: fmtCurrency(thisMonth), color: "text-amber-400" },
          { label: "This Week", value: fmtCurrency(thisWeek), color: "text-cyan-400" },
          { label: "Avg / Day (30d)", value: fmtCurrency(avgPerDay), color: "text-green-400" },
        ].map((stat) => (
          <HudCard key={stat.label}>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">{stat.label}</p>
            <p className={`text-xl font-display font-bold ${stat.color}`}>{stat.value}</p>
          </HudCard>
        ))}
      </motion.div>

      {/* ── Add Expense Form ──────────────────────────────────── */}
      {showAddForm && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <HudCard glowColor="gold">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-mono text-primary uppercase tracking-widest">Log New Expense</p>
              <button onClick={() => setShowAddForm(false)} className="text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              <div className="lg:col-span-2">
                <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">Description *</label>
                <input
                  type="text"
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. AWS hosting..."
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={addForm.amount}
                  onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">Currency</label>
                <select
                  value={addForm.currency}
                  onChange={(e) => setAddForm((f) => ({ ...f, currency: e.target.value }))}
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">Category</label>
                <select
                  value={addForm.category}
                  onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">Date</label>
                <input
                  type="date"
                  value={addForm.expense_date}
                  onChange={(e) => setAddForm((f) => ({ ...f, expense_date: e.target.value }))}
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                />
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <button
                onClick={handleAddExpense}
                disabled={submitting}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
              >
                {submitting ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                Log Expense
              </button>
            </div>
          </HudCard>
        </motion.div>
      )}

      {/* ── Monthly Bar Chart ─────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Monthly Spend (Last 6 Months)</h2>
        <HudCard>
          <div className="flex items-end gap-2 h-32">
            {months.map((m, i) => {
              const val = monthlyTotals[i];
              const pct = maxMonthly > 0 ? (val / maxMonthly) * 100 : 0;
              const monthLabel = MONTH_LABELS[parseInt(m.slice(5, 7)) - 1];
              return (
                <div key={m} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[8px] font-mono text-primary tabular-nums">
                    {val > 0 ? `$${Math.round(val)}` : ""}
                  </span>
                  <div className="w-full flex items-end" style={{ height: "72px" }}>
                    <div
                      className="w-full bg-primary/60 rounded-t transition-all duration-700"
                      style={{ height: `${pct}%`, minHeight: val > 0 ? "2px" : "0" }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground">{monthLabel}</span>
                </div>
              );
            })}
          </div>
        </HudCard>
      </motion.div>

      {/* ── Category Breakdown + Expense List ────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        {/* Category breakdown */}
        <div>
          <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Category Breakdown</h2>
          <HudCard>
            {sortedCategories.length === 0 ? (
              <p className="text-xs font-mono text-muted-foreground text-center py-4">No expenses yet</p>
            ) : (
              <div className="space-y-3">
                {sortedCategories.map(([cat, total]) => {
                  const pct = totalSpend > 0 ? Math.round((total / totalSpend) * 100) : 0;
                  return (
                    <div key={cat}>
                      <div className="flex justify-between mb-1">
                        <span className="text-xs font-mono text-foreground capitalize">{cat}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-mono text-muted-foreground">{pct}%</span>
                          <span className="text-xs font-mono text-primary">{fmtCurrency(total)}</span>
                        </div>
                      </div>
                      <ProgressBar value={total} max={totalSpend} colorClass="bg-primary/60" height="xs" />
                    </div>
                  );
                })}
              </div>
            )}
          </HudCard>
        </div>

        {/* Recent expenses */}
        <div>
          <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Recent Expenses</h2>
          <HudCard className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="animate-spin text-primary" size={18} />
              </div>
            ) : recentExpenses.length === 0 ? (
              <p className="text-xs font-mono text-muted-foreground text-center py-6">No expenses logged yet.</p>
            ) : (
              <div className="space-y-1.5">
                {recentExpenses.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 p-2 rounded bg-muted/20 border border-border/40 hover:bg-muted/30 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-foreground truncate">{e.description}</span>
                        <span className="text-[8px] font-mono text-muted-foreground bg-muted/50 px-1 py-0.5 rounded shrink-0 capitalize">
                          {e.category}
                        </span>
                      </div>
                      <span className="text-[9px] font-mono text-muted-foreground">{fmtDate(e.expense_date)}</span>
                    </div>
                    <span className="text-xs font-mono text-red-400 shrink-0">
                      -{fmtCurrency(Number(e.amount), e.currency)}
                    </span>
                    <button
                      onClick={() => handleDelete(e.id)}
                      className="shrink-0 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </HudCard>
        </div>
      </motion.div>

      {/* ── Empty state fallback ──────────────────────────────── */}
      {!loading && expenses.length === 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          <HudCard className="text-center py-10">
            <TrendingDown size={32} className="text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-mono text-muted-foreground">No expenses recorded yet.</p>
            <p className="text-xs font-mono text-muted-foreground mt-1">Click "+ Add Expense" to begin tracking.</p>
          </HudCard>
        </motion.div>
      )}
    </div>
  );
}
