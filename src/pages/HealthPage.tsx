// ============================================================
// VANTARA.EXE — HealthPage
// Health & recovery dashboard — Oura, Calendar, Manual log
// ============================================================
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Heart, Loader2, RefreshCw, Calendar, Clock, Plus, CheckCircle2, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ─── Types ──────────────────────────────────────────────────
interface HealthMetric {
  id: string;
  date: string;
  source: string;
  sleep_duration_minutes: number | null;
  sleep_efficiency: number | null;
  hrv_avg: number | null;
  resting_hr: number | null;
  readiness_score: number | null;
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  light_sleep_minutes: number | null;
}

interface CalendarEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
  description: string;
  location: string;
}

function readinessColor(score: number | null) {
  if (score === null) return "text-muted-foreground";
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-amber-400";
  return "text-red-400";
}

function fmtMins(mins: number | null) {
  if (mins === null) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtPct(val: number | null) {
  if (val === null) return "—";
  return `${Math.round(val * 100)}%`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

// ─── HealthPage ─────────────────────────────────────────────
export function HealthPage() {
  const { session } = useAuth();

  // Oura
  const [ouraToken, setOuraToken] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // Metrics
  const [metrics, setMetrics] = useState<HealthMetric[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // Calendar
  const [icalUrl, setIcalUrl] = useState("");
  const [syncingCal, setSyncingCal] = useState(false);
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([]);
  const [calLoading, setCalLoading] = useState(true);

  // Manual log
  const [manualForm, setManualForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    sleep_hours: "",
    hrv: "",
    resting_hr: "",
    readiness: "",
    notes: "",
  });
  const [savingManual, setSavingManual] = useState(false);

  useEffect(() => {
    if (!session) return;
    loadMetrics();
    loadUpcomingEvents();
  }, [session]);

  // ─── Load metrics ──────────────────────────────────────────
  async function loadMetrics() {
    setMetricsLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - 14);
    const { data } = await (supabase as any)
      .from("health_metrics")
      .select("*")
      .gte("date", since.toISOString().slice(0, 10))
      .order("date", { ascending: false })
      .limit(14);
    setMetrics(data || []);
    setMetricsLoading(false);
    if (data && data.length > 0) {
      setLastSync(data[0].created_at || null);
    }
  }

  async function loadUpcomingEvents() {
    setCalLoading(true);
    const now = new Date();
    const week = new Date();
    week.setDate(week.getDate() + 7);
    const { data } = await (supabase as any)
      .from("calendar_events")
      .select("*")
      .gte("start_at", now.toISOString())
      .lte("start_at", week.toISOString())
      .order("start_at", { ascending: true });
    setCalEvents(data || []);
    setCalLoading(false);
  }

  // ─── Oura sync ────────────────────────────────────────────
  async function handleOuraSync() {
    if (!ouraToken.trim()) { toast.error("Enter your Oura Personal Access Token"); return; }
    if (!session) return;
    setSyncing(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-oura-sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ oura_token: ouraToken, days: 7 }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success(data.message || "Oura sync complete");
      setLastSync(new Date().toISOString());
      loadMetrics();
    } catch (e: any) {
      toast.error(e.message || "Oura sync failed");
    } finally {
      setSyncing(false);
    }
  }

  // ─── Calendar sync ────────────────────────────────────────
  async function handleCalendarSync() {
    if (!icalUrl.trim()) { toast.error("Enter your iCal URL"); return; }
    if (!session) return;
    setSyncingCal(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-calendar-sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ical_url: icalUrl }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success(data.message || "Calendar synced");
      loadUpcomingEvents();
    } catch (e: any) {
      toast.error(e.message || "Calendar sync failed");
    } finally {
      setSyncingCal(false);
    }
  }

  // ─── Manual log ───────────────────────────────────────────
  async function handleManualLog() {
    if (!session) return;
    setSavingManual(true);
    const sleepMins = manualForm.sleep_hours ? Math.round(parseFloat(manualForm.sleep_hours) * 60) : null;
    const { error } = await (supabase as any).from("health_metrics").upsert({
      user_id: session.user.id,
      date: manualForm.date,
      source: "manual",
      sleep_duration_minutes: sleepMins,
      hrv_avg: manualForm.hrv ? parseFloat(manualForm.hrv) : null,
      resting_hr: manualForm.resting_hr ? parseInt(manualForm.resting_hr) : null,
      readiness_score: manualForm.readiness ? parseInt(manualForm.readiness) : null,
      raw_data: manualForm.notes ? { notes: manualForm.notes } : {},
    }, { onConflict: "user_id,date,source" });

    if (error) {
      toast.error("Failed to log health data");
    } else {
      toast.success("Health data logged");
      setManualForm({ date: new Date().toISOString().slice(0, 10), sleep_hours: "", hrv: "", resting_hr: "", readiness: "", notes: "" });
      loadMetrics();
    }
    setSavingManual(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Health & Recovery"
        subtitle="Biometrics, sleep, calendar intelligence"
        icon={<Heart size={18} />}
      />

      {/* ── Section 1: Oura Connect ────────────────────────── */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Connect Oura Ring</h2>
        <HudCard>
          <p className="text-[10px] font-mono text-muted-foreground mb-3">
            Get your Personal Access Token from{" "}
            <a
              href="https://cloud.ouraring.com/personal-access-tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              cloud.ouraring.com
            </a>
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={ouraToken}
              onChange={(e) => setOuraToken(e.target.value)}
              placeholder="Oura Personal Access Token..."
              className="flex-1 bg-muted/30 border border-border rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-primary/40"
            />
            <button
              onClick={handleOuraSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Sync Last 7 Days
            </button>
          </div>
          {lastSync && (
            <p className="text-[9px] font-mono text-muted-foreground mt-2">
              Last synced: {fmtDate(lastSync)}
            </p>
          )}
        </HudCard>
      </section>

      {/* ── Section 2: Health Metrics ─────────────────────── */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Recent Health Metrics</h2>
        {metricsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary" size={20} /></div>
        ) : metrics.length === 0 ? (
          <HudCard>
            <p className="text-xs font-mono text-muted-foreground text-center py-6">No data yet. Sync Oura or log manually.</p>
          </HudCard>
        ) : (
          <HudCard className="overflow-x-auto">
            <table className="w-full min-w-max text-[10px] font-mono">
              <thead>
                <tr className="text-muted-foreground uppercase text-[8px] tracking-widest border-b border-border/30">
                  <th className="text-left py-1.5 pr-3">Date</th>
                  <th className="text-left py-1.5 pr-3">Source</th>
                  <th className="text-right py-1.5 pr-3">Sleep</th>
                  <th className="text-right py-1.5 pr-3">Eff%</th>
                  <th className="text-right py-1.5 pr-3">HRV</th>
                  <th className="text-right py-1.5 pr-3">HR</th>
                  <th className="text-right py-1.5 pr-3">Readiness</th>
                  <th className="text-right py-1.5 pr-3">Deep</th>
                  <th className="text-right py-1.5 pr-3">REM</th>
                  <th className="text-right py-1.5">Light</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {metrics.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/10">
                    <td className="py-1.5 pr-3 text-foreground/80">{m.date}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground uppercase">{m.source}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtMins(m.sleep_duration_minutes)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtPct(m.sleep_efficiency)}</td>
                    <td className="py-1.5 pr-3 text-right">{m.hrv_avg?.toFixed(1) ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right">{m.resting_hr ?? "—"}</td>
                    <td className={`py-1.5 pr-3 text-right font-bold ${readinessColor(m.readiness_score)}`}>
                      {m.readiness_score ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-blue-400/80">{fmtMins(m.deep_sleep_minutes)}</td>
                    <td className="py-1.5 pr-3 text-right text-purple-400/80">{fmtMins(m.rem_sleep_minutes)}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{fmtMins(m.light_sleep_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Readiness legend */}
            <div className="flex gap-4 mt-3 pt-2 border-t border-border/20">
              <span className="text-[8px] font-mono text-green-400">■ ≥ 80 Optimal</span>
              <span className="text-[8px] font-mono text-amber-400">■ 60-79 Moderate</span>
              <span className="text-[8px] font-mono text-red-400">■ &lt;60 Low</span>
            </div>
          </HudCard>
        )}
      </section>

      {/* ── Section 3: Calendar Events ────────────────────── */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Calendar Sync</h2>
        <HudCard className="mb-3">
          <p className="text-[10px] font-mono text-muted-foreground mb-3">
            Google Calendar: Settings → your calendar → "Secret address in iCal format"
          </p>
          <div className="flex gap-2">
            <input
              value={icalUrl}
              onChange={(e) => setIcalUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/..."
              className="flex-1 bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40"
            />
            <button
              onClick={handleCalendarSync}
              disabled={syncingCal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {syncingCal ? <Loader2 size={12} className="animate-spin" /> : <Calendar size={12} />}
              Sync Calendar
            </button>
          </div>
        </HudCard>

        <h3 className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Next 7 Days</h3>
        {calLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="animate-spin text-primary" size={18} /></div>
        ) : calEvents.length === 0 ? (
          <HudCard>
            <p className="text-xs font-mono text-muted-foreground text-center py-4">No upcoming events. Sync your calendar first.</p>
          </HudCard>
        ) : (
          <div className="space-y-2">
            {calEvents.map((ev, i) => (
              <motion.div key={ev.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                <HudCard>
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-10 text-center">
                      <div className="text-[8px] font-mono text-muted-foreground uppercase">
                        {new Date(ev.start_at).toLocaleDateString("en-US", { month: "short" })}
                      </div>
                      <div className="text-base font-display font-bold text-primary leading-none">
                        {new Date(ev.start_at).getDate()}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-display font-bold truncate">{ev.title}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                          <Clock size={9} />
                          {fmtDateTime(ev.start_at)}
                        </span>
                        {ev.location && (
                          <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                            <MapPin size={9} />
                            {ev.location}
                          </span>
                        )}
                      </div>
                      {ev.description && (
                        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">{ev.description}</p>
                      )}
                    </div>
                  </div>
                </HudCard>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 4: Manual Log ─────────────────────────── */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Manual Log</h2>
        <HudCard>
          <p className="text-[9px] font-mono text-primary uppercase tracking-widest mb-3">Quick Health Entry</p>
          <div className="space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">Date</label>
                <input
                  type="date"
                  value={manualForm.date}
                  onChange={(e) => setManualForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">Sleep (hours)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="24"
                  value={manualForm.sleep_hours}
                  onChange={(e) => setManualForm((f) => ({ ...f, sleep_hours: e.target.value }))}
                  placeholder="7.5"
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">HRV (ms)</label>
                <input
                  type="number"
                  step="1"
                  value={manualForm.hrv}
                  onChange={(e) => setManualForm((f) => ({ ...f, hrv: e.target.value }))}
                  placeholder="65"
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">Resting HR (bpm)</label>
                <input
                  type="number"
                  step="1"
                  value={manualForm.resting_hr}
                  onChange={(e) => setManualForm((f) => ({ ...f, resting_hr: e.target.value }))}
                  placeholder="58"
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">Readiness (1-100)</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="100"
                  value={manualForm.readiness}
                  onChange={(e) => setManualForm((f) => ({ ...f, readiness: e.target.value }))}
                  placeholder="82"
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                />
              </div>
            </div>
            <input
              value={manualForm.notes}
              onChange={(e) => setManualForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Notes (optional)..."
              className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
            />
            <div className="flex justify-end">
              <button
                onClick={handleManualLog}
                disabled={savingManual}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
              >
                {savingManual ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                Log Entry
              </button>
            </div>
          </div>
        </HudCard>
      </section>
    </div>
  );
}
