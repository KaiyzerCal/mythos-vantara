import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Globe, TrendingUp, Lightbulb, Users, Shield,
  ChevronDown, ChevronUp, Loader2, RefreshCw, Sparkles,
  AlertTriangle, CheckCircle2, Target, Network, BarChart3,
  Send, BookOpen, Zap, Clock, ArrowRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

const TABS = ["World Model", "Predictions", "Opportunities", "Entity Graph", "Relationships", "Strategy Council"] as const;
type Tab = typeof TABS[number];

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-indigo-500" : "bg-amber-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-700/60 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-zinc-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

function TypeBadge({ type, colors }: { type: string; colors: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${colors}`}>
      {type.replace(/_/g, " ")}
    </span>
  );
}

function WorldModelPanel({ token }: { token: string }) {
  const [model, setModel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("mavis_world_model")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        setModel(data);
      } catch { /* */ } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  async function rebuild() {
    setBuilding(true);
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-world-model`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.world_model) setModel(data.world_model);
    } catch { /* */ } finally {
      setBuilding(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-zinc-500" /></div>;

  if (!model) return (
    <div className="text-center py-12">
      <Globe size={40} className="mx-auto mb-3 text-zinc-600" />
      <p className="text-sm text-zinc-500">No world model yet.</p>
      <button onClick={rebuild} disabled={building} className="mt-3 flex items-center gap-2 mx-auto bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 px-4 py-2 rounded-xl text-sm hover:bg-indigo-500/30">
        {building ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Build World Model
      </button>
    </div>
  );

  const domains = model.domains ?? {};
  const opportunities = model.opportunities ?? [];
  const risks = model.risks ?? [];
  const insights = model.key_insights ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">Last updated: {model.created_at ? new Date(model.created_at).toLocaleDateString() : "unknown"}</p>
        <button onClick={rebuild} disabled={building} className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300">
          {building ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Rebuild
        </button>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2"><Globe size={14} className="text-indigo-400" /> Current State</h3>
        <p className="text-sm text-zinc-300 leading-relaxed">{model.summary}</p>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2"><TrendingUp size={14} className="text-emerald-400" /> Trajectory</h3>
        <p className="text-sm text-zinc-300 leading-relaxed">{model.trajectory}</p>
      </div>

      {insights.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Lightbulb size={14} className="text-amber-400" /> Key Insights</h3>
          <div className="space-y-2">
            {insights.map((i: string, idx: number) => (
              <div key={idx} className="flex items-start gap-2 text-sm text-zinc-300">
                <Sparkles size={12} className="text-amber-400 mt-1 shrink-0" />
                {i}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {opportunities.length > 0 && (
          <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2"><Zap size={14} /> Opportunities</h3>
            <div className="space-y-2">
              {opportunities.map((o: string, i: number) => <p key={i} className="text-xs text-zinc-300">• {o}</p>)}
            </div>
          </div>
        )}
        {risks.length > 0 && (
          <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2"><AlertTriangle size={14} /> Risks</h3>
            <div className="space-y-2">
              {risks.map((r: string, i: number) => <p key={i} className="text-xs text-zinc-300">• {r}</p>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PredictionsPanel() {
  const [predictions, setPredictions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("mavis_predictions").select("*").eq("acted_on", false).order("confidence", { ascending: false }).limit(20);
      setPredictions(data ?? []);
      setLoading(false);
    };
    load();
  }, []);

  async function dismiss(id: string) {
    await supabase.from("mavis_predictions").update({ acted_on: true }).eq("id", id);
    setPredictions(ps => ps.filter(p => p.id !== id));
  }

  const typeColors: Record<string, string> = {
    risk_alert: "border-red-500/50 text-red-400 bg-red-500/10",
    upcoming_need: "border-amber-500/50 text-amber-400 bg-amber-500/10",
    opportunity: "border-emerald-500/50 text-emerald-400 bg-emerald-500/10",
    behavioral_pattern: "border-indigo-500/50 text-indigo-400 bg-indigo-500/10",
    productivity_window: "border-purple-500/50 text-purple-400 bg-purple-500/10",
    health_insight: "border-blue-500/50 text-blue-400 bg-blue-500/10",
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-zinc-500" /></div>;
  if (!predictions.length) return (
    <div className="text-center py-12 text-zinc-500">
      <Brain size={40} className="mx-auto mb-3 opacity-30" />
      <p className="text-sm">No active predictions.</p>
      <p className="text-xs mt-1">MAVIS will generate predictions after analyzing your behavioral patterns.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {predictions.map(p => (
        <div key={p.id} className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <TypeBadge type={p.prediction_type} colors={typeColors[p.prediction_type] ?? "border-zinc-600 text-zinc-400"} />
              <span className="text-sm font-medium text-white">{p.title}</span>
            </div>
            <button onClick={() => dismiss(p.id)} className="text-xs text-zinc-600 hover:text-zinc-400 shrink-0">dismiss</button>
          </div>
          <p className="text-sm text-zinc-400">{p.content}</p>
          <ConfidenceBar confidence={p.confidence ?? 0.7} />
        </div>
      ))}
    </div>
  );
}

function OpportunitiesPanel({ token }: { token: string }) {
  const [opps, setOpps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("mavis_opportunities").select("*").eq("acted_on", false).order("confidence", { ascending: false }).limit(15);
      setOpps(data ?? []);
      setLoading(false);
    };
    load();
  }, []);

  async function scan() {
    setScanning(true);
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-opportunity-scanner`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.opportunities) setOpps(data.opportunities);
    } catch { /* */ } finally {
      setScanning(false);
    }
  }

  async function markActedOn(id: string) {
    await supabase.from("mavis_opportunities").update({ acted_on: true }).eq("id", id);
    setOpps(os => os.filter(o => o.id !== id));
  }

  const typeColors: Record<string, string> = {
    skill_gap_bridge: "border-indigo-500/50 text-indigo-400 bg-indigo-500/10",
    timing_window: "border-purple-500/50 text-purple-400 bg-purple-500/10",
    dormant_asset: "border-amber-500/50 text-amber-400 bg-amber-500/10",
    cross_domain_synergy: "border-emerald-500/50 text-emerald-400 bg-emerald-500/10",
    pattern_leverage: "border-blue-500/50 text-blue-400 bg-blue-500/10",
    relationship_leverage: "border-pink-500/50 text-pink-400 bg-pink-500/10",
    financial_optimization: "border-yellow-500/50 text-yellow-400 bg-yellow-500/10",
    health_performance: "border-red-500/50 text-red-400 bg-red-500/10",
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-zinc-500" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={scan} disabled={scanning} className="flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 rounded-xl px-4 py-2 text-sm">
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Scan for Opportunities
        </button>
      </div>
      {!opps.length ? (
        <div className="text-center py-12 text-zinc-500">
          <Lightbulb size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No opportunities found yet.</p>
        </div>
      ) : opps.map(o => (
        <div key={o.id} className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl overflow-hidden">
          <button
            onClick={() => setExpanded(ex => ex === o.id ? null : o.id)}
            className="w-full flex items-start justify-between p-4 text-left hover:bg-zinc-800/30"
          >
            <div className="flex items-start gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <TypeBadge type={o.opportunity_type} colors={typeColors[o.opportunity_type] ?? "border-zinc-600 text-zinc-400"} />
                </div>
                <p className="text-sm font-medium text-white">{o.title}</p>
                <p className="text-xs text-zinc-400 mt-1">{o.description.slice(0, 120)}{o.description.length > 120 ? "..." : ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-zinc-500">{Math.round((o.confidence ?? 0.7) * 100)}%</span>
              {expanded === o.id ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
            </div>
          </button>
          <AnimatePresence>
            {expanded === o.id && (
              <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="border-t border-zinc-700/40 px-4 py-4 space-y-3">
                <p className="text-sm text-zinc-300">{o.description}</p>
                {o.potential_value && <p className="text-xs text-emerald-400">Potential: {o.potential_value}</p>}
                {Array.isArray(o.action_steps) && o.action_steps.length > 0 && (
                  <div>
                    <p className="text-xs text-zinc-500 mb-2">Action Steps:</p>
                    {o.action_steps.map((s: string, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                        <ArrowRight size={10} className="text-indigo-400 mt-0.5 shrink-0" />
                        {s}
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => markActedOn(o.id)} className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Mark as acted on
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

function EntityGraphPanel() {
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("mavis_entities").select("id,name,entity_type,description,mention_count,last_mentioned").order("mention_count", { ascending: false }).limit(40);
    if (filter !== "all") q = q.eq("entity_type", filter);
    if (search) q = q.ilike("name", `%${search}%`);
    const { data } = await q;
    setEntities(data ?? []);
    setLoading(false);
  }, [search, filter]);

  useEffect(() => { load(); }, [load]);

  const typeColors: Record<string, string> = {
    person: "text-indigo-400 bg-indigo-500/10 border-indigo-500/40",
    company: "text-amber-400 bg-amber-500/10 border-amber-500/40",
    project: "text-emerald-400 bg-emerald-500/10 border-emerald-500/40",
    place: "text-blue-400 bg-blue-500/10 border-blue-500/40",
    concept: "text-purple-400 bg-purple-500/10 border-purple-500/40",
    product: "text-pink-400 bg-pink-500/10 border-pink-500/40",
    event: "text-orange-400 bg-orange-500/10 border-orange-500/40",
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search entities..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
        <select value={filter} onChange={e => setFilter(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white">
          {["all","person","company","project","place","concept","product","event"].map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
      </div>
      {loading ? <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-zinc-500" /></div>
        : !entities.length ? <div className="text-center py-12 text-zinc-500"><Network size={40} className="mx-auto mb-3 opacity-30" /><p className="text-sm">No entities yet. Use MAVIS more to build your knowledge graph.</p></div>
        : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {entities.map(e => (
              <div key={e.id} className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-white">{e.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{e.mention_count}x</span>
                    <TypeBadge type={e.entity_type} colors={typeColors[e.entity_type] ?? "border-zinc-600 text-zinc-400"} />
                  </div>
                </div>
                {e.description && <p className="text-xs text-zinc-400 truncate">{e.description}</p>}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

function RelationshipsPanel() {
  const [relationships, setRelationships] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("mavis_relationship_health").select("*").order("days_since_contact", { ascending: false }).limit(30)
      .then(({ data }) => { setRelationships(data ?? []); setLoading(false); });
  }, []);

  function healthColor(score: number): string {
    if (score >= 7) return "text-emerald-400";
    if (score >= 4) return "text-amber-400";
    return "text-red-400";
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-zinc-500" /></div>;
  if (!relationships.length) return (
    <div className="text-center py-12 text-zinc-500">
      <Users size={40} className="mx-auto mb-3 opacity-30" />
      <p className="text-sm">No relationship data yet.</p>
      <p className="text-xs mt-1">Add contacts and interactions to track relationship health.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {relationships.map(r => (
        <div key={r.id} className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-700/60 flex items-center justify-center text-sm font-bold text-zinc-300">
                {r.contact_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-white">{r.contact_name}</p>
                <p className="text-xs text-zinc-500">{r.interaction_frequency} · {r.days_since_contact}d ago</p>
              </div>
            </div>
            <div className="text-right">
              <p className={`text-lg font-bold ${healthColor(r.health_score)}`}>{r.health_score}/10</p>
              <p className="text-xs text-zinc-500">health</p>
            </div>
          </div>
          {r.suggested_action && (
            <div className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
              r.action_urgency === "critical" ? "bg-red-500/10 text-red-400" :
              r.action_urgency === "high" ? "bg-orange-500/10 text-orange-400" :
              r.action_urgency === "medium" ? "bg-amber-500/10 text-amber-400" :
              "bg-zinc-800/60 text-zinc-400"
            }`}>
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {r.suggested_action}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StrategyCouncilPanel({ token }: { token: string }) {
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [memos, setMemos] = useState<any[]>([]);
  const [memosLoading, setMemosLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    supabase.from("mavis_strategy_memos").select("id,question,recommendation,confidence,created_at").order("created_at", { ascending: false }).limit(10)
      .then(({ data }) => { setMemos(data ?? []); setMemosLoading(false); });
  }, []);

  async function submit() {
    if (!question.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-strategy-council`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ question, context }),
      });
      const data = await res.json();
      setResult(data);
      setMemos(ms => [{ id: data.memo_id, question, recommendation: data.recommendation, confidence: data.confidence, created_at: new Date().toISOString() }, ...ms]);
      setShowForm(false);
    } catch { /* */ } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">Claude Opus 4 + 16K extended thinking · 5-advisor board simulation</p>
        <button onClick={() => setShowForm(s => !s)} className="flex items-center gap-2 bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30 rounded-xl px-4 py-2 text-sm">
          <Brain size={14} /> Ask Council
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-zinc-900/60 border border-indigo-500/30 rounded-xl p-5 space-y-4">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Strategic Question *</label>
                <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Should I raise prices by 30%? Should I hire or stay lean? Is this the right time to pivot?" rows={3} className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white resize-none" />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Context (optional)</label>
                <textarea value={context} onChange={e => setContext(e.target.value)} placeholder="Any relevant background..." rows={2} className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white resize-none" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 bg-zinc-800 text-zinc-300 rounded-lg py-2 text-sm hover:bg-zinc-700">Cancel</button>
                <button onClick={submit} disabled={running || !question.trim()} className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm">
                  {running ? <><Loader2 size={14} className="animate-spin" /> Consulting council...</> : <><Send size={14} /> Submit</>}
                </button>
              </div>
              {running && (
                <div className="text-xs text-zinc-500 text-center animate-pulse">
                  5 advisors deliberating · Opus synthesis in progress · ~60-90 seconds
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {result && (
        <div className="bg-zinc-900/60 border border-indigo-500/30 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Latest Council Output</h3>
          <div className="bg-zinc-800/60 rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">Synthesis</p>
            <p className="text-sm text-zinc-300 leading-relaxed">{result.synthesis}</p>
          </div>
          <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-4">
            <p className="text-xs text-indigo-400 mb-1">Recommendation</p>
            <p className="text-sm text-white">{result.recommendation}</p>
          </div>
          <ConfidenceBar confidence={result.confidence ?? 0.8} />
          {result.advisor_outputs?.length > 0 && (
            <div>
              <button onClick={() => setExpanded(ex => ex === "advisors" ? null : "advisors")} className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1">
                {expanded === "advisors" ? <ChevronUp size={12} /> : <ChevronDown size={12} />} View advisor breakdowns
              </button>
              <AnimatePresence>
                {expanded === "advisors" && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 space-y-3">
                    {result.advisor_outputs.map((a: any) => (
                      <div key={a.role} className="bg-zinc-800/40 rounded-lg p-3">
                        <p className="text-xs font-bold text-zinc-400 mb-1">{a.role}</p>
                        <p className="text-xs text-zinc-400">{a.analysis}</p>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {!memosLoading && memos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-400">Past Memos</h3>
          {memos.map(memo => (
            <div key={memo.id} className="bg-zinc-900/40 border border-zinc-700/40 rounded-xl p-4">
              <div className="flex items-start justify-between">
                <p className="text-sm text-white">{memo.question}</p>
                <span className="text-xs text-zinc-500 shrink-0 ml-2">{new Date(memo.created_at).toLocaleDateString()}</span>
              </div>
              {memo.recommendation && <p className="text-xs text-zinc-400 mt-2">{memo.recommendation.slice(0, 150)}{memo.recommendation.length > 150 ? "..." : ""}</p>}
              <ConfidenceBar confidence={memo.confidence ?? 0.8} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function IntelligencePage() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const [tab, setTab] = useState<Tab>("World Model");

  const tabIcons: Record<Tab, any> = {
    "World Model": Globe,
    "Predictions": Brain,
    "Opportunities": Lightbulb,
    "Entity Graph": Network,
    "Relationships": Users,
    "Strategy Council": Shield,
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800/60 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
          <Brain size={18} className="text-indigo-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Intelligence</h1>
          <p className="text-xs text-zinc-500">MAVIS world model, predictions, and strategic intelligence</p>
        </div>
      </div>

      <div className="flex gap-1 px-6 pt-4 shrink-0 overflow-x-auto">
        {TABS.map(t => {
          const Icon = tabIcons[t];
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-colors whitespace-nowrap ${
                tab === t ? "text-white bg-zinc-800/80 border border-zinc-700/50 border-b-transparent" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Icon size={12} />
              {t}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            {tab === "World Model" && <WorldModelPanel token={token} />}
            {tab === "Predictions" && <PredictionsPanel />}
            {tab === "Opportunities" && <OpportunitiesPanel token={token} />}
            {tab === "Entity Graph" && <EntityGraphPanel />}
            {tab === "Relationships" && <RelationshipsPanel />}
            {tab === "Strategy Council" && <StrategyCouncilPanel token={token} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
