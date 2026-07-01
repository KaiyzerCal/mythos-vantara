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

async function logActivity(sb: any, userId: string, eventType: string, description: string, xpAmount: number) {
  await sb.from("activity_log").insert({ user_id: userId, event_type: eventType, description, xp_amount: xpAmount });
}

async function awardXP(sb: any, userId: string, amount: number) {
  const { data: profile } = await sb.from("profiles").select("xp, xp_to_next_level, level, operator_xp, operator_level").eq("id", userId).single();
  if (!profile) return;

  let xp: number = Number(profile.xp || 0) + amount;
  let level: number = Number(profile.level || 1);
  let threshold: number = Number(profile.xp_to_next_level || 500);

  while (xp >= threshold) {
    xp -= threshold;
    level++;
    threshold = Math.floor(200 * Math.pow(level, 1.45));
  }

  await sb.from("profiles").update({
    xp,
    level,
    xp_to_next_level: threshold,
    operator_xp: Number(profile.operator_xp || 0) + amount,
  }).eq("id", userId);
}

// ── Name-based ID resolver ────────────────────────────────
async function resolveId(
  sb: any,
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
  return (data?.id as string) || "";
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
  "create_task": "create_quest", "add_task": "create_quest", "new_task": "create_quest",
  "create_habit": "create_quest", "add_habit": "create_quest",
  "complete_task": "complete_quest", "finish_task": "complete_quest",
  "delete_task": "delete_quest", "remove_task": "delete_quest",
  "update_task": "update_quest", "edit_task": "update_quest",
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
async function executeAction(sb: any, userId: string, action: MavisAction) {
  // Support both nested { type, params: {...} } and flat { type, title, ... } formats.
  // Telegram/Claude may send flat; frontend always sends nested.
  const p: Record<string, unknown> = (action.params && typeof action.params === "object")
    ? action.params as Record<string, unknown>
    : (({ type: _t, params: _p, ...rest }) => rest)(action as any);
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
        parent_quest_id: p.parent_quest_id ? String(p.parent_quest_id) : null,
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

    // ── TASKS (legacy — all task actions redirect to quests) ─────────────
    // NOTE: create_task / complete_task / update_task / delete_task are
    // handled via ACTION_ALIASES above (→ create_quest / complete_quest /
    // update_quest / delete_quest). These cases are kept as a safety net
    // in case an alias lookup is bypassed (e.g. direct switch fall-through).
    case "create_task": {
      // Redirect: insert as a quest (type "side") instead of the tasks table
      const { error } = await sb.from("quests").insert({
        user_id: userId,
        title: String(p.title || "New Quest"),
        description: p.description ? String(p.description) : null,
        type: String(p.type && p.type !== "task" && p.type !== "habit" ? p.type : "side"),
        status: "active",
        difficulty: String(p.difficulty || "Normal"),
        xp_reward: Number(p.xp_reward || 25),
        codex_points_reward: 0,
        progress_current: 0,
        progress_target: 1,
        parent_quest_id: p.parent_quest_id ? String(p.parent_quest_id) : null,
      });
      if (error) throw error;
      await logActivity(sb, userId, "quest_created", `Quest created (via create_task): ${String(p.title || "New Quest")}`, 0);
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
      const { data: newEntry, error } = await sb.from("journal_entries").insert({
        user_id: userId,
        title: String(p.title || "New Entry"),
        content: String(p.content || ""),
        tags: asStringArray(p.tags),
        category: String(p.category || "personal"),
        importance: String(p.importance || "medium"),
        mood: p.mood ? String(p.mood) : null,
        xp_earned: xp,
      }).select("id").single();
      if (error) throw error;
      await awardXP(sb, userId, xp);
      await logActivity(sb, userId, "journal_created", `Journal: ${String(p.title || "New Entry")}`, xp);

      // After successful journal entry insert, tag emotions asynchronously
      if (newEntry?.id) {
        (async () => {
          try {
            await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-emotion-tag`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
              body: JSON.stringify({ journal_entry_id: newEntry.id, content: p.content ?? p.title ?? "", user_id: userId }),
            });
          } catch { /* non-critical */ }
        })();
      }

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
      const { data: vd, error } = await sb.from("vault_entries").insert({
        user_id: userId,
        title: String(p.title || "New Entry"),
        content: String(p.content || ""),
        category: String(p.category || "personal"),
        importance: String(p.importance || "medium"),
        attachments: asStringArray(p.attachments),
      }).select("id").maybeSingle();
      if (error) throw error;
      await logActivity(sb, userId, "vault_created", `Vault: ${String(p.title || "New Entry")}`, 0);
      return { entryId: vd?.id ?? null };
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

    // ── PERSONA FORGE ────────────────────────────────────
    case "forge_persona":
    case "create_persona":
    case "new_persona":
    case "add_persona": {
      const description = String(p.description || p.prompt || p.spec || p.name || "").trim();
      if (!description) throw new Error("forge_persona requires a 'description' parameter");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-persona-forge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
          "apikey": serviceRoleKey,
        },
        body: JSON.stringify({ user_id: userId, description }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`persona-forge failed (${res.status}): ${txt}`);
      }
      const data = await res.json();
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
      const personaName = data?.persona?.name || "New Persona";
      await logActivity(sb, userId, "persona_forged", `Persona forged via MAVIS: ${personaName}`, 0);
      return;
    }

    case "delete_persona": {
      const personaId = await resolveId(sb, userId, "personas", (p.persona_id || p.id) as string, (p.persona_name || p.name) as string);
      if (!personaId) return;
      await sb.from("personas").update({ is_active: false }).eq("id", personaId).eq("user_id", userId);
      await logActivity(sb, userId, "persona_deleted", `Persona archived: ${String(p.persona_name || p.name || personaId)}`, 0);
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

    // ── GOAL — autonomous multi-step agentic execution ────────────────
    // MAVIS queues a goal task. The task executor runs it every 15 min:
    // plan → act → observe → re-plan until objective is achieved.
    case "goal":
    case "set_goal":
    case "autonomous_goal":
    case "run_goal": {
      const objective = String(p.objective ?? p.goal ?? p.description ?? (action as any).objective ?? "").trim();
      if (!objective) throw new Error("goal requires an 'objective' parameter");
      const context = String(p.context ?? (action as any).context ?? "").trim();
      const { error } = await sb.from("mavis_tasks").insert({
        user_id: userId,
        type: "goal",
        description: `GOAL: ${objective.slice(0, 120)}`,
        payload: { objective, context, created_from: "mavis-actions" },
        status: "pending",
      });
      if (error) throw error;

      // Insert into mavis_goals for tracking + fire decomposition engine
      const { data: goalRecord } = await sb.from("mavis_goals").insert({
        user_id:   userId,
        objective: objective.slice(0, 500),
        context:   context.slice(0, 500),
        status:    "active",
      }).select("id").single();

      // Fire goal decomposition engine asynchronously (non-blocking)
      if (goalRecord?.id) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        fetch(`${supabaseUrl}/functions/v1/mavis-goal-engine`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ goal_id: goalRecord.id, objective, context, user_id: userId }),
        }).catch(() => {});
      }

      await logActivity(sb, userId, "goal_queued", `Autonomous goal: ${objective.slice(0, 80)}`, 0);
      return;
    }

    // ── COUNCIL NOTIFY — direct Telegram from a council member ──────────
    case "council_notify": {
      const msg = String(p.message ?? (action as any).message ?? "").slice(0, 1000);
      if (!msg) break;
      const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
      const chatId   = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID");
      if (botToken && chatId) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: msg }),
        });
        await logActivity(sb, userId, "council_notify", `Council alert: ${msg.slice(0, 80)}`, 1);
      }
      break;
    }

    // ── NORA TWEET — queue for confirmation then fire via task executor ──
    case "nora_tweet": {
      const content = String(p.content ?? (action as any).content ?? "").slice(0, 280);
      if (!content) throw new Error("nora_tweet requires content");
      const { error } = await sb.from("mavis_tasks").insert({
        user_id: userId,
        type: "nora_tweet",
        description: `Nora tweet: "${content.slice(0, 60)}${content.length > 60 ? "…" : ""}"`,
        payload: { content, reply_to_tweet_id: p.replyToTweetId ?? (action as any).replyToTweetId ?? null },
        status: "requires_confirmation",
      });
      if (error) throw error;
      await logActivity(sb, userId, "nora_tweet_queued", `Tweet queued: ${content.slice(0, 60)}`, 0);
      return;
    }

    // ── PROPOSE PRODUCT — queue for operator approval ──────────────────
    case "propose_product": {
      const title       = String(p.title ?? (action as any).title ?? "New Product");
      const description = String(p.description ?? (action as any).description ?? "");
      const priceCents  = Number(p.price_cents ?? (action as any).price_cents ?? 2900);
      const payload = { ...p, ...(action as any), type: "propose_product", title, description, price_cents: priceCents };
      const { error } = await sb.from("mavis_tasks").insert({
        user_id: userId,
        type: "create_product",
        description: `Product proposal: "${title}" — $${(priceCents / 100).toFixed(2)}`,
        payload,
        status: "requires_confirmation",
      });
      if (error) throw error;
      await logActivity(sb, userId, "product_proposed", `Product proposed: ${title}`, 0);
      return;
    }

    // ── KNOWLEDGE GRAPH ──────────────────────────────────
    case "create_note":
    case "new_note":
    case "add_note": {
      const now = new Date().toISOString();
      const { data: noteData, error } = await sb.from("mavis_notes").insert({
        user_id: userId,
        title: String(p.title || "Untitled Note"),
        content: String(p.content || ""),
        tags: asStringArray(p.tags),
        aliases: asStringArray(p.aliases),
        properties: (p.properties && typeof p.properties === "object") ? p.properties : {},
        created_at: now,
        updated_at: now,
      }).select("id").single();
      if (error) throw error;
      await logActivity(sb, userId, "note_created", `Note created: ${String(p.title || "Untitled Note")}`, 0);
      return;
    }

    case "update_note":
    case "edit_note": {
      const noteId = await resolveId(sb, userId, "mavis_notes", (p.note_id || p.id) as string, (p.note_title || p.title) as string, "title");
      if (!noteId) return;
      // Snapshot current version before updating
      const { data: current } = await sb.from("mavis_notes").select("title,content").eq("id", noteId).eq("user_id", userId).single();
      if (current) {
        const { data: lastVer } = await sb.from("mavis_note_versions").select("version_number").eq("note_id", noteId).order("version_number", { ascending: false }).limit(1).single();
        const nextVer = ((lastVer?.version_number as number) ?? 0) + 1;
        await sb.from("mavis_note_versions").insert({
          note_id: noteId,
          title: current.title,
          content: current.content,
          version_number: nextVer,
        });
      }
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (p.title !== undefined) updates.title = String(p.title);
      if (p.content !== undefined) updates.content = String(p.content);
      if (p.tags !== undefined) updates.tags = asStringArray(p.tags);
      if (p.aliases !== undefined) updates.aliases = asStringArray(p.aliases);
      if (p.properties !== undefined && typeof p.properties === "object") updates.properties = p.properties;
      await sb.from("mavis_notes").update(updates).eq("id", noteId).eq("user_id", userId);
      await logActivity(sb, userId, "note_updated", `Note updated: ${String(p.title || noteId)}`, 0);
      return;
    }

    case "delete_note":
    case "remove_note": {
      const noteId = await resolveId(sb, userId, "mavis_notes", (p.note_id || p.id) as string, (p.note_title || p.title) as string, "title");
      if (!noteId) return;
      await sb.from("mavis_note_links").delete().or(`source_note_id.eq.${noteId},target_note_id.eq.${noteId}`);
      await sb.from("mavis_note_versions").delete().eq("note_id", noteId);
      await sb.from("mavis_notes").delete().eq("id", noteId).eq("user_id", userId);
      await logActivity(sb, userId, "note_deleted", `Note deleted: ${String(p.title || noteId)}`, 0);
      return;
    }

    case "link_notes":
    case "add_note_link": {
      const sourceId = await resolveId(sb, userId, "mavis_notes", p.source_note_id as string, p.source_note as string, "title");
      const targetId = await resolveId(sb, userId, "mavis_notes", p.target_note_id as string, p.target_note as string, "title");
      if (!sourceId || !targetId) throw new Error("link_notes: could not resolve source or target note");
      const { error } = await sb.from("mavis_note_links").insert({
        source_note_id: sourceId,
        target_note_id: targetId,
        type: String(p.type || "relates_to"),
        description: p.description ? String(p.description) : null,
      });
      if (error) throw error;
      return;
    }

    case "unlink_notes":
    case "remove_note_link": {
      const linkId = p.link_id ? String(p.link_id) : null;
      if (linkId) {
        await sb.from("mavis_note_links").delete().eq("id", linkId);
      } else {
        const sourceId = await resolveId(sb, userId, "mavis_notes", p.source_note_id as string, p.source_note as string, "title");
        const targetId = await resolveId(sb, userId, "mavis_notes", p.target_note_id as string, p.target_note as string, "title");
        if (sourceId && targetId) {
          await sb.from("mavis_note_links").delete().eq("source_note_id", sourceId).eq("target_note_id", targetId);
        }
      }
      return;
    }

    // ── CONTACTS ─────────────────────────────────────────────────────────
    case "create_contact":
    case "add_contact":
    case "new_contact": {
      const { error } = await sb.from("contacts").insert({
        user_id: userId,
        name: String(p.name || "New Contact"),
        relationship_type: String(p.relationship_type || p.relationship || "personal"),
        last_contact_at: p.last_contact_at ? String(p.last_contact_at) : null,
        follow_up_date: p.follow_up_date ? String(p.follow_up_date) : null,
        notes: String(p.notes || ""),
        tags: asStringArray(p.tags),
        profile: (p.profile && typeof p.profile === "object") ? p.profile : {},
      });
      if (error) throw error;
      await logActivity(sb, userId, "contact_created", `Contact added: ${String(p.name || "New Contact")}`, 0);
      return;
    }

    case "update_contact":
    case "edit_contact": {
      const contactId = await resolveId(sb, userId, "contacts", (p.contact_id || p.id) as string, (p.contact_name || p.name) as string);
      if (!contactId) return;
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const key of ["name", "relationship_type", "last_contact_at", "follow_up_date", "notes", "tags", "profile"]) {
        if (p[key] !== undefined) updates[key] = key === "tags" ? asStringArray(p[key]) : p[key];
      }
      await sb.from("contacts").update(updates).eq("id", contactId).eq("user_id", userId);
      return;
    }

    case "log_contact":
    case "log_interaction":
    case "contact_interaction": {
      const contactId = await resolveId(sb, userId, "contacts", (p.contact_id || p.id) as string, (p.contact_name || p.name) as string);
      if (!contactId) return;
      await sb.from("contact_interactions").insert({
        user_id: userId,
        contact_id: contactId,
        interaction_type: String(p.interaction_type || p.type || "note"),
        notes: String(p.notes || p.content || ""),
        sentiment: String(p.sentiment || "neutral"),
      });
      // Bump last_contact_at and interaction_count
      const { data: contact } = await sb.from("contacts").select("interaction_count").eq("id", contactId).eq("user_id", userId).single();
      await sb.from("contacts").update({
        last_contact_at: new Date().toISOString(),
        interaction_count: Number(contact?.interaction_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", contactId).eq("user_id", userId);
      return;
    }

    // ── LOG EXPENSE ──────────────────────────────────────────────────────
    case "log_expense":
    case "expense": {
      const description = String(p.description ?? p.title ?? (action as any).description ?? "").trim();
      const amount      = Number(p.amount ?? (action as any).amount ?? 0);
      if (!description || amount <= 0) throw new Error("expense requires description and amount > 0");
      const { error } = await sb.from("mavis_expenses").insert({
        user_id:      userId,
        description:  description.slice(0, 200),
        amount,
        currency:     String(p.currency ?? "USD"),
        category:     String(p.category ?? "general"),
        source:       String(p.source ?? ""),
        expense_date: p.date ? String(p.date) : new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;
      await logActivity(sb, userId, "expense_logged", `Expense: $${amount.toFixed(2)} — ${description.slice(0, 60)}`, 0);
      return;
    }

    case "run_code":
    case "execute_code": {
      const code = String(p.code ?? "").trim();
      if (!code) throw new Error("run_code requires a 'code' parameter");

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-code-exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error(`Code exec service error (${res.status})`);

      const data = await res.json();
      if (data.error) throw new Error(`Runtime error: ${data.error}`);

      // Persist result as a knowledge note so MAVIS can reference it in context
      const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const resultNote = [
        "```javascript",
        code.slice(0, 2000),
        "```",
        "",
        "**Output:**",
        "```",
        ...(data.output ?? []),
        data.result !== undefined ? `\nReturn: ${data.result}` : "",
        "```",
      ].join("\n");

      await sb.from("mavis_notes").insert({
        user_id:    userId,
        title:      `[CODE] ${timestamp}`,
        content:    resultNote.slice(0, 8000),
        tags:       ["code-execution", "auto"],
        aliases:    [],
        properties: { skip_sr: true, source: "code_exec" },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).catch(() => {});

      return;
    }

    case "generate_image":
    case "image_gen":
    case "create_image": {
      const prompt = String(p.prompt ?? p.description ?? "").trim();
      if (!prompt) throw new Error("generate_image requires a 'prompt' parameter");
      const aspectRatio = String(p.aspect_ratio ?? "1:1");
      const saveToVault = p.save_to_vault !== false;

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

      let imageUrl = "";
      let imageb64 = "";
      let note = "";

      // Try Gemini Imagen first
      if (geminiKey) {
        try {
          const imgRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                instances: [{ prompt }],
                parameters: { sampleCount: 1, aspectRatio },
              }),
            }
          );
          if (imgRes.ok) {
            const imgData = await imgRes.json();
            imageb64 = imgData?.predictions?.[0]?.bytesBase64Encoded ?? "";
            if (imageb64) {
              imageUrl = `data:image/png;base64,${imageb64}`;
            }
          }
        } catch {
          // fall through to vault fallback
        }
      }

      // Fallback: save prompt to vault for manual creation
      if (!imageUrl) {
        note = "Image generation requires Imagen API access. Prompt saved to vault.";
        if (saveToVault) {
          await sb.from("vault_entries").insert({
            user_id: userId,
            title: `[Image Prompt] ${prompt.slice(0, 60)}`,
            content: `**Prompt:** ${prompt}\n\n**Aspect Ratio:** ${aspectRatio}\n\n*Awaiting manual image generation.*`,
            category: "image-prompt",
            tags: ["image-prompt", "ai-generated"],
            is_public: false,
          }).catch(() => {});
        }
        return { note, prompt, aspect_ratio: aspectRatio };
      }

      // Upload image to vault-media storage if we have base64
      if (saveToVault && imageb64) {
        try {
          const bytes = Uint8Array.from(atob(imageb64), c => c.charCodeAt(0));
          const fileName = `mavis-gen-${Date.now()}.png`;
          const storagePath = `${userId}/${fileName}`;
          await sb.storage.from("vault-media").upload(storagePath, bytes.buffer, { contentType: "image/png" });
          const { data: pubData } = sb.storage.from("vault-media").getPublicUrl(storagePath);
          if (pubData?.publicUrl) imageUrl = pubData.publicUrl;
          await sb.from("vault_media").insert({
            user_id: userId,
            file_name: fileName,
            file_url: imageUrl,
            file_type: "image",
            file_size: bytes.length,
            description: `AI-generated: ${prompt.slice(0, 120)}`,
            tags: ["ai-generated", "mavis-gen"],
          }).catch(() => {});
        } catch {
          // Keep base64 URL as fallback
        }
      }

      await logActivity(sb, userId, "image_generated", `Generated image: ${prompt.slice(0, 60)}`, 5);
      return { imageUrl, prompt, note };
    }

    case "generate_video": {
      const videoUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-video-gen`;
      const videoRes = await fetch(videoUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ ...action, user_id: userId }),
      });
      if (!videoRes.ok) throw new Error(`mavis-video-gen error: ${videoRes.status}`);
      return await videoRes.json();
    }

    case "video_status": {
      const vsUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-video-gen`;
      const vsRes = await fetch(vsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "status", ...action, user_id: userId }),
      });
      if (!vsRes.ok) throw new Error(`mavis-video-gen status error: ${vsRes.status}`);
      return await vsRes.json();
    }

    case "create_website": {
      const wbUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-web-builder`;
      const wbRes = await fetch(wbUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ ...action, user_id: userId }),
      });
      if (!wbRes.ok) throw new Error(`mavis-web-builder error: ${wbRes.status}`);
      return await wbRes.json();
    }

    case "publish_webpage": {
      const pwUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-wordpress`;
      const pwRes = await fetch(pwUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "create_page", ...action, user_id: userId }),
      });
      if (!pwRes.ok) throw new Error(`mavis-wordpress error: ${pwRes.status}`);
      return await pwRes.json();
    }

    case "create_widget": {
      const wgUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-widget-gen`;
      const wgRes = await fetch(wgUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "generate", ...action, user_id: userId }),
      });
      if (!wgRes.ok) throw new Error(`mavis-widget-gen error: ${wgRes.status}`);
      return await wgRes.json();
    }

    case "plan_execute": {
      const planUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-planner`;
      const planRes = await fetch(planUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ user_id: userId, params: (action as any).params }),
      });
      if (!planRes.ok) throw new Error(`mavis-planner error: ${planRes.status}`);
      return await planRes.json();
    }

    case "analyze_video": {
      const avUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-video-editor`;
      const avRes = await fetch(avUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "analyze", user_id: userId, ...action }),
      });
      if (!avRes.ok) throw new Error(`mavis-video-editor error: ${avRes.status}`);
      return await avRes.json();
    }

    case "generate_clips": {
      const gcUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-video-editor`;
      const gcRes = await fetch(gcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "generate_clips", user_id: userId, ...action }),
      });
      if (!gcRes.ok) throw new Error(`mavis-video-editor generate_clips error: ${gcRes.status}`);
      return await gcRes.json();
    }

    case "render_clip": {
      const rcUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-video-render`;
      const rcRes = await fetch(rcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "render", user_id: userId, ...action }),
      });
      if (!rcRes.ok) throw new Error(`mavis-video-render error: ${rcRes.status}`);
      return await rcRes.json();
    }

    // ── Social Persona Agent ───────────────────────────────────────────────
    // Multi-persona social media posting (Nora Vale, BioneerX, etc.).
    // Personas are configured in mavis_social_personas. Credentials are
    // env vars keyed by each persona's cred_prefix.
    case "social_upsert_persona":
    case "social_get_persona":
    case "social_list_personas":
    case "social_generate_post":
    case "social_schedule_post":
    case "social_post_now":
    case "social_list_posts":
    case "social_process_scheduled": {
      const socialActionMap: Record<string, string> = {
        social_upsert_persona:    "upsert_persona",
        social_get_persona:       "get_persona",
        social_list_personas:     "list_personas",
        social_generate_post:     "generate_post",
        social_schedule_post:     "schedule_post",
        social_post_now:          "post_now",
        social_list_posts:        "list_posts",
        social_process_scheduled: "process_scheduled",
      };
      const socialRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-persona-social`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: socialActionMap[action.type], userId, ...p }),
        signal: AbortSignal.timeout(30_000),
      });
      const socialData = await socialRes.json().catch(() => ({}));
      if (!socialRes.ok) throw new Error((socialData as any).error ?? `persona-social returned ${socialRes.status}`);
      return socialData;
    }

    // ── Salesforce CRM ────────────────────────────────────────────────────
    // Proxies to mavis-salesforce. action.sf_action selects the sub-action.
    case "salesforce_query":
    case "salesforce_search":
    case "salesforce_get_record":
    case "salesforce_create_record":
    case "salesforce_update_record":
    case "salesforce_log_activity":
    case "salesforce_get_crm_context": {
      const sfAction = action.type.replace("salesforce_", "");
      const sfRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-salesforce`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: sfAction, userId, ...p }),
        signal: AbortSignal.timeout(25_000),
      });
      const sfData = await sfRes.json().catch(() => ({}));
      if (!sfRes.ok) throw new Error((sfData as any).error ?? `Salesforce returned ${sfRes.status}`);
      return sfData;
    }

    // ── Booking system ────────────────────────────────────────────────────
    // Venue search (OSM), calendar-backed reservations, booking management.
    case "booking_find_venue":
    case "booking_create":
    case "booking_list":
    case "booking_cancel":
    case "booking_update": {
      const bookingActionMap: Record<string, string> = {
        booking_find_venue: "find_venue",
        booking_create:     "create_booking",
        booking_list:       "list_bookings",
        booking_cancel:     "cancel_booking",
        booking_update:     "update_booking",
      };
      const bookRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: bookingActionMap[action.type], userId, ...p }),
        signal: AbortSignal.timeout(25_000),
      });
      const bookData = await bookRes.json().catch(() => ({}));
      if (!bookRes.ok) throw new Error((bookData as any).error ?? `Booking returned ${bookRes.status}`);
      return bookData;
    }

    // ── Device Command — queue a command for the MAVIS bridge ────────────
    // Sends the command to mavis-device-bridge and optionally polls for result.
    case "device_command": {
      const SB_URL = Deno.env.get("SUPABASE_URL")!;
      const SRK    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      // Queue the command
      const queueRes = await fetch(`${SB_URL}/functions/v1/mavis-device-bridge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SRK}` },
        body: JSON.stringify({
          action: "queue_command",
          userId,
          device_id: p.device_id,
          command_type: p.command_type,
          params: p.params ?? {},
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const queueData = await queueRes.json().catch(() => ({}));
      if (!queueRes.ok) throw new Error((queueData as any).error ?? `mavis-device-bridge returned ${queueRes.status}`);

      const commandId = (queueData as any).command_id;
      if (!commandId) throw new Error("device_command: no command_id returned");

      // Optionally poll for result (up to 30s, 1s intervals)
      if (p.wait_for_result) {
        for (let i = 0; i < 30; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          const pollRes = await fetch(`${SB_URL}/functions/v1/mavis-device-bridge`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SRK}` },
            body: JSON.stringify({ action: "get_command", userId, command_id: commandId }),
            signal: AbortSignal.timeout(5_000),
          });
          const pollData = await pollRes.json().catch(() => ({}));
          const cmd = (pollData as any).command;
          if (cmd?.status === "done" || cmd?.status === "failed") {
            return { command_id: commandId, status: cmd.status, result: cmd.result, error: cmd.error };
          }
        }
        return { command_id: commandId, status: "timeout", note: "Command did not complete within 30s" };
      }

      return { command_id: commandId, status: "queued" };
    }

    // ── HeyGen AI Avatar Video ────────────────────────────────────────────────
    // generate_video | get_video_status | list_avatars | list_voices
    case "heygen_agent": {
      const hgRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-heygen-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ userId, action: p.action ?? (action as any).params?.action, ...p }),
        signal: AbortSignal.timeout(150_000), // 2.5 min — polling can take ~120 s
      });
      const hgData = await hgRes.json().catch(() => ({}));
      if (!hgRes.ok) throw new Error((hgData as any).error ?? `mavis-heygen-agent returned ${hgRes.status}`);
      return hgData;
    }

    // ── Avatar Video (Photo → Lip-Sync via fal.ai SadTalker) ─────────────────
    // generate (source_image_url + text/audio_url + voice_id) | poll (request_id)
    case "avatar_video": {
      const avRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-avatar-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: p.action ?? "generate", user_id: userId, ...p }),
        signal: AbortSignal.timeout(120_000),
      });
      const avData = await avRes.json().catch(() => ({}));
      if (!avRes.ok) throw new Error((avData as any).error ?? `mavis-avatar-video returned ${avRes.status}`);
      return avData;
    }

    // ── Higgsfield Cinematic Video ────────────────────────────────────────────
    // generate_video | get_video_status | list_models
    // Specialties: image animation, camera motion, character consistency
    case "higgsfield_agent": {
      const hfRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-higgsfield`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ userId, action: p.action ?? (action as any).params?.action, ...p }),
        signal: AbortSignal.timeout(150_000),
      });
      const hfData = await hfRes.json().catch(() => ({}));
      if (!hfRes.ok) throw new Error((hfData as any).error ?? `mavis-higgsfield returned ${hfRes.status}`);
      return hfData;
    }

    case "get_biometric_state": {
      const [{ data: camData }, { data: wifiData }] = await Promise.all([
        sb.from("mavis_biometric_state").select("*").eq("user_id", userId)
          .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("mavis_ruview_state").select("*").eq("user_id", userId).maybeSingle(),
      ]);
      if (!camData && !wifiData) {
        return { message: "No biometric state recorded yet. Start MediaPipe vision tracking or configure a RuView WiFi sensor." };
      }
      return {
        camera: camData ?? null,
        wifi_sensing: wifiData ?? null,
        summary: {
          present: wifiData?.present ?? null,
          n_persons: wifiData?.n_persons ?? null,
          heart_rate_bpm: wifiData?.heart_rate_bpm ?? null,
          breathing_rate_bpm: wifiData?.breathing_rate_bpm ?? null,
          stress_score: wifiData?.stress_score ?? null,
          sleep_stage: wifiData?.sleep_stage ?? null,
          fall_detected: wifiData?.fall_detected ?? false,
          pose_confidence: wifiData?.pose_confidence ?? camData?.pose_confidence ?? null,
          room_id: wifiData?.room_id ?? null,
          updated_at: wifiData?.updated_at ?? camData?.updated_at ?? null,
        },
      };
    }

    case "list_gestures": {
      const { data } = await sb
        .from("mavis_gesture_commands")
        .select("gesture, action_type, action_payload, enabled, hold_ms")
        .eq("user_id", userId)
        .order("gesture", { ascending: true });
      return { gestures: data ?? [] };
    }

    case "map_gesture": {
      const p = params as any;
      if (!p.gesture || !p.action_type) throw new Error("map_gesture requires gesture and action_type");
      const { data, error } = await sb
        .from("mavis_gesture_commands")
        .upsert(
          { user_id: userId, gesture: p.gesture, action_type: p.action_type, action_payload: p.action_payload ?? {}, hold_ms: p.hold_ms ?? 500, enabled: true },
          { onConflict: "user_id,gesture" }
        )
        .select("gesture, action_type, hold_ms")
        .single();
      if (error) throw error;
      return { ok: true, mapping: data };
    }

    case "ruview_get_presence": {
      const { data } = await sb
        .from("mavis_ruview_state")
        .select("present, n_persons, presence_confidence, room_id, node_id, updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      return data ?? { message: "No RuView presence data yet. Configure a RuView WiFi sensor node." };
    }

    case "ruview_get_vitals": {
      const { data } = await sb
        .from("mavis_ruview_state")
        .select("heart_rate_bpm, breathing_rate_bpm, hrv_ms, stress_score, sleep_stage, apnea_events, updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      return data ?? { message: "No RuView vitals data yet. Configure a RuView WiFi sensor node." };
    }

    case "ruview_get_all": {
      const { data } = await sb
        .from("mavis_ruview_state")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      return data ?? { message: "No RuView data yet. Configure a RuView WiFi sensor node and point it at the mavis-ruview-bridge webhook." };
    }

    case "notion_agent": {
      const notionUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-notion-agent`;
      const notionRes = await fetch(notionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ ...(params as Record<string, unknown>), user_id: userId }),
      });
      if (!notionRes.ok) throw new Error(`mavis-notion-agent error: ${notionRes.status}`);
      return await notionRes.json();
    }

    case "brain_consolidate": {
      const bcUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-brain-consolidate`;
      const bcRes = await fetch(bcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!bcRes.ok) throw new Error(`mavis-brain-consolidate error: ${bcRes.status}`);
      return await bcRes.json();
    }

    case "notion_sync": {
      const syncUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-notion-sync`;
      const syncRes = await fetch(syncUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ user_id: userId, ...(params as Record<string, unknown>) }),
      });
      if (!syncRes.ok) throw new Error(`mavis-notion-sync error: ${syncRes.status}`);
      return await syncRes.json();
    }

    case "worldmonitor": {
      const wmUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-worldmonitor`;
      const wmRes = await fetch(wmUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ ...(params as Record<string, unknown>) }),
        signal: AbortSignal.timeout(30000),
      });
      if (!wmRes.ok) throw new Error(`mavis-worldmonitor error: ${wmRes.status}`);
      return await wmRes.json();
    }

    case "get_standing_orders": {
      const { data } = await sb
        .from("mavis_standing_orders")
        .select("id, order_text, enabled, created_at")
        .eq("user_id", userId)
        .eq("enabled", true)
        .order("created_at", { ascending: true });
      return { standing_orders: data ?? [] };
    }

    case "add_standing_order": {
      const p = params as any;
      if (!p.order_text) throw new Error("add_standing_order requires order_text");
      const { data, error } = await sb
        .from("mavis_standing_orders")
        .upsert(
          { user_id: userId, order_text: p.order_text, enabled: true },
          { onConflict: "user_id,order_text" }
        )
        .select("id, order_text")
        .single();
      if (error) throw error;
      return { ok: true, added: data };
    }

    case "remove_standing_order": {
      const p = params as any;
      if (!p.order_text && !p.order_id) throw new Error("remove_standing_order requires order_text or order_id");
      const q = sb.from("mavis_standing_orders").update({ enabled: false }).eq("user_id", userId);
      if (p.order_id) q.eq("id", p.order_id);
      else q.eq("order_text", p.order_text);
      const { error } = await q;
      if (error) throw error;
      return { ok: true };
    }

    case "list_skills": {
      const { data } = await sb
        .from("mavis_skill_definitions")
        .select("name, description, trigger_keywords, enabled, created_at")
        .eq("user_id", userId)
        .eq("enabled", true)
        .order("name", { ascending: true });
      return { skills: data ?? [], count: (data ?? []).length };
    }

    case "get_pending_reviews": {
      const { data } = await sb
        .from("mavis_notes")
        .select("id, title, tags, next_review_at, review_interval_days")
        .eq("user_id", userId)
        .lte("next_review_at", new Date().toISOString())
        .not("tags", "cs", '["daily-log"]')
        .order("next_review_at", { ascending: true })
        .limit((params as any).limit ?? 10);
      return { pending_reviews: data ?? [], count: (data ?? []).length };
    }

    case "recall_memory": {
      const p = params as any;
      if (!p.query) throw new Error("recall_memory requires query string");
      const queryLower = (p.query as string).toLowerCase();
      const limit = p.limit ?? 8;

      const [memoriesRes, sessionRes, tacitRes] = await Promise.all([
        sb.from("mavis_agent_memories")
          .select("content, summary, importance, tags, created_at")
          .eq("user_id", userId)
          .eq("status", "active")
          .ilike("content", `%${p.query}%`)
          .order("importance", { ascending: false })
          .limit(Math.ceil(limit / 2)),
        sb.from("mavis_memory")
          .select("content, role, importance_score, created_at")
          .eq("user_id", userId)
          .ilike("content", `%${p.query}%`)
          .gte("importance_score", 5)
          .order("created_at", { ascending: false })
          .limit(Math.floor(limit / 3)),
        sb.from("mavis_tacit")
          .select("key, value, category, created_at")
          .eq("user_id", userId)
          .ilike("value", `%${queryLower}%`)
          .limit(3),
      ]);

      const results = [
        ...(memoriesRes.data ?? []).map((r: any) => ({ source: "agent_memory", content: r.content, summary: r.summary, importance: r.importance, tags: r.tags, createdAt: r.created_at })),
        ...(sessionRes.data ?? []).map((r: any) => ({ source: "session_log", content: `[${r.role}] ${r.content}`, importance: r.importance_score ?? 5, createdAt: r.created_at })),
        ...(tacitRes.data ?? []).map((r: any) => ({ source: "tacit", content: `${r.key}: ${r.value}`, importance: 8, tags: [r.category] })),
      ].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)).slice(0, limit);

      return { query: p.query, results, count: results.length };
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

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // Parse body early — needed for service-role userId pass-through
    const body = await req.json();
    const actions = Array.isArray(body?.actions) ? (body.actions as MavisAction[]) : [];

    let userId: string;

    if (token === serviceRoleKey && body.userId) {
      // Server-to-server call (telegram-webhook, task-executor, etc.)
      // Trust the userId from the body when the service role key is presented
      userId = String(body.userId);
    } else {
      // Normal frontend call — validate the user's JWT
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
      userId = userData.user.id;
    }

    const results: Array<{ type: string; success: boolean; error?: string; data?: Record<string, unknown> }> = [];
    for (const action of actions) {
      try {
        const actionData = await executeAction(adminClient, userId, action);
        results.push({ type: action.type, success: true, data: (actionData as Record<string, unknown>) ?? undefined });
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
