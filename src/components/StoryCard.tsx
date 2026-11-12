// Dashboard "Story" card: the narrative layer of the game in one place. The latest chapter MAVIS wrote
// (Vault, category "chapter"), the latest milestone beat, today's boss, and the status effects currently on the
// character. Renders nothing at all until there is something to show.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppData } from "@/contexts/AppDataContext";
import { supabase } from "@/integrations/supabase/client";
import { HudCard } from "@/components/SharedUI";

interface Beat { key: string; kind: string; text: string | null; created_at: string }

const timeLeft = (deadline: string | null) => {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return "overdue";
  return ms > 3_600_000 ? `${Math.floor(ms / 3_600_000)}h left` : `${Math.max(1, Math.ceil(ms / 60_000))}m left`;
};

export function StoryCard() {
  const navigate = useNavigate();
  const { vaultEntries, quests, domainEffects } = useAppData();
  const [beat, setBeat] = useState<Beat | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("mavis_beats").select("key,kind,text,created_at")
        .eq("announced", true).not("text", "is", null)
        .order("created_at", { ascending: false }).limit(1);
      if (!cancelled && data?.[0]) setBeat(data[0] as Beat);
    })();
    return () => { cancelled = true; };
  }, []);

  const chapter = [...vaultEntries]
    .filter((e) => e.category === "chapter")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const boss = quests.find((q: any) => q.category === "Boss" && q.status === "active");
  const effects = domainEffects.filter((d) => d.is_active && d.source === "mavis-auto" && (!d.expires_at || new Date(d.expires_at).getTime() > Date.now()));

  if (!chapter && !beat && !boss && effects.length === 0) return null;

  return (
    <HudCard className="border-primary/20">
      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/60 mb-3">// The Story</p>
      <div className="grid gap-4 md:grid-cols-2">
        {chapter && (
          <button onClick={() => navigate("/vault")} className="text-left group">
            <p className="text-[10px] font-mono uppercase text-muted-foreground">Latest chapter</p>
            <p className="text-sm font-display font-bold mt-0.5 group-hover:text-primary transition-colors">{chapter.title}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-4">{chapter.content.replace(/\s+/g, " ").slice(0, 260)}…</p>
          </button>
        )}
        <div className="space-y-3">
          {boss && (
            <button onClick={() => navigate("/quests")} className="text-left group block w-full">
              <p className="text-[10px] font-mono uppercase text-red-400">Boss fight{timeLeft(boss.deadline as string | null) ? ` · ${timeLeft(boss.deadline as string | null)}` : ""}</p>
              <p className="text-sm font-display font-bold mt-0.5 group-hover:text-primary transition-colors">{String(boss.title).replace(/^Boss:\s*/i, "")}</p>
            </button>
          )}
          {beat?.text && (
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground">Latest milestone</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed italic">{beat.text}</p>
            </div>
          )}
          {effects.length > 0 && (
            <button onClick={() => navigate("/character")} className="text-left block w-full">
              <p className="text-[10px] font-mono uppercase text-muted-foreground">Status effects</p>
              <p className="text-xs mt-0.5">
                {effects.map((e, i) => (
                  <span key={e.id} className={e.stat_modifiers?.[0]?.value < 0 ? "text-red-400" : "text-green-400"}>
                    {i > 0 ? " · " : ""}{e.name}
                  </span>
                ))}
              </p>
            </button>
          )}
        </div>
      </div>
    </HudCard>
  );
}
