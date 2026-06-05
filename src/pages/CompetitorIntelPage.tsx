// Competitor Intelligence — monitor competitor websites for changes
import { useState, useEffect, useCallback } from "react";
import { Shield, Plus, RefreshCw, Loader2, AlertTriangle, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

interface Competitor {
  id: string;
  name: string;
  url: string;
  last_checked_at: string | null;
  changes_detected: number;
  notes: string | null;
  created_at: string;
}

export default function CompetitorIntelPage() {
  const { user } = useAuth() as any;
  const { lastActionTs } = useAppData();
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const fetch = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase.from("mavis_competitors").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setCompetitors((data as Competitor[]) ?? []);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { if (lastActionTs) fetch(); }, [lastActionTs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addCompetitor() {
    if (!name.trim() || !url.trim()) { toast.error("Name and URL required"); return; }
    setAdding(true);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-competitor-monitor", {
        body: { action: "add", name: name.trim(), url: url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}` },
      });
      if (error || data?.error) throw new Error(data?.error ?? error?.message);
      toast.success(`${name} added to monitoring`);
      setName(""); setUrl("");
      await fetch();
    } catch (e: any) { toast.error(e.message); } finally { setAdding(false); }
  }

  async function runCheck() {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-competitor-monitor", { body: { action: "check" } });
      if (error || data?.error) throw new Error(data?.error ?? error?.message);
      toast.success(`Checked ${data.checked} sites — ${data.changes} change${data.changes !== 1 ? "s" : ""} detected`);
      await fetch();
    } catch (e: any) { toast.error(e.message); } finally { setChecking(false); }
  }

  async function remove(id: string) {
    await supabase.from("mavis_competitors").delete().eq("id", id).eq("user_id", user.id);
    await fetch();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Competitor Intel" subtitle="MAVIS monitors competitor sites for changes and surfaces insights automatically." icon={<Shield size={20} />} />

      <HudCard className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-primary uppercase tracking-widest">Add Competitor</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className="w-full bg-background border border-border rounded px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            placeholder="Company name" value={name} onChange={e => setName(e.target.value)} />
          <input className="w-full bg-background border border-border rounded px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            placeholder="https://competitor.com" value={url} onChange={e => setUrl(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={addCompetitor} disabled={adding}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {adding ? "Adding…" : "Add"}
          </button>
          {competitors.length > 0 && (
            <button onClick={runCheck} disabled={checking}
              className="flex items-center gap-2 border border-border rounded px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50">
              {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {checking ? "Checking…" : "Run Check Now"}
            </button>
          )}
        </div>
      </HudCard>

      <HudCard className="p-5">
        <h3 className="text-sm font-semibold text-primary uppercase tracking-widest mb-4">Monitoring ({competitors.length})</h3>
        {loading ? <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
          : competitors.length === 0 ? <p className="text-muted-foreground text-sm text-center py-8">No competitors added. Add one above to start monitoring.</p>
          : <div className="space-y-2">
            {competitors.map(c => (
              <div key={c.id} className="flex items-center gap-3 p-3 border border-border rounded">
                <div className={`p-1.5 rounded border ${c.changes_detected > 0 ? "text-yellow-400 border-yellow-400/30 bg-yellow-400/10" : "text-green-400 border-green-400/30 bg-green-400/10"}`}>
                  {c.changes_detected > 0 ? <AlertTriangle size={12} /> : <CheckCircle size={12} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.name}</span>
                    {c.changes_detected > 0 && (
                      <span className="text-xs text-yellow-400 border border-yellow-400/30 rounded px-1.5 py-0.5">{c.changes_detected} change{c.changes_detected !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary truncate">{c.url}</a>
                    {c.last_checked_at && <span className="text-xs text-muted-foreground shrink-0">checked {new Date(c.last_checked_at).toLocaleDateString()}</span>}
                  </div>
                </div>
                <button onClick={() => remove(c.id)} className="p-1.5 border border-border rounded text-muted-foreground hover:text-red-400 hover:border-red-400/30 transition-colors text-xs">✕</button>
              </div>
            ))}
          </div>}
      </HudCard>
    </div>
  );
}
