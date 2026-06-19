import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getMonday(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  r.setDate(r.getDate() + diff);
  return r;
}

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function StreakHeatmap() {
  const { session } = useAuth();
  const [cellData, setCellData] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;

    async function load() {
      setLoading(true);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 364);
      const cutoffStr = cutoff.toISOString();

      const map = new Map<string, number>();

      const bump = (dateStr: string | null) => {
        if (!dateStr) return;
        const d = dateStr.slice(0, 10);
        map.set(d, (map.get(d) ?? 0) + 1);
      };

      const [tasksRes, journalRes] = await Promise.allSettled([
        supabase
          .from("mavis_tasks")
          .select("completed_at")
          .eq("user_id", userId)
          .not("completed_at", "is", null)
          .gte("completed_at", cutoffStr),
        supabase
          .from("journal_entries")
          .select("created_at")
          .eq("user_id", userId)
          .gte("created_at", cutoffStr),
      ]);

      if (tasksRes.status === "fulfilled" && tasksRes.value.data) {
        tasksRes.value.data.forEach((r: any) => bump(r.completed_at));
      }
      if (journalRes.status === "fulfilled" && journalRes.value.data) {
        journalRes.value.data.forEach((r: any) => bump(r.created_at));
      }

      setCellData(map);
      setLoading(false);
    }

    load();
  }, [session?.user?.id]);

  // Build 52-week grid starting from Monday 364 days ago
  const today = new Date();
  const startMonday = getMonday(addDays(today, -363));

  const weeks: Date[][] = [];
  for (let w = 0; w < 52; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(addDays(startMonday, w * 7 + d));
    }
    weeks.push(week);
  }

  const totalActivity = Array.from(cellData.values()).reduce((a, b) => a + b, 0);

  function cellColor(count: number): string {
    if (count === 0) return "bg-muted/30";
    if (count === 1) return "bg-primary/20";
    if (count <= 3) return "bg-primary/40";
    if (count <= 6) return "bg-primary/70";
    return "bg-primary";
  }

  // Month labels: track when month changes across weeks (row 0)
  const monthCols: { idx: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const m = week[0].getMonth();
    if (m !== lastMonth) {
      monthCols.push({ idx: wi, label: MONTH_LABELS[m] });
      lastMonth = m;
    }
  });

  if (loading) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Activity — Last 52 Weeks</p>
        <div className="h-[84px] bg-muted/20 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Activity — Last 52 Weeks</p>
        <p className="text-xs font-mono text-muted-foreground">{totalActivity} actions</p>
      </div>

      {/* Month labels */}
      <div className="relative" style={{ height: 14 }}>
        {monthCols.map(({ idx, label }) => (
          <span
            key={idx}
            className="absolute text-xs font-mono text-muted-foreground"
            style={{ left: idx * 12 }}
          >
            {label}
          </span>
        ))}
      </div>

      {/* Grid: 7 rows × 52 cols */}
      <div className="flex gap-[2px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[2px]">
            {week.map((day, di) => {
              const dateStr = formatDate(day);
              const count = cellData.get(dateStr) ?? 0;
              return (
                <div
                  key={di}
                  title={`${count} action${count !== 1 ? "s" : ""} on ${dateStr}`}
                  className={`w-[10px] h-[10px] rounded-sm transition-colors ${cellColor(count)}`}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 justify-end">
        <span className="text-xs font-mono text-muted-foreground">Less</span>
        {["bg-muted/30","bg-primary/20","bg-primary/40","bg-primary/70","bg-primary"].map((cls) => (
          <div key={cls} className={`w-[10px] h-[10px] rounded-sm ${cls}`} />
        ))}
        <span className="text-xs font-mono text-muted-foreground">More</span>
      </div>
    </div>
  );
}
