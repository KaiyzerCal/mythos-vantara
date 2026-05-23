// ============================================================
// VANTARA.EXE — WebhookConfigPage
// Outbound webhook endpoints for Zapier / Make / n8n / HTTP
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  Plus,
  Trash2,
  Loader2,
  X,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── Constants ──────────────────────────────────────────────
const EVENT_TYPES = [
  "*",
  "quest.completed",
  "goal.achieved",
  "task.created",
  "task.completed",
  "revenue.logged",
  "mavis.insight",
  "nora.posted",
  "journal.created",
];

const SAMPLE_PAYLOAD = `{
  "event": "quest.completed",
  "timestamp": "2026-05-17T12:00:00Z",
  "user_id": "uuid-...",
  "data": {
    "id": "quest-uuid",
    "title": "Complete morning ritual",
    "xp_reward": 100,
    "completed_at": "2026-05-17T12:00:00Z"
  }
}`;

// ─── Types ──────────────────────────────────────────────────
interface WebhookConfig {
  id: string;
  user_id: string;
  name: string;
  endpoint_url: string;
  event_types: string[];
  secret: string | null;
  active: boolean;
  created_at: string;
}

interface WebhookLog {
  id: string;
  config_id: string;
  user_id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  status_code: number | null;
  ok: boolean;
  error: string | null;
  created_at: string;
}

interface CreateForm {
  name: string;
  endpoint_url: string;
  event_types: string[];
  secret: string;
}

// ─── Helpers ────────────────────────────────────────────────
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function truncateUrl(url: string, max = 48) {
  if (url.length <= max) return url;
  return url.slice(0, max) + "…";
}

