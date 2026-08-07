import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProfile } from "@/hooks/useProfile";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Play,
  Plus,
  Trash2,
  Bot,
  RefreshCw,
  Save,
  Zap,
  Users,
  Sparkles,
  MessageSquare,
  Mic,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";

// Types
interface CrewAgent {
  specialization: string;
  task: string;
  dependsOn?: number;
}

interface CrewProgressEvent {
  id: string;
  run_id: string;
  agent_name?: string;
  agent_id?: string;
  task?: string;
  event: "start" | "complete" | "error";
  payload?: any;
  created_at: string;
}

interface AgentRun {
  id: string;
  goal: string;
  process_type: "sequential" | "parallel" | "hierarchical";
  agents: CrewAgent[];
  status: string;
  result?: any;
  created_at: string;
  updated_at: string;
}

interface SavedTemplate {
  id: string;
  name: string;
  goal: string;
  process_type: "sequential" | "parallel" | "hierarchical";
  agents: CrewAgent[];
}

const SPECIALIZATIONS = [
  "researcher",
  "analyst",
  "writer",
  "coder",
  "planner",
  "reviewer",
  "creative",
  "data",
  "strategist",
  "support",
];

export default function AgentConsole() {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [activeTab, setActiveTab] = useState("run");
  const [goal, setGoal] = useState("");
  const [processType, setProcessType] = useState<"sequential" | "parallel" | "hierarchical">("parallel");
  const [agents, setAgents] = useState<CrewAgent[]>([
    { specialization: "researcher", task: "" },
    { specialization: "analyst", task: "" },
  ]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<CrewProgressEvent[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const progressSubscription = useRef<any>(null);

  const userId = profile?.id;

  // Fetch recent runs
  const fetchRuns = async () => {
    if (!userId) return;
    const { data, error } = await (supabase as any)
      .from("mavis_crew_runs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (!error && data) setRuns(data);
  };

  // Fetch templates
  const fetchTemplates = async () => {
    if (!userId) return;
    const { data, error } = await (supabase as any)
      .from("mavis_crew_templates")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (!error && data) setTemplates(data);
  };

  useEffect(() => {
    if (userId) {
      fetchRuns();
      fetchTemplates();
    }
  }, [userId]);

  const addAgent = () => {
    setAgents([...agents, { specialization: "researcher", task: "" }]);
  };

  const removeAgent = (index: number) => {
    if (agents.length <= 1) {
      toast({ title: "Need at least one agent", variant: "destructive" });
      return;
    }
    setAgents(agents.filter((_, i) => i !== index));
  };

  const updateAgent = (index: number, field: keyof CrewAgent, value: string | number | undefined) => {
    const next = [...agents];
    if (field === "dependsOn") {
      next[index].dependsOn = value === undefined ? undefined : Number(value);
    } else {
      next[index][field] = value as string;
    }
    setAgents(next);
  };

  const runCrew = async () => {
    if (!userId) {
      toast({ title: "Not signed in", variant: "destructive" });
      return;
    }
    const validAgents = agents.filter((a) => a.task.trim() && a.specialization);
    if (validAgents.length === 0) {
      toast({ title: "Add at least one agent with a task", variant: "destructive" });
      return;
    }
    if (!goal.trim()) {
      toast({ title: "Enter a goal for the crew", variant: "destructive" });
      return;
    }

    setLoading(true);
    setLiveEvents([]);
    setActiveRunId(null);

    try {
      // Generate run_id client-side and subscribe to progress before invoking orchestrator
      const runId = crypto.randomUUID();
      setActiveRunId(runId);

      // Subscribe to Supabase Realtime on mavis_crew_progress filtered by run_id
      progressSubscription.current?.unsubscribe?.();
      progressSubscription.current = (supabase as any)
        .channel(`crew-progress-${runId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "mavis_crew_progress",
            filter: `run_id=eq.${runId}`,
          },
          (payload: { new: CrewProgressEvent }) => {
            setLiveEvents((prev) => [...prev, payload.new]);
          }
        )
        .subscribe();

      const { data, error } = await (supabase as any).functions.invoke("mavis-crew-orchestrator", {
        body: {
          userId,
          runId,
          goal: goal.trim(),
          processType,
          agents: validAgents,
        },
      });

      if (error) {
        toast({ title: "Crew run failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Crew run complete", description: `Run ${data?.successCount || 0}/${data?.totalAgents || 0} agents succeeded.` });
        await fetchRuns();
      }
    } catch (e: any) {
      toast({ title: "Crew run error", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
      setTimeout(() => {
        progressSubscription.current?.unsubscribe?.();
        progressSubscription.current = null;
      }, 5000);
    }
  };

  const saveTemplate = async () => {
    if (!userId) return;
    if (!templateName.trim()) {
      toast({ title: "Enter a template name", variant: "destructive" });
      return;
    }
    const validAgents = agents.filter((a) => a.task.trim() && a.specialization);
    if (validAgents.length === 0) {
      toast({ title: "Need at least one valid agent", variant: "destructive" });
      return;
    }
    const { error } = await (supabase as any).from("mavis_crew_templates").insert({
      user_id: userId,
      name: templateName.trim(),
      goal: goal.trim(),
      process_type: processType,
      agents: validAgents,
    });
    if (error) {
      toast({ title: "Failed to save template", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Template saved" });
      setTemplateName("");
      await fetchTemplates();
    }
  };

  const loadTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setGoal(t.goal);
    setProcessType(t.process_type);
    setAgents(t.agents.length ? t.agents : [{ specialization: "researcher", task: "" }]);
    setSelectedTemplate(id);
    toast({ title: `Loaded template: ${t.name}` });
  };

  const deleteTemplate = async (id: string) => {
    if (!userId) return;
    const { error } = await (supabase as any).from("mavis_crew_templates").delete().eq("id", id).eq("user_id", userId);
    if (error) {
      toast({ title: "Failed to delete template", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Template deleted" });
      if (selectedTemplate === id) setSelectedTemplate("");
      await fetchTemplates();
    }
  };

  const runTemplate = async (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setGoal(t.goal);
    setProcessType(t.process_type);
    setAgents(t.agents);
    setActiveTab("run");
    toast({ title: "Template loaded into runner", description: "Press Run Crew to start" });
  };

  const quickGoal = (text: string) => {
    setGoal(text);
    setProcessType("parallel");
    setAgents([
      { specialization: "researcher", task: `Research the current state of ${text}` },
      { specialization: "analyst", task: `Analyze the implications of ${text}` },
      { specialization: "writer", task: `Draft a concise summary and recommendations for ${text}` },
    ]);
  };

  const renderAgentStatus = (agentName: string, events: CrewProgressEvent[]) => {
    const start = events.find((e) => (e.agent_name || e.agent_id) === agentName && e.event === "start");
    const complete = events.find((e) => (e.agent_name || e.agent_id) === agentName && e.event === "complete");
    const error = events.find((e) => (e.agent_name || e.agent_id) === agentName && e.event === "error");
    if (error) return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" /> Error</Badge>;
    if (complete) return <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 className="w-3 h-3" /> Complete</Badge>;
    if (start) return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3 animate-spin" /> Running</Badge>;
    return <Badge variant="outline">Pending</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Agent Console</h1>
            <p className="text-sm text-muted-foreground">Multi-agent crew orchestration and templates.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchRuns} disabled={!userId}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="run"><Play className="w-4 h-4 mr-2" /> Run Crew</TabsTrigger>
          <TabsTrigger value="templates"><Save className="w-4 h-4 mr-2" /> Templates</TabsTrigger>
          <TabsTrigger value="history"><Clock className="w-4 h-4 mr-2" /> History</TabsTrigger>
        </TabsList>

        <TabsContent value="run" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    Mission Goal
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="goal">Goal</Label>
                    <Textarea
                      id="goal"
                      placeholder="Describe the mission you want the crew to accomplish..."
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "Competitive research report",
                      "Draft a product launch plan",
                      "Analyze recent customer feedback",
                      "Create a content strategy",
                    ].map((q) => (
                      <Button key={q} variant="outline" size="sm" onClick={() => quickGoal(q)}>
                        <Zap className="w-3 h-3 mr-2" /> {q}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bot className="w-4 h-4 text-primary" />
                    Crew Agents
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {agents.map((agent, idx) => (
                    <div key={idx} className="p-3 rounded-lg border bg-card/50 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">Agent {idx + 1}</Badge>
                          {processType === "sequential" && idx > 0 && (
                            <Select
                              value={String(agent.dependsOn ?? idx - 1)}
                              onValueChange={(v) => updateAgent(idx, "dependsOn", v === "" ? undefined : Number(v))}
                            >
                              <SelectTrigger className="w-32 h-7 text-xs">
                                <SelectValue placeholder="Depends on" />
                              </SelectTrigger>
                              <SelectContent>
                                {agents.slice(0, idx).map((_, i) => (
                                  <SelectItem key={i} value={String(i)}>Agent {i + 1}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeAgent(idx)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-1">
                          <Label className="text-xs">Specialization</Label>
                          <Select value={agent.specialization} onValueChange={(v) => updateAgent(idx, "specialization", v)}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SPECIALIZATIONS.map((s) => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="sm:col-span-2">
                          <Label className="text-xs">Task</Label>
                          <Input
                            placeholder="What should this agent do?"
                            value={agent.task}
                            onChange={(e) => updateAgent(idx, "task", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" onClick={addAgent} className="w-full">
                    <Plus className="w-4 h-4 mr-2" /> Add Agent
                  </Button>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Execution Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Process Type</Label>
                    <Select value={processType} onValueChange={(v) => setProcessType(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="parallel">Parallel</SelectItem>
                        <SelectItem value="sequential">Sequential</SelectItem>
                        <SelectItem value="hierarchical">Hierarchical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={runCrew} disabled={loading} className="w-full">
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                    Run Crew
                  </Button>
                  <Button variant="outline" onClick={saveTemplate} className="w-full">
                    <Save className="w-4 h-4 mr-2" /> Save as Template
                  </Button>
                  <Input
                    placeholder="Template name"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                  />
                </CardContent>
              </Card>

              {activeRunId && (
                <Card className="border-primary/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                      Live Run Progress
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {liveEvents.length === 0 && (
                        <p className="text-sm text-muted-foreground">Waiting for agents to start...</p>
                      )}
                      {Array.from(new Set(liveEvents.map((e) => e.agent_name || e.agent_id || "unknown"))).map((agentName) => {
                        const agentEvents = liveEvents.filter((e) => (e.agent_name || e.agent_id) === agentName);
                        const latest = agentEvents[agentEvents.length - 1];
                        return (
                          <div key={agentName} className="flex items-center justify-between p-2 rounded-md bg-background/80 border">
                            <div className="flex items-center gap-2">
                              <Bot className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm font-medium">{agentName}</span>
                            </div>
                            {renderAgentStatus(agentName, liveEvents)}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="templates" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Saved Templates</CardTitle>
            </CardHeader>
            <CardContent>
              {templates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Save className="w-8 h-8 mx-auto mb-3 opacity-50" />
                  <p>No templates saved yet.</p>
                  <p className="text-sm">Configure a crew in the Run tab and save it here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {templates.map((t) => (
                    <div
                      key={t.id}
                      className={cn(
                        "p-4 rounded-lg border transition-colors cursor-pointer",
                        selectedTemplate === t.id ? "bg-primary/5 border-primary/30" : "hover:bg-accent/50"
                      )}
                      onClick={() => loadTemplate(t.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium">{t.name}</h3>
                            <Badge variant="outline">{t.process_type}</Badge>
                            <Badge variant="secondary">{t.agents.length} agents</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-1">{t.goal || "No goal"}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); runTemplate(t.id); }}>
                            <Play className="w-4 h-4 mr-2" /> Run
                          </Button>
                          <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent Crew Runs</CardTitle>
            </CardHeader>
            <CardContent>
              {runs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="w-8 h-8 mx-auto mb-3 opacity-50" />
                  <p>No crew runs yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {runs.map((run) => (
                    <div key={run.id} className="rounded-lg border overflow-hidden">
                      <div
                        className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium line-clamp-1">{run.goal}</h3>
                              <Badge variant="outline">{run.process_type}</Badge>
                              <Badge
                                className={cn(
                                  run.status === "completed" && "bg-emerald-600 hover:bg-emerald-700",
                                  run.status === "failed" && "bg-destructive",
                                  run.status === "running" && "bg-primary"
                                )}
                              >
                                {run.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {new Date(run.created_at).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setGoal(run.goal); setProcessType(run.process_type); setAgents(run.agents); setActiveTab("run"); toast({ title: "Loaded into runner" }); }}>
                              <RefreshCw className="w-4 h-4 mr-2" /> Re-run
                            </Button>
                          </div>
                        </div>
                      </div>
                      {expandedRunId === run.id && run.result && (
                        <div className="p-4 border-t bg-muted/30">
                          <ScrollArea className="h-64">
                            <div className="space-y-4">
                              {(run.result?.agentResults || []).map((r: any, i: number) => (
                                <div key={i} className="p-3 rounded-md bg-background border">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Badge variant="secondary">{r.specialization}</Badge>
                                    {r.success ? (
                                      <Badge className="bg-emerald-600 hover:bg-emerald-700">Success</Badge>
                                    ) : (
                                      <Badge variant="destructive">Failed</Badge>
                                    )}
                                  </div>
                                  <p className="text-sm whitespace-pre-wrap">{r.output}</p>
                                </div>
                              ))}
                              {run.result?.synthesis && (
                                <div className="p-3 rounded-md bg-primary/5 border border-primary/20">
                                  <h4 className="text-sm font-semibold mb-1">Synthesis</h4>
                                  <p className="text-sm whitespace-pre-wrap">{run.result.synthesis}</p>
                                </div>
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          <span>Agents communicate via the local mesh</span>
        </div>
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4" />
          <span>Crew runs are logged for memory</span>
        </div>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          <span>Save reusable templates for common missions</span>
        </div>
      </div>
    </div>
  );
}
