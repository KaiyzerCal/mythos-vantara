import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type MavisAction = {
  type: string;
  params: Record<string, unknown>;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Helpers ────────────────────────────────────────────────
function serializeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  if (error && typeof error === "object") return JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error)));
  return { message: String(error) };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((i): i is string => typeof i === "string");
  if (typeof value === "string") return value.split(",").map((p) => p.trim()).filter(Boolean);
  return [];
}

async function logActivity(sb: ReturnType<typeof createClient>, userId: string, eventType: string, description: string, xpAmount: number) {
  await sb.from("activity_log").insert({ user_id: userId, event_type: eventType, description, xp_amount: xpAmount });
}

async function awardXP(sb: ReturnType<typeof createClient>, userId: string, amount: number) {
  const { data: profile } = await sb.from("profiles").select("xp, xp_to_next_level, level, operator_xp, operator_level").eq("id", userId).single();
  if (!profile) return;

  let xp = (profile.xp || 0) + amount;
  let level = profile.level || 1;
  let threshold = profile.xp_to_next_level || 500;

  while (xp >= threshold) {
    xp -= threshold;
    level++;
    threshold = Math.floor(200 * Math.pow(level, 1.45));
  }

  await sb.from("profiles").update({
    xp,
    level,
    xp_to_next_level: threshold,
    operator_xp: (profile.operator_xp || 0) + amount,
  }).eq("id", userId);
}

// ── Name-based ID resolver ────────────────────────────────
async function resolveId(
  sb: ReturnType<typeof createClient>,
  userId: string,
  table: string,
  idParam: string | undefined,
  nameParam: string | undefined,
  nameColumn = "name",
  userColumn = "user_id"
): Promise<string> {
  if (idParam) return String(idParam);
  if (!nameParam) return "";
  const { data } = await sb.from(table).select("id").eq(userColumn, userId).ilike(nameColumn, String(nameParam)).limit(1).single();
  return data?.id || "";
}

// ── Profile fields MAVIS is allowed to update ─────────────
const PROFILE_ALLOWED = [
  "inscribed_name", "true_name", "titles", "species_lineage", "aura",
  "territory_class", "territory_floors", "arc_story",
  "stat_str", "stat_agi", "stat_vit", "stat_int", "stat_wis", "stat_cha", "stat_lck",
  "fatigue", "full_cowl_sync", "codex_integrity",
  "current_form", "current_bpm", "current_floor",
  "aura_power", "display_name", "operator_level", "operator_xp",
  "notification_settings",
  "rank", "level", "xp", "xp_to_next_level", "pvp_rating", "gpr",
] as const;

