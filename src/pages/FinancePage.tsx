// ============================================================
// VANTARA.EXE — FinancePage
// Financial analytics dashboard — expenses, charts, categories
// ============================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { DollarSign, TrendingDown, Plus, Trash2, Loader2, X, TrendingUp, Activity, RefreshCw, Sparkles, Building2, RefreshCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard, ProgressBar } from "@/components/SharedUI";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";

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
const CATEGORIES = ["general", "food", "tech", "travel", "marketing", "advertising", "software", "fitness", "health", "education", "entertainment", "utilities", "office_supplies", "professional_services", "subscriptions", "other"];
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

const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

// ─── FinancePage ────────────────────────────────────────────
export function FinancePage() {
  const { user, session } = useAuth();
  const token = session?.access_token ?? "";
  const { lastActionTs } = useAppData();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);
  const [marketInsights, setMarketInsights] = useState<any>(null);
  const [perfInsights, setPerfInsights] = useState<any>(null);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [loadingPerf, setLoadingPerf] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [plaidAccounts, setPlaidAccounts] = useState<any[]>([]);
  const [plaidItems, setPlaidItems] = useState<any[]>([]);
  const [connectingBank, setConnectingBank] = useState(false);
  const [syncingBank, setSyncingBank] = useState(false);
  const autoDetectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // ─── Plaid accounts ────────────────────────────────────────
  const fetchPlaidAccounts = useCallback(async () => {
    if (!token) return;
    try {
      const { data, error } = await supabase.functions.invoke("mavis-plaid", {
        body: { action: "get_accounts" },
      });
      if (!error && data) {
        setPlaidItems(data.items ?? []);
        setPlaidAccounts(data.accounts ?? []);
      }
    } catch { /* non-fatal */ }
  }, [token]);
  useEffect(() => { fetchPlaidAccounts(); }, [fetchPlaidAccounts]);

  // ─── Auto-detect category ──────────────────────────────────
  async function handleAutoDetect() {
    if (!addForm.description.trim()) return;
    setAutoDetecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-expense-categorize", {
        body: {
          description: addForm.description.trim(),
          amount: addForm.amount ? parseFloat(addForm.amount) : undefined,
          currency: addForm.currency,
        },
      });
      if (error) throw error;
      if (data?.category) {
        setAddForm((f) => ({ ...f, category: data.category }));
        toast.success(`Auto-detected: ${data.category}${data.tax_deductible ? " (tax-deductible)" : ""}`);
      }
    } catch {
      toast.error("Auto-detect failed");
    } finally {
      setAutoDetecting(false);
    }
  }

  // Debounce auto-detect on description change
  function handleDescriptionChange(value: string) {
    setAddForm((f) => ({ ...f, description: value }));
    if (autoDetectRef.current) clearTimeout(autoDetectRef.current);
    if (value.trim().length > 4) {
      autoDetectRef.current = setTimeout(async () => {
        setAutoDetecting(true);
        try {
          const { data } = await supabase.functions.invoke("mavis-expense-categorize", {
            body: { description: value.trim() },
          });
          if (data?.category) setAddForm((f) => ({ ...f, category: data.category }));
        } catch { /* silent */ } finally {
          setAutoDetecting(false);
        }
      }, 900);
    }
  }

  // ─── Plaid connect ─────────────────────────────────────────
  async function handleConnectBank() {
    setConnectingBank(true);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-plaid", {
        body: { action: "create_link_token" },
      });
      if (error || !data?.link_token) throw new Error(error?.message ?? "No link token");

      // Dynamically load Plaid Link script
      const script = document.createElement("script");
      script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
      script.onload = () => {
        const handler = (window as any).Plaid.create({
          token: data.link_token,
          onSuccess: async (publicToken: string, metadata: any) => {
            const { error: exchErr } = await supabase.functions.invoke("mavis-plaid", {
              body: {
                action: "exchange_token",
                public_token: publicToken,
                institution_name: metadata?.institution?.name ?? "Bank",
              },
            });
            if (exchErr) { toast.error("Failed to connect bank"); return; }
            toast.success(`${metadata?.institution?.name ?? "Bank"} connected!`);
            fetchPlaidAccounts();
            handleSyncBank();
          },
          onExit: () => setConnectingBank(false),
        });
        handler.open();
      };
      document.body.appendChild(script);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to start bank connection");
      setConnectingBank(false);
    }
  }

  async function handleSyncBank() {
    setSyncingBank(true);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-plaid", {
        body: { action: "sync_transactions" },
      });
      if (error) throw error;
      toast.success(`Synced ${data?.synced ?? 0} transactions`);
      fetchExpenses();
    } catch {
      toast.error("Bank sync failed");
    } finally {
      setSyncingBank(false);
    }
  }

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

  // ─── Market Radar ──────────────────────────────────────────
  async function fetchMarketRadar() {
    if (!token) return;
    setLoadingMarket(true);
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-market-radar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ trigger: "manual" }),
      });
      const data = await res.json().catch(() => ({}));
      setMarketInsights(data);
    } catch { /* non-fatal */ } finally {
      setLoadingMarket(false);
    }
  }

  async function fetchPerfScience() {
    if (!token) return;
    setLoadingPerf(true);
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-performance-science`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ trigger: "manual" }),
      });
      const data = await res.json().catch(() => ({}));
      setPerfInsights(data);
    } catch { /* non-fatal */ } finally {
      setLoadingPerf(false);
    }
  }

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
          <div className="flex items-center gap-2">
            {plaidItems.length > 0 && (
              <button
                onClick={handleSyncBank}
                disabled={syncingBank}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 rounded hover:bg-cyan-500/20 disabled:opacity-50 transition-colors"
              >
                {syncingBank ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
                Sync Bank
              </button>
            )}
            <button
              onClick={handleConnectBank}
              disabled={connectingBank}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
            >
              {connectingBank ? <Loader2 size={12} className="animate-spin" /> : <Building2 size={12} />}
              Connect Bank
            </button>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
            >
              <Plus size={12} /> Add Expense
            </button>
          </div>
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
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">{stat.label}</p>
            <p className={`text-xl font-display font-bold ${stat.color}`}>{stat.value}</p>
          </HudCard>
        ))}
      </motion.div>

      {/* ── Connected Bank Accounts ──────────────────────────── */}
      {plaidAccounts.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.04 }}>
          <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-2">Connected Accounts</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {plaidAccounts.map((acct) => {
              const item = plaidItems.find((i) => i.item_id === acct.item_id);
              return (
                <HudCard key={acct.account_id} className="py-2 px-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-mono text-foreground">{acct.name}</p>
                      <p className="text-xs font-mono text-muted-foreground capitalize">{item?.institution_name ?? acct.type}</p>
                    </div>
                    <div className="text-right">
                      {acct.current_bal != null && (
                        <p className="text-sm font-mono font-bold text-emerald-400">{fmtCurrency(acct.current_bal, acct.currency)}</p>
                      )}
                      {acct.mask && <p className="text-xs font-mono text-muted-foreground">••{acct.mask}</p>}
                    </div>
                  </div>
                </HudCard>
              );
            })}
          </div>
        </motion.div>
      )}

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
                <label className="text-xs font-mono text-muted-foreground block mb-0.5">Description *</label>
                <input
                  type="text"
                  value={addForm.description}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  placeholder="e.g. AWS hosting..."
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                />
              </div>
              <div>
                <label className="text-xs font-mono text-muted-foreground block mb-0.5">Amount *</label>
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
                <label className="text-xs font-mono text-muted-foreground block mb-0.5">Currency</label>
                <select
                  value={addForm.currency}
                  onChange={(e) => setAddForm((f) => ({ ...f, currency: e.target.value }))}
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-xs font-mono text-muted-foreground">Category</label>
                  <button
                    type="button"
                    onClick={handleAutoDetect}
                    disabled={autoDetecting || !addForm.description.trim()}
                    className="flex items-center gap-0.5 text-xs font-mono text-primary/70 hover:text-primary disabled:opacity-40 transition-colors"
                  >
                    {autoDetecting ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
                    Auto-detect
                  </button>
                </div>
                <select
                  value={addForm.category}
                  onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-mono text-muted-foreground block mb-0.5">Date</label>
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
                  <span className="text-xs font-mono text-primary tabular-nums">
                    {val > 0 ? `$${Math.round(val)}` : ""}
                  </span>
                  <div className="w-full flex items-end" style={{ height: "72px" }}>
                    <div
                      className="w-full bg-primary/60 rounded-t transition-all duration-700"
                      style={{ height: `${pct}%`, minHeight: val > 0 ? "2px" : "0" }}
                    />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{monthLabel}</span>
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
                          <span className="text-xs font-mono text-muted-foreground">{pct}%</span>
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
                        <span className="text-xs font-mono text-muted-foreground bg-muted/50 px-1 py-0.5 rounded shrink-0 capitalize">
                          {e.category}
                        </span>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">{fmtDate(e.expense_date)}</span>
                    </div>
                    <span className="text-xs font-mono text-red-400 shrink-0">
                      -{fmtCurrency(Number(e.amount), e.currency)}
                    </span>
                    <button
                      onClick={() => setConfirmDelete({ id: e.id, label: e.description })}
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

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.label}"?`}
        description="This action cannot be undone."
        onConfirm={async () => {
          if (!confirmDelete) return;
          await handleDelete(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* ── Market Intelligence ──────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        {/* Market Radar */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-mono text-primary uppercase tracking-widest">Market Radar</h2>
            <button
              onClick={fetchMarketRadar}
              disabled={loadingMarket}
              className="flex items-center gap-1 text-xs text-primary/70 hover:text-primary font-mono"
            >
              {loadingMarket ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Run
            </button>
          </div>
          <HudCard>
            {!marketInsights && !loadingMarket && (
              <div className="text-center py-6">
                <TrendingUp size={28} className="text-muted-foreground mx-auto mb-2" />
                <p className="text-xs font-mono text-muted-foreground">Click Run to scan market signals</p>
              </div>
            )}
            {loadingMarket && <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-primary" /></div>}
            {marketInsights && !loadingMarket && (
              <div className="space-y-3">
                {marketInsights.summary && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{marketInsights.summary}</p>
                )}
                {Array.isArray(marketInsights.signals) && marketInsights.signals.slice(0, 5).map((s: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <Sparkles size={11} className="text-amber-400 mt-0.5 shrink-0" />
                    <span className="text-foreground">{typeof s === "string" ? s : s.signal ?? s.title ?? JSON.stringify(s)}</span>
                  </div>
                ))}
                {marketInsights.opportunities?.slice(0, 3).map((o: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <TrendingUp size={11} className="text-emerald-400 mt-0.5 shrink-0" />
                    <span className="text-foreground">{typeof o === "string" ? o : o.title ?? JSON.stringify(o)}</span>
                  </div>
                ))}
              </div>
            )}
          </HudCard>
        </div>

        {/* Performance Science */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-mono text-primary uppercase tracking-widest">Performance Science</h2>
            <button
              onClick={fetchPerfScience}
              disabled={loadingPerf}
              className="flex items-center gap-1 text-xs text-primary/70 hover:text-primary font-mono"
            >
              {loadingPerf ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Run
            </button>
          </div>
          <HudCard>
            {!perfInsights && !loadingPerf && (
              <div className="text-center py-6">
                <Activity size={28} className="text-muted-foreground mx-auto mb-2" />
                <p className="text-xs font-mono text-muted-foreground">Click Run to analyze performance patterns</p>
              </div>
            )}
            {loadingPerf && <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-primary" /></div>}
            {perfInsights && !loadingPerf && (
              <div className="space-y-3">
                {perfInsights.summary && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{perfInsights.summary}</p>
                )}
                {Array.isArray(perfInsights.insights) && perfInsights.insights.slice(0, 5).map((ins: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <Sparkles size={11} className="text-cyan-400 mt-0.5 shrink-0" />
                    <span className="text-foreground">{typeof ins === "string" ? ins : ins.insight ?? ins.title ?? JSON.stringify(ins)}</span>
                  </div>
                ))}
                {perfInsights.recommendations?.slice(0, 3).map((r: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <Activity size={11} className="text-blue-400 mt-0.5 shrink-0" />
                    <span className="text-foreground">{typeof r === "string" ? r : r.recommendation ?? r.title ?? JSON.stringify(r)}</span>
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
