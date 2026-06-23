// MAVIS SMS + WhatsApp page — send messages, view history
import { useState, useEffect, useCallback } from "react";
import { MessageSquare, Send, Loader2, Phone, Globe } from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

interface SmsLog {
  id: string;
  to_number: string;
  from_number: string;
  message: string;
  channel: string;
  status: string;
  created_at: string;
}

export default function SMSPage() {
  const { user } = useAuth() as any;
  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");

  const fetchLogs = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase.from("mavis_sms_log").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
    setLogs((data as SmsLog[]) ?? []);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  async function send() {
    if (!to.trim() || !message.trim()) { toast.error("Number and message required"); return; }
    if (!to.trim().startsWith("+")) { toast.error("Use international format: +1XXXXXXXXXX"); return; }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-sms", { body: { to: to.trim(), message: message.trim(), channel } });
      if (error || data?.error) throw new Error(data?.error ?? error?.message);
      toast.success(`${channel === "whatsapp" ? "WhatsApp" : "SMS"} sent`);
      setTo(""); setMessage("");
      await fetchLogs();
    } catch (e: any) { toast.error(e.message); } finally { setSending(false); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="SMS & WhatsApp" subtitle="Send messages via MAVIS — Twilio powered." icon={<MessageSquare size={20} />} />

      <HudCard className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-primary uppercase tracking-widest">Send Message</h3>
        <div className="flex gap-2">
          {(["sms", "whatsapp"] as const).map(ch => (
            <button key={ch} onClick={() => setChannel(ch)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors ${channel === ch ? "bg-primary/10 text-primary border-primary/40" : "text-muted-foreground border-border hover:border-primary/30"}`}>
              {ch === "sms" ? <Phone size={12} /> : <Globe size={12} />}
              {ch === "sms" ? "SMS" : "WhatsApp"}
            </button>
          ))}
        </div>
        <input className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          placeholder="+15551234567" value={to} onChange={e => setTo(e.target.value)} />
        <textarea className="w-full bg-background border border-border rounded px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
          rows={3} placeholder="Message…" value={message} onChange={e => setMessage(e.target.value)} />
        <button onClick={send} disabled={sending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {sending ? "Sending…" : "Send"}
        </button>
      </HudCard>

      <HudCard className="p-5">
        <h3 className="text-sm font-semibold text-primary uppercase tracking-widest mb-4">Message History</h3>
        {loading ? <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
          : logs.length === 0 ? <p className="text-muted-foreground text-sm text-center py-8">No messages sent yet.</p>
          : <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 p-3 border border-border rounded">
                <div className={`mt-0.5 p-1.5 rounded border ${log.channel === "whatsapp" ? "text-green-400 border-green-400/30 bg-green-400/10" : "text-blue-400 border-blue-400/30 bg-blue-400/10"}`}>
                  {log.channel === "whatsapp" ? <Globe size={12} /> : <Phone size={12} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono">{log.to_number}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${log.status === "sent" ? "text-green-400 border-green-400/30" : "text-red-400 border-red-400/30"}`}>{log.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.message}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{new Date(log.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>}
      </HudCard>
    </div>
  );
}
