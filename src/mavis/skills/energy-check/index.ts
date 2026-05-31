import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const uid = ctx.userId;
    const [energyRes, bpmRes] = await Promise.all([
      supabase.from("energy_systems").select("*").eq("user_id", uid),
      supabase.from("bpm_sessions").select("bpm,form,mood,notes,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(5),
    ]);

    const energy = energyRes.data ?? [];
    const bpm = bpmRes.data ?? [];

    if (energy.length === 0 && bpm.length === 0) {
      return { skillName: "energy-check", output: "No energy data found. Configure your energy systems to start tracking." };
    }

    const lines: string[] = ["ENERGY CHECK — BIONEER STATUS REPORT\n"];

    if (energy.length > 0) {
      lines.push("ENERGY SYSTEMS:");
      energy.forEach((e: any) => {
        const pct = e.max_value > 0 ? Math.round((e.current_value / e.max_value) * 100) : 0;
        const bar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));
        const warn = pct < 30 ? " ⚠ LOW" : pct < 60 ? " — moderate" : " — strong";
        lines.push(`  ${e.type}: [${bar}] ${pct}% (${e.current_value}/${e.max_value}) [${e.status}]${warn}`);
        if (e.description) lines.push(`    ${e.description}`);
      });
    }

    if (bpm.length > 0) {
      lines.push("\nRECENT BPM SESSIONS:");
      bpm.forEach((b: any) => {
        const when = new Date(b.created_at).toLocaleDateString();
        lines.push(`  • ${b.bpm} BPM | ${b.form} | ${when}${b.mood ? ` | mood: ${b.mood}` : ""}${b.notes ? ` | ${b.notes}` : ""}`);
      });

      const avgBpm = Math.round(bpm.reduce((s: number, b: any) => s + b.bpm, 0) / bpm.length);
      lines.push(`\nAVG BPM (last ${bpm.length}): ${avgBpm}`);
    }

    const lowEnergy = energy.filter((e: any) => e.max_value > 0 && (e.current_value / e.max_value) < 0.3);
    if (lowEnergy.length > 0) {
      lines.push(`\nRECOMMENDATION: ${lowEnergy.map((e: any) => e.type).join(", ")} critically low. Prioritize recovery work today — avoid high-intensity sprints.`);
    } else {
      lines.push("\nStatus: Systems nominal. Proceed with full intensity.");
    }

    return { skillName: "energy-check", output: lines.join("\n") };
  } catch (err) {
    return { skillName: "energy-check", output: `Energy check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "energy-check",
  description: "Checks current energy levels and recent BPM sessions — Bioneer readiness report",
  keywords: ["energy check", "check energy", "how am i doing", "energy levels", "bpm check", "bioneer status", "readiness", "how's my energy"],
}, handler);
