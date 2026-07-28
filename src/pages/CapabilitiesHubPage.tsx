// ============================================================
// VANTARA.EXE — CapabilitiesHubPage
// Execution Blueprint Stage E: a single page that introspects every MAVIS
// edge function from the auto-generated manifest (never hand-maintained —
// regenerate via `node scripts/generate-capabilities-manifest.mjs`) so it
// can't silently drift the way SHARD.md did. Grouped by SHARD.md category,
// with a distinct Autonomy & Proactive section, plus a generic invocation
// form per function.
// ============================================================
import { useMemo, useState } from "react";
import {
  Search, Zap, ChevronDown, ChevronRight, Play, Loader2,
  CheckCircle2, XCircle, HelpCircle, Clock, Globe, Ban,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";
import {
  CAPABILITIES_MANIFEST,
  type CapabilityEntry,
  type CapabilityStatus,
} from "@/mavis/capabilitiesManifest.generated";

const STATUS_META: Record<CapabilityStatus, { label: string; color: string; icon: React.ElementType }> = {
  ACTIVE:          { label: "Active",          color: "text-neon-green border-neon-green/40 bg-neon-green/10",   icon: CheckCircle2 },
  CRON_ONLY:       { label: "Cron-only",        color: "text-sky-400 border-sky-400/40 bg-sky-400/10",           icon: Clock },
  WEBHOOK:         { label: "Webhook",          color: "text-purple-400 border-purple-400/40 bg-purple-400/10",  icon: Globe },
  ORPHANED:        { label: "Orphaned",         color: "text-amber-400 border-amber-400/40 bg-amber-400/10",     icon: HelpCircle },
  NEEDS_DECISION:  { label: "Needs decision",   color: "text-red-400 border-red-400/40 bg-red-400/10",           icon: Ban },
};

const AUTONOMY_STATUS_META: Record<string, { color: string }> = {
  CONNECTED: { color: "text-neon-green border-neon-green/40 bg-neon-green/10" },
  PARTIAL:   { color: "text-amber-400 border-amber-400/40 bg-amber-400/10" },
  BROKEN:    { color: "text-red-400 border-red-400/40 bg-red-400/10" },
};

function StatusBadge({ status }: { status: CapabilityStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wide ${meta.color}`}>
      <Icon className="w-3 h-3" /> {meta.label}
    </span>
  );
}

function InvokeForm({ fn }: { fn: CapabilityEntry }) {
  const [body, setBody] = useState("{}");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const invoke = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      toast.error("Body must be valid JSON");
      return;
    }
    if (!confirm(`This will actually call the live "${fn.name}" edge function. Continue?`)) return;
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke(fn.name, { body: parsed });
      if (error) {
        setIsError(true);
        setResult(error.message ?? String(error));
      } else {
        setIsError(false);
        setResult(JSON.stringify(data, null, 2));
      }
    } catch (e) {
      setIsError(true);
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
      <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Request body (JSON)</label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        spellCheck={false}
        className="w-full bg-background/60 border border-border rounded px-2 py-1.5 text-xs font-mono text-foreground resize-y"
      />
      <button
        onClick={invoke}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary text-xs font-mono hover:bg-primary/20 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        Invoke
      </button>
      {result !== null && (
        <pre className={`text-[11px] font-mono whitespace-pre-wrap rounded p-2 border ${isError ? "border-red-400/40 bg-red-400/5 text-red-300" : "border-border bg-background/40 text-muted-foreground"}`}>
          {result}
        </pre>
      )}
    </div>
  );
}

function FunctionRow({ fn }: { fn: CapabilityEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/60 rounded-md bg-background/30">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-background/50"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
        <span className="font-mono text-xs text-foreground">{fn.name}</span>
        <StatusBadge status={fn.status} />
        {fn.autonomyPathway && (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wide ${AUTONOMY_STATUS_META[fn.autonomyPathway.status].color}`}>
            {fn.autonomyPathway.status}
          </span>
        )}
        {fn.purpose && <span className="text-[11px] text-muted-foreground truncate ml-1">{fn.purpose}</span>}
      </button>
      {open && (
        <div className="px-3 pb-3">
          {fn.autonomyPathway && (
            <p className="text-[11px] text-muted-foreground mb-2 italic">{fn.autonomyPathway.note}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-muted-foreground">
            <span>Frontend callers: {fn.calledFromFrontend.length || "none"}</span>
            <span>Backend callers: {fn.calledFromBackend.length || "none"}</span>
            <span>Cron target: {fn.isCronTarget ? "yes" : "no"}</span>
            <span>Requires JWT: {fn.requiresJwt ? "yes" : "no"}</span>
          </div>
          <InvokeForm fn={fn} />
        </div>
      )}
    </div>
  );
}

