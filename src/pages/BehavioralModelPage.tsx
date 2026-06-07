// ============================================================
// VANTARA.EXE — BehavioralModelPage
// Displays the synthesized mavis_user_model behavioral profile
// ============================================================
import { useState, useEffect } from "react";
import {
  Brain, RefreshCw, Loader2, Sparkles, Target, Zap,
  AlertTriangle, Clock, CheckCircle2, BarChart3, User,
} from "lucide-react";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

const supabase: any = supabaseTyped;
const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">{icon}{title}</h3>
      {children}
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300">{label}</span>
  );
}

function KVRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-zinc-800/50 last:border-0">
      <span className="text-xs text-zinc-500 capitalize w-32 shrink-0">{k.replace(/_/g, " ")}</span>
      <span className="text-xs text-zinc-200 text-right">{v}</span>
    </div>
  );
}

export function BehavioralModelPage() {
  const { user, session } = useAuth();
  const token = session?.access_token ?? "";

  const [model, setModel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("mavis_user_model")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    setModel(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refresh() {
    if (!token) return;
    setRefreshing(true);
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-user-model-refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: user?.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.refreshed ?? 0) > 0) {
        toast.success("Behavioral model refreshed");
        await load();
      } else if ((data.refreshed ?? 0) === 0) {
        toast.info("Not enough data to synthesize yet — keep using MAVIS");
      } else {
        toast.error(data.errors?.[0] ?? "Refresh failed");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Behavioral Model"
        subtitle="MAVIS's synthesized understanding of you — used to personalize every response"
        icon={<Brain size={18} />}
        actions={
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20"
          >
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh Now
          </button>
        }
      />

      {!model ? (
        <div className="text-center py-16">
          <Brain size={48} className="mx-auto mb-4 text-zinc-600" />
          <p className="text-sm text-zinc-400">No behavioral model yet.</p>
          <p className="text-xs text-zinc-500 mt-1 mb-4">MAVIS needs at least 5 interactions and some memory to synthesize your profile.</p>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-2 mx-auto bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 px-4 py-2 rounded-xl text-sm hover:bg-indigo-500/30"
          >
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Build Model Now
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "Model Version", value: `v${model.synthesis_version ?? 1}`, color: "text-primary" },
              { label: "Sessions Tracked", value: model.session_count ?? 0, color: "text-cyan-400" },
              { label: "Confidence", value: `${Math.round((model.confidence_score ?? 0) * 100)}%`, color: "text-emerald-400" },
              { label: "Last Updated", value: model.last_synthesized_at ? new Date(model.last_synthesized_at).toLocaleDateString() : "—", color: "text-amber-400" },
            ].map(stat => (
              <HudCard key={stat.label}>
                <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">{stat.label}</p>
                <p className={`text-xl font-display font-bold ${stat.color}`}>{stat.value}</p>
              </HudCard>
            ))}
          </div>

          {model.personality_summary && (
            <Section title="Personality Summary" icon={<User size={14} className="text-indigo-400" />}>
              <p className="text-sm text-zinc-300 leading-relaxed">{model.personality_summary}</p>
            </Section>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {model.communication_style && Object.keys(model.communication_style).length > 0 && (
              <Section title="Communication Style" icon={<Zap size={14} className="text-cyan-400" />}>
                <div className="space-y-0.5">
                  {Object.entries(model.communication_style as Record<string, string>).map(([k, v]) => (
                    <KVRow key={k} k={k} v={String(v)} />
                  ))}
                </div>
              </Section>
            )}

            {model.decision_patterns && Object.keys(model.decision_patterns).length > 0 && (
              <Section title="Decision Patterns" icon={<BarChart3 size={14} className="text-amber-400" />}>
                <div className="space-y-0.5">
                  {Object.entries(model.decision_patterns as Record<string, string>).map(([k, v]) => (
                    <KVRow key={k} k={k} v={String(v)} />
                  ))}
                </div>
              </Section>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.isArray(model.core_values) && model.core_values.length > 0 && (
              <Section title="Core Values" icon={<CheckCircle2 size={14} className="text-emerald-400" />}>
                <div className="flex flex-wrap gap-1.5">
                  {model.core_values.map((v: string) => <Tag key={v} label={v} />)}
                </div>
              </Section>
            )}

            {Array.isArray(model.primary_goals) && model.primary_goals.length > 0 && (
              <Section title="Primary Goals" icon={<Target size={14} className="text-violet-400" />}>
                <ul className="space-y-1.5">
                  {model.primary_goals.map((g: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                      <span className="text-violet-400 shrink-0 font-mono text-xs mt-0.5">{i + 1}.</span>
                      {g}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>

          {model.working_style && Object.keys(model.working_style).length > 0 && (
            <Section title="Working Style" icon={<Clock size={14} className="text-blue-400" />}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-0.5">
                {Object.entries(model.working_style as Record<string, string>).map(([k, v]) => (
                  <KVRow key={k} k={k} v={String(v)} />
                ))}
              </div>
            </Section>
          )}

          {model.triggers && (
            <Section title="Energy Triggers" icon={<AlertTriangle size={14} className="text-amber-400" />}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {model.triggers.energizers?.length > 0 && (
                  <div>
                    <p className="text-xs text-emerald-400 font-semibold mb-2">Energizers</p>
                    <ul className="space-y-1">
                      {model.triggers.energizers.map((e: string, i: number) => (
                        <li key={i} className="text-xs text-zinc-300">• {e}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {model.triggers.drains?.length > 0 && (
                  <div>
                    <p className="text-xs text-red-400 font-semibold mb-2">Drains</p>
                    <ul className="space-y-1">
                      {model.triggers.drains.map((d: string, i: number) => (
                        <li key={i} className="text-xs text-zinc-300">• {d}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {model.triggers.warnings?.length > 0 && (
                  <div>
                    <p className="text-xs text-amber-400 font-semibold mb-2">Warnings</p>
                    <ul className="space-y-1">
                      {model.triggers.warnings.map((w: string, i: number) => (
                        <li key={i} className="text-xs text-zinc-300">• {w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}

          {model.raw_synthesis && (
            <Section title="Deep Analysis" icon={<Brain size={14} className="text-indigo-400" />}>
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{model.raw_synthesis}</p>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
