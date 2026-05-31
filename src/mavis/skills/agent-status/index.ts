import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const uid = ctx.userId;

    const { data: memories } = await supabase
      .from("mavis_agent_memories")
      .select("agent_id, agent_name, content, memory_type, importance, created_at")
      .eq("user_id", uid)
      .in("memory_type", ["agent_run_complete", "agent_termination"])
      .order("created_at", { ascending: false })
      .limit(10);

    if (!memories || memories.length === 0) {
      return {
        skillName: "agent-status",
        output: "No specialist agents have run yet. Use AGENT mode and dispatch a specialist to begin.",
      };
    }

    const lines: string[] = ["SPECIALIST AGENT STATUS — RECENT RUNS\n"];

    for (const m of memories) {
      const when = new Date(m.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      lines.push(`[ ${m.agent_name ?? m.agent_id} ] — ${when}`);
      if (m.content && m.content.length < 300) {
        lines.push(`  ${m.content}`);
      } else if (m.content) {
        lines.push(`  ${m.content.slice(0, 280)}...`);
      }
      lines.push("");
    }

    lines.push(`Total logged agent runs: ${memories.length}`);

    return { skillName: "agent-status", output: lines.join("\n") };
  } catch (err) {
    return { skillName: "agent-status", output: `Agent status unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "agent-status",
  description: "Shows recent specialist agent run history from the dynamic agent factory",
  keywords: ["agent status", "specialist agents", "what agents", "agent history", "agent runs", "show agents", "recent agents"],
}, handler);