// ─── WebhookConfigPage ──────────────────────────────────────
export function WebhookConfigPage() {
  const { user } = useAuth();

  const [configs, setConfigs] = useState<WebhookConfig[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);

  const [form, setForm] = useState<CreateForm>({
    name: "",
    endpoint_url: "",
    event_types: ["*"],
    secret: "",
  });

  // ─── Loaders ───────────────────────────────────────────────
  const loadConfigs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("webhook_dispatch_config")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load webhook configs");
    } else {
      setConfigs((data as WebhookConfig[]) || []);
    }
    setLoading(false);
  }, [user]);

  const loadLogs = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("webhook_dispatch_log")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      toast.error("Failed to load dispatch logs");
    } else {
      setLogs((data as WebhookLog[]) || []);
    }
  }, [user]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (showLogs) loadLogs();
  }, [showLogs, loadLogs]);

  // ─── Create Config ─────────────────────────────────────────
  async function handleCreate() {
    if (!user) return;
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!form.endpoint_url.trim()) {
      toast.error("Endpoint URL is required");
      return;
    }
    if (form.event_types.length === 0) {
      toast.error("Select at least one event type");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("webhook_dispatch_config").insert({
      user_id: user.id,
      name: form.name.trim(),
      endpoint_url: form.endpoint_url.trim(),
      event_types: form.event_types,
      secret: form.secret.trim() || null,
      active: true,
    });
    if (error) {
      toast.error("Failed to create webhook");
    } else {
      toast.success("Webhook endpoint created");
      setForm({ name: "", endpoint_url: "", event_types: ["*"], secret: "" });
      setShowCreate(false);
      loadConfigs();
    }
    setSaving(false);
  }

  // ─── Toggle Active ─────────────────────────────────────────
  async function toggleActive(id: string, currentActive: boolean) {
    setConfigs((prev) =>
      prev.map((c) => (c.id === id ? { ...c, active: !currentActive } : c))
    );
    const { error } = await supabase
      .from("webhook_dispatch_config")
      .update({ active: !currentActive })
      .eq("id", id);
    if (error) {
      toast.error("Failed to update webhook");
      setConfigs((prev) =>
        prev.map((c) => (c.id === id ? { ...c, active: currentActive } : c))
      );
    } else {
      toast.success(
        `Webhook ${!currentActive ? "activated" : "deactivated"}`
      );
    }
  }

  // ─── Delete Config ─────────────────────────────────────────
  async function deleteConfig(id: string) {
    setConfigs((prev) => prev.filter((c) => c.id !== id));
    const { error } = await supabase
      .from("webhook_dispatch_config")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Failed to delete webhook");
      loadConfigs();
    } else {
      toast.success("Webhook deleted");
    }
  }

  // ─── Toggle event type in form ─────────────────────────────
  function toggleEventType(et: string) {
    setForm((f) => {
      const has = f.event_types.includes(et);
      if (et === "*") {
        return { ...f, event_types: has ? [] : ["*"] };
      }
      const without = f.event_types.filter((e) => e !== "*");
      return {
        ...f,
        event_types: has
          ? without.filter((e) => e !== et)
          : [...without, et],
      };
    });
  }

  // ─── Lookup config name for log ───────────────────────────
  function configName(configId: string) {
    return configs.find((c) => c.id === configId)?.name ?? configId.slice(0, 8);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        subtitle="Send events to Zapier, Make, n8n, or any HTTP endpoint"
        icon={<Zap size={18} />}
        actions={
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
          >
            {showCreate ? <X size={12} /> : <Plus size={12} />}
            {showCreate ? "Cancel" : "Add Endpoint"}
          </button>
        }
      />

      {/* ── Create Form ──────────────────────────────────────── */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            key="create-form"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <HudCard glowColor="gold">
              <p className="text-xs font-mono text-primary uppercase tracking-widest mb-3">
                New Endpoint
              </p>
              <div className="space-y-2.5">
                {/* Name */}
                <div>
                  <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="e.g. Zapier Quest Hook"
                    className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                  />
                </div>

                {/* URL */}
                <div>
                  <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">
                    Endpoint URL *
                  </label>
                  <input
                    type="url"
                    value={form.endpoint_url}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, endpoint_url: e.target.value }))
                    }
                    placeholder="https://hooks.zapier.com/hooks/catch/..."
                    className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                  />
                </div>

                {/* Secret */}
                <div>
                  <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">
                    Secret{" "}
                    <span className="text-muted-foreground/50">
                      (optional, for HMAC signing)
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      type={showSecret ? "text" : "password"}
                      value={form.secret}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, secret: e.target.value }))
                      }
                      placeholder="Signing secret..."
                      className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 pr-8 text-xs font-mono focus:outline-none focus:border-primary/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                </div>

                {/* Event types */}
                <div>
                  <label className="text-[9px] font-mono text-muted-foreground block mb-1.5">
                    Event Types *
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {EVENT_TYPES.map((et) => {
                      const selected = form.event_types.includes(et);
                      return (
                        <button
                          key={et}
                          type="button"
                          onClick={() => toggleEventType(et)}
                          className={`px-2 py-1 text-[9px] font-mono rounded border transition-colors ${
                            selected
                              ? "bg-primary/20 border-primary/40 text-primary"
                              : "bg-muted/20 border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                          }`}
                        >
                          {et}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Save */}
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleCreate}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
                  >
                    {saving ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Plus size={11} />
                    )}
                    Save Endpoint
                  </button>
                </div>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Endpoint List ─────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">
          Configured Endpoints
        </h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-primary" size={20} />
          </div>
        ) : configs.length === 0 ? (
          <HudCard className="text-center py-8">
            <Zap size={28} className="text-muted-foreground mx-auto mb-2" />
            <p className="text-xs font-mono text-muted-foreground">
              No endpoints configured yet.
            </p>
            <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">
              Add an endpoint to start routing events to Zapier, Make, or n8n.
            </p>
          </HudCard>
        ) : (
          <div className="space-y-2">
            {configs.map((cfg, i) => {
              const isExpanded = expandedConfigId === cfg.id;
              return (
                <motion.div
                  key={cfg.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <HudCard>
                    <div className="flex items-start gap-3">
                      {/* Active indicator */}
                      <button
                        onClick={() => toggleActive(cfg.id, cfg.active)}
                        title={cfg.active ? "Active — click to disable" : "Inactive — click to enable"}
                        className="shrink-0 mt-0.5"
                      >
                        <div
                          className={`w-2.5 h-2.5 rounded-full transition-colors ${
                            cfg.active
                              ? "bg-green-400 shadow-[0_0_6px_#4ade80]"
                              : "bg-muted-foreground/30"
                          }`}
                        />
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono font-bold text-foreground">
                            {cfg.name}
                          </span>
                          {!cfg.active && (
                            <span className="text-[8px] font-mono text-muted-foreground bg-muted/30 px-1 py-0.5 rounded border border-border/50 uppercase">
                              Disabled
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
                          {truncateUrl(cfg.endpoint_url)}
                        </p>

                        {/* Event type pills */}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {cfg.event_types.map((et) => (
                            <span
                              key={et}
                              className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-primary/20 bg-primary/5 text-primary/70"
                            >
                              {et}
                            </span>
                          ))}
                        </div>

                        {/* Expand toggle */}
                        <button
                          onClick={() =>
                            setExpandedConfigId(isExpanded ? null : cfg.id)
                          }
                          className="flex items-center gap-1 mt-2 text-[9px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronUp size={10} />
                          ) : (
                            <ChevronDown size={10} />
                          )}
                          {isExpanded ? "Less" : "Details"}
                        </button>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              key="details"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.15 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-mono text-muted-foreground w-16">
                                    Full URL
                                  </span>
                                  <span className="text-[9px] font-mono text-foreground/70 break-all">
                                    {cfg.endpoint_url}
                                  </span>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(cfg.endpoint_url);
                                      toast.success("URL copied");
                                    }}
                                    className="text-muted-foreground hover:text-primary transition-colors"
                                  >
                                    <Copy size={10} />
                                  </button>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-mono text-muted-foreground w-16">
                                    Secret
                                  </span>
                                  <span className="text-[9px] font-mono text-muted-foreground">
                                    {cfg.secret ? "••••••••" : "Not set"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-mono text-muted-foreground w-16">
                                    Created
                                  </span>
                                  <span className="text-[9px] font-mono text-muted-foreground">
                                    {fmtDateTime(cfg.created_at)}
                                  </span>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Delete */}
                      <button
                        onClick={() => deleteConfig(cfg.id)}
                        className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors mt-0.5"
                        title="Delete endpoint"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </HudCard>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Dispatch Logs ─────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-mono text-primary uppercase tracking-widest">
            Dispatch Logs
          </h2>
          <button
            onClick={() => setShowLogs((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            {showLogs ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {showLogs ? "Hide Logs" : "View Logs"}
          </button>
        </div>

        <AnimatePresence>
          {showLogs && (
            <motion.div
              key="logs"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {logs.length === 0 ? (
                <HudCard className="text-center py-6">
                  <p className="text-xs font-mono text-muted-foreground">
                    No dispatch logs yet.
                  </p>
                </HudCard>
              ) : (
                <HudCard className="overflow-x-auto">
                  <table className="w-full min-w-max">
                    <thead>
                      <tr className="border-b border-border/40">
                        {[
                          "Status",
                          "Event",
                          "Endpoint",
                          "Code",
                          "Timestamp",
                        ].map((h) => (
                          <th
                            key={h}
                            className="text-left text-[9px] font-mono text-muted-foreground uppercase tracking-widest pb-1.5 pr-4 last:pr-0"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr
                          key={log.id}
                          className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors"
                        >
                          <td className="py-1.5 pr-4">
                            {log.ok ? (
                              <CheckCircle2
                                size={13}
                                className="text-green-400"
                              />
                            ) : (
                              <XCircle size={13} className="text-red-400" />
                            )}
                          </td>
                          <td className="py-1.5 pr-4">
                            <span className="text-[10px] font-mono text-foreground/80">
                              {log.event_type}
                            </span>
                          </td>
                          <td className="py-1.5 pr-4">
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {configName(log.config_id)}
                            </span>
                          </td>
                          <td className="py-1.5 pr-4">
                            <span
                              className={`text-[10px] font-mono ${
                                log.ok
                                  ? "text-green-400"
                                  : "text-red-400"
                              }`}
                            >
                              {log.status_code ?? "—"}
                            </span>
                          </td>
                          <td className="py-1.5">
                            <span className="text-[9px] font-mono text-muted-foreground whitespace-nowrap">
                              {fmtDateTime(log.created_at)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </HudCard>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* ── Integration Guide ─────────────────────────────────── */}
      <section>
        <div className="flex items-start gap-2 px-3 py-2.5 rounded border border-blue-800/40 bg-blue-950/20 mb-3">
          <Info size={12} className="text-blue-400 shrink-0 mt-0.5" />
          <span className="text-[10px] font-mono text-blue-400/80 leading-relaxed">
            Copy your endpoint URL into the Zapier / Make / n8n webhook trigger
            step. MAVIS will POST events as JSON when they occur.
          </span>
        </div>

        <HudCard>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
              Sample Payload Format
            </p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(SAMPLE_PAYLOAD);
                toast.success("Sample payload copied");
              }}
              className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground hover:text-primary transition-colors"
            >
              <Copy size={10} /> Copy
            </button>
          </div>
          <pre className="text-[10px] font-mono text-foreground/70 bg-muted/20 rounded p-3 overflow-x-auto leading-relaxed">
            {SAMPLE_PAYLOAD}
          </pre>
        </HudCard>
      </section>
    </div>
  );
}
