import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BookMarked, Plus, Loader2, CheckCircle2, Clock, ChevronRight, Play } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface SOTemplate {
  id: string;
  name: string;
  description: string;
  instructions: string;
  status: string;
  last_used_at: string | null;
  usage_count: number;
  success_count: number;
  cron_expression: string | null;
}

function timeAgo(ts: string | null) {
  if (!ts) return "never";
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function StandingOrdersWidget({ userId }: { userId: string }) {
  const [templates, setTemplates] = useState<SOTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", instructions: "" });
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("standing_order_templates")
      .select("id,name,description,instructions,status,last_used_at,usage_count,success_count,cron_expression")
      .eq("user_id", userId)
      .in("status", ["active", "pinned"])
      .order("status", { ascending: false })         // pinned first
      .order("last_used_at", { ascending: false })
      .limit(5);
    setTemplates(data ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!form.name.trim() || !form.instructions.trim()) return;
    setSaving(true);
    const slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const { error } = await (supabase as any).from("standing_order_templates").insert({
      user_id: userId,
      name: form.name.trim(),
      slug: `${slug}-${Date.now()}`,
      instructions: form.instructions.trim(),
      description: form.instructions.trim().slice(0, 120),
      status: "active",
      category: "general",
      version: 1,
      usage_count: 0,
      success_count: 0,
    });
    if (error) { toast.error("Failed to create standing order"); }
    else { toast.success("Standing order created"); setForm({ name: "", instructions: "" }); setShowCreate(false); await load(); }
    setSaving(false);
  }

  async function runNow(id: string, name: string) {
    setRunning(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-so-scheduler`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "run_now", template_id: id, user_id: userId }),
      });
      if (res.ok) { toast.success(`Running: ${name}`); await load(); }
      else { toast.error("Failed to queue"); }
    } catch { toast.error("Network error"); }
    setRunning(null);
  }

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="hud-border rounded p-3 animate-pulse space-y-1.5">
              <div className="h-3 bg-muted rounded w-1/2" />
              <div className="h-2.5 bg-muted rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {templates.map(t => (
            <div key={t.id} className="hud-border rounded-lg p-3 group">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 shrink-0">
                  {t.status === "pinned"
                    ? <CheckCircle2 size={12} className="text-primary" />
                    : <BookMarked size={12} className="text-muted-foreground" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-foreground leading-tight">{t.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Clock size={9} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{timeAgo(t.last_used_at)}</span>
                    {t.cron_expression && (
                      <span className="text-xs font-mono text-primary/70">⏱ scheduled</span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {t.success_count}/{t.usage_count} runs
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => runNow(t.id, t.name)}
                  disabled={running === t.id}
                  className="shrink-0 p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all disabled:opacity-50"
                  title="Run now"
                >
                  {running === t.id
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Play size={11} />
                  }
                </button>
              </div>
            </div>
          ))}

          {!templates.length && !showCreate && (
            <div className="py-6 text-center">
              <BookMarked size={18} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-xs font-mono text-muted-foreground">No standing orders yet.</p>
              <p className="text-xs text-muted-foreground mt-0.5">Delegate recurring tasks to MAVIS.</p>
            </div>
          )}

          {/* Quick-create */}
          {showCreate ? (
            <div className="hud-border rounded-lg p-3 space-y-2 border-primary/20">
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Order name (e.g. Daily market scan)"
                className="w-full bg-muted/30 border border-border rounded px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
              />
              <textarea
                value={form.instructions}
                onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                placeholder="Instructions for MAVIS... (e.g. Every morning, scan Twitter for mentions of my brand and summarize)"
                rows={3}
                className="w-full bg-muted/30 border border-border rounded px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={saving || !form.name.trim() || !form.instructions.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all disabled:opacity-50"
                >
                  {saving ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                  Create Order
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-3 py-1.5 text-xs font-mono text-muted-foreground hover:text-foreground border border-border rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreate(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-mono text-muted-foreground hover:text-primary border border-dashed border-border hover:border-primary/40 rounded transition-all"
              >
                <Plus size={10} /> New standing order
              </button>
              <button
                onClick={() => navigate("/so-templates")}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono text-muted-foreground hover:text-foreground border border-border rounded transition-colors"
              >
                All <ChevronRight size={10} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
