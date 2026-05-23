// ============================================================
// VANTARA.EXE — IntegrationsPage
// Manage API keys and third-party credentials for MAVIS
// ============================================================
import { useState, useEffect } from "react";
import {
  Cpu,
  Share2,
  MessageSquare,
  DollarSign,
  Heart,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plus,
  Trash2,
  Smartphone,
  HexagonIcon,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";
import {
  getLocalMeshConfig,
  saveLocalMeshConfig,
  checkLocalMeshHealth,
  listLocalModels,
  type LocalMeshConfig,
  type LocalMeshStatus,
} from "@/mavis/localMesh";
import { getN8nConfig, setN8nConfig } from "@/mavis/plugins/n8nPlugin";

// ─── Types ──────────────────────────────────────────────────
interface ProviderDef {
  id: string;
  name: string;
  description: string;
  keys: string[];
  docsUrl?: string | null;
}

interface GroupDef {
  label: string;
  icon: string;
  providers: ProviderDef[];
}

// ─── Constants ──────────────────────────────────────────────
const INTEGRATION_GROUPS: GroupDef[] = [
  {
    label: "AI Providers",
    icon: "Cpu",
    providers: [
      { id: "anthropic", name: "Anthropic", description: "Claude models — core AI engine", keys: ["API Key"], docsUrl: null },
      { id: "openai", name: "OpenAI", description: "Embeddings (text-embedding-3-small)", keys: ["API Key"], docsUrl: null },
    ],
  },
  {
    label: "Social",
    icon: "Share2",
    providers: [
      { id: "twitter", name: "Twitter / X", description: "Nora's Twitter presence", keys: ["Consumer Key", "Consumer Secret", "Access Token", "Access Token Secret", "Nora User ID", "Nora Username"] },
      { id: "linkedin", name: "LinkedIn", description: "Nora LinkedIn posting", keys: ["Access Token"] },
      { id: "discord", name: "Discord", description: "Nora Discord webhook + interactions", keys: ["Webhook URL", "Public Key"] },
      { id: "instagram", name: "Instagram", description: "Nora Instagram (Meta Graph API)", keys: ["Access Token", "User ID"] },
      { id: "tiktok", name: "TikTok", description: "Nora TikTok posting", keys: ["Access Token", "Open ID"] },
    ],
  },
  {
    label: "Messaging & Email",
    icon: "MessageSquare",
    providers: [
      { id: "telegram", name: "Telegram", description: "Morning brief & command bot", keys: ["Bot Token", "Operator Chat ID", "Operator User ID"] },
      { id: "resend", name: "Resend", description: "Transactional email sending", keys: ["API Key", "From Address"] },
    ],
  },
  {
    label: "Finance & Commerce",
    icon: "DollarSign",
    providers: [
      { id: "stripe", name: "Stripe", description: "Revenue tracking & webhooks", keys: ["Secret Key", "Webhook Secret"] },
      { id: "gumroad", name: "Gumroad", description: "Product sales tracking", keys: ["Access Token"] },
      { id: "alpaca", name: "Alpaca Markets", description: "Stock trading — paper & live order execution", keys: ["API Key", "Secret Key", "Paper Mode (true/false)", "Max Position %", "Stop Loss %", "Approval Threshold USD"] },
      { id: "binance", name: "Binance", description: "Crypto trading — BTC, ETH and more via Binance API", keys: ["API Key", "Secret Key", "Testnet (true/false)", "Max Position %", "Stop Loss %", "Approval Threshold USD"] },
    ],
  },
  {
    label: "Health & Devices",
    icon: "Heart",
    providers: [
      { id: "oura", name: "Oura Ring", description: "Sleep, HRV, readiness sync", keys: ["Personal Access Token"] },
      { id: "fcm", name: "Firebase (FCM)", description: "Android & web push notifications", keys: ["Server Key", "Project ID"] },
    ],
  },
];

// ─── Icon map ───────────────────────────────────────────────
const ICON_MAP: Record<string, LucideIcon> = {
  Cpu,
  Share2,
  MessageSquare,
  DollarSign,
  Heart,
};

// ─── Helper ─────────────────────────────────────────────────
function showKey(keyId: string, showValues: Record<string, boolean>): boolean {
  return !!showValues[keyId];
}

function keyId(providerId: string, keyName: string): string {
  return `${providerId}::${keyName}`;
}

// ─── Local Mesh Panel ────────────────────────────────────────
function LocalMeshPanel() {
  const [cfg, setCfg] = useState<LocalMeshConfig>(getLocalMeshConfig());
  const [status, setStatus] = useState<LocalMeshStatus>("checking");
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    const health = await checkLocalMeshHealth(true);
    setStatus(health);
    if (health === "online") {
      const m = await listLocalModels();
      setModels(m);
      toast.success(`Local Mesh online — ${m.length} model${m.length !== 1 ? "s" : ""} found`);
    } else {
      toast.error("Local Mesh unreachable. Check that Ollama is running.");
    }
    setChecking(false);
  };

  const handleSave = () => {
    setSaving(true);
    saveLocalMeshConfig(cfg);
    setSaving(false);
    toast.success("Local Mesh config saved.");
  };

  const statusLabel = status === "online" ? "ONLINE" : status === "offline" ? "OFFLINE" : status === "disabled" ? "DISABLED" : "CHECKING";
  const statusColor = status === "online" ? "text-green-400" : status === "offline" ? "text-red-400" : "text-muted-foreground";

  return (
    <HudCard glowColor={status === "online" ? "green" : "none"}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor" className="text-primary">
            <polygon points="6.5,0 12,3.25 12,9.75 6.5,13 1,9.75 1,3.25" />
          </svg>
          <p className="text-xs font-mono text-foreground">Local Mesh · OpenClaw / OpenJarvis</p>
        </div>
        <span className={`text-[9px] font-mono ${statusColor}`}>{statusLabel}</span>
      </div>

      <p className="text-[10px] font-mono text-muted-foreground mb-4 leading-relaxed">
        Route MAVIS requests to a local Ollama instance for on-device computation.
        Works now with any machine running Ollama on your LAN.
        When OpenClaw arrives, set its address here and flip the switch.
      </p>

      <div className="space-y-3">
        {/* Enable toggle */}
        <label className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Enable Local Mesh</span>
          <button
            onClick={() => setCfg((c) => ({ ...c, enabled: !c.enabled }))}
            className={`w-9 h-5 rounded-full transition-colors ${cfg.enabled ? "bg-primary" : "bg-muted"} relative`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${cfg.enabled ? "left-4" : "left-0.5"}`} />
          </button>
        </label>

        {/* Endpoint */}
        <div>
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5 block">Ollama Endpoint</label>
          <input
            value={cfg.endpoint}
            onChange={(e) => setCfg((c) => ({ ...c, endpoint: e.target.value }))}
            placeholder="http://localhost:11434"
            className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/50"
          />
          <p className="text-[9px] font-mono text-muted-foreground mt-1">Local: http://localhost:11434 · Tailscale: http://100.x.x.x:11434</p>
        </div>

        {/* Model */}
        <div>
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5 block">Model</label>
          {models.length > 0 ? (
            <select
              value={cfg.model}
              onChange={(e) => setCfg((c) => ({ ...c, model: e.target.value }))}
              className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
            >
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input
              value={cfg.model}
              onChange={(e) => setCfg((c) => ({ ...c, model: e.target.value }))}
              placeholder="llama3.2:3b"
              className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/50"
            />
          )}
        </div>

        {/* Tunnel toggle + URL */}
        <label className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Use Tunnel URL</span>
          <button
            onClick={() => setCfg((c) => ({ ...c, tunnelEnabled: !c.tunnelEnabled }))}
            className={`w-9 h-5 rounded-full transition-colors ${cfg.tunnelEnabled ? "bg-primary" : "bg-muted"} relative`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${cfg.tunnelEnabled ? "left-4" : "left-0.5"}`} />
          </button>
        </label>
        {cfg.tunnelEnabled && (
          <input
            value={cfg.tunnelUrl}
            onChange={(e) => setCfg((c) => ({ ...c, tunnelUrl: e.target.value }))}
            placeholder="https://your-ngrok.ngrok.io"
            className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/50"
          />
        )}

        {/* Context window */}
        <div>
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5 block">
            Context Window (tokens)
          </label>
          <input
            type="number"
            value={cfg.contextWindowTokens}
            onChange={(e) => setCfg((c) => ({ ...c, contextWindowTokens: Number(e.target.value) }))}
            min={512} max={131072} step={512}
            className="w-40 bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
          />
        </div>

        {/* Detected models */}
        {models.length > 0 && (
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Detected Models</p>
            <div className="flex flex-wrap gap-1">
              {models.map((m) => (
                <span key={m} className="px-2 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-[9px] font-mono text-primary">{m}</span>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-border text-muted-foreground rounded hover:border-primary/40 hover:text-primary disabled:opacity-40 transition-all"
          >
            {checking ? <Loader2 size={11} className="animate-spin" /> : <Wifi size={11} />}
            {checking ? "Checking..." : "Test Connection"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-40 transition-all"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : null}
            Save Config
          </button>
          {status === "online" && <CheckCircle2 size={13} className="text-green-400" />}
          {status === "offline" && <WifiOff size={13} className="text-red-400" />}
        </div>

        <div className="text-[9px] font-mono text-muted-foreground leading-relaxed border-t border-border pt-2">
          <strong className="text-primary">Supported models:</strong> llama3.2:3b · phi4-mini · mistral:7b · gemma3:4b · deepseek-r1:7b
          <br />
          <strong className="text-primary">Offline mode:</strong> When Cloud is unreachable, MAVIS serves cached data from your last sync.
          <br />
          <strong className="text-primary">OpenClaw:</strong> Once your local machine is set up with Ollama, point the endpoint here.
        </div>
      </div>
    </HudCard>
  );
}

// ─── n8n Config Panel ────────────────────────────────────────
function N8nConfigPanel() {
  const [host, setHost]     = useState(getN8nConfig().host);
  const [apiKey, setApiKey] = useState(getN8nConfig().apiKey);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting]   = useState(false);
  const [connStatus, setConnStatus] = useState<"idle" | "ok" | "error">("idle");

  const handleSave = () => {
    setN8nConfig({ host: host.trim(), apiKey: apiKey.trim() });
    toast.success("n8n config saved");
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch(`${host.trim()}/api/v1/workflows`, {
        headers: { "X-N8N-API-KEY": apiKey },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) { setConnStatus("ok"); toast.success("n8n connected"); }
      else { setConnStatus("error"); toast.error(`n8n returned ${res.status}`); }
    } catch { setConnStatus("error"); toast.error("n8n unreachable"); }
    setTesting(false);
  };

  return (
    <HudCard glowColor={connStatus === "ok" ? "green" : "none"}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-primary">
            <circle cx="12" cy="12" r="10" />
          </svg>
          <p className="text-xs font-mono text-foreground">n8n · Workflow Automation</p>
        </div>
        <span className={`text-[9px] font-mono ${connStatus === "ok" ? "text-green-400" : connStatus === "error" ? "text-red-400" : "text-muted-foreground"}`}>
          {connStatus === "ok" ? "CONNECTED" : connStatus === "error" ? "UNREACHABLE" : "IDLE"}
        </span>
      </div>

      <p className="text-[10px] font-mono text-muted-foreground mb-4 leading-relaxed">
        Connect a local or hosted n8n instance so MAVIS can build and trigger automation workflows.
        Get an API key from Settings → API in your n8n instance.
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest block mb-1">Host URL</label>
          <input
            type="text"
            value={host}
            onChange={e => setHost(e.target.value)}
            placeholder="http://localhost:5678"
            className="w-full bg-muted/20 border border-border rounded px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
        <div>
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest block mb-1">API Key</label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="n8n API key"
              className="w-full bg-muted/20 border border-border rounded px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50 pr-8"
            />
            <button onClick={() => setShowKey(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={handleTest} disabled={testing || !host}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-muted/20 border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
            {testing ? <Loader2 size={11} className="animate-spin" /> : connStatus === "ok" ? <CheckCircle2 size={11} className="text-green-400" /> : <XCircle size={11} />}
            Test
          </button>
          <button onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors">
            Save
          </button>
        </div>
      </div>
    </HudCard>
  );
}

// ─── Telegram Linked Accounts ────────────────────────────────
interface LinkedAccount {
  id: string;
  telegram_user_id: string;
  label: string;
  created_at: string;
}

function TelegramLinkedAccountsPanel({ userId }: { userId: string }) {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [newId, setNewId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("telegram_linked_accounts")
      .select("id, telegram_user_id, label, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    setAccounts((data ?? []) as LinkedAccount[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [userId]);

  const handleAdd = async () => {
    const tid = newId.trim();
    if (!tid) return;
    setAdding(true);
    const { error } = await (supabase as any)
      .from("telegram_linked_accounts")
      .insert({ user_id: userId, telegram_user_id: tid, label: newLabel.trim() || "Linked Account" });
    if (error) {
      toast.error(error.message.includes("unique") ? "That account is already linked." : error.message);
    } else {
      setNewId(""); setNewLabel("");
      await load();
      toast.success("Account linked — it can now message MAVIS.");
    }
    setAdding(false);
  };

  const handleRemove = async (id: string) => {
    setRemoving(id);
    await (supabase as any).from("telegram_linked_accounts").delete().eq("id", id);
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    setRemoving(null);
    toast.success("Account unlinked.");
  };

  return (
    <HudCard>
      <div className="flex items-center gap-2 mb-4">
        <Smartphone size={13} className="text-primary" />
        <p className="text-xs font-mono text-foreground">Telegram Linked Accounts</p>
      </div>
      <p className="text-[10px] font-mono text-muted-foreground mb-4 leading-relaxed">
        Link additional Telegram accounts (e.g. a second phone) so they can talk to MAVIS.
        Each linked account shares your full MAVIS context.
        To find your secondary account's Telegram user ID, message the bot from that account and send <span className="text-primary">/myid</span>.
      </p>

      {loading ? (
        <Loader2 size={14} className="animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-3">
          {accounts.length === 0 && (
            <p className="text-[10px] font-mono text-muted-foreground">No linked accounts yet.</p>
          )}
          {accounts.map((acc) => (
            <div key={acc.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-muted/20 border border-border">
              <div className="min-w-0">
                <p className="text-xs font-mono text-foreground truncate">{acc.label}</p>
                <p className="text-[10px] font-mono text-muted-foreground">ID: {acc.telegram_user_id}</p>
              </div>
              <button
                onClick={() => handleRemove(acc.id)}
                disabled={removing === acc.id}
                className="p-1.5 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-40"
                title="Unlink"
              >
                {removing === acc.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              </button>
            </div>
          ))}

          {/* Add new */}
          <div className="pt-2 border-t border-border space-y-2">
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Add Account</p>
            <div className="flex gap-2">
              <input
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="Telegram user ID (from /myid)"
                className="flex-1 bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
              />
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Label (e.g. Work Phone)"
                className="w-36 bg-muted/30 border border-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
              />
              <button
                onClick={handleAdd}
                disabled={adding || !newId.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                Link
              </button>
            </div>
          </div>
        </div>
      )}
    </HudCard>
  );
}

// ─── IntegrationsPage ───────────────────────────────────────
export function IntegrationsPage() {
  const { user } = useAuth();

  const [savedKeys, setSavedKeys] = useState<Record<string, Record<string, string>>>({});
  const [editingValues, setEditingValues] = useState<Record<string, Record<string, string>>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, "ok" | "fail" | "testing">>({});

  // ── Load saved keys on mount ──────────────────────────────
  useEffect(() => {
    if (!user) return;

    async function loadKeys() {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from("mavis_user_integrations" as any)
        .select("provider, key_name, key_value")
        .eq("user_id", user!.id);

      if (error) {
        toast.error("Failed to load integrations");
        setLoading(false);
        return;
      }

      const grouped: Record<string, Record<string, string>> = {};
      for (const row of (data ?? []) as { provider: string; key_name: string; key_value: string }[]) {
        if (!grouped[row.provider]) grouped[row.provider] = {};
        grouped[row.provider][row.key_name] = row.key_value;
      }

      setSavedKeys(grouped);

      // Initialize editingValues with the same data
      const editing: Record<string, Record<string, string>> = {};
      for (const group of INTEGRATION_GROUPS) {
        for (const provider of group.providers) {
          editing[provider.id] = {};
          for (const k of provider.keys) {
            editing[provider.id][k] = grouped[provider.id]?.[k] ?? "";
          }
        }
      }
      setEditingValues(editing);
      setLoading(false);
    }

    loadKeys();
  }, [user]);

  // ── Save all keys for a provider ─────────────────────────
  async function saveProvider(providerId: string, keys: string[]) {
    if (!user) return;
    setSaving((prev) => ({ ...prev, [providerId]: true }));

    try {
      for (const keyName of keys) {
        const keyValue = editingValues[providerId]?.[keyName] ?? "";
        if (!keyValue) continue; // skip empty keys

        const { error } = await (supabase as any)
          .from("mavis_user_integrations" as any)
          .upsert(
            {
              user_id: user.id,
              provider: providerId,
              key_name: keyName,
              key_value: keyValue,
            },
            { onConflict: "user_id,provider,key_name" }
          );

        if (error) throw error;
      }

      // Update savedKeys to reflect the new state
      setSavedKeys((prev) => {
        const updated = { ...prev, [providerId]: { ...(prev[providerId] ?? {}) } };
        for (const keyName of keys) {
          const v = editingValues[providerId]?.[keyName] ?? "";
          if (v) updated[providerId][keyName] = v;
        }
        return updated;
      });

      toast.success(`${providerId} — Saved`);
    } catch (err: any) {
      toast.error(`Save failed: ${err?.message ?? "Unknown error"}`);
    } finally {
      setSaving((prev) => ({ ...prev, [providerId]: false }));
    }
  }

  // ── Test Connection ───────────────────────────────────────
  async function testConnection(providerId: string) {
    setTestResults((prev) => ({ ...prev, [providerId]: "testing" }));
    try {
      const { error } = await (supabase as any)
        .from("mavis_user_integrations" as any)
        .select("id")
        .eq("provider", providerId)
        .limit(1);

      setTestResults((prev) => ({ ...prev, [providerId]: error ? "fail" : "ok" }));
    } catch {
      setTestResults((prev) => ({ ...prev, [providerId]: "fail" }));
    }
  }

  // ── Toggle show/hide for a single key ─────────────────────
  function toggleShowValue(kid: string) {
    setShowValues((prev) => ({ ...prev, [kid]: !prev[kid] }));
  }

  // ── Edit value ────────────────────────────────────────────
  function setEditValue(providerId: string, keyName: string, value: string) {
    setEditingValues((prev) => ({
      ...prev,
      [providerId]: { ...(prev[providerId] ?? {}), [keyName]: value },
    }));
  }

  // ── Has any saved key for provider ────────────────────────
  function hasSavedKey(providerId: string): boolean {
    const providerKeys = savedKeys[providerId];
    if (!providerKeys) return false;
    return Object.values(providerKeys).some((v) => !!v);
  }

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Integrations"
        subtitle="Manage API keys and third-party credentials"
      />

      {/* Info Banner */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
        <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
        <p className="text-xs font-mono text-amber-300/80 leading-relaxed">
          Keys are stored encrypted per-user. Use scoped/read-only keys where possible.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-8">
          <LocalMeshPanel />
          <N8nConfigPanel />
          {user && <TelegramLinkedAccountsPanel userId={user.id} />}

          {INTEGRATION_GROUPS.map((group) => {
            const GroupIcon = ICON_MAP[group.icon] ?? Cpu;

            return (
              <section key={group.label}>
                {/* Group header */}
                <div className="flex items-center gap-2 mb-3">
                  <GroupIcon size={13} className="text-primary" />
                  <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                    {group.label}
                  </h2>
                </div>

                <div className="space-y-2">
                  {group.providers.map((provider) => {
                    const isExpanded = expandedProvider === provider.id;
                    const isSaving = !!saving[provider.id];
                    const testResult = testResults[provider.id];
                    const hasKey = hasSavedKey(provider.id);

                    return (
                      <HudCard key={provider.id} glowColor={hasKey ? "green" : "none"}>
                        {/* Provider header — clickable to expand */}
                        <button
                          onClick={() =>
                            setExpandedProvider(isExpanded ? null : provider.id)
                          }
                          className="w-full flex items-center justify-between gap-3 text-left"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {/* Status dot */}
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                hasKey ? "bg-green-400" : "bg-muted-foreground/40"
                              }`}
                            />
                            <div className="min-w-0">
                              <span className="text-sm font-mono text-foreground">
                                {provider.name}
                              </span>
                              <p className="text-[10px] font-mono text-muted-foreground truncate mt-0.5">
                                {provider.description}
                              </p>
                            </div>
                          </div>
                          {isExpanded ? (
                            <ChevronUp size={14} className="text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                          )}
                        </button>

                        {/* Expanded content */}
                        {isExpanded && (
                          <div className="mt-4 space-y-4 border-t border-border pt-4">
                            {/* Key fields */}
                            <div className="space-y-3">
                              {provider.keys.map((keyName) => {
                                const kid = keyId(provider.id, keyName);
                                const revealed = showKey(kid, showValues);
                                const currentEdit = editingValues[provider.id]?.[keyName] ?? "";
                                const savedVal = savedKeys[provider.id]?.[keyName] ?? "";
                                const displayValue = revealed
                                  ? currentEdit
                                  : currentEdit
                                  ? currentEdit
                                  : "";
                                const placeholder = savedVal && !currentEdit
                                  ? "•".repeat(12)
                                  : keyName;

                                return (
                                  <div key={keyName}>
                                    <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5 block">
                                      {keyName}
                                    </label>
                                    <div className="flex gap-2">
                                      <input
                                        type={revealed ? "text" : "password"}
                                        value={displayValue}
                                        onChange={(e) =>
                                          setEditValue(provider.id, keyName, e.target.value)
                                        }
                                        placeholder={placeholder}
                                        className="flex-1 bg-muted/30 border border-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/50 placeholder:text-xs"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => toggleShowValue(kid)}
                                        className="px-2.5 border border-border rounded bg-muted/20 hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-all"
                                        title={revealed ? "Hide" : "Show"}
                                      >
                                        {revealed ? (
                                          <EyeOff size={13} />
                                        ) : (
                                          <Eye size={13} />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Actions row */}
                            <div className="flex items-center gap-3 flex-wrap">
                              <button
                                onClick={() => saveProvider(provider.id, provider.keys)}
                                disabled={isSaving}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                              >
                                {isSaving ? (
                                  <Loader2 size={11} className="animate-spin" />
                                ) : null}
                                {isSaving ? "Saving…" : "Save"}
                              </button>

                              <button
                                onClick={() => testConnection(provider.id)}
                                disabled={testResult === "testing"}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-border text-muted-foreground rounded hover:border-border/60 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                              >
                                {testResult === "testing" ? (
                                  <Loader2 size={11} className="animate-spin" />
                                ) : null}
                                {testResult === "testing" ? "Testing…" : "Test Connection"}
                              </button>

                              {/* Test result badge */}
                              {testResult === "ok" && (
                                <span className="flex items-center gap-1 text-[10px] font-mono text-green-400">
                                  <CheckCircle2 size={11} />
                                  Connected
                                </span>
                              )}
                              {testResult === "fail" && (
                                <span className="flex items-center gap-1 text-[10px] font-mono text-red-400">
                                  <XCircle size={11} />
                                  Failed
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </HudCard>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
