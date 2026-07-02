import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, X, ChevronRight, ExternalLink, Loader2,
  Zap, Users2, Copy, Check, Power, PowerOff,
} from "lucide-react";
import { AGENTS, DIVISIONS, getDivision, classifyTaskToDivision, findBestAgent, type AgencyAgent } from "@/data/agencyAgents";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// ── Markdown → plain preview (strip # headers + ** bold + bullets) ───
function mdPreview(md: string, chars = 280): string {
  return md
    .replace(/^#{1,6}\s+.+$/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\n/g, " ")
    .trim()
    .slice(0, chars) + "…";
}

// ── Agent detail panel ───────────────────────────────────────────────
function AgentPanel({
  agent, onClose, activeAgentId, onActivationChange,
}: {
  agent: AgencyAgent;
  onClose: () => void;
  activeAgentId: string | null;
  onActivationChange: (id: string | null) => void;
}) {
  const navigate = useNavigate();
  const div = getDivision(agent.division);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [activating, setActivating] = useState(false);

  const agentId = `${agent.division}/${agent.file}`;
  const isActive = activeAgentId === agentId;

  useEffect(() => {
    setContent(null);
    setLoading(true);
    fetch(agent.rawUrl, { signal: AbortSignal.timeout(15000) })
      .then(r => r.ok ? r.text() : null)
      .then(t => { setContent(t); setLoading(false); })
      .catch(() => { setContent(null); setLoading(false); });
  }, [agent.rawUrl]);

  async function activateAgent() {
    if (!content) return;
    setActivating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Not signed in"); return; }
      const { error } = await supabase.from("mavis_active_agency_specialists").upsert({
        user_id:      user.id,
        agent_id:     agentId,
        agent_name:   agent.name,
        division:     agent.division,
        raw_url:      agent.rawUrl,
        spec_content: content,
        activated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
      onActivationChange(agentId);
      toast.success(`${agent.name} is now active — MAVIS will operate as this specialist`);
      navigate("/mavis");
    } catch (err: any) {
      toast.error(`Activation failed: ${err?.message ?? "unknown error"}`);
    } finally {
      setActivating(false);
    }
  }

  async function deactivateAgent() {
    setActivating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("mavis_active_agency_specialists").delete().eq("user_id", user.id);
      onActivationChange(null);
      toast.success("Specialist deactivated — MAVIS returned to standard mode");
    } catch (err: any) {
      toast.error(`Deactivation failed: ${err?.message ?? "unknown error"}`);
    } finally {
      setActivating(false);
    }
  }

  function copyPrompt() {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <motion.div
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="w-[420px] shrink-0 h-full flex flex-col border-l border-zinc-800/60 bg-zinc-950/95"
    >
      {/* Header */}
      <div className={`flex items-start justify-between px-5 py-4 border-b border-zinc-800/60 ${div?.bgColor ?? ""}`}>
        <div className="min-w-0 pr-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{div?.emoji}</span>
            <span className={`text-[10px] font-mono uppercase tracking-wider ${div?.color ?? "text-zinc-400"}`}>
              {div?.label}
            </span>
            {isActive && (
              <span className="text-[9px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">
                ACTIVE
              </span>
            )}
          </div>
          <h2 className="text-base font-semibold text-white leading-tight">{agent.name}</h2>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800/60 transition-colors shrink-0 mt-0.5"
        >
          <X size={16} />
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-5 py-3 border-b border-zinc-800/40">
        {isActive ? (
          <button
            onClick={deactivateAgent}
            disabled={activating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white text-xs font-medium transition-colors flex-1 justify-center"
          >
            {activating ? <Loader2 size={13} className="animate-spin" /> : <PowerOff size={13} />}
            Deactivate
          </button>
        ) : (
          <button
            onClick={activateAgent}
            disabled={!content || activating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-medium transition-colors flex-1 justify-center"
          >
            {activating ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
            Activate Specialist
          </button>
        )}
        <button
          onClick={copyPrompt}
          disabled={!content}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-xs font-medium transition-colors"
        >
          {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <a
          href={`https://github.com/KaiyzerCal/agency-agents/blob/main/${agent.division}/${agent.file}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
        >
          <ExternalLink size={13} />
        </a>
      </div>

      {/* Active notice */}
      {isActive && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-mono">
          ✓ MAVIS is currently operating as this specialist. All chats — app and Telegram — use this specialist's expertise and voice.
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-zinc-500 text-xs py-6 justify-center">
            <Loader2 size={14} className="animate-spin" />
            Loading agent spec…
          </div>
        ) : content ? (
          <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-mono">
            {content}
          </div>
        ) : (
          <div className="text-zinc-600 text-xs py-6 text-center">
            Could not load agent spec.<br />
            <a href={agent.rawUrl} target="_blank" rel="noreferrer" className="text-violet-400 hover:underline mt-1 inline-block">
              View on GitHub ↗
            </a>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Agent card ───────────────────────────────────────────────────────
function AgentCard({
  agent, selected, isActive, onClick,
}: { agent: AgencyAgent; selected: boolean; isActive: boolean; onClick: () => void }) {
  const div = getDivision(agent.division);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        isActive
          ? "border-emerald-500/40 bg-emerald-500/8"
          : selected
          ? `${div?.bgColor ?? "bg-zinc-800/50"} ${div?.borderColor ?? "border-zinc-600"}`
          : "border-zinc-800/50 hover:border-zinc-700 hover:bg-zinc-800/30 bg-zinc-900/40"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-base mt-0.5 shrink-0">{div?.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium text-zinc-200 leading-tight line-clamp-1">{agent.name}</p>
            {isActive && <span className="text-[8px] font-mono bg-emerald-500/20 text-emerald-400 px-1 rounded shrink-0">ON</span>}
          </div>
          <p className={`text-[10px] mt-0.5 ${div?.color ?? "text-zinc-500"}`}>{div?.label}</p>
        </div>
        <ChevronRight size={12} className={`shrink-0 mt-0.5 ${selected ? (div?.color ?? "text-zinc-400") : "text-zinc-700"}`} />
      </div>
    </button>
  );
}

// ── Main page ────────────────────────────────────────────────────────
export default function AgencyPage() {
  const [search, setSearch] = useState("");
  const [activeDivision, setActiveDivision] = useState<string>("all");
  const [selectedAgent, setSelectedAgent] = useState<AgencyAgent | null>(null);
  const [taskQuery, setTaskQuery] = useState("");
  const [routedAgent, setRoutedAgent] = useState<AgencyAgent | null>(null);
  const [showRouter, setShowRouter] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const navigate = useNavigate();

  // Load current active specialist on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("mavis_active_agency_specialists")
        .select("agent_id")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.agent_id) setActiveAgentId(data.agent_id);
        });
    });
  }, []);

  function routeTask() {
    if (!taskQuery.trim()) return;
    const agent = findBestAgent(taskQuery);
    if (!agent) { toast.error("No matching agent found — try different keywords"); return; }
    const divId = classifyTaskToDivision(taskQuery);
    setRoutedAgent(agent);
    setActiveDivision(divId);
    setSelectedAgent(agent);
    toast.success(`Routed to ${agent.name} in ${getDivision(divId)?.label ?? divId}`);
  }

  const filtered = useMemo(() => {
    let list = AGENTS;
    if (activeDivision !== "all") list = list.filter(a => a.division === activeDivision);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.division.toLowerCase().includes(q) ||
        (getDivision(a.division)?.label ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [search, activeDivision]);

  // Group by division for display
  const grouped = useMemo(() => {
    const map = new Map<string, AgencyAgent[]>();
    for (const a of filtered) {
      if (!map.has(a.division)) map.set(a.division, []);
      map.get(a.division)!.push(a);
    }
    return map;
  }, [filtered]);

  return (
    <div className="flex h-full bg-zinc-950 text-white overflow-hidden">
      {/* Left nav + grid */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Active specialist banner */}
        {activeAgentId && (
          <div className="flex items-center justify-between px-5 py-2 bg-emerald-500/10 border-b border-emerald-500/20 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-mono text-emerald-400">
                MAVIS operating as: <strong>{AGENTS.find(a => `${a.division}/${a.file}` === activeAgentId)?.name ?? activeAgentId}</strong>
              </span>
            </div>
            <button
              onClick={async () => {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                await supabase.from("mavis_active_agency_specialists").delete().eq("user_id", user.id);
                setActiveAgentId(null);
              }}
              className="text-[10px] font-mono text-emerald-600 hover:text-emerald-400 transition-colors"
            >
              Deactivate ×
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/50 bg-zinc-950/70 shrink-0">
          <div className="flex items-center gap-3">
            <Users2 size={16} className="text-violet-400" />
            <span className="font-mono font-semibold text-sm tracking-widest text-white">THE AGENCY</span>
            <span className="text-[10px] text-zinc-600 font-mono">{AGENTS.length} specialists</span>
          </div>
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search agents…"
              className="pl-8 pr-8 py-1.5 bg-zinc-800/60 border border-zinc-700/50 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 w-56"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Task Router */}
        <div className="px-4 py-2 border-b border-zinc-800/40 bg-zinc-900/30">
          <button
            onClick={() => setShowRouter(v => !v)}
            className={`w-full text-left flex items-center gap-2 text-[10px] font-mono transition-colors ${showRouter ? "text-violet-400" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            <Zap size={10} />
            AUTO-ROUTE TASK TO BEST AGENT
            <span className={`ml-auto transition-transform ${showRouter ? "rotate-180" : ""}`}>▾</span>
          </button>
          {showRouter && (
            <div className="mt-2 flex gap-2">
              <input
                autoFocus
                value={taskQuery}
                onChange={e => setTaskQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") routeTask(); }}
                placeholder="Describe your task… e.g. 'build a REST API with auth'"
                className="flex-1 bg-zinc-900 border border-zinc-700/60 rounded text-xs font-body text-white px-3 py-1.5 focus:outline-none focus:border-violet-500/40 placeholder:text-zinc-600"
              />
              <button
                onClick={routeTask}
                disabled={!taskQuery.trim()}
                className="px-3 py-1.5 rounded bg-violet-500/20 border border-violet-500/30 text-violet-400 text-xs font-mono hover:bg-violet-500/30 transition-colors disabled:opacity-40"
              >
                Route →
              </button>
            </div>
          )}
          {routedAgent && !showRouter && (
            <p className="text-[9px] font-mono text-violet-400/70 mt-0.5">
              Last routed → {routedAgent.label}
            </p>
          )}
        </div>

        {/* Division tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-zinc-800/30 overflow-x-auto shrink-0 scrollbar-none">
          <button
            onClick={() => setActiveDivision("all")}
            className={`text-[10px] font-mono px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
              activeDivision === "all"
                ? "bg-violet-500/20 text-violet-300 border border-violet-500/40"
                : "text-zinc-500 hover:text-zinc-300 border border-transparent"
            }`}
          >
            All ({AGENTS.length})
          </button>
          {DIVISIONS.map(div => {
            const count = AGENTS.filter(a => a.division === div.id).length;
            return (
              <button
                key={div.id}
                onClick={() => setActiveDivision(div.id)}
                className={`text-[10px] font-mono px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border ${
                  activeDivision === div.id
                    ? `${div.bgColor} ${div.color} ${div.borderColor}`
                    : "text-zinc-500 hover:text-zinc-300 border-transparent"
                }`}
              >
                {div.emoji} {div.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Agent grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
              No agents match "{search}"
            </div>
          ) : activeDivision === "all" ? (
            // Grouped by division
            Array.from(grouped.entries()).map(([divId, agents]) => {
              const div = getDivision(divId);
              return (
                <div key={divId} className="mb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span>{div?.emoji}</span>
                    <span className={`text-[10px] font-mono uppercase tracking-wider font-semibold ${div?.color ?? "text-zinc-400"}`}>
                      {div?.label}
                    </span>
                    <span className="text-zinc-700 text-[9px] font-mono">{agents.length}</span>
                  </div>
                  <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                    {agents.map(a => (
                      <AgentCard
                        key={a.id}
                        agent={a}
                        selected={selectedAgent?.id === a.id}
                        isActive={activeAgentId === `${a.division}/${a.file}`}
                        onClick={() => setSelectedAgent(prev => prev?.id === a.id ? null : a)}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            // Flat grid for single division
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
              {filtered.map(a => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  selected={selectedAgent?.id === a.id}
                  isActive={activeAgentId === `${a.division}/${a.file}`}
                  onClick={() => setSelectedAgent(prev => prev?.id === a.id ? null : a)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right detail panel */}
      <AnimatePresence>
        {selectedAgent && (
          <AgentPanel
            key={selectedAgent.id}
            agent={selectedAgent}
            onClose={() => setSelectedAgent(null)}
            activeAgentId={activeAgentId}
            onActivationChange={setActiveAgentId}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
