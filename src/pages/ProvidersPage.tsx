import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu, ChevronDown, ChevronUp, ExternalLink, Check,
  Loader2, AlertCircle, Zap, Eye, Brain, Wrench, Wifi, Lock,
  Copy, CheckCircle2, RefreshCw, Settings,
} from "lucide-react";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  PROVIDERS, CAPABILITY_BADGES, type ProviderDef, type ProviderModel,
} from "@/data/openclaude";

const supabase: any = supabaseTyped;
const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

// ── Storage: provider config in localStorage (fast) + Supabase (durable) ────

const LS_KEY = "vantara_provider_config";
const DB_PROVIDER = "vantara_providers";
const DB_KEY      = "config";

interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;     // override default base URL (for local/proxy)
  defaultModel?: string;
  isDefault?: boolean;  // this provider is the MAVIS default
}

type ConfigMap = Record<string, ProviderConfig>;

function loadConfig(): ConfigMap {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}"); } catch { return {}; }
}
function saveLocal(cfg: ConfigMap) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}
async function saveRemote(userId: string, cfg: ConfigMap) {
  await (supabase as any)
    .from("mavis_user_integrations")
    .upsert(
      { user_id: userId, provider: DB_PROVIDER, key_name: DB_KEY, key_value: JSON.stringify(cfg), verified: true },
      { onConflict: "user_id,provider,key_name" }
    );
}

// ── Test connection ──────────────────────────────────────────────────────────

async function testConnection(provider: ProviderDef, cfg: ProviderConfig): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";
  try {
    const res = await fetch(`${SB_URL}/functions/v1/mavis-multi-provider`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: "test",
        provider: provider.id,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl ?? provider.baseUrl,
        model: cfg.defaultModel ?? provider.models[0]?.id,
      }),
    });
    const data = await res.json();
    if (data.ok) return null;
    return data.error ?? "Unknown error";
  } catch (e: any) {
    return e?.message ?? "Network error";
  }
}

// ── Capability icon map ──────────────────────────────────────────────────────

const CAP_ICONS: Record<string, any> = {
  vision: Eye,
  reasoning: Brain,
  functionCalling: Wrench,
  streaming: Wifi,
  local: Lock,
};

// ── Provider card ────────────────────────────────────────────────────────────

