// Live status panel for the System Health page: failing scheduled jobs, AI providers on cool-down, failing backend calls.
// Reads public.mavis_system_health() (operator-only). If that function isn't installed yet it says so instead of erroring.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { HudCard } from "@/components/SharedUI";

interface Health {
  error?: string;
  generated_at?: string;
  cron_totals?: { jobs?: number; runs_24h?: number; failed_24h?: number };
  cron_failures?: { job: string; failed?: number; runs?: number; last_failure?: string; message?: string }[];
  providers_cooling_down?: { provider: string; unhealthy_until: string; reason?: string }[];
  http_errors_24h?: { status_code: number; n: number }[];
}

const ago = (iso?: string) => {
  if (!iso) return "";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};

export function LiveSystemStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setUnavailable(null);
    const { data, error } = await (supabase as any).rpc("mavis_system_health");
    if (error) {
      // 404 / "function does not exist" = the database function hasn't been installed yet.
      setUnavailable(/does not exist|not find|404/i.test(error.message ?? "") ? "The health check isn't installed in the database yet." : (error.message ?? "Couldn't load system health."));
      setHealth(null);
    } else if (data && typeof data === "object" && !Array.isArray(data) && (("cron_failures" in data) || ("error" in data))) {
      setHealth(data as Health);
    } else {
      // Never read an empty or unexpected reply as "all clear".
      setUnavailable("Unexpected reply from the health check.");
      setHealth(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const failures = health?.cron_failures ?? [];
  const providers = health?.providers_cooling_down ?? [];
  const httpErrors = health?.http_errors_24h ?? [];
  const totals = health?.cron_totals;
  const allClear = !!health && !health.error && failures.length === 0 && providers.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
          Live status{health?.generated_at ? ` · checked ${ago(health.generated_at)}` : ""}
        </p>
        <button onClick={() => void load()} disabled={loading} className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded disabled:opacity-50">
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Refresh
        </button>
      </div>
      {loading && !health && !unavailable && <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" size={22} /></div>}

      {unavailable && <HudCard className="border-amber-700/30"><p className="text-xs font-mono text-amber-400">{unavailable}</p></HudCard>}
      {health?.error === "forbidden" && <HudCard className="border-amber-700/30"><p className="text-xs font-mono text-amber-400">System health is only available to the operator account.</p></HudCard>}

      {health && !health.error && (
        <>
          <HudCard className={allClear ? "border-green-700/30" : "border-amber-700/30"}>
            <div className="flex items-center gap-2">
              {allClear ? <CheckCircle2 size={16} className="text-green-400" /> : <AlertTriangle size={16} className="text-amber-400" />}
              <p className="text-sm font-display font-bold">{allClear ? "All clear" : `${failures.length} failing job${failures.length === 1 ? "" : "s"}${providers.length ? `, ${providers.length} provider${providers.length === 1 ? "" : "s"} cooling down` : ""}`}</p>
            </div>
            {totals && (
              <p className="text-xs font-mono text-muted-foreground mt-1.5">
                {totals.jobs ?? 0} scheduled jobs · {totals.runs_24h ?? 0} runs in 24h · {totals.failed_24h ?? 0} failed
              </p>
            )}
          </HudCard>

          {failures.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Failing scheduled jobs (24h)</p>
              {failures.map((f) => (
                <HudCard key={f.job} className="border-red-800/30">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-display font-bold">{f.job}</span>
                    <span className="text-xs font-mono text-red-400">{f.failed ?? "?"} of {f.runs ?? "?"} runs failed{f.last_failure ? ` · last ${ago(f.last_failure)}` : ""}</span>
                  </div>
                  {f.message && <p className="text-xs font-mono text-muted-foreground mt-1 whitespace-pre-wrap break-words">{f.message}</p>}
                </HudCard>
              ))}
            </div>
          )}

          {providers.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">AI providers on cool-down</p>
              {providers.map((p) => (
                <HudCard key={p.provider}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-display font-bold">{p.provider}</span>
                    <span className="text-xs font-mono text-amber-400">back at {new Date(p.unhealthy_until).toLocaleTimeString()}</span>
                  </div>
                  {p.reason && <p className="text-xs font-mono text-muted-foreground mt-1">{p.reason}</p>}
                </HudCard>
              ))}
            </div>
          )}

          {httpErrors.length > 0 && (
            <HudCard>
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1.5">Failing backend calls (24h)</p>
              <div className="flex flex-wrap gap-3 text-xs font-mono">
                {httpErrors.map((e) => <span key={e.status_code}><span className="text-red-400">{e.status_code}</span> × {e.n}</span>)}
              </div>
            </HudCard>
          )}
        </>
      )}
    </div>
  );
}
