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
