// SKILL: google-tasks
// Syncs and manages Google Tasks via mavis-google-tasks-sync.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "google-tasks", output: "Manage Google Tasks. Example: 'show my google tasks' or 'add task: review the proposal by Friday'" };
  }
  const action = /show|list|get|check|my tasks/i.test(input) ? "list"
    : /add|create|new task/i.test(input) ? "create"
    : /complete|done|finish/i.test(input) ? "complete"
    : "list";
  const taskTitle = input.replace(/^(add|create|new)\s+(task|google task)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-google-tasks-sync", {
      body: { action, title: action === "create" ? taskTitle : undefined, user_id: ctx.userId },
    });
    if (error) throw error;
    const tasks = data?.tasks ?? data?.items ?? [];
    if (Array.isArray(tasks) && tasks.length > 0) {
      const list = tasks.slice(0, 10).map((t: any) => `• ${t.status === "completed" ? "✅" : "⬜"} ${t.title}`).join("\n");
      return { skillName: "google-tasks", output: `✅ **Google Tasks:**\n${list}` };
    }
    return { skillName: "google-tasks", output: data?.output ?? (action === "create" ? `Task created: "${taskTitle}"` : JSON.stringify(data)) };
  } catch (err) {
    return { skillName: "google-tasks", output: `Google Tasks error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "google-tasks",
  description: "Manages Google Tasks — add, list, and complete tasks",
  keywords: [
    "google tasks", "add task", "my tasks", "check tasks", "task list",
    "create task", "mark task complete", "google task", "list tasks",
    "upcoming tasks", "to do list google",
  ],
}, handler);
