import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, PhoneCall, PhoneIncoming, Building2, MessageSquare,
  Plus, Trash2, Settings, CheckCircle2, XCircle, Clock,
  BarChart3, Users, ChevronDown, ChevronUp, Loader2,
  RefreshCw, Edit3, Save, X, AlertCircle, Mic,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Business {
  id: string;
  name: string;
  industry: string;
  description: string;
  greeting: string;
  hours: Record<string, { open: string; close: string } | null>;
  timezone: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  receptionist_phone_numbers?: PhoneNumber[];
  receptionist_calls?: { count: number }[];
}

interface PhoneNumber {
  id: string;
  phone_number: string;
  vapi_phone_number_id: string;
  is_active: boolean;
}

interface Call {
  id: string;
  business_id: string;
  caller_number: string;
  duration_seconds: number;
  status: string;
  outcome: string;
  transcript: string;
  recording_url: string;
  follow_up_sent: boolean;
  created_at: string;
}

interface Message {
  id: string;
  business_id: string;
  caller_number: string;
  caller_name: string;
  message: string;
  urgency: string;
  is_read: boolean;
  created_at: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = ["Overview", "Businesses", "Calls", "Messages"] as const;
type Tab = typeof TABS[number];

const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

const DAY_LABELS: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "text-emerald-400";
    case "transferred": return "text-blue-400";
    case "failed": return "text-red-400";
    case "voicemail": return "text-purple-400";
    default: return "text-zinc-400";
  }
}

function urgencyColor(urgency: string): string {
  switch (urgency) {
    case "urgent": return "border-red-500/60 bg-red-500/10";
    case "high": return "border-orange-500/60 bg-orange-500/10";
    case "low": return "border-zinc-600 bg-zinc-800/40";
    default: return "border-indigo-500/40 bg-indigo-500/10";
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color: string }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-5">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${color}`}>
        <Icon size={18} />
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
    </div>
  );
}

// ── Business Card ─────────────────────────────────────────────────────────────

