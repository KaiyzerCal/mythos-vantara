// AgentBuilderSection — AI Agent product builder embedded in WidgetBuilderPage
// Creates/manages customer AI agents (Claude-powered, premium tier)
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Plus, Copy, Check, ChevronRight, Loader2, ExternalLink,
  MessageSquare, Trash2, Edit3, Zap, Users, DollarSign,
  Code2, Globe, Package2, ArrowLeft, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────
const CAPABILITY_OPTIONS = [
  { id: "faq",           label: "FAQ & Q&A",        desc: "Answer questions about the business" },
  { id: "lead_capture",  label: "Lead Capture",      desc: "Collect names, emails, and inquiries" },
  { id: "booking",       label: "Booking / Appointments", desc: "Help customers book services" },
  { id: "product_info",  label: "Product Info",      desc: "Explain products, services, and pricing" },
  { id: "support",       label: "Customer Support",  desc: "Handle complaints and support requests" },
  { id: "sales",         label: "Sales Assistant",   desc: "Guide customers toward a purchase" },
];

const TONE_OPTIONS = [
  { id: "friendly",      label: "Friendly",     desc: "Warm, casual, approachable" },
  { id: "professional",  label: "Professional",  desc: "Formal, polished, business-like" },
  { id: "casual",        label: "Casual",        desc: "Relaxed, conversational" },
  { id: "formal",        label: "Formal",        desc: "Structured, authoritative" },
];

const PLAN_TIERS = [
  { id: "widget",  label: "Embed Widget",   price: 197,  desc: "Floating chat on their site" },
  { id: "hosted",  label: "Hosted Page",    price: 297,  desc: "Dedicated agent URL" },
  { id: "custom",  label: "Custom System",  price: 497,  desc: "Full branded deployment" },
];

const BUSINESS_TYPES = [
  "Salon / Spa", "Restaurant / Café", "Law Firm", "Medical Practice",
  "Real Estate", "E-commerce", "Fitness / Gym", "Consulting",
  "Agency / Marketing", "Tech / SaaS", "Retail", "Education",
  "Construction / Trades", "Financial Services", "Non-profit", "Other",
];

type AgentView = "gallery" | "builder" | "detail";

interface CustomerAgent {
  id:                   string;
  customer_name:        string;
  business_name:        string;
  agent_name:           string;
  brand_color:          string;
  plan_tier:            string;
  status:               string;
  monthly_price_cents:  number;
  total_conversations:  number;
  total_messages:       number;
  embed_token:          string;
  created_at:           string;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AgentBuilderSection() {
  const { user } = useAuth();
  const SUPABASE_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;

  const [agentView,      setAgentView]      = useState<AgentView>("gallery");
  const [agents,         setAgents]         = useState<CustomerAgent[]>([]);
  const [selectedAgent,  setSelectedAgent]  = useState<CustomerAgent & { embed_snippets?: any; agent_persona?: string } | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [generating,     setGenerating]     = useState(false);
  const [copiedKey,      setCopiedKey]      = useState<string | null>(null);
  const [embedTab,       setEmbedTab]       = useState<"script" | "iframe" | "api">("script");

  const [form, setForm] = useState({
    customer_name:        "",
    customer_email:       "",
    business_name:        "",
    business_type:        "",
    agent_name:           "AI Assistant",
    capabilities:         [] as string[],
    knowledge_base:       "",
    tone:                 "friendly",
    brand_color:          "#1a56db",
    plan_tier:            "widget",
    monthly_price_cents:  19700,
  });

  // ── Load agents ─────────────────────────────────────────────────────────────
  const loadAgents = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-agent-builder`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body:    JSON.stringify({ action: "list" }),
      });
      const data = await res.json();
      setAgents(data.agents ?? []);
    } finally {
      setLoading(false);
    }
  }, [user, SUPABASE_URL]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  // ── Copy helper ──────────────────────────────────────────────────────────────
  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    toast.success("Copied!");
  };

  // ── Toggle capability ────────────────────────────────────────────────────────
  const toggleCap = (id: string) => {
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(id)
        ? f.capabilities.filter((c) => c !== id)
        : [...f.capabilities, id],
    }));
  };

  // ── Generate agent ────────────────────────────────────────────────────────────
  const generateAgent = async () => {
    if (!form.business_name.trim()) { toast.error("Business name is required"); return; }
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-agent-builder`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body:    JSON.stringify({ action: "create", ...form }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success("AI Agent created!");
      await loadAgents();
      setSelectedAgent({ ...data.agent, embed_snippets: data.embed_snippets, agent_persona: data.agent_persona });
      setAgentView("detail");
    } catch (err: any) {
      toast.error(err.message ?? "Agent creation failed");
    } finally {
      setGenerating(false);
    }
  };

