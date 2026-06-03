// API Keys — generate and manage programmatic access keys for MAVIS
import { useState, useEffect, useCallback } from "react";
import { Key, Plus, Trash2, Copy, Check, Loader2, Eye, EyeOff } from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  is_active: boolean;
  last_used_at: string | null;
  requests_count: number;
  created_at: string;
}

const PERMISSION_OPTS = [
  { id: "chat", label: "Chat" },
  { id: "memory", label: "Memory" },
  { id: "task", label: "Tasks" },
  { id: "sms", label: "SMS" },
];

function genKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "mk_live_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashKey(key: string): Promise<string> {
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function ApiKeysPage() {
  const { user } = useAuth() as any;
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<string[]>(["chat", "memory"]);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase.from("mavis_api_keys").select("id,name,key_prefix,permissions,is_active,last_used_at,requests_count,created_at").eq("user_id", user.id).order("created_at", { ascending: false });
    setKeys((data as ApiKey[]) ?? []);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  async function createKey() {
    if (!newKeyName.trim()) { toast.error("Name required"); return; }
    setCreating(true);
    try {
      const rawKey = genKey();
      const hash = await hashKey(rawKey);
      const { error } = await supabase.from("mavis_api_keys").insert({
        user_id: user.id, name: newKeyName.trim(),
        key_hash: hash, key_prefix: rawKey.slice(0, 12),
        permissions: selectedPerms,
      });
      if (error) throw new Error(error.message);
      setRevealedKey(rawKey);
      setNewKeyName("");
      await fetchKeys();
      toast.success("API key created — copy it now, it won't be shown again");
    } catch (e: any) { toast.error(e.message); } finally { setCreating(false); }
  }

  async function deactivate(id: string) {
    await supabase.from("mavis_api_keys").update({ is_active: false }).eq("id", id).eq("user_id", user.id);
    await fetchKeys();
    toast.success("Key deactivated");
  }

  function copyKey() {
    if (!revealedKey) return;
    navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="API Keys" subtitle="Programmatic access to MAVIS for external services and automations." icon={Key} />

      {revealedKey && (
        <HudCard className="p-4 border-primary/40 bg-primary/5">
          <p className="text-xs text-primary font-semibold mb-2">New API Key — copy now, not shown again</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-background border border-border rounded px-3 py-2 overflow-x-auto">{revealedKey}</code>
            <button onClick={copyKey} className="p-2 border border-border rounded hover:bg-muted/20 transition-colors">
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            </button>
          </div>
          <button onClick={() => setRevealedKey(null)} className="text-xs text-muted-foreground mt-2 hover:text-foreground">Dismiss</button>
        </HudCard>
      )}

      <HudCard className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-primary uppercase tracking-widest">Create New Key</h3>
        <input className="w-full bg-background border border-border rounded px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          placeholder="Key name (e.g. n8n automation, Zapier)" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} />
        <div>
          <p className="text-xs text-muted-foreground mb-2">Permissions</p>
          <div className="flex flex-wrap gap-2">
            {PERMISSION_OPTS.map(p => (
              <button key={p.id} onClick={() => setSelectedPerms(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                className={`text-xs border rounded px-2.5 py-1 transition-colors ${selectedPerms.includes(p.id) ? "bg-primary/10 text-primary border-primary/40" : "text-muted-foreground border-border hover:border-primary/30"}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={createKey} disabled={creating}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {creating ? "Creating…" : "Create Key"}
        </button>
      </HudCard>

      <HudCard className="p-5">
        <h3 className="text-sm font-semibold text-primary uppercase tracking-widest mb-4">Active Keys</h3>
        {loading ? <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
          : keys.length === 0 ? <p className="text-muted-foreground text-sm text-center py-8">No API keys yet.</p>
          : <div className="space-y-2">
            {keys.map(k => (
              <div key={k.id} className={`flex items-center gap-3 p-3 border rounded ${k.is_active ? "border-border" : "border-border/40 opacity-50"}`}>
                <Key size={14} className={k.is_active ? "text-primary" : "text-muted-foreground"} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{k.name}</span>
                    {!k.is_active && <span className="text-xs text-muted-foreground border border-border rounded px-1.5">revoked</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <code className="text-xs text-muted-foreground font-mono">{k.key_prefix}…</code>
                    <span className="text-xs text-muted-foreground">{k.requests_count} requests</span>
                    {k.last_used_at && <span className="text-xs text-muted-foreground">last used {new Date(k.last_used_at).toLocaleDateString()}</span>}
                  </div>
                  <div className="flex gap-1 mt-1">
                    {(k.permissions as string[]).map(p => (
                      <span key={p} className="text-xs border border-border rounded px-1.5 py-0.5 text-muted-foreground">{p}</span>
                    ))}
                  </div>
                </div>
                {k.is_active && (
                  <button onClick={() => deactivate(k.id)} className="p-1.5 border border-border rounded text-muted-foreground hover:text-red-400 hover:border-red-400/30 transition-colors">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>}

        <div className="mt-6 p-4 bg-muted/20 rounded border border-border">
          <p className="text-xs font-medium mb-2">Usage</p>
          <code className="text-xs text-muted-foreground font-mono block">
            POST {window.location.origin}/functions/v1/mavis-api-gateway<br/>
            x-mavis-api-key: mk_live_…<br/>
            {'{ "endpoint": "chat", "payload": { "message": "…" } }'}
          </code>
        </div>
      </HudCard>
    </div>
  );
}
