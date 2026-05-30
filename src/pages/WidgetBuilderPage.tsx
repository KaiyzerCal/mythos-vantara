// ============================================================
// VANTARA.EXE — WidgetBuilderPage
// MAVIS widget service — embeddable AI micro-apps
// ============================================================
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MessageSquare, FileText, Calculator, HelpCircle, TrendingUp,
  Calendar, Plus, Copy, Check, ExternalLink, Loader2,
  Zap, Globe, Code2, BarChart3, Users, DollarSign, ChevronRight,
  Sparkles, Package,
} from "lucide-react";
import { toast } from "sonner";

// ─── Widget Type Definitions ──────────────────────────────────
const WIDGET_TYPES = [
  { id: "chat",               icon: MessageSquare, label: "AI Chat Assistant",   desc: "Floating chat bubble with MAVIS AI",          color: "text-blue-400",    monthly: 97  },
  { id: "lead_capture",       icon: FileText,      label: "Smart Lead Capture",  desc: "AI-powered form with instant response",       color: "text-green-400",   monthly: 49  },
  { id: "quote_calculator",   icon: Calculator,    label: "Quote Calculator",    desc: "Multi-step wizard with AI quotes",            color: "text-amber-400",   monthly: 79  },
  { id: "faq",                icon: HelpCircle,    label: "FAQ + AI Fallback",   desc: "Searchable FAQ with AI Q&A",                  color: "text-violet-400",  monthly: 49  },
  { id: "roi_calculator",     icon: TrendingUp,    label: "ROI Calculator",      desc: "Business value calculator with AI analysis",  color: "text-emerald-400", monthly: 79  },
  { id: "appointment_booker", icon: Calendar,      label: "Appointment Booker",  desc: "Service booking with AI confirmation",        color: "text-rose-400",    monthly: 97  },
];

