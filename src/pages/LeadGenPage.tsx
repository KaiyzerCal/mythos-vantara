// Lead Generation — AI researches prospects, drafts outreach for SkyforgeAI
import { useState, useEffect, useCallback } from "react";
import { Users, Search, Mail, Star, Loader2, Plus, ChevronDown, ChevronUp, TrendingUp } from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

interface Lead {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_title: string | null;
  website: string | null;
  industry: string | null;
  research_summary: string | null;
  outreach_draft: string | null;
  status: string;
  score: number;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  researched: "text-blue-400 border-blue-400/30",
  contacted:  "text-yellow-400 border-yellow-400/30",
  replied:    "text-purple-400 border-purple-400/30",
  qualified:  "text-green-400 border-green-400/30",
  closed:     "text-muted-foreground border-border",
};

const STATUSES = ["researched", "contacted", "replied", "qualified", "closed"];

export default function LeadGenPage() {
  const { user } = useAuth() as any;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [researching, setResearching] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [company, setCompany] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [filter, setFilter] = useState("all");

  const fetchLeads = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase.from("mavis_leads").select("*").eq("user_id", user.id).order("score", { ascending: false }).order("created_at", { ascending: false });
    setLeads((data as Lead[]) ?? []);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  async function research() {
    if (!company.trim()) { toast.error("Company name required"); return; }
    setResearching(true);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-lead-gen", {
        body: { company: company.trim(), target_role: targetRole.trim() || undefined, action: "research" },
      });
      if (error || data?.error) throw new Error(data?.error ?? error?.message);
      toast.success(`Lead researched: ${data.company_name}`);
      setCompany(""); setTargetRole("");
      await fetchLeads();
    } catch (e: any) { toast.error(e.message); } finally { setResearching(false); }
  }

  async function draftOutreach(leadId: string) {
    setDraftingId(leadId);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-lead-gen", {
        body: { action: "draft_outreach", lead_id: leadId, product_context: "SkyforgeAI — AI revenue automation for SMBs" },
      });
      if (error || data?.error) throw new Error(data?.error ?? error?.message);
      toast.success("Outreach drafted");
      await fetchLeads();
    } catch (e: any) { toast.error(e.message); } finally { setDraftingId(null); }
  }

  async function updateStatus(leadId: string, status: string) {
    await supabase.from("mavis_leads").update({ status, updated_at: new Date().toISOString() }).eq("id", leadId).eq("user_id", user.id);
    await fetchLeads();
  }

  const filtered = filter === "all" ? leads : leads.filter(l => l.status === filter);

  return (
    <div className="space-y-6">
      <PageHeader title="Lead Generation" subtitle="MAVIS researches prospects and drafts personalized outreach for SkyforgeAI." icon={<Users size={20} />} />

      <HudCard className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-primary uppercase tracking-widest">Research New Lead</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Company Name</label>
            <input className="w-full bg-background border border-border rounded px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              placeholder="Acme Corp" value={company} onChange={e => setCompany(e.target.value)}
              onKeyDown={e => e.key === "Enter" && research()} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Target Role (optional)</label>
            <input className="w-full bg-background border border-border rounded px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              placeholder="CEO, Founder, Head of Marketing…" value={targetRole} onChange={e => setTargetRole(e.target.value)} />
          </div>
        </div>
        <button onClick={research} disabled={researching}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {researching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {researching ? "Researching…" : "Research Lead"}
        </button>
      </HudCard>

      <HudCard className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-primary uppercase tracking-widest">Pipeline ({leads.length})</h3>
          <div className="flex gap-1">
            {["all", ...STATUSES].map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={`text-xs px-2 py-1 rounded border transition-colors capitalize ${filter === s ? "bg-primary/10 text-primary border-primary/40" : "text-muted-foreground border-border hover:border-primary/30"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {loading ? <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
          : filtered.length === 0 ? <p className="text-muted-foreground text-sm text-center py-8">No leads yet. Research a company above.</p>
          : <div className="space-y-2">
            {filtered.map(lead => {
              const isExpanded = expanded === lead.id;
              return (
                <div key={lead.id} className="border border-border rounded overflow-hidden">
                  <button onClick={() => setExpanded(isExpanded ? null : lead.id)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-muted/20 transition-colors text-left">
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} size={10} className={i < Math.round(lead.score / 2) ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground"} />
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{lead.company_name}</span>
                        <span className={`text-xs border rounded px-1.5 py-0.5 ${STATUS_COLORS[lead.status] ?? ""}`}>{lead.status}</span>
                        {lead.industry && <span className="text-xs text-muted-foreground">{lead.industry}</span>}
                      </div>
                      {lead.contact_name && <p className="text-xs text-muted-foreground mt-0.5">{lead.contact_name}{lead.contact_title ? ` · ${lead.contact_title}` : ""}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{new Date(lead.created_at).toLocaleDateString()}</span>
                      {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border bg-muted/10 p-4 space-y-4">
                      {lead.research_summary && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Research Summary</p>
                          <p className="text-sm">{lead.research_summary}</p>
                        </div>
                      )}

                      {lead.outreach_draft ? (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Outreach Draft</p>
                          <div className="bg-background border border-border rounded p-3">
                            <pre className="text-xs whitespace-pre-wrap font-sans">{lead.outreach_draft}</pre>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => draftOutreach(lead.id)} disabled={draftingId === lead.id}
                          className="flex items-center gap-2 border border-border rounded px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                          {draftingId === lead.id ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                          {draftingId === lead.id ? "Drafting…" : "Draft Outreach"}
                        </button>
                      )}

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Move to:</span>
                        {STATUSES.filter(s => s !== lead.status).map(s => (
                          <button key={s} onClick={() => updateStatus(lead.id, s)}
                            className="text-xs border border-border rounded px-2 py-0.5 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors capitalize">
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>}
      </HudCard>
    </div>
  );
}
