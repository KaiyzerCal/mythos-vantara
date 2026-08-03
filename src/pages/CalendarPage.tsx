// ============================================================
// VANTARA.EXE — CalendarPage
// Real calendar (personal events, not scheduled posts — see Content
// Station's "Post Calendar" tab for that). Backed by Google Calendar via
// mavis-calendar-manage (create/reschedule/cancel) and the local
// calendar_events table (fast reads, kept fresh by mavis-calendar-sync).
// This is also where MAVIS puts things when you ask it to add an event
// or task to your calendar from chat/Telegram.
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, RefreshCw,
  Loader2, X, MapPin, Clock, Trash2, Link2Off,
} from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";
import { Link } from "react-router-dom";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

interface CalEvent {
  id: string;
  event_uid: string | null;
  title: string;
  start_at: string;
  end_at: string | null;
  description: string;
  location: string;
}

interface NewEventForm {
  title: string;
  description: string;
  location: string;
  all_day: boolean;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dateKey(d: Date): string {
  // Local-timezone date key — NOT toISOString().slice(0,10), which buckets
  // by UTC and can put a late-evening local event on the wrong day.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayForInput(): string {
  return dateKey(new Date());
}

function emptyForm(): NewEventForm {
  return {
    title: "", description: "", location: "", all_day: false,
    start_date: todayForInput(), start_time: "09:00", end_date: todayForInput(), end_time: "10:00",
  };
}

export function CalendarPage() {
  const { session, user } = useAuth();

  const [connected, setConnected] = useState<boolean | null>(null); // null = still checking
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>(todayForInput());
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<NewEventForm>(emptyForm());
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${session?.access_token}`,
    apikey: ANON_KEY,
    "Content-Type": "application/json",
  }), [session]);

  // ── Connection status ────────────────────────────────────
  const checkConnection = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-google-oauth`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "get_status" }),
      });
      const data = await res.json().catch(() => ({}));
      setConnected(!!data?.statuses?.google_calendar);
    } catch {
      setConnected(false);
    }
  }, [session, authHeaders]);

  useEffect(() => { checkConnection(); }, [checkConnection]);

  // ── Load events for the displayed month from the local table ────
  const loadEvents = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const rangeStart = new Date(viewMonth);
    rangeStart.setDate(rangeStart.getDate() - 7); // small pad for leading days shown from prev month
    const rangeEnd = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 7); // + pad for trailing days
    const { data, error } = await supabase
      .from("calendar_events")
      .select("id, event_uid, title, start_at, end_at, description, location")
      .eq("user_id", user.id)
      .gte("start_at", rangeStart.toISOString())
      .lt("start_at", rangeEnd.toISOString())
      .order("start_at", { ascending: true });
    if (error) toast.error("Failed to load events");
    else setEvents((data as CalEvent[]) ?? []);
    setLoading(false);
  }, [user, viewMonth]);

  useEffect(() => { if (connected) loadEvents(); }, [connected, loadEvents]);

  // ── Sync from Google ─────────────────────────────────────
  async function handleSync() {
    if (!session) return;
    setSyncing(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-calendar-sync`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ days_ahead: 90 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      toast.success(`Synced ${data.count ?? 0} event${data.count === 1 ? "" : "s"} from Google`);
      loadEvents();
    } catch (e: any) {
      toast.error(e.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  // ── Create event ──────────────────────────────────────────
  async function handleCreate() {
    if (!session || !user) return;
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    setCreating(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-calendar-manage`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action: "create_event",
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          location: form.location.trim() || undefined,
          all_day: form.all_day,
          start_date: form.start_date,
          start_time: form.all_day ? undefined : form.start_time + ":00",
          end_date: form.end_date || form.start_date,
          end_time: form.all_day ? undefined : form.end_time + ":00",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to create event");

      // Mirror into the local table immediately so it shows up without
      // waiting on a full sync round-trip.
      await supabase.from("calendar_events").insert({
        user_id: user.id,
        event_uid: data.id,
        title: data.summary ?? form.title.trim(),
        start_at: data.start?.dateTime ?? data.start?.date,
        end_at: data.end?.dateTime ?? data.end?.date ?? null,
        description: form.description.trim(),
        location: form.location.trim(),
        ical_url: "google_calendar_api",
      });

      toast.success("Event created");
      setShowCreate(false);
      setForm(emptyForm());
      loadEvents();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create event");
    } finally {
      setCreating(false);
    }
  }

  // ── Delete event ──────────────────────────────────────────
  async function handleDelete(ev: CalEvent) {
    if (!ev.event_uid) {
      // Locally-synced-only row with no Google id somehow — just remove locally.
      await supabase.from("calendar_events").delete().eq("id", ev.id);
      setEvents((prev) => prev.filter((e) => e.id !== ev.id));
      return;
    }
    setDeletingId(ev.id);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-calendar-manage`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "cancel_event", event_id: ev.event_uid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to delete event");
      await supabase.from("calendar_events").delete().eq("id", ev.id);
      setEvents((prev) => prev.filter((e) => e.id !== ev.id));
      toast.success("Event deleted");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to delete event");
    } finally {
      setDeletingId(null);
    }
  }

  // ── Month grid ────────────────────────────────────────────
  const firstOfMonth = viewMonth;
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0).getDate();
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - firstWeekday);
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const gridDays: Date[] = Array.from({ length: totalCells }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const eventsByDay = events.reduce<Record<string, CalEvent[]>>((acc, e) => {
    const key = dateKey(new Date(e.start_at));
    (acc[key] = acc[key] ?? []).push(e);
    return acc;
  }, {});

  const todayKey = todayForInput();
  const monthLabel = viewMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const selectedDayEvents = eventsByDay[selectedDay] ?? [];

  function shiftMonth(delta: number) {
    const d = new Date(viewMonth);
    d.setMonth(d.getMonth() + delta);
    setViewMonth(d);
  }

  // ── Not connected state ──────────────────────────────────
  if (connected === false) {
    return (
      <div className="space-y-6">
        <PageHeader title="Calendar" subtitle="Personal events and tasks" icon={<CalendarIcon size={18} />} />
        <HudCard>
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Link2Off size={32} className="text-muted-foreground" />
            <p className="text-sm font-mono text-foreground">Google Calendar isn't connected</p>
            <p className="text-xs font-mono text-muted-foreground text-center max-w-xs">
              Connect it in Integrations so MAVIS can read and create events here — and so you can ask it to put things on your calendar from chat or Telegram.
            </p>
            <Link
              to="/integrations"
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
            >
              Go to Integrations
            </Link>
          </div>
        </HudCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        subtitle="Personal events and tasks — ask MAVIS to add something here from chat or Telegram"
        icon={<CalendarIcon size={18} />}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing || connected !== true}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-border text-muted-foreground rounded hover:text-primary hover:border-primary/40 disabled:opacity-50 transition-colors"
            >
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Sync
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
            >
              <Plus size={12} /> New Event
            </button>
          </div>
        }
      />

      {/* ── Create Event Modal ───────────────────────────────── */}
      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <HudCard glowColor="gold">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-mono text-primary uppercase tracking-widest">New Event</p>
                <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
              </div>

              <div className="space-y-3">
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Event title *"
                  className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40"
                />
                <input
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="Location (optional)"
                  className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40"
                />
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Description (optional)"
                  rows={2}
                  className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-primary/40"
                />

                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.all_day} onChange={(e) => setForm((f) => ({ ...f, all_day: e.target.checked }))} className="accent-primary" />
                  <span className="text-xs font-mono text-muted-foreground">All-day event</span>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-mono text-muted-foreground block mb-1">Start</label>
                    <div className="flex gap-1.5">
                      <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                        className="flex-1 bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40" />
                      {!form.all_day && (
                        <input type="time" value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                          className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40" />
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-mono text-muted-foreground block mb-1">End</label>
                    <div className="flex gap-1.5">
                      <input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                        className="flex-1 bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40" />
                      {!form.all_day && (
                        <input type="time" value={form.end_time} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                          className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40" />
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
                  >
                    {creating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                    Create Event
                  </button>
                </div>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Month grid ──────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
              <ChevronLeft size={14} />
            </button>
            <p className="text-sm font-mono text-foreground">{monthLabel}</p>
            <button onClick={() => shiftMonth(1)} className="p-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary" size={20} /></div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center">
                {DAY_LABELS.map((d) => <p key={d} className="text-xs font-mono text-muted-foreground">{d}</p>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {gridDays.map((day) => {
                  const key = dateKey(day);
                  const dayEvents = eventsByDay[key] ?? [];
                  const inMonth = day.getMonth() === viewMonth.getMonth();
                  const isToday = key === todayKey;
                  const isSelected = key === selectedDay;
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDay(key)}
                      className={`min-h-[72px] text-left rounded border p-1.5 transition-colors ${
                        isSelected ? "border-primary/60 bg-primary/10"
                        : isToday ? "border-primary/40 bg-primary/5"
                        : "border-border bg-muted/10 hover:border-border/80"
                      } ${inMonth ? "" : "opacity-40"}`}
                    >
                      <p className={`text-xs font-mono mb-1 ${isToday ? "text-primary" : "text-muted-foreground"}`}>{day.getDate()}</p>
                      {dayEvents.slice(0, 3).map((e) => (
                        <div key={e.id} className="text-[10px] font-mono px-1 py-0.5 rounded mb-0.5 truncate bg-primary/10 text-primary" title={e.title}>
                          {e.title}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <p className="text-[10px] font-mono text-muted-foreground">+{dayEvents.length - 3} more</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Selected day detail ─────────────────────────────── */}
        <HudCard>
          <p className="text-xs font-mono text-primary uppercase tracking-widest mb-3">
            {new Date(selectedDay + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
          </p>
          {selectedDayEvents.length === 0 ? (
            <p className="text-xs font-mono text-muted-foreground py-4">No events this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedDayEvents.map((e) => (
                <div key={e.id} className="border border-border/40 rounded p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-foreground/90 font-medium">{e.title}</p>
                    <button
                      onClick={() => handleDelete(e)}
                      disabled={deletingId === e.id}
                      className="text-muted-foreground hover:text-red-400 transition-colors shrink-0 disabled:opacity-50"
                      title="Delete"
                    >
                      {deletingId === e.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground flex items-center gap-1 mt-1">
                    <Clock size={10} />
                    {new Date(e.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    {e.end_at ? ` – ${new Date(e.end_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}
                  </p>
                  {e.location && (
                    <p className="text-xs font-mono text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin size={10} /> {e.location}
                    </p>
                  )}
                  {e.description && <p className="text-xs text-muted-foreground mt-1.5">{e.description}</p>}
                </div>
              ))}
            </div>
          )}
        </HudCard>
      </div>
    </div>
  );
}
