import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Brain, TrendingUp, AlertCircle, Lightbulb, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Insight {
  id: string;
  type: "prediction" | "opportunity" | "pattern";
  title: string;
  content: string;
  confidence: number;
  kind_label: string;
  href: string;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  upcoming_need: Lightbulb,
  behavioral_pattern: TrendingUp,
  risk_alert: AlertCircle,
  opportunity: TrendingUp,
  health_insight: Brain,
  productivity_window: TrendingUp,
};

export function CausalInsights({ userId }: { userId: string }) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      const [{ data: preds }, { data: opps }] = await Promise.all([
        (supabase as any)
          .from("mavis_predictions")
          .select("id,prediction_type,title,content,confidence")
          .eq("user_id", userId)
          .eq("acted_on", false)
          .gt("expires_at", new Date().toISOString())
          .order("confidence", { ascending: false })
          .limit(3),
        (supabase as any)
          .from("mavis_opportunities")
          .select("id,opportunity_type,title,description,confidence")
          .eq("user_id", userId)
          .eq("acted_on", false)
          .order("confidence", { ascending: false })
          .limit(2),
      ]);

      const combined: Insight[] = [
        ...(preds ?? []).map((p: any) => ({
          id: p.id,
          type: "prediction" as const,
          title: p.title,
          content: p.content,
          confidence: p.confidence,
          kind_label: p.prediction_type?.replace(/_/g, " ") ?? "insight",
          href: "/intelligence",
        })),
        ...(opps ?? []).map((o: any) => ({
          id: o.id,
          type: "opportunity" as const,
          title: o.title,
          content: o.description,
          confidence: o.confidence,
          kind_label: "opportunity",
          href: "/intelligence",
        })),
      ]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 4);

      setInsights(combined);
      setLoading(false);
    }
    load();
  }, [userId]);

  if (loading) return (
    <div className="space-y-2 py-1">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="hud-border rounded p-3 space-y-1.5 animate-pulse">
          <div className="h-3 bg-muted rounded w-2/3" />
          <div className="h-2.5 bg-muted rounded w-full" />
        </div>
      ))}
    </div>
  );

  if (!insights.length) return (
    <div className="py-8 text-center">
      <Brain size={20} className="text-muted-foreground mx-auto mb-2" />
      <p className="text-xs font-mono text-muted-foreground">No insights yet.</p>
      <p className="text-xs text-muted-foreground mt-1">MAVIS will surface patterns as it learns.</p>
    </div>
  );

  return (
    <div className="space-y-2">
      {insights.map(ins => {
        const Icon = TYPE_ICONS[ins.kind_label.replace(/ /g, "_")] ?? Brain;
        const pct = Math.round(ins.confidence * 100);
        const confColor = pct >= 80 ? "text-green-400" : pct >= 60 ? "text-amber-400" : "text-muted-foreground";
        return (
          <button
            key={ins.id}
            onClick={() => navigate(ins.href)}
            className="w-full text-left hud-border rounded-lg p-3 hover:border-primary/30 hover:bg-muted/20 transition-all group"
          >
            <div className="flex items-start gap-2">
              <Icon size={12} className="text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-mono text-muted-foreground uppercase tracking-wide">
                    {ins.kind_label}
                  </span>
                  <span className={`text-xs font-mono ${confColor}`}>{pct}%</span>
                </div>
                <p className="text-xs font-mono text-foreground leading-snug">{ins.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ins.content}</p>
              </div>
              <ChevronRight size={12} className="text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        );
      })}
      <button
        onClick={() => navigate("/intelligence")}
        className="w-full text-xs font-mono text-muted-foreground hover:text-primary transition-colors py-1 text-center"
      >
        View all intelligence →
      </button>
    </div>
  );
}