// ── Alias normalization ─────────────────────────────────────
const ACTION_ALIASES: Record<string, string> = {
  "create_item": "create_inventory_item", "add_item": "create_inventory_item", "add_inventory": "create_inventory_item",
  "add_inventory_item": "create_inventory_item", "new_item": "create_inventory_item",
  "update_item": "update_inventory_item", "edit_item": "update_inventory_item",
  "delete_item": "delete_inventory_item", "remove_item": "delete_inventory_item",
  "add_quest": "create_quest", "new_quest": "create_quest", "edit_quest": "update_quest", "remove_quest": "delete_quest", "finish_quest": "complete_quest",
  "add_task": "create_task", "new_task": "create_task", "edit_task": "update_task", "remove_task": "delete_task", "finish_task": "complete_task",
  "add_skill": "create_skill", "new_skill": "create_skill", "edit_skill": "update_skill", "remove_skill": "delete_skill",
  "add_subskill": "create_subskill", "new_subskill": "create_subskill",
  "add_journal": "create_journal", "new_journal": "create_journal", "create_journal_entry": "create_journal", "add_journal_entry": "create_journal",
  "edit_journal": "update_journal", "remove_journal": "delete_journal", "delete_journal_entry": "delete_journal",
  "add_vault": "create_vault", "new_vault": "create_vault", "create_vault_entry": "create_vault", "add_vault_entry": "create_vault",
  "edit_vault": "update_vault", "remove_vault": "delete_vault", "delete_vault_entry": "delete_vault",
  "add_council": "create_council_member", "create_council": "create_council_member", "new_council": "create_council_member", "add_council_member": "create_council_member",
  "edit_council": "update_council_member", "edit_council_member": "update_council_member",
  "remove_council": "delete_council_member", "remove_council_member": "delete_council_member",
  "add_ally": "create_ally", "new_ally": "create_ally", "edit_ally": "update_ally", "remove_ally": "delete_ally",
  "edit_energy": "update_energy", "create_energy": "create_energy_system", "add_energy": "create_energy_system", "new_energy": "create_energy_system",
  "add_transformation": "create_transformation", "add_form": "create_transformation", "create_form": "create_transformation",
  "new_form": "create_transformation", "new_transformation": "create_transformation",
  "edit_transformation": "update_transformation", "edit_form": "update_transformation",
  "remove_transformation": "delete_transformation", "remove_form": "delete_transformation",
  "add_store_item": "create_store_item", "new_store_item": "create_store_item",
  "edit_store_item": "update_store_item", "remove_store_item": "delete_store_item",
  "add_ranking": "create_ranking", "new_ranking": "create_ranking", "edit_ranking": "update_ranking", "remove_ranking": "delete_ranking",
  "add_ritual": "create_ritual", "new_ritual": "create_ritual", "edit_ritual": "update_ritual", "remove_ritual": "delete_ritual", "finish_ritual": "complete_ritual",
  "edit_profile": "update_profile", "modify_profile": "update_profile",
  "set_stats": "update_profile", "update_stats": "update_profile", "change_stats": "update_profile", "modify_stats": "update_profile", "edit_stats": "update_profile",
  "update_character": "update_profile", "edit_character": "update_profile", "modify_character": "update_profile", "change_character": "update_profile",
  "set_stat": "update_profile", "change_stat": "update_profile", "update_stat": "update_profile",
  "set_fatigue": "update_profile", "change_fatigue": "update_profile", "update_fatigue": "update_profile",
  "set_level": "update_profile", "change_level": "update_profile",
  "set_rank": "update_profile", "change_rank": "update_profile",
  "set_str": "update_profile", "set_agi": "update_profile", "set_vit": "update_profile", "set_int": "update_profile",
  "set_wis": "update_profile", "set_cha": "update_profile", "set_lck": "update_profile",
  "set_sync": "update_profile", "change_sync": "update_profile",
  "set_codex": "update_profile", "change_codex": "update_profile",
  "set_bpm": "update_profile", "change_bpm": "update_profile",
  "set_floor": "update_profile", "change_floor": "update_profile",
  "set_gpr": "update_profile", "change_gpr": "update_profile",
  "set_pvp": "update_profile", "change_pvp": "update_profile",
  "set_form": "update_profile", "change_form": "update_profile",
  "set_aura": "update_profile", "change_aura": "update_profile",
  "set_arc": "update_profile", "change_arc": "update_profile",
  "give_xp": "award_xp", "add_xp": "award_xp",
  "add_bpm": "log_bpm_session", "create_bpm": "log_bpm_session", "log_bpm": "log_bpm_session",
};

function normalizeActionType(type: string): string {
  const normalized = type.toLowerCase().trim();
  return ACTION_ALIASES[normalized] || normalized;
}