  // ── Delete agent ──────────────────────────────────────────────────────────────
  const deleteAgent = async (agentId: string) => {
    if (!confirm("Delete this agent? This cannot be undone.")) return;
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`${SUPABASE_URL}/functions/v1/mavis-agent-builder`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body:    JSON.stringify({ action: "delete", agent_id: agentId }),
    });
    toast.success("Agent deleted");
    await loadAgents();
    if (agentView === "detail") setAgentView("gallery");
  };

  // ── MRR ──────────────────────────────────────────────────────────────────────
  const activeMrr = agents
    .filter((a) => a.status === "active")
    .reduce((sum, a) => sum + (a.monthly_price_cents ?? 0), 0) / 100;

  // ── Gallery ───────────────────────────────────────────────────────────────────
  const renderGallery = () => (
    <div className="space-y-5">
      {agents.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
            {agents.length} AI agent{agents.length !== 1 ? "s" : ""} deployed
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">${activeMrr.toFixed(2)}/mo recurring</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
            <Bot size={28} className="text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">No AI Agents Yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Build your first customer AI agent and get an embed code to deploy anywhere.</p>
          </div>
          <Button onClick={() => setAgentView("builder")} className="gap-2">
            <Plus size={14} /> Build First Agent
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((a) => (
            <Card key={a.id} className="border border-border/50 hover:border-primary/30 transition-all group">
              <CardContent className="p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold border"
                    style={{ backgroundColor: (a.brand_color ?? "#1a56db") + "22", color: a.brand_color ?? "#1a56db", borderColor: (a.brand_color ?? "#1a56db") + "44" }}
                  >
                    {a.agent_name?.slice(0, 2).toUpperCase() ?? "AI"}
                  </div>
                  <Badge className={a.status === "active"
                    ? "bg-green-500/20 text-green-400 border-green-500/30"
                    : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                  }>
                    {a.status}
                  </Badge>
                </div>

                <div>
                  <p className="font-semibold text-sm">{a.agent_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{a.business_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">For: {a.customer_name || "—"}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-muted-foreground">Conversations</p>
                    <p className="font-semibold text-base">{a.total_conversations ?? 0}</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-muted-foreground">Revenue</p>
                    <p className="font-semibold text-base">${((a.monthly_price_cents ?? 0) / 100).toFixed(0)}/mo</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-7 text-xs gap-1"
                    onClick={() => {
                      setSelectedAgent(a);
                      setAgentView("detail");
                    }}
                  >
                    View <ChevronRight size={11} />
                  </Button>
                  <button
                    onClick={() => deleteAgent(a.id)}
                    className="w-7 h-7 rounded-md border border-border/50 flex items-center justify-center text-muted-foreground hover:text-red-400 hover:border-red-400/30 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  // ── Builder ────────────────────────────────────────────────────────────────
  const renderBuilder = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-5">
        {/* Customer info */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">1</span>
              Customer Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Customer Name</label>
                <Input placeholder="Jane Smith" value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Customer Email</label>
                <Input type="email" placeholder="jane@business.com" value={form.customer_email} onChange={(e) => setForm((f) => ({ ...f, customer_email: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Business Name <span className="text-red-400">*</span></label>
                <Input placeholder="Bloom Salon & Spa" value={form.business_name} onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Business Type</label>
                <select
                  value={form.business_type}
                  onChange={(e) => setForm((f) => ({ ...f, business_type: e.target.value }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select type…</option>
                  {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Agent identity */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">2</span>
              Agent Identity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Agent Name</label>
                <Input placeholder="Aria" value={form.agent_name} onChange={(e) => setForm((f) => ({ ...f, agent_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Brand Color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={form.brand_color}
                    onChange={(e) => setForm((f) => ({ ...f, brand_color: e.target.value }))}
                    className="w-9 h-9 rounded-md border border-input cursor-pointer bg-background p-0.5"
                  />
                  <Input value={form.brand_color} onChange={(e) => setForm((f) => ({ ...f, brand_color: e.target.value }))} className="font-mono text-sm" />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Tone</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {TONE_OPTIONS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setForm((f) => ({ ...f, tone: t.id }))}
                    className={cn(
                      "flex flex-col gap-0.5 p-2.5 rounded-lg border text-left text-xs transition-all",
                      form.tone === t.id
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/50 hover:border-border text-muted-foreground"
                    )}
                  >
                    <span className="font-semibold">{t.label}</span>
                    <span className="text-xs opacity-70">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Capabilities */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">3</span>
              Capabilities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CAPABILITY_OPTIONS.map((cap) => {
                const isOn = form.capabilities.includes(cap.id);
                return (
                  <button
                    key={cap.id}
                    onClick={() => toggleCap(cap.id)}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border text-left transition-all",
                      isOn
                        ? "border-primary/50 bg-primary/8"
                        : "border-border/50 hover:border-border/80"
                    )}
                  >
                    <div className={cn("w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors", isOn ? "border-primary bg-primary" : "border-border")}>
                      {isOn && <span className="text-xs text-primary-foreground font-bold">✓</span>}
                    </div>
                    <div>
                      <p className="text-xs font-semibold">{cap.label}</p>
                      <p className="text-xs text-muted-foreground">{cap.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Knowledge base */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">4</span>
              Business Knowledge
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Add FAQs, services, pricing, hours, policies — anything the agent should know.</p>
            <Textarea
              rows={8}
              placeholder={"Services: Haircut $45, Color $120, Blowout $60\nHours: Mon-Sat 9am-7pm, Sun 10am-5pm\nLocation: 123 Main St, Atlanta GA\nBooking: Call (404) 555-0100 or book at bloomsalon.com\n\nFAQ:\nQ: Do you take walk-ins?\nA: Yes, but appointments are preferred.\n\nQ: What products do you use?\nA: We use Oribe and Redken exclusively."}
              value={form.knowledge_base}
              onChange={(e) => setForm((f) => ({ ...f, knowledge_base: e.target.value }))}
              className="font-mono text-xs"
            />
          </CardContent>
        </Card>
      </div>

      {/* Right panel — Plan + Generate */}
      <div className="space-y-5">
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Plan Tier</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {PLAN_TIERS.map((tier) => (
              <button
                key={tier.id}
                onClick={() => setForm((f) => ({ ...f, plan_tier: tier.id, monthly_price_cents: tier.price * 100 }))}
                className={cn(
                  "w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all",
                  form.plan_tier === tier.id
                    ? "border-primary/50 bg-primary/8"
                    : "border-border/50 hover:border-border/80"
                )}
              >
                <div className={cn("w-3.5 h-3.5 rounded-full border-2 mt-0.5 flex items-center justify-center shrink-0 transition-colors", form.plan_tier === tier.id ? "border-primary" : "border-border")}>
                  {form.plan_tier === tier.id && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-1">
                    <p className="text-xs font-semibold">{tier.label}</p>
                    <p className="text-xs font-mono text-primary shrink-0">${tier.price}/mo</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{tier.desc}</p>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Preview card */}
        <Card className="border border-border/50 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Agent Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-white/10 bg-[#0d1117] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-white/8 bg-[#060810]">
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold border"
                  style={{ backgroundColor: form.brand_color + "22", color: form.brand_color, borderColor: form.brand_color + "44" }}
                >
                  {form.agent_name.slice(0, 2).toUpperCase() || "AI"}
                </div>
                <span className="text-xs font-semibold text-white/80">{form.agent_name || "AI Assistant"}</span>
                <span className="ml-auto w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: form.brand_color }} />
              </div>
              <div className="px-3 py-3 space-y-2">
                <div className="bg-black/40 border border-white/5 rounded-xl rounded-tl-sm px-3 py-2 text-xs text-white/60">
                  Hi! I'm {form.agent_name || "your AI assistant"}{form.business_name ? ` for ${form.business_name}` : ""}. How can I help you today?
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button
          onClick={generateAgent}
          disabled={generating || !form.business_name.trim()}
          className="w-full gap-2"
          size="lg"
        >
          {generating
            ? <><Loader2 size={14} className="animate-spin" /> MAVIS is building your agent…</>
            : <><Bot size={14} /> Generate AI Agent</>
          }
        </Button>

        {generating && (
          <p className="text-xs text-center text-muted-foreground animate-pulse">
            MAVIS is crafting a custom persona and system prompt…
          </p>
        )}
      </div>
    </div>
  );

  // ── Detail ─────────────────────────────────────────────────────────────────
  const renderDetail = () => {
    if (!selectedAgent) return null;
    const loaderUrl = `${SUPABASE_URL}/functions/v1/prymal-widget-loader?token=${selectedAgent.embed_token}`;

    const snippets = selectedAgent.embed_snippets ?? {
      html_script: `<script src="${loaderUrl}" async></script>`,
      iframe:      `<iframe src="${SUPABASE_URL}/functions/v1/mavis-agent-serve/chat?token=${selectedAgent.embed_token}" width="100%" height="600" frameborder="0"></iframe>`,
      api_call:    `fetch("${SUPABASE_URL}/functions/v1/mavis-agent-serve", {\n  method: "POST",\n  headers: { "Content-Type": "application/json", "x-agent-token": "${selectedAgent.embed_token}" },\n  body: JSON.stringify({ message: "Hello", history: [], session_id: "user-123" })\n})`,
    };

    const EMBED_TABS = [
      { id: "script" as const, label: "HTML Script", icon: Code2, snippet: snippets.html_script },
      { id: "iframe" as const, label: "iFrame",      icon: Globe,  snippet: snippets.iframe      },
      { id: "api"    as const, label: "API Direct",  icon: Zap,    snippet: snippets.api_call    },
    ];

    return (
      <div className="space-y-5">
        {/* Agent header */}
        <Card className="border border-border/50">
          <CardContent className="p-5 flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold border shrink-0"
              style={{ backgroundColor: (selectedAgent.brand_color ?? "#1a56db") + "22", color: selectedAgent.brand_color ?? "#1a56db", borderColor: (selectedAgent.brand_color ?? "#1a56db") + "44" }}
            >
              {selectedAgent.agent_name?.slice(0, 2).toUpperCase() ?? "AI"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{selectedAgent.agent_name}</p>
              <p className="text-sm text-muted-foreground">{selectedAgent.business_name}</p>
              <p className="text-xs text-muted-foreground">Customer: {selectedAgent.customer_name || "—"}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">{selectedAgent.status ?? "active"}</Badge>
              <span className="text-sm font-mono text-primary">${((selectedAgent.monthly_price_cents ?? 0) / 100).toFixed(0)}/mo</span>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { label: "Conversations", value: selectedAgent.total_conversations ?? 0, icon: MessageSquare, color: "text-blue-400" },
            { label: "Messages",      value: selectedAgent.total_messages       ?? 0, icon: Zap,          color: "text-amber-400" },
            { label: "Monthly Rev.",  value: `$${((selectedAgent.monthly_price_cents ?? 0) / 100).toFixed(0)}`, icon: DollarSign, color: "text-emerald-400" },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className="border border-border/50">
                <CardContent className="p-4">
                  <div className={`mb-2 ${s.color}`}><Icon size={16} /></div>
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Embed code */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Code2 size={14} />
              Embed Code
            </CardTitle>
            <p className="text-xs text-muted-foreground">Give this to your customer to paste on their website</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              {EMBED_TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setEmbedTab(tab.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all",
                      embedTab === tab.id ? "bg-primary/10 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground border border-transparent"
                    )}
                  >
                    <Icon size={11} /> {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="relative rounded-lg bg-muted/30 border border-border/50">
              <pre className="p-3 text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                {EMBED_TABS.find((t) => t.id === embedTab)?.snippet}
              </pre>
              <button
                onClick={() => copy(EMBED_TABS.find((t) => t.id === embedTab)?.snippet ?? "", embedTab)}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-background border border-border/50 hover:bg-muted transition-colors"
              >
                {copiedKey === embedTab ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Generated persona */}
        {selectedAgent.agent_persona && (
          <Card className="border border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bot size={14} className="text-primary" />
                Generated Agent Persona
                <span className="text-xs font-normal text-muted-foreground ml-1">— created by MAVIS</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed bg-muted/30 rounded-lg p-3 border border-border/50 max-h-48 overflow-y-auto">
                {selectedAgent.agent_persona}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  // ── Shell ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {agentView !== "gallery" && (
            <Button variant="outline" size="sm" onClick={() => setAgentView("gallery")} className="gap-1">
              <ArrowLeft size={13} /> All Agents
            </Button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <Bot size={18} className="text-primary" />
              <h2 className="font-bold text-lg">
                {agentView === "gallery" ? "Customer AI Agents" : agentView === "builder" ? "Build AI Agent" : selectedAgent?.agent_name ?? "Agent Detail"}
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              {agentView === "gallery"
                ? "Claude-powered agents you build and sell to customers — embeddable on any website"
                : agentView === "builder"
                  ? "MAVIS generates a custom persona and system prompt from your brief"
                  : `${selectedAgent?.business_name} · ${PLAN_TIERS.find((t) => t.id === selectedAgent?.plan_tier)?.label ?? "Widget"}`
              }
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {agentView === "gallery" && (
            <>
              <Button variant="outline" size="sm" onClick={loadAgents} className="gap-1">
                <RefreshCw size={12} /> Refresh
              </Button>
              <Button onClick={() => setAgentView("builder")} className="gap-2">
                <Plus size={14} /> New Agent
              </Button>
            </>
          )}
        </div>
      </div>

      {agentView === "gallery" && renderGallery()}
      {agentView === "builder" && renderBuilder()}
      {agentView === "detail"  && renderDetail()}
    </div>
  );
}
