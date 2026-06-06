// MAVIS Phone Calls — Initiate AI outbound calls and view call history.
import { useState, useEffect, useCallback } from "react";
import { Phone, PhoneCall, PhoneOff, PhoneMissed, Loader2, ChevronDown, ChevronUp, Clock, DollarSign, Mic } from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

interface Call {
  id: string;
  vapi_call_id: string | null;
  direction: string;
  to_number: string | null;
  from_number: string | null;
  purpose: string;
  status: string;
  transcript: { role: string; text: string; timestamp: string }[];
  summary: string | null;
  outcome: string | null;
  duration_seconds: number | null;
  cost_cents: number | null;
  created_at: string;
  ended_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  initiated:   "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  ringing:     "text-blue-400 bg-blue-400/10 border-blue-400/30",
  "in-progress": "text-green-400 bg-green-400/10 border-green-400/30",
  ended:       "text-muted-foreground bg-muted/20 border-border",
  failed:      "text-red-400 bg-red-400/10 border-red-400/30",
};

const STATUS_ICON: Record<string, typeof Phone> = {
  initiated:   PhoneCall,
  ringing:     PhoneCall,
  "in-progress": PhoneCall,
  ended:       PhoneOff,
  failed:      PhoneMissed,
};

function fmtDuration(sec: number | null) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function PhoneCallsPage() {
  const { user } = useAuth() as any;
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Form state
  const [toNumber, setToNumber] = useState("");
  const [purpose, setPurpose] = useState("");
  const [callerName, setCallerName] = useState("MAVIS");

  const fetchCalls = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await (supabase as any)
      .from("mavis_calls")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setCalls((data as Call[]) ?? []);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    fetchCalls();

    // Realtime updates for in-progress calls
    const ch = (supabase as any)
      .channel("mavis_calls_rt")
      .on("postgres_changes", {
        event: "*", schema: "public", table: "mavis_calls",
        filter: user?.id ? `user_id=eq.${user.id}` : undefined,
      }, () => fetchCalls())
      .subscribe();

    return () => { (supabase as any).removeChannel(ch); };
  }, [fetchCalls, user?.id]);

  async function initiateCall() {
    const num = toNumber.trim();
    const purp = purpose.trim();
    if (!num || !purp) { toast.error("Phone number and purpose required"); return; }
    if (!num.startsWith("+")) { toast.error("Use international format: +1XXXXXXXXXX"); return; }

    setCalling(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("mavis-phone-call", {
        body: { to: num, purpose: purp, caller_name: callerName || "MAVIS" },
      });
      if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "Call failed");
      toast.success("Call initiated — MAVIS is dialing...");
      setToNumber("");
      setPurpose("");
      await fetchCalls();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCalling(false);
    }
  }

  const activeCount = calls.filter(c => ["initiated", "ringing", "in-progress"].includes(c.status)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Phone Calls"
        subtitle="MAVIS calls on your behalf — reserve, schedule, follow up, or handle anything over the phone."
        icon={<Phone size={20} />}
      />

      {/* Initiate Call */}
      <HudCard className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-primary uppercase tracking-widest">New Call</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Phone Number</label>
            <input
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              placeholder="+15551234567"
              value={toNumber}
              onChange={e => setToNumber(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Caller Name (how MAVIS introduces itself)</label>
            <input
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              placeholder="MAVIS"
              value={callerName}
              onChange={e => setCallerName(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">Purpose (what MAVIS should accomplish)</label>
          <textarea
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
            rows={3}
            placeholder="Reserve a table for 2 at La Piazza tonight at 7pm. Confirm under the name Caliyah Johnson."
            value={purpose}
            onChange={e => setPurpose(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={initiateCall}
            disabled={calling}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {calling ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
            {calling ? "Initiating…" : "Start Call"}
          </button>

          {activeCount > 0 && (
            <div className="flex items-center gap-1.5 text-green-400 text-xs">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              {activeCount} call{activeCount > 1 ? "s" : ""} active
            </div>
          )}
        </div>

        {/* Quick-fire templates */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Quick templates:</p>
          <div className="flex flex-wrap gap-2">
            {[
              "Make a reservation for 2 people tonight at 7pm under my name",
              "Follow up on the proposal sent last week and ask if they have questions",
              "Cancel my appointment and reschedule to next week",
              "Ask about current pricing and availability",
            ].map(t => (
              <button
                key={t}
                onClick={() => setPurpose(t)}
                className="text-xs border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              >
                {t.slice(0, 40)}…
              </button>
            ))}
          </div>
        </div>
      </HudCard>

      {/* Call History */}
      <HudCard className="p-5">
        <h3 className="text-sm font-semibold text-primary uppercase tracking-widest mb-4">Call History</h3>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : calls.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">No calls yet. Initiate your first AI phone call above.</p>
        ) : (
          <div className="space-y-2">
            {calls.map(call => {
              const StatusIcon = STATUS_ICON[call.status] ?? Phone;
              const isExpanded = expanded === call.id;
              const hasTranscript = (call.transcript?.length ?? 0) > 0;

              return (
                <div key={call.id} className="border border-border rounded overflow-hidden">
                  <button
                    onClick={() => setExpanded(isExpanded ? null : call.id)}
                    className="w-full flex items-start gap-3 p-3 hover:bg-muted/20 transition-colors text-left"
                  >
                    <div className={`mt-0.5 p-1.5 rounded border ${STATUS_COLORS[call.status] ?? "text-muted-foreground border-border"}`}>
                      <StatusIcon size={12} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{call.to_number ?? call.from_number ?? "Unknown"}</span>
                        <span className={`text-xs border rounded px-1.5 py-0.5 ${STATUS_COLORS[call.status] ?? ""}`}>
                          {call.status}
                        </span>
                        {call.duration_seconds && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock size={10} />{fmtDuration(call.duration_seconds)}
                          </span>
                        )}
                        {call.cost_cents && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <DollarSign size={10} />${(call.cost_cents / 100).toFixed(2)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{call.purpose}</p>
                      {call.outcome && (
                        <p className="text-xs text-green-400 mt-0.5">✓ {call.outcome}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                      <span className="text-xs">{fmtDate(call.created_at)}</span>
                      {(hasTranscript || call.summary) && (
                        isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border bg-muted/10 p-3 space-y-3">
                      {call.summary && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Summary</p>
                          <p className="text-sm">{call.summary}</p>
                        </div>
                      )}

                      {hasTranscript && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                            <Mic size={10} /> Transcript
                          </p>
                          <div className="space-y-1.5 max-h-64 overflow-y-auto">
                            {call.transcript.map((turn, i) => (
                              <div key={i} className={`text-xs flex gap-2 ${turn.role === "assistant" ? "text-primary" : "text-foreground"}`}>
                                <span className="text-muted-foreground shrink-0 w-16 uppercase font-mono">
                                  {turn.role === "assistant" ? "MAVIS" : "THEM"}
                                </span>
                                <span>{turn.text}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </HudCard>
    </div>
  );
}
