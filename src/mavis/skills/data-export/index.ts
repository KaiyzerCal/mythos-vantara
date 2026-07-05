// SKILL: data-export
// Exports VANTARA app data (goals, journal, vault, tasks) via mavis-data-export.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "data-export", output: "Export your VANTARA data. Example: 'export my goals as CSV' or 'export my journal entries to markdown'" };
  }
  const format = /csv/i.test(input) ? "csv" : /json/i.test(input) ? "json" : /markdown|md/i.test(input) ? "markdown" : "csv";
  const dataType = /goal/i.test(input) ? "goals"
    : /journal|notes/i.test(input) ? "journal"
    : /vault|media/i.test(input) ? "vault"
    : /task/i.test(input) ? "tasks"
    : /skill/i.test(input) ? "skills"
    : "all";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-data-export", {
      body: { data_type: dataType, format, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.export ?? data?.content ?? data?.url ?? data?.output;
    return {
      skillName: "data-export",
      output: result
        ? (typeof result === "string" && result.startsWith("http")
            ? `📥 **Export Ready:** [Download ${dataType}.${format}](${result})`
            : `📥 **${dataType} Export (${format}):**\n\n\`\`\`\n${String(result).slice(0, 4000)}\n\`\`\``)
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "data-export", output: `Data export error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "data-export",
  description: "Exports VANTARA app data (goals, journal, vault, tasks) to CSV, JSON, or Markdown",
  keywords: [
    "export data", "export my goals", "export journal", "download my data",
    "export to csv", "export to json", "export vault", "backup my data",
    "export tasks", "export notes", "data download",
  ],
}, handler);