// ── Action executor ────────────────────────────────────────
async function executeAction(sb: ReturnType<typeof createClient>, userId: string, action: MavisAction) {
  const p = action.params || {};
  const actionType = normalizeActionType(action.type);

  switch (actionType) {

    // ── QUESTS ───────────────────────────────────────────
    case "create_quest": {
      const { error } = await sb.from("quests").insert({
        user_id: userId,
        title: String(p.title || "New Quest"),
        description: String(p.description || ""),
        type: String(p.type || "daily"),
        status: String(p.status || "active"),
        difficulty: String(p.difficulty || "Normal"),
        xp_reward: Number(p.xp_reward || 100),
        codex_points_reward: Number(p.codex_points_reward || 0),
        progress_current: Number(p.progress_current || 0),
        progress_target: Number(p.progress_target || 1),
        real_world_mapping: p.real_world_mapping ? String(p.real_world_mapping) : null,
        category: p.category ? String(p.category) : null,
        loot_rewards: p.loot_rewards || [],
        linked_skill_ids: asStringArray(p.linked_skill_ids),
      });
      if (error) throw error;
      await logActivity(sb, userId, "quest_created", `Quest created: ${String(p.title || "New Quest")}`, 0);
      return;
    }

    case "update_quest": {
      const questId = await resolveId(sb, userId, "quests", p.quest_id as string, (p.quest_name || p.title) as string, "title");
      if (!questId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["title", "description", "type", "status", "difficulty", "xp_reward", "progress_current", "progress_target", "real_world_mapping", "category"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      updates.updated_at = new Date().toISOString();
      const { error } = await sb.from("quests").update(updates).eq("id", questId).eq("user_id", userId);
      if (error) throw error;
      return;
    }

    case "complete_quest": {
      const questId = await resolveId(sb, userId, "quests", (p.quest_id || p.id) as string, (p.quest_name || p.title) as string, "title");
      if (!questId) return;
      const { data: quest } = await sb.from("quests").select("xp_reward, title").eq("id", questId).eq("user_id", userId).single();
      if (!quest) return;
      await sb.from("quests").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", questId).eq("user_id", userId);
      await awardXP(sb, userId, Number(quest.xp_reward || 0));
      await logActivity(sb, userId, "quest_completed", `Quest completed: ${quest.title}`, Number(quest.xp_reward || 0));
      return;
    }

    case "delete_quest": {
      const questId = await resolveId(sb, userId, "quests", (p.quest_id || p.id) as string, (p.quest_name || p.title) as string, "title");
      if (!questId) return;
      const { data: quest } = await sb.from("quests").select("title").eq("id", questId).eq("user_id", userId).single();
      await sb.from("quests").delete().eq("id", questId).eq("user_id", userId);
      await logActivity(sb, userId, "quest_deleted", `Quest deleted: ${quest?.title || "Unknown"}`, 0);
      return;
    }

    // ── TASKS ────────────────────────────────────────────
    case "create_task": {
      const { error } = await sb.from("tasks").insert({
        user_id: userId,
        title: String(p.title || "New Task"),
        description: p.description ? String(p.description) : null,
        type: String(p.type || "task"),
        status: "active",
        recurrence: String(p.recurrence || "once"),
        xp_reward: Number(p.xp_reward || 25),
        streak: 0,
        completed_count: 0,
      });
      if (error) throw error;
      await logActivity(sb, userId, "task_created", `Task created: ${String(p.title || "New Task")}`, 0);
      return;
    }

    case "complete_task": {
      const taskId = await resolveId(sb, userId, "tasks", (p.task_id || p.id) as string, (p.task_name || p.title) as string, "title");
      if (!taskId) return;
      const { data: task } = await sb.from("tasks").select("xp_reward, title, recurrence, completed_count, streak").eq("id", taskId).eq("user_id", userId).single();
      if (!task) return;
      const newStatus = task.recurrence === "once" ? "completed" : "active";
      await sb.from("tasks").update({
        status: newStatus,
        completed_count: (task.completed_count || 0) + 1,
        streak: (task.streak || 0) + 1,
        last_completed: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", taskId).eq("user_id", userId);
      await awardXP(sb, userId, Number(task.xp_reward || 0));
      await logActivity(sb, userId, "task_completed", `Task completed: ${task.title}`, Number(task.xp_reward || 0));
      return;
    }

    case "update_task": {
      const taskId = await resolveId(sb, userId, "tasks", (p.task_id || p.id) as string, (p.task_name || p.title) as string, "title");
      if (!taskId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["title", "description", "type", "status", "recurrence", "xp_reward"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      updates.updated_at = new Date().toISOString();
      await sb.from("tasks").update(updates).eq("id", taskId).eq("user_id", userId);
      return;
    }

    case "delete_task": {
      const taskId = await resolveId(sb, userId, "tasks", (p.task_id || p.id) as string, (p.task_name || p.title) as string, "title");
      if (!taskId) return;
      await sb.from("tasks").delete().eq("id", taskId).eq("user_id", userId);
      return;
    }

    // ── SKILLS ───────────────────────────────────────────
    case "create_skill":
    case "create_subskill": {
      const insertData: Record<string, unknown> = {
        user_id: userId,
        name: String(p.name || "New Skill"),
        description: String(p.description || ""),
        category: String(p.category || "General"),
        energy_type: String(p.energy_type || "Emerald Flames"),
        tier: Number(p.tier || 1),
        unlocked: true,
        cost: Number(p.cost || 0),
        proficiency: Number(p.proficiency || 0),
        prerequisites: asStringArray(p.prerequisites),
      };
      if (p.parent_skill_id) insertData.parent_skill_id = String(p.parent_skill_id);
      // If parent_skill_name provided but no ID, resolve it
      if (!p.parent_skill_id && p.parent_skill_name) {
        const parentId = await resolveId(sb, userId, "skills", undefined, p.parent_skill_name as string);
        if (parentId) insertData.parent_skill_id = parentId;
      }
      const { error } = await sb.from("skills").insert(insertData);
      if (error) throw error;
      const label = insertData.parent_skill_id ? "Subskill" : "Skill";
      await logActivity(sb, userId, "skill_created", `${label} unlocked: ${String(p.name || "New Skill")}`, 0);
      return;
    }

    case "update_skill": {
      const skillId = await resolveId(sb, userId, "skills", (p.skill_id || p.id) as string, (p.skill_name || p.name) as string);
      if (!skillId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["name", "description", "category", "energy_type", "tier", "unlocked", "proficiency"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      updates.updated_at = new Date().toISOString();
      await sb.from("skills").update(updates).eq("id", skillId).eq("user_id", userId);
      return;
    }

    case "delete_skill": {
      const skillId = await resolveId(sb, userId, "skills", (p.skill_id || p.id) as string, (p.skill_name || p.name) as string);
      if (!skillId) return;
      await sb.from("skills").delete().eq("id", skillId).eq("user_id", userId);
      return;
    }

    // ── JOURNAL ──────────────────────────────────────────
    case "create_journal": {
      const xp = Number(p.xp_earned || 10);
      const { error } = await sb.from("journal_entries").insert({
        user_id: userId,
        title: String(p.title || "New Entry"),
        content: String(p.content || ""),
        tags: asStringArray(p.tags),
        category: String(p.category || "personal"),
        importance: String(p.importance || "medium"),
        mood: p.mood ? String(p.mood) : null,
        xp_earned: xp,
      });
      if (error) throw error;
      await awardXP(sb, userId, xp);
      await logActivity(sb, userId, "journal_created", `Journal: ${String(p.title || "New Entry")}`, xp);
      return;
    }

    case "update_journal": {
      const entryId = await resolveId(sb, userId, "journal_entries", (p.entry_id || p.id) as string, (p.entry_title || p.title) as string, "title");
      if (!entryId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["title", "content", "tags", "category", "importance", "mood"]) {
        if (p[key] !== undefined) updates[key] = key === "tags" ? asStringArray(p[key]) : p[key];
      }
      updates.updated_at = new Date().toISOString();
      await sb.from("journal_entries").update(updates).eq("id", entryId).eq("user_id", userId);
      return;
    }

    case "delete_journal": {
      const entryId = await resolveId(sb, userId, "journal_entries", (p.entry_id || p.id) as string, (p.entry_title || p.title) as string, "title");
      if (!entryId) return;
      await sb.from("journal_entries").delete().eq("id", entryId).eq("user_id", userId);
      return;
    }

    // ── VAULT ────────────────────────────────────────────
    case "create_vault": {
      const { error } = await sb.from("vault_entries").insert({
        user_id: userId,
        title: String(p.title || "New Entry"),
        content: String(p.content || ""),
        category: String(p.category || "personal"),
        importance: String(p.importance || "medium"),
        attachments: asStringArray(p.attachments),
      });
      if (error) throw error;
      await logActivity(sb, userId, "vault_created", `Vault: ${String(p.title || "New Entry")}`, 0);
      return;
    }

    case "update_vault": {
      const entryId = await resolveId(sb, userId, "vault_entries", (p.entry_id || p.id) as string, (p.entry_title || p.title) as string, "title");
      if (!entryId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["title", "content", "category", "importance"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      updates.updated_at = new Date().toISOString();
      await sb.from("vault_entries").update(updates).eq("id", entryId).eq("user_id", userId);
      return;
    }

    case "delete_vault": {
      const entryId = await resolveId(sb, userId, "vault_entries", (p.entry_id || p.id) as string, (p.entry_title || p.title) as string, "title");
      if (!entryId) return;
      await sb.from("vault_entries").delete().eq("id", entryId).eq("user_id", userId);
      return;
    }

    // ── COUNCILS ─────────────────────────────────────────
    case "create_council_member": {
      const { error } = await sb.from("councils").insert({
        user_id: userId,
        name: String(p.name || "New Member"),
        role: String(p.role || "Member"),
        specialty: p.specialty ? String(p.specialty) : null,
        class: String(p.class || "advisory"),
        notes: String(p.notes || ""),
        avatar: p.avatar ? String(p.avatar) : null,
      });
      if (error) throw error;
      await logActivity(sb, userId, "council_added", `Council member: ${String(p.name || "New Member")}`, 0);
      return;
    }

    case "update_council_member": {
      const memberId = await resolveId(sb, userId, "councils", (p.member_id || p.id) as string, (p.member_name || p.name) as string);
      if (!memberId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["name", "role", "specialty", "class", "notes"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      updates.updated_at = new Date().toISOString();
      await sb.from("councils").update(updates).eq("id", memberId).eq("user_id", userId);
      return;
    }

    case "delete_council_member": {
      const memberId = await resolveId(sb, userId, "councils", (p.member_id || p.id) as string, (p.member_name || p.name) as string);
      if (!memberId) return;
      await sb.from("councils").delete().eq("id", memberId).eq("user_id", userId);
      return;
    }

    // ── INVENTORY ────────────────────────────────────────
    case "create_inventory_item": {
      const { error } = await sb.from("inventory").insert({
        user_id: userId,
        name: String(p.name || "New Item"),
        description: String(p.description || ""),
        type: String(p.type || "equipment"),
        rarity: String(p.rarity || "common"),
        quantity: Number(p.quantity || 1),
        effect: p.effect ? String(p.effect) : null,
        slot: p.slot ? String(p.slot) : null,
        tier: p.tier ? String(p.tier) : null,
        stat_effects: p.stat_effects || [],
        is_equipped: Boolean(p.is_equipped || false),
      });
      if (error) throw error;
      await logActivity(sb, userId, "item_created", `Item: ${String(p.name || "New Item")}`, 0);
      return;
    }

    case "update_inventory_item": {
      const itemId = await resolveId(sb, userId, "inventory", (p.item_id || p.id) as string, (p.item_name || p.name) as string);
      if (!itemId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["name", "description", "type", "rarity", "quantity", "effect", "slot", "tier", "is_equipped", "stat_effects"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      await sb.from("inventory").update(updates).eq("id", itemId).eq("user_id", userId);
      await logActivity(sb, userId, "item_updated", `Item updated: ${String(p.name || itemId)}`, 0);
      return;
    }

    case "delete_inventory_item": {
      const itemId = await resolveId(sb, userId, "inventory", (p.item_id || p.id) as string, (p.item_name || p.name) as string);
      if (!itemId) return;
      await sb.from("inventory").delete().eq("id", itemId).eq("user_id", userId);
      await logActivity(sb, userId, "item_deleted", "Item removed", 0);
      return;
    }

    // ── ENERGY ───────────────────────────────────────────
    case "update_energy": {
      const energyId = await resolveId(sb, userId, "energy_systems", (p.energy_id || p.id) as string, (p.energy_name || p.type || p.name) as string, "type");
      if (!energyId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["current_value", "max_value", "status", "description", "color", "type"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      updates.updated_at = new Date().toISOString();
      await sb.from("energy_systems").update(updates).eq("id", energyId).eq("user_id", userId);
      return;
    }

    case "create_energy_system": {
      const { error } = await sb.from("energy_systems").insert({
        user_id: userId,
        type: String(p.type || p.name || "New Energy"),
        current_value: Number(p.current_value ?? 100),
        max_value: Number(p.max_value ?? 100),
        color: String(p.color || "#08C284"),
        description: String(p.description || ""),
        status: String(p.status || "developing"),
      });
      if (error) throw error;
      await logActivity(sb, userId, "energy_created", `Energy system: ${String(p.type || p.name || "New Energy")}`, 0);
      return;
    }

    case "delete_energy": {
      const energyId = await resolveId(sb, userId, "energy_systems", (p.energy_id || p.id) as string, (p.energy_name || p.type || p.name) as string, "type");
      if (!energyId) return;
      await sb.from("energy_systems").delete().eq("id", energyId).eq("user_id", userId);
      return;
    }

    // ── ALLIES ───────────────────────────────────────────
    case "create_ally": {
      const { error } = await sb.from("allies").insert({
        user_id: userId,
        name: String(p.name || "New Ally"),
        relationship: String(p.relationship || "ally"),
        level: Number(p.level || 1),
        specialty: String(p.specialty || "General"),
        affinity: Number(p.affinity || 50),
        notes: String(p.notes || ""),
      });
      if (error) throw error;
      await logActivity(sb, userId, "ally_added", `Ally: ${String(p.name || "New Ally")}`, 0);
      return;
    }

    case "update_ally": {
      const allyId = await resolveId(sb, userId, "allies", (p.ally_id || p.id) as string, (p.ally_name || p.name) as string);
      if (!allyId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["name", "relationship", "level", "specialty", "affinity", "notes"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      await sb.from("allies").update(updates).eq("id", allyId).eq("user_id", userId);
      return;
    }

    case "delete_ally": {
      const allyId = await resolveId(sb, userId, "allies", (p.ally_id || p.id) as string, (p.ally_name || p.name) as string);
      if (!allyId) return;
      await sb.from("allies").delete().eq("id", allyId).eq("user_id", userId);
      await logActivity(sb, userId, "ally_deleted", "Ally removed", 0);
      return;
    }

    // ── PROFILE ──────────────────────────────────────────
    case "update_profile": {
      const updates: Record<string, unknown> = {};
      for (const key of PROFILE_ALLOWED) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      if (Object.keys(updates).length === 0) return;
      const { error } = await sb.from("profiles").update(updates).eq("id", userId);
      if (error) throw error;
      await logActivity(sb, userId, "profile_updated", `Profile updated: ${Object.keys(updates).join(", ")}`, 0);
      return;
    }

    // ── XP ───────────────────────────────────────────────
    case "award_xp": {
      const amount = Number(p.amount || 0);
      await awardXP(sb, userId, amount);
      await logActivity(sb, userId, "xp_awarded", `MAVIS awarded ${amount} XP`, amount);
      return;
    }

    // ── RITUALS ──────────────────────────────────────────
    case "create_ritual": {
      const { error } = await sb.from("rituals").insert({
        user_id: userId,
        name: String(p.name || "New Ritual"),
        description: String(p.description || ""),
        type: String(p.type || "other"),
        category: p.category ? String(p.category) : null,
        xp_reward: Number(p.xp_reward || 25),
        completed: false,
        streak: 0,
      });
      if (error) throw error;
      return;
    }

    case "update_ritual": {
      const ritualId = await resolveId(sb, userId, "rituals", (p.ritual_id || p.id) as string, (p.ritual_name || p.name) as string);
      if (!ritualId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["name", "description", "type", "category", "xp_reward"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      await sb.from("rituals").update(updates).eq("id", ritualId).eq("user_id", userId);
      return;
    }

    case "complete_ritual": {
      const ritualId = await resolveId(sb, userId, "rituals", (p.ritual_id || p.id) as string, (p.ritual_name || p.name) as string);
      if (!ritualId) return;
      const { data: ritual } = await sb.from("rituals").select("xp_reward, name, streak").eq("id", ritualId).eq("user_id", userId).single();
      if (!ritual) return;
      await sb.from("rituals").update({
        completed: true,
        streak: (ritual.streak || 0) + 1,
        last_completed: new Date().toISOString(),
      }).eq("id", ritualId).eq("user_id", userId);
      await awardXP(sb, userId, Number(ritual.xp_reward || 0));
      await logActivity(sb, userId, "ritual_completed", `Ritual: ${ritual.name}`, Number(ritual.xp_reward || 0));
      return;
    }

    case "delete_ritual": {
      const ritualId = await resolveId(sb, userId, "rituals", (p.ritual_id || p.id) as string, (p.ritual_name || p.name) as string);
      if (!ritualId) return;
      await sb.from("rituals").delete().eq("id", ritualId).eq("user_id", userId);
      return;
    }

    // ── TRANSFORMATIONS ─────────────────────────────────
    case "create_transformation": {
      const { error } = await sb.from("transformations").insert({
        user_id: userId,
        name: String(p.name || "New Form"),
        tier: String(p.tier || "Base"),
        form_order: Number(p.form_order || 0),
        bpm_range: String(p.bpm_range || "65–75"),
        energy: String(p.energy || "Ki"),
        jjk_grade: String(p.jjk_grade || "Special Grade"),
        op_tier: String(p.op_tier || "God Tier"),
        description: p.description ? String(p.description) : null,
        category: p.category ? String(p.category) : null,
        unlocked: Boolean(p.unlocked ?? false),
        active_buffs: p.active_buffs || [],
        passive_buffs: p.passive_buffs || [],
        abilities: p.abilities || [],
      });
      if (error) throw error;
      await logActivity(sb, userId, "transformation_created", `Form created: ${String(p.name || "New Form")}`, 0);
      return;
    }

    case "update_transformation": {
      const transformId = await resolveId(sb, userId, "transformations", (p.transformation_id || p.id) as string, (p.transformation_name || p.name) as string);
      if (!transformId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["name", "tier", "form_order", "bpm_range", "energy", "jjk_grade", "op_tier", "description", "category", "unlocked", "active_buffs", "passive_buffs", "abilities"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      await sb.from("transformations").update(updates).eq("id", transformId).eq("user_id", userId);
      await logActivity(sb, userId, "transformation_updated", `Form updated: ${String(p.name || transformId)}`, 0);
      return;
    }

    case "delete_transformation": {
      const transformId = await resolveId(sb, userId, "transformations", (p.transformation_id || p.id) as string, (p.transformation_name || p.name) as string);
      if (!transformId) return;
      await sb.from("transformations").delete().eq("id", transformId).eq("user_id", userId);
      await logActivity(sb, userId, "transformation_deleted", "Form deleted", 0);
      return;
    }

    // ── STORE ITEMS ──────────────────────────────────────
    case "create_store_item": {
      const { error } = await sb.from("store_items").insert({
        user_id: userId,
        name: String(p.name || "New Item"),
        description: String(p.description || ""),
        price: Number(p.price || 100),
        currency: String(p.currency || "Codex Points"),
        rarity: String(p.rarity || "common"),
        category: String(p.category || "consumable"),
        effect: p.effect ? String(p.effect) : null,
        req_level: p.req_level ? Number(p.req_level) : null,
        req_rank: p.req_rank ? String(p.req_rank) : null,
      });
      if (error) throw error;
      await logActivity(sb, userId, "store_item_created", `Store item: ${String(p.name || "New Item")}`, 0);
      return;
    }

    case "update_store_item": {
      const itemId = await resolveId(sb, userId, "store_items", (p.item_id || p.id) as string, (p.item_name || p.name) as string);
      if (!itemId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["name", "description", "price", "currency", "rarity", "category", "effect", "req_level", "req_rank"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      updates.updated_at = new Date().toISOString();
      await sb.from("store_items").update(updates).eq("id", itemId).eq("user_id", userId);
      return;
    }

    case "delete_store_item": {
      const itemId = await resolveId(sb, userId, "store_items", (p.item_id || p.id) as string, (p.item_name || p.name) as string);
      if (!itemId) return;
      await sb.from("store_items").delete().eq("id", itemId).eq("user_id", userId);
      return;
    }

    // ── RANKINGS PROFILES ────────────────────────────────
    case "create_ranking":
    case "create_ranking_profile":
    case "add_ranking":
    case "add_to_rankings": {
      const { error } = await sb.from("rankings_profiles").insert({
        user_id: userId,
        display_name: String(p.display_name || p.name || "Unknown"),
        role: String(p.role || "npc"),
        rank: String(p.rank || "D"),
        level: Number(p.level || 1),
        jjk_grade: String(p.jjk_grade || "G4"),
        op_tier: String(p.op_tier || "Local"),
        gpr: Number(p.gpr || 1000),
        pvp: Number(p.pvp || 5000),
        influence: String(p.influence || "Local"),
        notes: String(p.notes || ""),
        is_self: Boolean(p.is_self || false),
      });
      if (error) throw error;
      await logActivity(sb, userId, "ranking_created", `Ranking: ${String(p.display_name || p.name || "Unknown")}`, 0);
      return;
    }

    case "update_ranking":
    case "update_ranking_profile": {
      const rankingId = await resolveId(sb, userId, "rankings_profiles", (p.ranking_id || p.profile_id || p.id) as string, (p.ranking_name || p.display_name || p.name) as string, "display_name");
      if (!rankingId) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["display_name", "role", "rank", "level", "jjk_grade", "op_tier", "gpr", "pvp", "influence", "notes", "is_self"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      if (p.name !== undefined && !updates.display_name) updates.display_name = p.name;
      updates.updated_at = new Date().toISOString();
      await sb.from("rankings_profiles").update(updates).eq("id", rankingId).eq("user_id", userId);
      await logActivity(sb, userId, "ranking_updated", `Ranking updated: ${String(p.display_name || p.name || rankingId)}`, 0);
      return;
    }

    case "delete_ranking":
    case "delete_ranking_profile": {
      const rankingId = await resolveId(sb, userId, "rankings_profiles", (p.ranking_id || p.profile_id || p.id) as string, (p.ranking_name || p.display_name || p.name) as string, "display_name");
      if (!rankingId) return;
      await sb.from("rankings_profiles").delete().eq("id", rankingId).eq("user_id", userId);
      await logActivity(sb, userId, "ranking_deleted", "Ranking removed", 0);
      return;
    }

    // ── BPM SESSION ──────────────────────────────────────
    case "log_bpm_session": {
      const { error } = await sb.from("bpm_sessions").insert({
        user_id: userId,
        bpm: Number(p.bpm || 72),
        duration: Number(p.duration || 0),
        form: String(p.form || "Base"),
        mood: p.mood ? String(p.mood) : null,
        notes: p.notes ? String(p.notes) : null,
      });
      if (error) throw error;
      await logActivity(sb, userId, "bpm_logged", `BPM session: ${p.bpm}bpm`, 0);
      return;
    }

    default:
      throw new Error(`Unknown MAVIS action: ${action.type}`);
  }
}

// ── Main handler ──────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const body = await req.json();
    const actions = Array.isArray(body?.actions) ? (body.actions as MavisAction[]) : [];

    const results: Array<{ type: string; success: boolean; error?: string }> = [];
    for (const action of actions) {
      try {
        await executeAction(adminClient, userId, action);
        results.push({ type: action.type, success: true });
      } catch (error) {
        console.error("mavis-actions failed:", action.type, serializeError(error));
        results.push({
          type: action.type,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mavis-actions fatal:", serializeError(error));
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