function ProviderCard({
  provider, cfg, onSave, isDefault, onSetDefault,
}: {
  provider: ProviderDef;
  cfg: ProviderConfig;
  onSave: (updated: ProviderConfig) => void;
  isDefault: boolean;
  onSetDefault: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState(cfg.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl ?? provider.baseUrl);
  const [defaultModel, setDefaultModel] = useState(cfg.defaultModel ?? provider.models[0]?.id ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [testError, setTestError] = useState("");
  const [copied, setCopied] = useState(false);

  const isConfigured = provider.authMode === "none" || !!apiKey;

  function handleSave() {
    onSave({ apiKey, baseUrl, defaultModel });
    toast.success(`${provider.label} settings saved`);
    setExpanded(false);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const err = await testConnection(provider, { apiKey, baseUrl, defaultModel });
    setTesting(false);
    if (err) { setTestResult("fail"); setTestError(err); }
    else { setTestResult("ok"); }
  }

  function copyEnvSnippet() {
    const snippet = provider.authMode === "none"
      ? `# ${provider.label} — no API key required (local)`
      : `${provider.envKey}=your_key_here\n# Base URL: ${baseUrl}`;
    navigator.clipboard.writeText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className={`rounded-xl border transition-all overflow-hidden ${
      isDefault
        ? `${provider.bgColor} ${provider.borderColor}`
        : expanded
          ? "border-zinc-700 bg-zinc-900/60"
          : "border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700"
    }`}>
      {/* Card header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 p-4 text-left"
      >
        <span className="text-2xl shrink-0">{provider.logo}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-zinc-100">{provider.label}</span>
            {isDefault && (
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full border ${provider.color} ${provider.bgColor} ${provider.borderColor}`}>
                MAVIS DEFAULT
              </span>
            )}
            {isConfigured && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                ✓ CONFIGURED
              </span>
            )}
            {provider.local && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                LOCAL
              </span>
            )}
          </div>
          <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-1">{provider.description}</p>
        </div>

        {/* Capability badges */}
        <div className="hidden md:flex items-center gap-1 shrink-0">
          {CAPABILITY_BADGES.filter(b => (provider as any)[b.key]).map(b => {
            const Icon = CAP_ICONS[b.key] ?? Zap;
            return (
              <span key={b.key} title={b.label} className={`text-[9px] px-1.5 py-0.5 rounded border font-mono flex items-center gap-0.5 ${b.color}`}>
                <Icon size={9} />
              </span>
            );
          })}
        </div>

        <span className="text-zinc-600 shrink-0 ml-1">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {/* Expanded config */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-zinc-800/60 pt-3">
              {/* Model selector */}
              <div>
                <label className="text-[10px] font-mono text-zinc-500 mb-1 block">DEFAULT MODEL</label>
                <select
                  value={defaultModel}
                  onChange={e => setDefaultModel(e.target.value)}
                  className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                >
                  {provider.models.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.contextK ? ` · ${m.contextK}K ctx` : ""}
                      {m.reasoning ? " · reasoning" : ""}
                      {m.fast ? " · fast" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* API key (skip for local/none) */}
              {provider.authMode === "api-key" && (
                <div>
                  <label className="text-[10px] font-mono text-zinc-500 mb-1 flex items-center justify-between">
                    <span>API KEY ({provider.envKey})</span>
                    <button onClick={copyEnvSnippet} className="flex items-center gap-1 text-zinc-600 hover:text-zinc-400 transition-colors">
                      {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                      {copied ? "Copied" : ".env snippet"}
                    </button>
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={`${provider.envKey}=…`}
                    className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono placeholder-zinc-700 focus:outline-none focus:border-violet-500/50"
                  />
                </div>
              )}

              {/* Base URL (editable for local/proxy) */}
              <div>
                <label className="text-[10px] font-mono text-zinc-500 mb-1 block">
                  BASE URL {provider.local && <span className="text-amber-400">(Ollama endpoint)</span>}
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono focus:outline-none focus:border-violet-500/50"
                />
              </div>

              {/* Models list */}
              <div>
                <label className="text-[10px] font-mono text-zinc-500 mb-1.5 block">AVAILABLE MODELS</label>
                <div className="grid grid-cols-2 gap-1">
                  {provider.models.map(m => (
                    <div
                      key={m.id}
                      onClick={() => setDefaultModel(m.id)}
                      className={`text-[10px] px-2 py-1.5 rounded-lg cursor-pointer flex items-center gap-1.5 transition-colors ${
                        defaultModel === m.id
                          ? `${provider.bgColor} ${provider.color} ${provider.borderColor} border`
                          : "bg-zinc-800/40 text-zinc-400 border border-transparent hover:border-zinc-700"
                      }`}
                    >
                      <span className="truncate flex-1">{m.label}</span>
                      <div className="flex gap-0.5 shrink-0">
                        {m.vision && <Eye size={8} className="text-blue-400" />}
                        {m.reasoning && <Brain size={8} className="text-purple-400" />}
                        {m.fast && <Zap size={8} className="text-yellow-400" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleTest}
                  disabled={testing || (!isConfigured && provider.authMode !== "none")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-xs transition-colors"
                >
                  {testing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Test
                </button>
                {testResult && (
                  <span className={`flex items-center gap-1 text-xs px-2 ${testResult === "ok" ? "text-emerald-400" : "text-red-400"}`}>
                    {testResult === "ok" ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                    {testResult === "ok" ? "Connected" : testError.slice(0, 40)}
                  </span>
                )}
                <div className="flex-1" />
                {!isDefault && (
                  <button
                    onClick={onSetDefault}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
                  >
                    <Cpu size={11} />
                    Set as MAVIS default
                  </button>
                )}
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors"
                >
                  <Check size={11} />
                  Save
                </button>
              </div>

              {/* Docs link */}
              <a
                href={provider.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <ExternalLink size={9} />
                {provider.docsUrl}
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ProvidersPage() {
  const { user } = useAuth();
  const [configs, setConfigs] = useState<ConfigMap>(loadConfig);
  const [defaultProvider, setDefaultProvider] = useState<string>(
    () => {
      const cfg = loadConfig();
      return Object.entries(cfg).find(([, v]) => v.isDefault)?.[0] ?? "anthropic";
    }
  );

  // Load persisted config from Supabase on mount (remote wins, merged over local cache)
  useEffect(() => {
    if (!user) return;
    (supabase as any)
      .from("mavis_user_integrations")
      .select("key_value")
      .eq("user_id", user.id)
      .eq("provider", DB_PROVIDER)
      .eq("key_name", DB_KEY)
      .maybeSingle()
      .then(({ data }: { data: { key_value: string } | null }) => {
        if (!data?.key_value) return;
        try {
          const remote = JSON.parse(data.key_value) as ConfigMap;
          setConfigs(prev => {
            const merged = { ...prev, ...remote };
            saveLocal(merged);
            return merged;
          });
          const def = Object.entries(remote).find(([, v]) => v.isDefault)?.[0];
          if (def) setDefaultProvider(def);
        } catch { /* malformed — ignore */ }
      });
  }, [user]);

  const persist = useCallback((cfg: ConfigMap) => {
    saveLocal(cfg);
    if (user) saveRemote(user.id, cfg);
  }, [user]);

  function handleSave(providerId: string, updated: ProviderConfig) {
    setConfigs(prev => {
      const next = { ...prev, [providerId]: { ...prev[providerId], ...updated } };
      persist(next);
      return next;
    });
  }

  function handleSetDefault(providerId: string) {
    setDefaultProvider(providerId);
    setConfigs(prev => {
      const next: ConfigMap = {};
      for (const [k, v] of Object.entries(prev)) {
        next[k] = { ...v, isDefault: k === providerId };
      }
      if (!next[providerId]) next[providerId] = { isDefault: true };
      else next[providerId].isDefault = true;
      persist(next);
      return next;
    });
    toast.success(`${PROVIDERS.find(p => p.id === providerId)?.label} set as MAVIS default`);
  }

  const defaultProv = PROVIDERS.find(p => p.id === defaultProvider);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Settings size={16} className="text-violet-400" />
            <span className="font-mono font-semibold text-sm tracking-widest text-white">PROVIDER HUB</span>
            <span className="text-[10px] text-zinc-600 font-mono">powered by OpenClaude</span>
          </div>
          <p className="text-xs text-zinc-500">Configure AI model providers. MAVIS routes tasks to the default provider.</p>
        </div>
        {defaultProv && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs ${defaultProv.bgColor} ${defaultProv.borderColor} ${defaultProv.color}`}>
            <span>{defaultProv.logo}</span>
            <span className="font-mono">{defaultProv.label}</span>
            <span className="text-[9px] opacity-60">· {configs[defaultProvider]?.defaultModel ?? defaultProv.models[0]?.id}</span>
          </div>
        )}
      </div>

      {/* Capability legend */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] text-zinc-600 font-mono">CAPABILITIES:</span>
        {CAPABILITY_BADGES.map(b => {
          const Icon = CAP_ICONS[b.key] ?? Zap;
          return (
            <span key={b.key} className={`text-[9px] px-1.5 py-0.5 rounded border font-mono flex items-center gap-1 ${b.color}`}>
              <Icon size={9} /> {b.label}
            </span>
          );
        })}
      </div>

      {/* Provider cards */}
      <div className="space-y-2">
        {PROVIDERS.map(provider => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            cfg={configs[provider.id] ?? {}}
            onSave={(updated) => handleSave(provider.id, updated)}
            isDefault={defaultProvider === provider.id}
            onSetDefault={() => handleSetDefault(provider.id)}
          />
        ))}
      </div>

      {/* OpenClaude attribution */}
      <div className="text-center text-[10px] text-zinc-700 pb-4">
        Multi-provider routing powered by{" "}
        <a href="https://github.com/KaiyzerCal/openclaude" target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-zinc-300 underline">
          KaiyzerCal/openclaude
        </a>
        {" "}· MIT License
      </div>
    </div>
  );
}