export function CapabilitiesHubPage() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CapabilityStatus | "ALL">("ALL");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CAPABILITIES_MANIFEST.filter((fn) => {
      if (statusFilter !== "ALL" && fn.status !== statusFilter) return false;
      if (!q) return true;
      return fn.name.toLowerCase().includes(q) || fn.purpose?.toLowerCase().includes(q) || fn.category.toLowerCase().includes(q);
    });
  }, [query, statusFilter]);

  const autonomyPathways = useMemo(
    () => CAPABILITIES_MANIFEST.filter((fn) => fn.autonomyPathway),
    []
  );

  const grouped = useMemo(() => {
    const map = new Map<string, CapabilityEntry[]>();
    for (const fn of filtered) {
      const list = map.get(fn.category) ?? [];
      list.push(fn);
      map.set(fn.category, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const fn of CAPABILITIES_MANIFEST) c[fn.status] = (c[fn.status] ?? 0) + 1;
    return c;
  }, []);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Capabilities Hub"
        subtitle={`${CAPABILITIES_MANIFEST.length} functions — generated from the live repo, not hand-maintained`}
        icon={<Zap className="w-5 h-5" />}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-2 bg-background/40 border border-border rounded px-2 py-1.5 flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search functions, categories, purposes..."
            className="bg-transparent text-xs font-mono outline-none flex-1"
          />
        </div>
        <button
          onClick={() => setStatusFilter("ALL")}
          className={`px-2 py-1 rounded border text-[10px] font-mono ${statusFilter === "ALL" ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}
        >
          All ({CAPABILITIES_MANIFEST.length})
        </button>
        {(Object.keys(STATUS_META) as CapabilityStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-2 py-1 rounded border text-[10px] font-mono ${statusFilter === s ? STATUS_META[s].color : "border-border text-muted-foreground"}`}
          >
            {STATUS_META[s].label} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      <HudCard className="p-4 mb-5" glowColor="gold">
        <h2 className="font-display text-sm font-bold text-primary mb-1">Autonomy &amp; Proactive Pathways</h2>
        <p className="text-[11px] text-muted-foreground mb-3">
          Trigger → decision logic → action → outcome record, traced end-to-end. This
          judgment can't be derived from a regex — it's a manual annotation from
          Execution Blueprint Stage B, kept in the generator as a labeled layer on
          top of the auto-derived facts.
        </p>
        <div className="space-y-1.5">
          {autonomyPathways.map((fn) => (
            <div key={fn.name} className="flex items-center gap-2">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wide shrink-0 ${AUTONOMY_STATUS_META[fn.autonomyPathway!.status].color}`}>
                {fn.autonomyPathway!.status}
              </span>
              <span className="font-mono text-xs text-foreground shrink-0">{fn.name}</span>
              <span className="text-[11px] text-muted-foreground truncate">{fn.autonomyPathway!.note}</span>
            </div>
          ))}
        </div>
      </HudCard>

      <div className="space-y-5">
        {grouped.map(([category, fns]) => (
          <div key={category}>
            <h3 className="font-display text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
              {category} <span className="text-[10px] font-mono font-normal">({fns.length})</span>
            </h3>
            <div className="space-y-1.5">
              {fns.map((fn) => <FunctionRow key={fn.name} fn={fn} />)}
            </div>
          </div>
        ))}
        {grouped.length === 0 && (
          <p className="text-xs text-muted-foreground font-mono">No functions match this filter.</p>
        )}
      </div>
    </div>
  );
}
