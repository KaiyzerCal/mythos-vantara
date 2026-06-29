import { supabase } from "@/integrations/supabase/client";

export async function recordAutoMemory(
  type: "quest_complete" | "task_complete" | "journal_entry" | "goal_achieved",
  data: { title: string; content: string; tags?: string[]; metadata?: Record<string, unknown> }
) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    await supabase.from("memories").insert({
      user_id: session.user.id,
      title: data.title,
      content: data.content,
      memory_type: "key_information",
      source: `auto_${type}`,
      tags: ["auto_extracted", type, ...(data.tags ?? [])],
      metadata: { auto_type: type, recorded_at: new Date().toISOString(), ...(data.metadata ?? {}) },
    });
  } catch { /* non-critical — never block the main action */ }
}
