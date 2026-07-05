// SKILL: gdrive-sync
// Searches, uploads, and manages Google Drive files via mavis-gdrive-sync.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "gdrive-sync", output: "Access your Google Drive. Example: 'find my Drive file about Q3 report' or 'list recent Google Drive files'" };
  }
  const action = /upload|save|create/i.test(input) ? "upload" : "search";
  const query = input.replace(/^(find|search|get|look up|upload|save)\s+(in\s+)?(google\s+)?drive\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-gdrive-sync", {
      body: { action, query, user_id: ctx.userId },
    });
    if (error) throw error;
    const files = data?.files ?? data?.results ?? [];
    if (Array.isArray(files) && files.length > 0) {
      const list = files.slice(0, 8).map((f: any) => `• [${f.name ?? f.title}](${f.webViewLink ?? f.url ?? "#"}) — ${f.modifiedTime ?? ""}`).join("\n");
      return { skillName: "gdrive-sync", output: `📂 **Drive Files:**\n${list}` };
    }
    return { skillName: "gdrive-sync", output: data?.output ?? JSON.stringify(data) };
  } catch (err) {
    return { skillName: "gdrive-sync", output: `Google Drive error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "gdrive-sync",
  description: "Searches, accesses, and manages files in Google Drive",
  keywords: [
    "google drive", "find in drive", "drive file", "my drive", "google docs",
    "upload to drive", "save to drive", "recent drive files", "shared with me",
    "find my doc", "gdrive", "drive folder",
  ],
}, handler);
