// ============================================================
// VANTARA.EXE — IntegrationsPage
// Manage API keys and third-party credentials for MAVIS
// ============================================================
import { useState, useEffect, useCallback } from "react";
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
  Link2,
  Link2Off,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────
interface ProviderDef {
  id: string;
  name: string;
  description: string;
  keys: string[];
  docsUrl?: string | null;
  /** Provider uses OAuth — show Connect button after saving credentials */
  oauthEnabled?: boolean;
  /** Short labels shown as service badges when OAuth is connected */
  oauthServices?: string[];
}

interface GroupDef {
  label: string;
  icon: string;
  providers: ProviderDef[];
}

// Google service provider IDs that are activated after OAuth
const GOOGLE_OAUTH_PROVIDERS = ["gmail", "gdrive", "gcontacts", "google_tasks", "google_calendar"] as const;
const GOOGLE_SERVICE_LABELS: Record<string, string> = {
  gmail: "Gmail",
  gdrive: "Drive",
  gcontacts: "Contacts",
  google_tasks: "Tasks",
  google_calendar: "Calendar",
};

// ─── Constants ──────────────────────────────────────────────
const INTEGRATION_GROUPS: GroupDef[] = [
  {
    label: "Google Workspace",
    icon: "Share2",
    providers: [
      {
        id: "google_workspace",
        name: "Google Workspace",
        description: "Gmail · Drive · Contacts · Tasks · Calendar — one OAuth connection",
        keys: ["Client ID", "Client Secret"],
        oauthEnabled: true,
        oauthServices: ["gmail", "gdrive", "gcontacts", "google_tasks", "google_calendar"],
        docsUrl: "https://console.cloud.google.com/apis/credentials",
      },
    ],
  },
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
    ],
  },
  {
    label: "Memory & Knowledge",
    icon: "Cpu",
    providers: [
      { id: "mem0", name: "Mem0", description: "Persistent AI memory across sessions — semantic recall", keys: ["API Key"], docsUrl: null },
      { id: "letta", name: "Letta (MemGPT)", description: "Stateful agent memory — long-context retention", keys: ["API Key", "Agent ID"], docsUrl: null },
    ],
  },
  {
    label: "Health & Biometrics",
    icon: "Heart",
    providers: [
      { id: "whoop", name: "WHOOP", description: "Recovery, strain, sleep, and HRV sync", keys: ["Client ID", "Client Secret"], docsUrl: null },
      { id: "oura", name: "Oura Ring", description: "Sleep, HRV, readiness sync", keys: ["Personal Access Token"], docsUrl: null },
      { id: "galaxy_ring", name: "Samsung Galaxy Ring", description: "Cognitive load, SpO2, stress score sync", keys: ["API Key"], docsUrl: null },
    ],
  },
  {
    label: "Voice & TTS",
    icon: "MessageSquare",
    providers: [
      { id: "nvidia", name: "NVIDIA PersonaPlex", description: "MAVIS persona voice synthesis — NIM API", keys: ["API Key"], docsUrl: null },
      { id: "kyutai_port", name: "Kyutai (Local)", description: "On-device TTS daemon — port number (default 8020)", keys: ["Local Port"], docsUrl: null },
    ],
  },
  {
    label: "Productivity & Automation",
    icon: "Share2",
    providers: [
      { id: "reclaim", name: "Reclaim.ai", description: "Intelligent calendar defense and schedule optimization", keys: ["API Key"], docsUrl: null },
      { id: "n8n", name: "n8n", description: "Workflow automation — local or cloud instance", keys: ["API Key", "Base URL"], docsUrl: null },
    ],
  },
  {
    label: "Creative & Media",
    icon: "Cpu",
    providers: [
      { id: "fal", name: "fal.ai", description: "Ultra-fast video generation — Veo3, Kling, Runway", keys: ["API Key"], docsUrl: null },
      { id: "cartesia", name: "Cartesia", description: "Ultra-low-latency TTS — Sonic model", keys: ["API Key"], docsUrl: null },
    ],
  },
  {
    label: "Desktop & Context",
    icon: "Eye",
    providers: [
      { id: "screenpipe", name: "Screenpipe", description: "Local desktop activity context — port 3030 daemon", keys: ["Local Port"], docsUrl: null },
    ],
  },
  {
    label: "Finance Intelligence",
    icon: "DollarSign",
    providers: [
      { id: "era_finance", name: "Era Finance", description: "AI financial context and forecasting — MCP bridge", keys: ["API Key", "User ID"], docsUrl: null },
    ],
  },
  {
    label: "Smart Home & IoT",
    icon: "Cpu",
    providers: [
      {
        id: "home_assistant",
        name: "Home Assistant",
        description: "Control lights, switches, sensors, climate, and scenes via your local HA instance",
        keys: ["URL", "Long-Lived Access Token"],
        docsUrl: null,
      },
      {
        id: "philips_hue",
        name: "Philips Hue",
        description: "Direct control of Hue lights via local bridge (no cloud required)",
        keys: ["Bridge IP", "API Token"],
        docsUrl: null,
      },
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
  Eye,
};

// ─── Helper ─────────────────────────────────────────────────
function showKey(keyId: string, showValues: Record<string, boolean>): boolean {
  return !!showValues[keyId];
}

function keyId(providerId: string, keyName: string): string {
  return `${providerId}::${keyName}`;
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

  // ── Google OAuth state ────────────────────────────────────
  const [googleStatus, setGoogleStatus] = useState<{
    connected: boolean;
    email: string;
    statuses: Record<string, boolean>;
  }>({ connected: false, email: "", statuses: {} });
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [googleDisconnecting, setGoogleDisconnecting] = useState(false);
  const [googleExchanging, setGoogleExchanging] = useState(false);

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

  const loadGoogleStatus = useCallback(async () => {
    if (!user) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-google-oauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: "get_status", user_id: user.id }),
      });
      if (res.ok) setGoogleStatus(await res.json());
    } catch {
      toast.error("Failed to load integration status");
    }
  }, [user, SUPABASE_URL]);

  // ── Handle Google OAuth callback ──────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code  = params.get("code");
    const state = params.get("state");
    if (!code || !state || !user) return;

    // Only handle Google OAuth callbacks (state is base64 JSON with user_id)
    let stateData: { user_id?: string } = {};
    try { stateData = JSON.parse(atob(state)); } catch { return; }
    if (!stateData.user_id) return;

    // Clean URL immediately
    window.history.replaceState({}, "", window.location.pathname);

    setGoogleExchanging(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-google-oauth`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ action: "exchange_code", code, state, user_id: user.id }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error ?? "Token exchange failed");
        toast.success(`Google connected — ${data.email}`);
        await loadGoogleStatus();
      } catch (err: any) {
        toast.error(err.message ?? "Google connection failed");
      } finally {
        setGoogleExchanging(false);
      }
    })();
  }, [user, SUPABASE_URL, loadGoogleStatus]);

  async function connectGoogle(providerId: string) {
    if (!user) return;
    const clientId = editingValues[providerId]?.["Client ID"] ?? savedKeys[providerId]?.["Client ID"] ?? "";
    if (!clientId) {
      toast.error("Save your Google Client ID first, then click Connect");
      return;
    }
    setGoogleConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const redirectOrigin = window.location.origin;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-google-oauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: "get_auth_url", user_id: user.id, redirect_origin: redirectOrigin }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Failed to get auth URL");
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message ?? "Failed to start Google OAuth");
      setGoogleConnecting(false);
    }
  }

  async function disconnectGoogle() {
    if (!user) return;
    setGoogleDisconnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-google-oauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: "disconnect", user_id: user.id }),
      });
      if (!res.ok) throw new Error("Disconnect failed");
      setGoogleStatus({ connected: false, email: "", statuses: {} });
      toast.success("Google disconnected");
    } catch (err: any) {
      toast.error(err.message ?? "Disconnect failed");
    } finally {
      setGoogleDisconnecting(false);
    }
  }

  // ── Load saved keys on mount ──────────────────────────────
  useEffect(() => {
    if (!user) return;

    async function loadKeys() {
      setLoading(true);
      const { data, error } = await supabase
        .from("mavis_user_integrations" as any)
        .select("provider, key_name, key_value")
        .eq("user_id", user!.id);

      if (error) {
        toast.error("Failed to load integrations");
        setLoading(false);
        return;
      }

      const grouped: Record<string, Record<string, string>> = {};
      for (const row of ((data ?? []) as unknown) as { provider: string; key_name: string; key_value: string }[]) {
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
    loadGoogleStatus();
  }, [user, loadGoogleStatus]);

  // ── Save all keys for a provider ─────────────────────────
  async function saveProvider(providerId: string, keys: string[]) {
    if (!user) return;
    setSaving((prev) => ({ ...prev, [providerId]: true }));

    try {
      for (const keyName of keys) {
        const keyValue = editingValues[providerId]?.[keyName] ?? "";
        if (!keyValue) continue; // skip empty keys

        const { error } = await supabase
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
      const { error } = await supabase
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
                    const isOAuthConnected = provider.oauthEnabled && googleStatus.connected;
                    const hasKey = isOAuthConnected || hasSavedKey(provider.id);

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
                              <p className="text-xs font-mono text-muted-foreground truncate mt-0.5">
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
                                    <label className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1.5 block">
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
                                        className="flex-1 bg-muted/30 border border-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground placeholder:text-xs"
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
                                {isSaving ? "Saving…" : "Save Credentials"}
                              </button>

                              {!provider.oauthEnabled && (
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
                              )}

                              {/* Test result badge (non-OAuth providers) */}
                              {!provider.oauthEnabled && testResult === "ok" && (
                                <span className="flex items-center gap-1 text-xs font-mono text-green-400">
                                  <CheckCircle2 size={11} />
                                  Connected
                                </span>
                              )}
                              {!provider.oauthEnabled && testResult === "fail" && (
                                <span className="flex items-center gap-1 text-xs font-mono text-red-400">
                                  <XCircle size={11} />
                                  Failed
                                </span>
                              )}
                            </div>

                            {/* ── OAuth Connect section (Google Workspace) ── */}
                            {provider.oauthEnabled && (
                              <div className="border border-border/40 rounded-lg p-3 space-y-3 bg-muted/10">
                                {googleExchanging ? (
                                  <div className="flex items-center gap-2 text-xs font-mono text-primary">
                                    <Loader2 size={12} className="animate-spin" />
                                    Connecting to Google…
                                  </div>
                                ) : googleStatus.connected ? (
                                  <>
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="flex items-center gap-2">
                                        <CheckCircle2 size={13} className="text-green-400 shrink-0" />
                                        <span className="text-xs font-mono text-green-400">
                                          Connected — {googleStatus.email}
                                        </span>
                                      </div>
                                      <button
                                        onClick={disconnectGoogle}
                                        disabled={googleDisconnecting}
                                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono border border-red-500/30 text-red-400 rounded hover:bg-red-500/10 disabled:opacity-40 transition-all"
                                      >
                                        {googleDisconnecting
                                          ? <Loader2 size={10} className="animate-spin" />
                                          : <Link2Off size={10} />}
                                        {googleDisconnecting ? "Disconnecting…" : "Disconnect"}
                                      </button>
                                    </div>
                                    {/* Active service badges */}
                                    <div className="flex gap-1.5 flex-wrap">
                                      {GOOGLE_OAUTH_PROVIDERS.map(p => (
                                        <span
                                          key={p}
                                          className={`px-2 py-0.5 rounded text-xs font-mono border ${
                                            googleStatus.statuses[p]
                                              ? "border-green-500/40 text-green-400 bg-green-500/5"
                                              : "border-border/30 text-muted-foreground"
                                          }`}
                                        >
                                          {GOOGLE_SERVICE_LABELS[p]}
                                        </span>
                                      ))}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      Syncs run automatically every 20 min via the MAVIS heartbeat.
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => connectGoogle(provider.id)}
                                      disabled={googleConnecting}
                                      className="flex items-center gap-2 px-3 py-2 text-xs font-mono bg-blue-600/15 border border-blue-500/40 text-blue-300 rounded hover:bg-blue-600/25 disabled:opacity-40 transition-all w-full justify-center"
                                    >
                                      {googleConnecting
                                        ? <Loader2 size={12} className="animate-spin" />
                                        : <Link2 size={12} />}
                                      {googleConnecting ? "Opening Google…" : "Connect Google Account"}
                                    </button>
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                      Save your Client ID + Secret above first, then click Connect. You'll be redirected to Google to grant permissions for Gmail, Drive, Contacts, Tasks, and Calendar.
                                    </p>
                                    <p className="text-xs text-amber-400">
                                      Set <span className="font-mono">{window.location.origin}/integrations</span> as an Authorized Redirect URI in your Google Cloud Console OAuth credentials.
                                    </p>
                                  </>
                                )}
                              </div>
                            )}
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