function BusinessCard({
  biz,
  token,
  onRefresh,
}: {
  biz: Business;
  token: string;
  onRefresh: () => void;
}) {
  const [provisioning, setProvisioning] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState({
    name: biz.name,
    industry: biz.industry,
    description: biz.description,
    greeting: biz.greeting,
    timezone: biz.timezone,
  });
  const [areaCode, setAreaCode] = useState("415");
  const [error, setError] = useState("");

  const phoneNumber = biz.receptionist_phone_numbers?.[0];
  const callCount = biz.receptionist_calls?.[0]?.count ?? 0;

  async function provision() {
    setProvisioning(true);
    setError("");
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-receptionist-provision?action=provision`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: biz.id, area_code: areaCode }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Provisioning failed");
      else onRefresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProvisioning(false);
    }
  }

  async function release() {
    if (!phoneNumber) return;
    setReleasing(true);
    try {
      await fetch(`${SB_URL}/functions/v1/mavis-receptionist-provision?action=release`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number_id: phoneNumber.id }),
      });
      onRefresh();
    } catch { /* non-fatal */ } finally {
      setReleasing(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-receptionist-config/${biz.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) { setEditing(false); onRefresh(); }
    } catch { /* non-fatal */ } finally {
      setSaving(false);
    }
  }

  async function deleteBusiness() {
    if (!confirm(`Delete ${biz.name}? This cannot be undone.`)) return;
    await fetch(`${SB_URL}/functions/v1/mavis-receptionist-config/${biz.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    onRefresh();
  }

  return (
    <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
            <Building2 size={18} className="text-indigo-400" />
          </div>
          <div>
            {editing ? (
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-sm text-white w-48"
              />
            ) : (
              <div className="font-semibold text-white">{biz.name}</div>
            )}
            <div className="text-xs text-zinc-500">{biz.industry} · {callCount} calls</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${biz.is_active ? "bg-emerald-400" : "bg-zinc-600"}`} />
          {editing ? (
            <>
              <button onClick={save} disabled={saving} className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              </button>
              <button onClick={() => setEditing(false)} className="p-1.5 rounded-lg bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700">
                <X size={14} />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700">
                <Edit3 size={14} />
              </button>
              <button onClick={deleteBusiness} className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20">
                <Trash2 size={14} />
              </button>
              <button onClick={() => setExpanded(e => !e)} className="p-1.5 rounded-lg bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700">
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Phone number section */}
      <div className="px-4 pb-4">
        {phoneNumber ? (
          <div className="flex items-center justify-between bg-zinc-800/60 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <PhoneCall size={14} className="text-emerald-400" />
              <span className="text-sm text-emerald-300 font-mono">{phoneNumber.phone_number}</span>
            </div>
            <button
              onClick={release}
              disabled={releasing}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
            >
              {releasing ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
              Release
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={areaCode}
              onChange={e => setAreaCode(e.target.value)}
              placeholder="Area code"
              maxLength={3}
              className="bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1.5 text-sm text-white w-24"
            />
            <button
              onClick={provision}
              disabled={provisioning}
              className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30 rounded-lg py-1.5 text-sm transition-colors"
            >
              {provisioning ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
              Provision Number
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-zinc-700/50 px-4 py-4 space-y-3"
          >
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Greeting</label>
              {editing ? (
                <textarea
                  value={form.greeting}
                  onChange={e => setForm(f => ({ ...f, greeting: e.target.value }))}
                  rows={2}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-white resize-none"
                />
              ) : (
                <p className="text-sm text-zinc-300">{biz.greeting}</p>
              )}
            </div>
            {biz.description && (
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Description</label>
                <p className="text-sm text-zinc-300">{biz.description}</p>
              </div>
            )}
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Business Hours</label>
              <div className="grid grid-cols-2 gap-1">
                {DAYS.map(day => {
                  const h = biz.hours?.[day];
                  return (
                    <div key={day} className="flex items-center gap-2 text-xs">
                      <span className="text-zinc-500 w-8">{day.charAt(0).toUpperCase() + day.slice(1, 3)}</span>
                      {h ? (
                        <span className="text-zinc-300">{h.open}–{h.close}</span>
                      ) : (
                        <span className="text-zinc-600">Closed</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="text-xs text-zinc-500">Timezone: {biz.timezone}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── New Business Form ─────────────────────────────────────────────────────────

function NewBusinessForm({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "", industry: "general", description: "", greeting: "", timezone: "America/New_York",
  });

  async function create() {
    if (!form.name) return;
    setLoading(true);
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-receptionist-config`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) { setOpen(false); setForm({ name: "", industry: "general", description: "", greeting: "", timezone: "America/New_York" }); onCreated(); }
    } catch { /* non-fatal */ } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30 rounded-xl px-4 py-2 text-sm transition-colors"
      >
        <Plus size={16} /> Add Business
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">New Business</h3>
                <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300"><X size={18} /></button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Business Name *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Acme Dental Clinic"
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Industry</label>
                  <select
                    value={form.industry}
                    onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {["general", "dental", "medical", "legal", "real_estate", "restaurant", "salon", "retail", "consulting", "fitness"].map(v => (
                      <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1).replace("_", " ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Description (optional)</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Brief description of your business..."
                    rows={2}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Custom Greeting (optional)</label>
                  <input
                    value={form.greeting}
                    onChange={e => setForm(f => ({ ...f, greeting: e.target.value }))}
                    placeholder={`Thank you for calling ${form.name || "us"}. How can I help?`}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Timezone</label>
                  <select
                    value={form.timezone}
                    onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {[
                      "America/New_York", "America/Chicago", "America/Denver",
                      "America/Los_Angeles", "America/Phoenix", "America/Anchorage",
                      "Pacific/Honolulu", "Europe/London", "Europe/Paris", "Asia/Tokyo",
                    ].map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setOpen(false)} className="flex-1 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 rounded-lg py-2 text-sm">Cancel</button>
                <button
                  onClick={create}
                  disabled={loading || !form.name}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Call Row ──────────────────────────────────────────────────────────────────

function CallRow({ call }: { call: Call }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-zinc-900/50 border border-zinc-700/40 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-800/30"
      >
        <div className="flex items-center gap-3">
          <PhoneIncoming size={16} className="text-zinc-400" />
          <span className="text-sm text-white font-mono">{call.caller_number || "Unknown"}</span>
          <span className={`text-xs font-medium ${statusColor(call.status)}`}>{call.status}</span>
          {call.follow_up_sent && <span className="text-xs text-emerald-500/80 flex items-center gap-0.5"><CheckCircle2 size={10} /> SMS sent</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <Clock size={12} />
          <span>{fmtDuration(call.duration_seconds)}</span>
          <span>{fmtDate(call.created_at)}</span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-zinc-700/40 px-4 py-3 space-y-2"
          >
            {call.transcript ? (
              <div>
                <p className="text-xs text-zinc-500 mb-1">Transcript</p>
                <p className="text-xs text-zinc-300 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">{call.transcript}</p>
              </div>
            ) : (
              <p className="text-xs text-zinc-600">No transcript available.</p>
            )}
            {call.recording_url && (
              <a href={call.recording_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                <Mic size={12} /> Listen to recording
              </a>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReceptionistPage() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";

  const [tab, setTab] = useState<Tab>("Overview");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [callsLoading, setCallsLoading] = useState(false);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBusinesses = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-receptionist-config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setBusinesses(data.businesses ?? []);
    } catch { /* non-fatal */ } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchCalls = useCallback(async () => {
    if (!token || !session?.user?.id) return;
    setCallsLoading(true);
    try {
      const { data } = await supabase
        .from("receptionist_calls")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      setCalls(data ?? []);
    } catch { /* non-fatal */ } finally {
      setCallsLoading(false);
    }
  }, [token, session?.user?.id]);

  const fetchMessages = useCallback(async () => {
    if (!token || !session?.user?.id) return;
    setMsgsLoading(true);
    try {
      const { data } = await supabase
        .from("receptionist_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      setMessages(data ?? []);
    } catch { /* non-fatal */ } finally {
      setMsgsLoading(false);
    }
  }, [token, session?.user?.id]);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  useEffect(() => {
    if (tab === "Calls") fetchCalls();
    if (tab === "Messages") fetchMessages();
  }, [tab, fetchCalls, fetchMessages]);

  async function refresh() {
    setRefreshing(true);
    await fetchBusinesses();
    if (tab === "Calls") await fetchCalls();
    if (tab === "Messages") await fetchMessages();
    setRefreshing(false);
  }

  async function markRead(msgId: string) {
    await supabase.from("receptionist_messages").update({ is_read: true }).eq("id", msgId);
    setMessages(ms => ms.map(m => m.id === msgId ? { ...m, is_read: true } : m));
  }

  const totalCalls = calls.length;
  const unreadMessages = messages.filter(m => !m.is_read).length;
  const activeBusinesses = businesses.filter(b => b.is_active).length;
  const avgDuration = calls.length ? Math.round(calls.reduce((s, c) => s + c.duration_seconds, 0) / calls.length) : 0;

  if (!token) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        <AlertCircle size={16} className="mr-2" /> Please sign in to access the AI Receptionist.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
            <PhoneCall size={18} className="text-indigo-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">AI Receptionist</h1>
            <p className="text-xs text-zinc-500">24/7 voice AI for your businesses</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={refreshing}
            className="p-2 rounded-lg bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-200"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          </button>
          {tab === "Businesses" && <NewBusinessForm token={token} onCreated={fetchBusinesses} />}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4 pb-0 shrink-0">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors relative ${
              tab === t
                ? "text-white bg-zinc-800/80 border border-zinc-700/50 border-b-transparent"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
            {t === "Messages" && unreadMessages > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{unreadMessages}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <AnimatePresence mode="wait">
          {tab === "Overview" && (
            <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={Building2} label="Active Businesses" value={activeBusinesses} color="bg-indigo-500/20 text-indigo-400" />
                <StatCard icon={PhoneCall} label="Total Calls" value={totalCalls} color="bg-emerald-500/20 text-emerald-400" />
                <StatCard icon={MessageSquare} label="Unread Messages" value={unreadMessages} color="bg-orange-500/20 text-orange-400" />
                <StatCard icon={Clock} label="Avg Call Duration" value={fmtDuration(avgDuration)} color="bg-purple-500/20 text-purple-400" />
              </div>

              <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <BarChart3 size={16} className="text-indigo-400" /> How It Works
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { step: "1", title: "Add a Business", desc: "Create your business profile with name, industry, greeting, and business hours.", icon: Building2 },
                    { step: "2", title: "Provision a Number", desc: "Get a dedicated phone number. VAPI routes inbound calls to your AI receptionist.", icon: Phone },
                    { step: "3", title: "MAVIS Answers", desc: "Claude-powered AI answers calls 24/7, books appointments, takes messages, and transfers calls.", icon: PhoneCall },
                  ].map(item => (
                    <div key={item.step} className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-xs font-bold text-indigo-400 shrink-0">
                        {item.step}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{item.title}</div>
                        <div className="text-xs text-zinc-500 mt-0.5">{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {businesses.length > 0 && (
                <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    <Building2 size={16} className="text-zinc-400" /> Your Businesses
                  </h2>
                  <div className="space-y-2">
                    {businesses.map(biz => (
                      <div key={biz.id} className="flex items-center justify-between py-2 border-b border-zinc-800/60 last:border-0">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${biz.is_active ? "bg-emerald-400" : "bg-zinc-600"}`} />
                          <span className="text-sm text-white">{biz.name}</span>
                          <span className="text-xs text-zinc-500">{biz.industry}</span>
                        </div>
                        {biz.receptionist_phone_numbers?.[0] ? (
                          <span className="text-xs text-emerald-400 font-mono">{biz.receptionist_phone_numbers[0].phone_number}</span>
                        ) : (
                          <span className="text-xs text-zinc-600">No number</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {tab === "Businesses" && (
            <motion.div key="businesses" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-zinc-500" /></div>
              ) : businesses.length === 0 ? (
                <div className="text-center py-16 text-zinc-500">
                  <Building2 size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No businesses yet.</p>
                  <p className="text-xs mt-1">Click "Add Business" to get started.</p>
                </div>
              ) : (
                businesses.map(biz => (
                  <BusinessCard key={biz.id} biz={biz} token={token} onRefresh={fetchBusinesses} />
                ))
              )}
            </motion.div>
          )}

          {tab === "Calls" && (
            <motion.div key="calls" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">
              {callsLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-zinc-500" /></div>
              ) : calls.length === 0 ? (
                <div className="text-center py-16 text-zinc-500">
                  <PhoneCall size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No calls yet.</p>
                  <p className="text-xs mt-1">Calls will appear here after your first inbound call.</p>
                </div>
              ) : (
                calls.map(call => <CallRow key={call.id} call={call} />)
              )}
            </motion.div>
          )}

          {tab === "Messages" && (
            <motion.div key="messages" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">
              {msgsLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-zinc-500" /></div>
              ) : messages.length === 0 ? (
                <div className="text-center py-16 text-zinc-500">
                  <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No messages yet.</p>
                  <p className="text-xs mt-1">Messages taken during calls will appear here.</p>
                </div>
              ) : (
                messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`border rounded-xl p-4 space-y-2 ${urgencyColor(msg.urgency)} ${!msg.is_read ? "ring-1 ring-inset ring-white/5" : "opacity-70"}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{msg.caller_name || "Unknown Caller"}</span>
                        <span className="text-xs text-zinc-500 font-mono">{msg.caller_number}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full border ${urgencyColor(msg.urgency)} text-zinc-300`}>{msg.urgency}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">{fmtDate(msg.created_at)}</span>
                        {!msg.is_read && (
                          <button onClick={() => markRead(msg.id)} className="text-xs text-indigo-400 hover:text-indigo-300">Mark read</button>
                        )}
                        {msg.is_read && <CheckCircle2 size={14} className="text-emerald-500" />}
                      </div>
                    </div>
                    <p className="text-sm text-zinc-200">{msg.message}</p>
                  </div>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