// ─── Status helpers ───────────────────────────────────────────
const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active:  { label: "Active",  className: "bg-green-500/20 text-green-400 border-green-500/30" },
  paused:  { label: "Paused",  className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  trial:   { label: "Trial",   className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
};

// ─── Types ────────────────────────────────────────────────────
type View = "gallery" | "builder" | "detail";
type DetailTab = "embed" | "leads" | "analytics";

interface WidgetInstance {
  id: string;
  widget_type: string;
  status?: string;
  config?: Record<string, any>;
  total_leads?: number;
  total_conversations?: number;
  total_requests?: number;
  monthly_price_cents?: number;
  public_url?: string;
  embed_code?: string;
  created_at?: string;
  [key: string]: any;
}

interface WidgetLead {
  id: string;
  name?: string;
  email?: string;
  lead_type?: string;
  status?: string;
  created_at?: string;
  [key: string]: any;
}

// ─── Main Component ───────────────────────────────────────────
export default function WidgetBuilderPage() {
  const { user } = useAuth();

  const [view, setView] = useState<View>("gallery");
  const [widgets, setWidgets] = useState<WidgetInstance[]>([]);
  const [selectedWidget, setSelectedWidget] = useState<WidgetInstance | null>(null);
  const [leads, setLeads] = useState<WidgetLead[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("embed");

  // Builder form
  const [selectedType, setSelectedType] = useState("chat");
  const [form, setForm] = useState({
    business_name: "",
    primary_color: "#1a56db",
    position: "bottom-right",
    name: "AI Assistant",
    greeting: "Hi! How can I help you today?",
    placeholder: "Type a message...",
    system_prompt: "",
    project_id: "",
    monthly_price_cents: 9700,
    // Lead capture
    form_title: "Get In Touch",
    success_message: "Thanks! We'll get back to you shortly.",
    ai_response_enabled: true,
    // FAQ
    faqs_text: "",
    // Quote / ROI
    service_name: "",
    price_range_context: "",
    roi_context: "",
    // Appointment booker
    service_options: "",
    calendly_url: "",
  });

  useEffect(() => { loadWidgets(); }, [user]);
  useEffect(() => {
    if (selectedWidget?.id) loadLeads(selectedWidget.id);
  }, [selectedWidget]);

  // ─── Helpers ─────────────────────────────────────────────────
  const copyToClipboard = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    toast.success("Copied to clipboard");
  };

  const pf = (cents?: number) =>
    cents != null ? `$${(cents / 100).toFixed(2)}` : "$0.00";

  // ─── Data fetching ────────────────────────────────────────────
  const loadWidgets = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data } = await (supabase as any)
        .from("widget_instances")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setWidgets(data ?? []);
    } finally {
      setIsLoading(false);
    }
  };

  const loadLeads = async (widgetId: string) => {
    const { data } = await (supabase as any)
      .from("widget_leads")
      .select("*")
      .eq("widget_id", widgetId)
      .order("created_at", { ascending: false })
      .limit(20);
    setLeads(data ?? []);
  };

  // ─── Generate Widget ──────────────────────────────────────────
  const generateWidget = async () => {
    if (!user || !form.business_name) {
      toast.error("Business name is required");
      return;
    }
    setIsGenerating(true);
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();

      // Parse FAQs if faq type
      let faqs: { question: string; answer: string }[] | undefined;
      if (selectedType === "faq" && form.faqs_text) {
        const pairs = form.faqs_text.split(/\n(?=Q:)/i);
        faqs = pairs
          .map((p) => {
            const [q, ...a] = p.split(/\nA:/i);
            return { question: q.replace(/^Q:/i, "").trim(), answer: a.join("").trim() };
          })
          .filter((f) => f.question && f.answer);
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-widget-gen`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          action: "generate",
          widget_type: selectedType,
          config: { ...form, faqs },
          user_id: user.id,
          project_id: form.project_id || undefined,
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();

      toast.success(`${WIDGET_TYPES.find((t) => t.id === selectedType)?.label} widget created!`);
      await loadWidgets();

      // Switch to detail view of new widget
      const newWidget: WidgetInstance = {
        id: result.widget_id,
        widget_type: selectedType,
        config: form,
        ...result,
      };
      setSelectedWidget({ ...newWidget, embed: result.embed });
      setDetailTab("embed");
      setView("detail");
    } catch (err: any) {
      toast.error(err.message ?? "Widget generation failed");
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── WordPress Plugin Download ────────────────────────────────
  const downloadPlugin = async () => {
    if (!selectedWidget) return;
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-widget-plugin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          action: "generate_plugin",
          widget_id: selectedWidget.id,
          widget_type: selectedWidget.widget_type,
          business_name: selectedWidget.config?.business_name,
          public_url: selectedWidget.public_url,
        }),
      });
      const data = await res.json();
      const blob = new Blob([data.plugin_php], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Plugin downloaded!");
    } catch (err: any) {
      toast.error(err.message ?? "Plugin download failed");
    }
  };

  const updateLeadStatus = async (leadId: string, status: string) => {
    await (supabase as any)
      .from("widget_leads")
      .update({ status })
      .eq("id", leadId);
    if (selectedWidget?.id) loadLeads(selectedWidget.id);
    toast.success(`Lead marked as ${status}`);
  };

  // ─── Revenue summary ──────────────────────────────────────────
  const activeWidgets = widgets.filter((w) => w.status === "active");
  const mrr = activeWidgets.reduce((sum, w) => sum + (w.monthly_price_cents ?? 0), 0) / 100;
  const totalLeads = widgets.reduce((sum, w) => sum + (w.total_leads ?? 0), 0);

  // ─── Render helpers ───────────────────────────────────────────
  const typeInfo = (id: string) => WIDGET_TYPES.find((t) => t.id === id);

  const embedScriptUrl = (w: WidgetInstance) =>
    w.public_url ?? `https://widgets.mavis.ai/w/${w.id}.js`;

  const embedSnippets = (w: WidgetInstance) => ({
    script: `<script src="${embedScriptUrl(w)}" defer></script>`,
    divScript: `<div id="mavis-widget-${w.id}"></div>\n<script src="${embedScriptUrl(w)}" defer></script>`,
    shortcode: `[mavis_widget id="${w.id}"]`,
  });

  // ─── Gallery View ─────────────────────────────────────────────
  const renderGallery = () => (
    <div className="space-y-6">
      {/* Revenue summary bar */}
      {activeWidgets.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {activeWidgets.length} active widget{activeWidgets.length !== 1 ? "s" : ""}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">${mrr.toFixed(2)}/mo recurring</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{totalLeads} total leads captured</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      ) : widgets.length === 0 ? (
        /* Empty state — type selection grid */
        <div className="space-y-4">
          <div className="text-center py-6">
            <Package className="mx-auto mb-3 text-muted-foreground" size={40} />
            <h2 className="text-lg font-semibold mb-1">Create Your First Widget</h2>
            <p className="text-sm text-muted-foreground">Choose a widget type to get started</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {WIDGET_TYPES.map((wt) => {
              const Icon = wt.icon;
              return (
                <Card
                  key={wt.id}
                  className="cursor-pointer border border-border/50 hover:border-primary/50 transition-all hover:shadow-md hover:shadow-primary/10 group"
                  onClick={() => { setSelectedType(wt.id); setView("builder"); }}
                >
                  <CardContent className="p-5 flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <div className={`p-2 rounded-lg bg-background border border-border/50 ${wt.color}`}>
                        <Icon size={22} />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">${wt.monthly}/mo</span>
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{wt.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{wt.desc}</p>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                      <span>Get started</span>
                      <ChevronRight size={12} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        /* Widget cards grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {widgets.map((w) => {
            const wt = typeInfo(w.widget_type);
            const Icon = wt?.icon ?? Package;
            const status = w.status ?? "active";
            const badge = STATUS_BADGE[status] ?? STATUS_BADGE.active;
            return (
              <Card key={w.id} className="border border-border/50 hover:border-primary/30 transition-all">
                <CardContent className="p-5 flex flex-col gap-4">
                  <div className="flex items-start justify-between">
                    <div className={`p-2 rounded-lg bg-background border border-border/50 ${wt?.color ?? "text-primary"}`}>
                      <Icon size={22} />
                    </div>
                    <Badge className={`text-xs border ${badge.className}`}>{badge.label}</Badge>
                  </div>

                  <div>
                    <p className="font-semibold text-sm">{wt?.label ?? w.widget_type}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {w.config?.business_name ?? "Unnamed business"}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-muted/30 rounded p-2">
                      <p className="text-muted-foreground">Leads</p>
                      <p className="font-semibold text-base">{w.total_leads ?? 0}</p>
                    </div>
                    <div className="bg-muted/30 rounded p-2">
                      <p className="text-muted-foreground">Chats</p>
                      <p className="font-semibold text-base">{w.total_conversations ?? 0}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground font-mono">
                      {pf(w.monthly_price_cents)}/mo
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => {
                        setSelectedWidget(w);
                        setDetailTab("embed");
                        setView("detail");
                      }}
                    >
                      View Details <ChevronRight size={12} />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );

  // ─── Builder View ─────────────────────────────────────────────
  const renderBuilder = () => {
    const activeType = WIDGET_TYPES.find((t) => t.id === selectedType);
    const ActiveIcon = activeType?.icon ?? Package;

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Step 1 — Choose Type */}
          <Card className="border border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
                Choose Widget Type
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {WIDGET_TYPES.map((wt) => {
                  const Icon = wt.icon;
                  const isSelected = selectedType === wt.id;
                  return (
                    <button
                      key={wt.id}
                      onClick={() => setSelectedType(wt.id)}
                      className={`flex flex-col items-start gap-1.5 p-3 rounded-lg border text-left transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-border/50 hover:border-primary/40 bg-muted/20"
                      }`}
                    >
                      <Icon size={18} className={wt.color} />
                      <span className="text-xs font-medium leading-tight">{wt.label}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">${wt.monthly}/mo</span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Step 2 — Configure */}
          <Card className="border border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold">2</span>
                Configure Widget
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Shared fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Business Name *</label>
                  <Input
                    value={form.business_name}
                    onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                    placeholder="Acme Corp"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Monthly Price (client)</label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">$</span>
                    <Input
                      type="number"
                      value={form.monthly_price_cents / 100}
                      onChange={(e) =>
                        setForm({ ...form, monthly_price_cents: Math.round(parseFloat(e.target.value || "0") * 100) })
                      }
                      placeholder="97"
                    />
                    <span className="text-xs text-muted-foreground">/mo</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Primary Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.primary_color}
                    onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                    className="h-9 w-12 rounded cursor-pointer border border-border/50 bg-transparent p-0.5"
                  />
                  <Input
                    value={form.primary_color}
                    onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                    placeholder="#1a56db"
                    className="font-mono"
                  />
                </div>
              </div>

              {/* Type-specific fields */}
              {selectedType === "chat" && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Assistant Name</label>
                      <Input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="AI Assistant"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Position</label>
                      <Select
                        value={form.position}
                        onValueChange={(v) => setForm({ ...form, position: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bottom-right">Bottom Right</SelectItem>
                          <SelectItem value="bottom-left">Bottom Left</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Greeting Message</label>
                    <Input
                      value={form.greeting}
                      onChange={(e) => setForm({ ...form, greeting: e.target.value })}
                      placeholder="Hi! How can I help you today?"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Input Placeholder</label>
                    <Input
                      value={form.placeholder}
                      onChange={(e) => setForm({ ...form, placeholder: e.target.value })}
                      placeholder="Type a message..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">AI Context / System Prompt</label>
                    <Textarea
                      value={form.system_prompt}
                      onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
                      placeholder="What should the AI know about your business? e.g. services, pricing, policies"
                      rows={4}
                    />
                  </div>
                </>
              )}

              {selectedType === "lead_capture" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Form Title</label>
                    <Input
                      value={form.form_title}
                      onChange={(e) => setForm({ ...form, form_title: e.target.value })}
                      placeholder="Get In Touch"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Success Message</label>
                    <Input
                      value={form.success_message}
                      onChange={(e) => setForm({ ...form, success_message: e.target.value })}
                      placeholder="Thanks! We'll get back to you shortly."
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, ai_response_enabled: !form.ai_response_enabled })}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                        form.ai_response_enabled ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                          form.ai_response_enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                    <label className="text-xs font-medium text-muted-foreground">AI Response Enabled</label>
                  </div>
                </>
              )}

              {selectedType === "faq" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">FAQ Pairs</label>
                  <p className="text-[10px] text-muted-foreground">
                    Format: Q: Question\nA: Answer\n\nQ: Next question\nA: Next answer
                  </p>
                  <Textarea
                    value={form.faqs_text}
                    onChange={(e) => setForm({ ...form, faqs_text: e.target.value })}
                    placeholder={"Q: What are your hours?\nA: We're open 9–5 Monday through Friday.\n\nQ: Do you offer refunds?\nA: Yes, within 30 days of purchase."}
                    rows={8}
                    className="font-mono text-xs"
                  />
                </div>
              )}

              {selectedType === "quote_calculator" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Service Name</label>
                    <Input
                      value={form.service_name}
                      onChange={(e) => setForm({ ...form, service_name: e.target.value })}
                      placeholder="Web Design, Landscaping, Legal Consultation..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Price Range Context</label>
                    <Textarea
                      value={form.price_range_context}
                      onChange={(e) => setForm({ ...form, price_range_context: e.target.value })}
                      placeholder="Describe your typical pricing tiers so the AI can give accurate estimates..."
                      rows={4}
                    />
                  </div>
                </>
              )}

              {selectedType === "roi_calculator" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">ROI Context</label>
                  <Textarea
                    value={form.roi_context}
                    onChange={(e) => setForm({ ...form, roi_context: e.target.value })}
                    placeholder="What metric does this calculator measure? e.g. 'Calculates annual savings from switching to solar panels based on monthly electricity bill and location...'"
                    rows={4}
                  />
                </div>
              )}

              {selectedType === "appointment_booker" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Service Options (comma-separated)</label>
                    <Input
                      value={form.service_options}
                      onChange={(e) => setForm({ ...form, service_options: e.target.value })}
                      placeholder="Consultation, Full Service, Follow-up"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Calendly URL (optional)</label>
                    <Input
                      value={form.calendly_url}
                      onChange={(e) => setForm({ ...form, calendly_url: e.target.value })}
                      placeholder="https://calendly.com/yourname"
                    />
                  </div>
                </>
              )}

              {/* Generate button */}
              <Button
                className="w-full gap-2 mt-2"
                size="lg"
                onClick={generateWidget}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Generating Widget...
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    Generate Widget
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right — Live Preview Panel */}
        <div className="space-y-4">
          <Card className="border border-border/50 sticky top-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Globe size={14} />
                Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mock widget visual */}
              <div className="relative rounded-xl bg-muted/30 border border-border/50 h-44 flex items-end justify-end p-3 overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center opacity-20">
                  <Globe size={80} />
                </div>
                {/* Mock bubble / widget preview */}
                {selectedType === "chat" || selectedType === "appointment_booker" ? (
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg text-white"
                    style={{ backgroundColor: form.primary_color }}
                  >
                    <ActiveIcon size={22} />
                  </div>
                ) : (
                  <div
                    className="rounded-lg px-4 py-2 text-white text-xs font-semibold shadow-lg"
                    style={{ backgroundColor: form.primary_color }}
                  >
                    {activeType?.label}
                  </div>
                )}
              </div>

              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <ActiveIcon size={12} className={activeType?.color ?? "text-primary"} />
                  <span className="font-medium text-foreground">{activeType?.label}</span>
                </div>
                <p>{activeType?.desc}</p>

                <div className="pt-2 border-t border-border/30 space-y-1">
                  <div className="flex items-center justify-between">
                    <span>Est. conversion lift</span>
                    <span className="text-emerald-400 font-semibold">
                      {selectedType === "chat" ? "+23%" :
                       selectedType === "lead_capture" ? "+18%" :
                       selectedType === "quote_calculator" ? "+31%" :
                       selectedType === "roi_calculator" ? "+27%" :
                       selectedType === "appointment_booker" ? "+35%" :
                       "+15%"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Monthly price</span>
                    <span className="font-semibold text-foreground">
                      {pf(form.monthly_price_cents)}/mo
                    </span>
                  </div>
                  {form.business_name && (
                    <div className="flex items-center justify-between">
                      <span>Business</span>
                      <span className="font-semibold text-foreground truncate max-w-[100px]">
                        {form.business_name}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  // ─── Detail View ──────────────────────────────────────────────
  const renderDetail = () => {
    if (!selectedWidget) return null;
    const wt = typeInfo(selectedWidget.widget_type);
    const Icon = wt?.icon ?? Package;
    const status = selectedWidget.status ?? "active";
    const badge = STATUS_BADGE[status] ?? STATUS_BADGE.active;
    const snip = embedSnippets(selectedWidget);

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-muted border border-border/50 ${wt?.color ?? "text-primary"}`}>
              <Icon size={20} />
            </div>
            <div>
              <h2 className="font-semibold">
                {wt?.label ?? selectedWidget.widget_type}
              </h2>
              <p className="text-xs text-muted-foreground">
                {selectedWidget.config?.business_name ?? "Unnamed business"}
              </p>
            </div>
            <Badge className={`text-xs border ${badge.className}`}>{badge.label}</Badge>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border/50">
          {(["embed", "leads", "analytics"] as DetailTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              className={`px-4 py-2 text-sm capitalize transition-colors border-b-2 -mb-px ${
                detailTab === tab
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {detailTab === "embed" && renderEmbedTab(snip)}
        {detailTab === "leads" && renderLeadsTab()}
        {detailTab === "analytics" && renderAnalyticsTab()}
      </div>
    );
  };

  const EmbedBlock = ({
    label,
    code,
    copyKey,
  }: {
    label: string;
    code: string;
    copyKey: string;
  }) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs gap-1"
          onClick={() => copyToClipboard(code, copyKey)}
        >
          {copiedKey === copyKey ? <Check size={12} /> : <Copy size={12} />}
          {copiedKey === copyKey ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="bg-muted/40 border border-border/50 rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
        {code}
      </pre>
    </div>
  );

  const renderEmbedTab = (snip: ReturnType<typeof embedSnippets>) => (
    <div className="space-y-5">
      <EmbedBlock label="Script Tag (simplest)" code={snip.script} copyKey="script" />
      <EmbedBlock label="Div + Script (non-floating)" code={snip.divScript} copyKey="div-script" />
      <EmbedBlock label="WordPress Shortcode" code={snip.shortcode} copyKey="shortcode" />

      {/* WordPress Plugin download */}
      <Card className="border border-border/50">
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">WordPress Plugin</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Auto-generated PHP plugin — install via Plugins → Add New → Upload
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={downloadPlugin}>
            <Code2 size={14} />
            Download Plugin
          </Button>
        </CardContent>
      </Card>

      {/* Installation instructions */}
      <Card className="border border-border/50 bg-muted/20">
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">Installation Instructions</p>
          <ol className="space-y-2 text-xs text-muted-foreground list-decimal list-inside">
            <li>Copy the Script Tag embed code above.</li>
            <li>Open your website's HTML editor or CMS.</li>
            <li>Paste the script before the closing <code className="bg-muted px-1 py-0.5 rounded">&lt;/body&gt;</code> tag.</li>
            <li>Save and publish your page — the widget will appear automatically.</li>
            <li>For WordPress: use the Shortcode or download and install the plugin above.</li>
            <li>Need help? The widget self-initializes — no extra configuration required.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );

  const renderLeadsTab = () => (
    <div className="space-y-4">
      {leads.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users size={36} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No leads captured yet</p>
          <p className="text-xs mt-1">Leads will appear here once visitors interact with your widget</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-xs text-muted-foreground">
                <th className="text-left py-2 pr-4 font-medium">Name</th>
                <th className="text-left py-2 pr-4 font-medium">Email</th>
                <th className="text-left py-2 pr-4 font-medium">Type</th>
                <th className="text-left py-2 pr-4 font-medium">Date</th>
                <th className="text-left py-2 pr-4 font-medium">Status</th>
                <th className="text-left py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-muted/20 transition-colors">
                  <td className="py-2.5 pr-4 font-medium">{lead.name ?? "—"}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{lead.email ?? "—"}</td>
                  <td className="py-2.5 pr-4">
                    <Badge variant="outline" className="text-xs">
                      {lead.lead_type ?? "contact"}
                    </Badge>
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground text-xs">
                    {lead.created_at ? new Date(lead.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-2.5 pr-4">
                    <Badge
                      className={`text-xs ${
                        lead.status === "converted"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : lead.status === "contacted"
                          ? "bg-blue-500/20 text-blue-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {lead.status ?? "new"}
                    </Badge>
                  </td>
                  <td className="py-2.5">
                    <div className="flex gap-1.5">
                      {lead.status !== "contacted" && lead.status !== "converted" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => updateLeadStatus(lead.id, "contacted")}
                        >
                          Contacted
                        </Button>
                      )}
                      {lead.status !== "converted" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px] text-emerald-400 border-emerald-500/30"
                          onClick={() => updateLeadStatus(lead.id, "converted")}
                        >
                          Converted
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderAnalyticsTab = () => {
    const w = selectedWidget!;
    const totalReqs = w.total_requests ?? 0;
    const totalLeadsW = w.total_leads ?? 0;
    const totalConvos = w.total_conversations ?? 0;
    const revenue = (w.monthly_price_cents ?? 0) / 100;

    const stats = [
      { label: "Total Requests",      value: totalReqs,                    icon: Zap,        color: "text-amber-400" },
      { label: "Total Leads",         value: totalLeadsW,                  icon: Users,      color: "text-green-400" },
      { label: "Total Conversations", value: totalConvos,                  icon: MessageSquare, color: "text-blue-400" },
      { label: "Monthly Revenue",     value: `$${revenue.toFixed(2)}`,     icon: DollarSign, color: "text-emerald-400" },
    ];

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {stats.map((s) => {
            const StatIcon = s.icon;
            return (
              <Card key={s.label} className="border border-border/50">
                <CardContent className="p-4">
                  <div className={`mb-2 ${s.color}`}>
                    <StatIcon size={18} />
                  </div>
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Bar chart placeholder */}
        <Card className="border border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 size={14} />
              Activity Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-32 flex items-center justify-center bg-muted/20 rounded-lg border border-border/30">
              <div className="text-center text-muted-foreground">
                <BarChart3 size={28} className="mx-auto mb-2 opacity-40" />
                <p className="text-xs">Analytics coming soon — real-time data available via API</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // ─── Page shell ───────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="text-primary" size={24} />
            AI Widget Studio
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate embeddable AI micro-apps for any website — chat, leads, quotes, bookings
          </p>
        </div>
        <div className="flex gap-2">
          {view !== "gallery" && (
            <Button variant="outline" onClick={() => setView("gallery")}>
              ← All Widgets
            </Button>
          )}
          <Button onClick={() => setView("builder")} className="gap-2">
            <Plus size={16} />
            New Widget
          </Button>
        </div>
      </div>

      {view === "gallery" && renderGallery()}
      {view === "builder" && renderBuilder()}
      {view === "detail" && renderDetail()}
    </div>
  );
}
