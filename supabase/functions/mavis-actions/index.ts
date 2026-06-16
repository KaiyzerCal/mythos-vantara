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
  "create_inventory": "create_inventory_item",
  "update_item": "update_inventory_item", "edit_item": "update_inventory_item",
  "update_inventory": "update_inventory_item",
  "delete_item": "delete_inventory_item", "remove_item": "delete_inventory_item",
  "delete_inventory": "delete_inventory_item",
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
async function executeAction(sb: any, userId: string, action: MavisAction, req: Request) {
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
      if (!msg) return;
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
      return;
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

    // ── PROPOSE SYSTEM CHANGE — queue for operator approval ──────────────
    case "propose_system_change": {
      const title       = String(p.title ?? (action as any).title ?? "System Change");
      const description = String(p.description ?? (action as any).description ?? "");
      const proposedBy  = String(p.proposed_by ?? (action as any).proposed_by ?? "Council");
      const changeType  = String(p.change_type ?? (action as any).change_type ?? "feature|fix|config|process|other");
      const rationale   = String(p.rationale ?? (action as any).rationale ?? "");
      const priority    = String(p.priority ?? (action as any).priority ?? "normal");
      const payload = { title, description, proposed_by: proposedBy, change_type: changeType, rationale, priority };
      const { error } = await sb.from("mavis_tasks").insert({
        user_id: userId,
        type: "system_change",
        description: `[${proposedBy}] ${title}`,
        payload,
        status: "requires_confirmation",
      });
      if (error) throw error;
      await logActivity(sb, userId, "system_change_proposed", `Change proposed by ${proposedBy}: ${title}`, 0);
      return;
    }

    // ── PROPOSE SESSION UPDATE — The System bundles post-session gains for approval ──
    case "propose_session_update": {
      const sessionTitle   = String(p.session_title ?? (action as any).session_title ?? "Session");
      const proposedBy     = String(p.proposed_by   ?? (action as any).proposed_by   ?? "The System");
      const sessionSummary = String(p.session_summary ?? (action as any).session_summary ?? "");
      const xpAward        = Number(p.xp_award        ?? (action as any).xp_award        ?? 0);
      const questUpdates   = (p.quest_updates   ?? (action as any).quest_updates   ?? []) as unknown[];
      const skillUpdates   = (p.skill_updates   ?? (action as any).skill_updates   ?? []) as unknown[];
      const statUpdates    = (p.stat_updates    ?? (action as any).stat_updates    ?? {}) as Record<string, number>;
      const invConsumed    = (p.inventory_consumed ?? (action as any).inventory_consumed ?? []) as unknown[];

      const payload = {
        session_title: sessionTitle,
        proposed_by: proposedBy,
        session_summary: sessionSummary,
        xp_award: xpAward,
        quest_updates: questUpdates,
        skill_updates: skillUpdates,
        stat_updates: statUpdates,
        inventory_consumed: invConsumed,
      };

      // Build a readable summary for the task description
      const lines: string[] = [];
      if (xpAward > 0) lines.push(`+${xpAward} XP`);
      if ((questUpdates as any[]).length) lines.push(`${(questUpdates as any[]).length} quest(s)`);
      if ((skillUpdates as any[]).length) lines.push(`${(skillUpdates as any[]).length} skill(s)`);
      if (Object.keys(statUpdates).length) lines.push(`stat boost`);
      if ((invConsumed as any[]).length) lines.push(`${(invConsumed as any[]).length} item(s) consumed`);

      const { error } = await sb.from("mavis_tasks").insert({
        user_id: userId,
        type: "session_update",
        description: `[${proposedBy}] ${sessionTitle}${lines.length ? ` — ${lines.join(", ")}` : ""}`,
        payload,
        status: "requires_confirmation",
      });
      if (error) throw error;
      await logActivity(sb, userId, "session_update_proposed", `Session report queued: ${sessionTitle}`, 0);
      return;
    }

    // ── PROPOSE ACTION — generic proposal gate for ANY persona/council suggestion ──
    // Queues any action for operator review before execution.
    // On approval the executor re-dispatches via mavis-actions with the stored params.
    case "propose_action": {
      const actionType  = String(p.action_type  ?? (action as any).action_type  ?? "");
      const proposedBy  = String(p.proposed_by  ?? (action as any).proposed_by  ?? "Persona");
      const rationale   = String(p.rationale    ?? (action as any).rationale    ?? "");
      const priority    = String(p.priority     ?? (action as any).priority     ?? "normal");
      const actionParams = (p.params ?? (action as any).params ?? p) as Record<string, unknown>;
      // Build a human-readable label
      const label = String(
        actionParams.title ?? actionParams.name ?? actionParams.objective ??
        actionParams.text  ?? actionParams.goal  ?? actionType
      ).slice(0, 80);

      if (!actionType) throw new Error("propose_action requires action_type");

      const payload = {
        action_type: actionType,
        params: actionParams,
        proposed_by: proposedBy,
        rationale,
        priority,
      };

      const { error } = await sb.from("mavis_tasks").insert({
        user_id: userId,
        type: "execute_action",
        description: `[${proposedBy}] ${actionType}: ${label}`,
        payload,
        status: "requires_confirmation",
      });
      if (error) throw error;
      await logActivity(sb, userId, "action_proposed", `${proposedBy} proposed: ${actionType} — ${label}`, 0);
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
      // email, phone, company, role come from MAVIS action params — store in profile JSONB
      // since contacts table does not have those as top-level columns
      const baseProfile = (p.profile && typeof p.profile === "object") ? p.profile as Record<string, unknown> : {};
      const profileData: Record<string, unknown> = { ...baseProfile };
      if (p.email)   profileData.email   = String(p.email);
      if (p.phone)   profileData.phone   = String(p.phone);
      if (p.company) profileData.company = String(p.company);
      if (p.role)    profileData.role    = String(p.role);
      const { error } = await sb.from("contacts").insert({
        user_id: userId,
        name: String(p.name || "New Contact"),
        relationship_type: String(p.relationship_type || p.relationship || "personal"),
        last_contact_at: p.last_contact_at ? String(p.last_contact_at) : null,
        follow_up_date: p.follow_up_date ? String(p.follow_up_date) : null,
        notes: String(p.notes || ""),
        tags: asStringArray(p.tags),
        profile: profileData,
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
      for (const key of ["name", "relationship_type", "last_contact_at", "follow_up_date", "notes", "tags"]) {
        if (p[key] !== undefined) updates[key] = key === "tags" ? asStringArray(p[key]) : p[key];
      }
      // Merge email/phone/company/role into profile JSONB if provided
      if (p.email || p.phone || p.company || p.role || p.profile) {
        const { data: existing } = await sb.from("contacts").select("profile").eq("id", contactId).eq("user_id", userId).single();
        const existingProfile = (existing?.profile && typeof existing.profile === "object") ? existing.profile as Record<string, unknown> : {};
        const incomingProfile = (p.profile && typeof p.profile === "object") ? p.profile as Record<string, unknown> : {};
        updates.profile = {
          ...existingProfile,
          ...incomingProfile,
          ...(p.email   ? { email:   String(p.email) }   : {}),
          ...(p.phone   ? { phone:   String(p.phone) }   : {}),
          ...(p.company ? { company: String(p.company) } : {}),
          ...(p.role    ? { role:    String(p.role) }    : {}),
        };
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

    // ── MAVIS GOALS ──────────────────────────────────────────────────────
    case "create_mavis_goal":
    case "add_goal":
    case "set_mavis_goal": {
      const { error } = await sb.from("mavis_goals").insert({
        user_id: userId,
        objective: String(p.objective || p.title || p.goal || "New Goal"),
        context: String(p.context || p.description || ""),
        status: String(p.status || "active"),
      });
      if (error) throw error;
      await logActivity(sb, userId, "goal_created", `Goal: ${p.objective || p.title || ""}`, 0);
      return;
    }

    case "update_mavis_goal":
    case "update_goal": {
      const goalId = String(p.goal_id || p.id || "");
      if (!goalId) throw new Error("update_mavis_goal requires goal_id");
      const gUpdates: Record<string, unknown> = {};
      for (const k of ["objective", "context", "status"]) {
        if (p[k] !== undefined) gUpdates[k] = p[k];
      }
      // Also accept "title" as alias for "objective" and "description" as alias for "context"
      if (p.title !== undefined && p.objective === undefined) gUpdates.objective = p.title;
      if (p.description !== undefined && p.context === undefined) gUpdates.context = p.description;
      await sb.from("mavis_goals").update(gUpdates).eq("id", goalId).eq("user_id", userId);
      return;
    }

    // ── RITUALS ──────────────────────────────────────────────────────────
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
      await logActivity(sb, userId, "ritual_created", `Ritual: ${p.name || "New Ritual"}`, 0);
      return;
    }

    case "update_ritual": {
      const ritualId = await resolveId(sb, userId, "rituals", (p.ritual_id || p.id) as string, (p.ritual_name || p.name) as string);
      if (!ritualId) return;
      const updates: Record<string, unknown> = {};
      for (const k of ["name", "description", "type", "category", "xp_reward"]) {
        if (p[k] !== undefined) updates[k] = p[k];
      }
      const { error } = await sb.from("rituals").update(updates).eq("id", ritualId).eq("user_id", userId);
      if (error) throw error;
      return;
    }

    case "complete_ritual": {
      const ritualId = await resolveId(sb, userId, "rituals", (p.ritual_id || p.id) as string, (p.ritual_name || p.name) as string);
      if (!ritualId) return;
      const { data: ritual } = await sb.from("rituals").select("streak, xp_reward, name").eq("id", ritualId).eq("user_id", userId).single();
      if (!ritual) return;
      const newStreak = Number(ritual.streak || 0) + 1;
      await sb.from("rituals").update({
        completed: true,
        streak: newStreak,
        last_completed: new Date().toISOString(),
      }).eq("id", ritualId).eq("user_id", userId);
      await awardXP(sb, userId, Number(ritual.xp_reward || 25));
      await logActivity(sb, userId, "ritual_completed", `Ritual completed: ${ritual.name} (streak: ${newStreak})`, Number(ritual.xp_reward || 25));
      return;
    }

    case "delete_ritual": {
      const ritualId = await resolveId(sb, userId, "rituals", (p.ritual_id || p.id) as string, (p.ritual_name || p.name) as string);
      if (!ritualId) return;
      await sb.from("rituals").delete().eq("id", ritualId).eq("user_id", userId);
      await logActivity(sb, userId, "ritual_deleted", "Ritual deleted", 0);
      return;
    }

    // ── CALENDAR EVENTS ─────────────────────────────────
    case "create_calendar_event":
    case "schedule_event": {
      const { error } = await sb.from("calendar_events").insert({
        user_id:     userId,
        title:       String(p.title ?? "Untitled Event"),
        start_at:    String(p.start_at ?? p.start_time ?? new Date().toISOString()),
        end_at:      p.end_at ?? p.end_time ? String(p.end_at ?? p.end_time) : null,
        description: p.description ? String(p.description) : null,
        location:    p.location ? String(p.location) : null,
      });
      if (error) throw error;
      await logActivity(sb, userId, "calendar_event_created", `Event: ${String(p.title ?? "Untitled")}`, 0);
      return;
    }

    case "update_calendar_event": {
      const eventId = String(p.event_id ?? p.id ?? "");
      if (!eventId) return;
      const upd: Record<string, unknown> = {};
      for (const k of ["title", "start_at", "end_at", "description", "location"]) {
        if (p[k] !== undefined) upd[k] = p[k];
      }
      await sb.from("calendar_events").update(upd).eq("id", eventId).eq("user_id", userId);
      return;
    }

    case "delete_calendar_event": {
      const eventId = String(p.event_id ?? p.id ?? "");
      if (!eventId) return;
      await sb.from("calendar_events").delete().eq("id", eventId).eq("user_id", userId);
      return;
    }

    // ── TIME LOGS ────────────────────────────────────────
    case "log_time":
    case "create_time_log": {
      const { error } = await sb.from("time_logs").insert({
        user_id:          userId,
        description:      String(p.description ?? p.title ?? "Time log"),
        project:          p.project ? String(p.project) : null,
        started_at:       p.started_at ? String(p.started_at) : null,
        ended_at:         p.ended_at ? String(p.ended_at) : null,
        duration_seconds: p.duration_seconds ? Number(p.duration_seconds) : null,
        tags:             Array.isArray(p.tags) ? p.tags : [],
      });
      if (error) throw error;
      await logActivity(sb, userId, "time_logged", `Time: ${String(p.description ?? p.project ?? "log")}`, 0);
      return;
    }

    // ── MEETING NOTES ────────────────────────────────────
    case "create_meeting_note":
    case "log_meeting": {
      const { error } = await sb.from("meeting_notes").insert({
        user_id:      userId,
        title:        String(p.title ?? "Meeting"),
        meeting_date: p.meeting_date ? String(p.meeting_date) : new Date().toISOString().slice(0, 10),
        attendees:    Array.isArray(p.attendees) ? p.attendees : [],
        key_points:   Array.isArray(p.key_points) ? p.key_points : [],
        decisions:    Array.isArray(p.decisions) ? p.decisions : [],
        action_items: Array.isArray(p.action_items) ? p.action_items : null,
        summary:      p.summary ? String(p.summary) : null,
      });
      if (error) throw error;
      await logActivity(sb, userId, "meeting_logged", `Meeting: ${String(p.title ?? "Meeting")}`, 0);
      return;
    }

    case "update_meeting_note": {
      const noteId = String(p.note_id ?? p.id ?? "");
      if (!noteId) return;
      const upd: Record<string, unknown> = {};
      for (const k of ["title", "summary", "key_points", "decisions", "action_items", "attendees"]) {
        if (p[k] !== undefined) upd[k] = p[k];
      }
      await sb.from("meeting_notes").update(upd).eq("id", noteId).eq("user_id", userId);
      return;
    }

    // ── HEALTH METRICS ───────────────────────────────────
    case "log_health_metric":
    case "log_health":
    case "health_log": {
      const value = Number(p.value ?? 0);
      const metricType = String(p.metric_type ?? p.type ?? "general");
      const dateVal = String(p.date ?? new Date().toISOString().slice(0, 10));
      // Map to existing schema columns; store the raw metric_type+value in raw_data
      const row: Record<string, unknown> = {
        user_id: userId,
        date:    dateVal,
        source:  "mavis",
        raw_data: { metric_type: metricType, value, unit: p.unit ?? "" },
      };
      if (metricType === "sleep") row.sleep_duration_minutes = Math.round(value * 60);
      if (metricType === "hrv")   row.hrv_avg = value;
      if (metricType === "resting_hr" || metricType === "hr") row.resting_hr = value;
      if (metricType === "readiness") row.readiness_score = value;
      const { error } = await sb.from("health_metrics").upsert(row, { onConflict: "user_id,date,source" });
      if (error) throw error;
      await logActivity(sb, userId, "health_logged", `Health: ${metricType} = ${value}${p.unit ? ` ${p.unit}` : ""}`, 0);
      return;
    }

    // ── COMPETITORS ──────────────────────────────────────
    case "add_competitor":
    case "create_competitor": {
      const { error } = await sb.from("mavis_competitors").insert({
        user_id: userId,
        name:    String(p.name ?? "Competitor"),
        url:     p.url ? String(p.url) : null,
        notes:   p.notes ? String(p.notes) : null,
      });
      if (error) throw error;
      await logActivity(sb, userId, "competitor_added", `Competitor: ${String(p.name ?? "")}`, 0);
      return;
    }

    case "update_competitor": {
      const compId = String(p.competitor_id ?? p.id ?? "");
      if (!compId) return;
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of ["name", "url", "notes", "snapshot"]) {
        if (p[k] !== undefined) upd[k] = p[k];
      }
      await sb.from("mavis_competitors").update(upd).eq("id", compId).eq("user_id", userId);
      return;
    }

    // ── SEND NOTIFICATION — log a push notification / alert ────────────────
    case "send_notification":
    case "push_notification":
    case "notify": {
      const notifText = String(p.title ?? p.message ?? p.text ?? "MAVIS Alert").slice(0, 255);
      const body      = String(p.body ?? p.message ?? p.text ?? "").slice(0, 1000);
      const notifType = String(p.notification_type ?? "info").slice(0, 50);
      await sb.from("mavis_tasks").insert({
        user_id: userId,
        type: "push_notification",
        description: notifText,
        payload: { notification_type: notifType, body },
        status: "pending",
      });
      await logActivity(sb, userId, "notification_sent", `Notification: ${notifText}`, 0);
      return;
    }

    // ── SMART HOME — Home Assistant / Philips Hue control ──────────────────
    case "smart_home":
    case "home_control":
    case "iot_control": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const homeAction  = String(p.action ?? "status");
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-home`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
        body: JSON.stringify({ user_id: userId, action: homeAction, ...p }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!data.configured) throw new Error(`Smart home not configured: ${data.hint ?? ""}`);
        throw new Error(data.error ?? `smart_home returned ${res.status}`);
      }
      await logActivity(sb, userId, "smart_home", `Home: ${homeAction} ${p.entity_id ?? ""}`, 0);
      return;
    }

    // ── CREATE WORKFLOW — save a workflow definition ───────────────────────
    case "create_workflow": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const name        = String(p.name ?? "Untitled Workflow").slice(0, 255);
      const description = String(p.description ?? "").slice(0, 1000);
      const triggerType = ["manual", "schedule", "webhook"].includes(String(p.trigger_type))
        ? String(p.trigger_type) : "manual";
      const triggerConfig = (p.trigger_config && typeof p.trigger_config === "object") ? p.trigger_config : {};
      const steps         = Array.isArray(p.steps) ? p.steps : [];
      const isActive      = p.is_active !== false;

      if (steps.length === 0) throw new Error("create_workflow requires at least one step");

      const { data: wf, error: wfErr } = await sb
        .from("workflows")
        .insert({ user_id: userId, name, description, trigger_type: triggerType, trigger_config: triggerConfig, steps, is_active: isActive })
        .select("id")
        .single();

      if (wfErr) throw new Error(wfErr.message);
      await logActivity(sb, userId, "workflow_created", `Created workflow: ${name}`, 10);

      // run_immediately: true — execute the workflow right after creating it
      if (p.run_immediately) {
        const runRes = await fetch(`${supabaseUrl}/functions/v1/mavis-workflow-run`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ workflow_id: wf.id, userId }),
          signal: AbortSignal.timeout(90_000),
        });
        const runData = await runRes.json().catch(() => ({}));
        return { workflow_id: wf.id, name, run_id: runData.run_id, success: runData.success, steps_log: runData.steps_log };
      }

      return { workflow_id: wf.id, name };
    }

    // ── RUN WORKFLOW — execute a saved workflow or ad-hoc steps ───────────
    case "run_workflow": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const workflowId = p.workflow_id ? String(p.workflow_id) : undefined;
      const adHocSteps = Array.isArray(p.steps) ? p.steps : undefined;
      const name       = String(p.name ?? "Ad-hoc run");

      if (!workflowId && !adHocSteps) throw new Error("run_workflow requires workflow_id or steps");

      const body: Record<string, unknown> = { userId, name };
      if (workflowId)  body.workflow_id = workflowId;
      if (adHocSteps)  body.steps       = adHocSteps;

      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-workflow-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Workflow run failed: ${res.status}`);

      await logActivity(sb, userId, "workflow_run", `Ran workflow: ${workflowId ?? name}`, 5);
      return { run_id: data.run_id, success: data.success, steps_log: data.steps_log };
    }

    // ── CREATE WEBHOOK — register an outbound webhook endpoint ────────────
    case "create_webhook": {
      const name         = String(p.name ?? "MAVIS Webhook").slice(0, 255);
      const endpointUrl  = String(p.endpoint_url ?? p.url ?? "");
      const eventTypes   = asStringArray(p.event_types ?? p.events ?? ["*"]);
      const active       = p.active !== false;

      if (!endpointUrl) throw new Error("create_webhook requires endpoint_url");

      const { data: wh, error: whErr } = await sb
        .from("webhook_dispatch_config")
        .insert({ user_id: userId, name, endpoint_url: endpointUrl, event_types: eventTypes, active })
        .select("id")
        .single();

      if (whErr) throw new Error(whErr.message);
      await logActivity(sb, userId, "webhook_created", `Webhook: ${name} → ${endpointUrl.slice(0, 60)}`, 0);
      return { webhook_id: wh.id, name, endpoint_url: endpointUrl };
    }

    // ── DOMAIN EFFECTS — environmental/supernatural stat modifiers ─────────
    case "create_domain_effect": {
      const mods = Array.isArray(p.stat_modifiers) ? p.stat_modifiers : [];
      const areaFx = Array.isArray(p.area_effects) ? p.area_effects : [];
      const effectType = ["domain","curse","terrain","environmental","aura","zone"].includes(String(p.effect_type))
        ? String(p.effect_type) : "domain";
      const { data: ef, error: efErr } = await sb.from("mavis_domain_effects").insert({
        user_id: userId,
        name: String(p.name ?? "Unknown Effect").slice(0, 255),
        description: p.description ? String(p.description).slice(0, 1000) : null,
        effect_type: effectType,
        stat_modifiers: mods,
        area_effects: areaFx,
        is_active: p.is_active !== false,
        expires_at: p.expires_at ? new Date(String(p.expires_at)).toISOString() : null,
        source: p.source ? String(p.source).slice(0, 255) : null,
      }).select("id").single();
      if (efErr) throw efErr;
      await logActivity(sb, userId, "domain_effect_created", `Domain effect: ${p.name}`, 5);
      return { effect_id: ef.id };
    }

    case "update_domain_effect": {
      const effectId = String(p.effect_id ?? p.id ?? "");
      if (!effectId) throw new Error("update_domain_effect requires effect_id");
      const updates: Record<string, unknown> = {};
      if (p.name !== undefined) updates.name = String(p.name).slice(0, 255);
      if (p.description !== undefined) updates.description = p.description ? String(p.description) : null;
      if (p.effect_type !== undefined) updates.effect_type = String(p.effect_type);
      if (p.stat_modifiers !== undefined) updates.stat_modifiers = p.stat_modifiers;
      if (p.area_effects !== undefined) updates.area_effects = p.area_effects;
      if (p.is_active !== undefined) updates.is_active = Boolean(p.is_active);
      if (p.expires_at !== undefined) updates.expires_at = p.expires_at ? new Date(String(p.expires_at)).toISOString() : null;
      if (p.source !== undefined) updates.source = p.source ? String(p.source) : null;
      const { error: upErr } = await sb.from("mavis_domain_effects").update(updates).eq("id", effectId).eq("user_id", userId);
      if (upErr) throw upErr;
      return { effect_id: effectId, updated: Object.keys(updates) };
    }

    case "delete_domain_effect": {
      const effectId = String(p.effect_id ?? p.id ?? "");
      if (!effectId) throw new Error("delete_domain_effect requires effect_id");
      const { error: delErr } = await sb.from("mavis_domain_effects").delete().eq("id", effectId).eq("user_id", userId);
      if (delErr) throw delErr;
      return { deleted: effectId };
    }

    case "deep_research": {
      const query = String(p.query ?? "");
      if (!query) throw new Error("deep_research requires query");
      const depth = Number(p.depth ?? 2);
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-deep-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ query, depth }),
      });
      if (!res.ok) throw new Error(`deep_research failed: ${await res.text()}`);
      return await res.json();
    }

    case "translate": {
      const text = String(p.text ?? "");
      const target = String(p.target ?? "en");
      const source = p.source ? String(p.source) : undefined;
      if (!text) throw new Error("translate requires text");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ text, target, ...(source ? { source } : {}) }),
      });
      if (!res.ok) throw new Error(`translate failed: ${await res.text()}`);
      return await res.json();
    }

    case "get_market_data": {
      const symbols = asStringArray(p.symbols);
      const type = String(p.type ?? "auto") as "stock" | "crypto" | "auto";
      if (!symbols.length) throw new Error("get_market_data requires symbols array");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-market-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ type, symbols }),
      });
      if (!res.ok) throw new Error(`get_market_data failed: ${await res.text()}`);
      return await res.json();
    }

    case "send_email": {
      const to = String(p.to ?? "");
      const subject = String(p.subject ?? "");
      const body = p.body ? String(p.body) : undefined;
      const generate = p.generate ? String(p.generate) : undefined;
      const contact_id = p.contact_id ? String(p.contact_id) : undefined;
      if (!to) throw new Error("send_email requires to");
      if (!subject) throw new Error("send_email requires subject");
      if (!body && !generate) throw new Error("send_email requires either body or generate");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-email-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ to, subject, ...(body ? { body } : {}), ...(generate ? { generate } : {}), ...(contact_id ? { contact_id } : {}) }),
      });
      if (!res.ok) throw new Error(`send_email failed: ${await res.text()}`);
      return await res.json();
    }

    case "send_sms":
    case "send_whatsapp": {
      const to = String(p.to ?? "");
      const message = String(p.message ?? "");
      const channel = action.type === "send_whatsapp" ? "whatsapp" : String(p.channel ?? "sms");
      if (!to) throw new Error(`${action.type} requires to (E.164 phone number)`);
      if (!message) throw new Error(`${action.type} requires message`);
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ to, message, channel }),
      });
      if (!res.ok) throw new Error(`${action.type} failed: ${await res.text()}`);
      return await res.json();
    }

    case "get_weather": {
      const location = String(p.location ?? p.city ?? "");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-weather`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ location }),
      });
      if (!res.ok) throw new Error(`get_weather failed: ${await res.text()}`);
      return await res.json();
    }

    case "repurpose_content": {
      const content = String(p.content ?? "");
      const platforms = p.platforms ?? ["twitter", "linkedin", "instagram"];
      if (!content) throw new Error("repurpose_content requires content");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-repurpose`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ content, platforms }),
      });
      if (!res.ok) throw new Error(`repurpose_content failed: ${await res.text()}`);
      return await res.json();
    }

    case "generate_pdf": {
      const title = String(p.title ?? "Document");
      const contentHtml = String(p.content_html ?? p.content ?? "");
      if (!contentHtml) throw new Error("generate_pdf requires content_html");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-pdf-gen`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ title, content_html: contentHtml, user_id: userId }),
      });
      if (!res.ok) throw new Error(`generate_pdf failed: ${await res.text()}`);
      return await res.json();
    }

    case "nora_linkedin": {
      const content = p.content ? String(p.content) : undefined;
      const generate = p.generate !== false;
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-nora-linkedin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ content, generate: !content || generate }),
      });
      if (!res.ok) throw new Error(`nora_linkedin failed: ${await res.text()}`);
      return await res.json();
    }

    case "nora_instagram": {
      const content = p.content ? String(p.content) : undefined;
      const image_url = p.image_url ? String(p.image_url) : undefined;
      const generate = p.generate !== false;
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-nora-instagram`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ content, image_url, generate: !content || generate }),
      });
      if (!res.ok) throw new Error(`nora_instagram failed: ${await res.text()}`);
      return await res.json();
    }

    case "nora_tiktok": {
      const content = p.content ? String(p.content) : undefined;
      const video_url = p.video_url ? String(p.video_url) : undefined;
      const generate = p.generate !== false;
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-nora-tiktok`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ content, video_url, generate: !content || generate }),
      });
      if (!res.ok) throw new Error(`nora_tiktok failed: ${await res.text()}`);
      return await res.json();
    }

    case "speak":
    case "tts": {
      const text = String(p.text ?? "");
      if (!text) throw new Error("speak requires text");
      const gender = String(p.gender ?? "female");
      const voice_id = p.voice_id ? String(p.voice_id) : undefined;
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ text, gender, ...(voice_id ? { voice_id } : {}) }),
      });
      if (!res.ok) throw new Error(`speak failed: ${await res.text()}`);
      return await res.json();
    }

    case "phone_call": {
      const to = String(p.to ?? "");
      const purpose = String(p.purpose ?? "");
      if (!to) throw new Error("phone_call requires to (E.164 phone number)");
      if (!purpose) throw new Error("phone_call requires purpose");
      const caller_name = String(p.caller_name ?? "MAVIS");
      const first_message = p.first_message ? String(p.first_message) : undefined;
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-phone-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ to, purpose, caller_name, ...(first_message ? { first_message } : {}) }),
      });
      if (!res.ok) throw new Error(`phone_call failed: ${await res.text()}`);
      return await res.json();
    }

    case "maps": {
      const mapAction = String(p.action ?? "geocode");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-maps`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ action: mapAction, ...p }),
      });
      if (!res.ok) throw new Error(`maps failed: ${await res.text()}`);
      return await res.json();
    }

    case "arxiv_search": {
      const query = String(p.query ?? "");
      if (!query) throw new Error("arxiv_search requires query");
      const category = p.category ? String(p.category) : "";
      const max_results = Number(p.max_results ?? 10);
      const sort_by = String(p.sort_by ?? "relevance");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-arxiv`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ action: "search", query, category, max_results, sort_by }),
      });
      if (!res.ok) throw new Error(`arxiv_search failed: ${await res.text()}`);
      return await res.json();
    }

    case "youtube_ingest": {
      const url = String(p.url ?? "");
      if (!url) throw new Error("youtube_ingest requires url");
      const save_as = String(p.save_as ?? "note") as "note" | "vault";
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-youtube-ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ url, save_as }),
      });
      if (!res.ok) throw new Error(`youtube_ingest failed: ${await res.text()}`);
      return await res.json();
    }

    case "gumroad_action": {
      const gumroadAction = String(p.action ?? "create");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const url = `${supabaseUrl}/functions/v1/mavis-gumroad${gumroadAction === "list" ? "?action=list" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ ...p, action: gumroadAction }),
      });
      if (!res.ok) throw new Error(`gumroad_action failed: ${await res.text()}`);
      return await res.json();
    }

    case "slack_message": {
      const channel = String(p.channel ?? "");
      const text = String(p.text ?? p.message ?? "");
      if (!channel) throw new Error("slack_message requires channel");
      if (!text) throw new Error("slack_message requires text");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-slack-bot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ channel, text }),
      });
      if (!res.ok) throw new Error(`slack_message failed: ${await res.text()}`);
      return await res.json();
    }

    case "self_reflect": {
      const question = p.question ? String(p.question) : "";
      const context = p.context ? String(p.context) : "";
      const tags = asStringArray(p.tags);
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-self-reflect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ question, context, tags }),
      });
      if (!res.ok) throw new Error(`self_reflect failed: ${await res.text()}`);
      return await res.json();
    }

    case "extract_document": {
      const file_url = String(p.file_url ?? "");
      if (!file_url) throw new Error("extract_document requires file_url");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-doc-extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ file_url, file_name: p.file_name, file_type: p.file_type, vault_entry_id: p.vault_entry_id }),
      });
      if (!res.ok) throw new Error(`extract_document failed: ${await res.text()}`);
      return await res.json();
    }

    case "process_attachment": {
      const attachment_id = String(p.attachment_id ?? "");
      if (!attachment_id) throw new Error("process_attachment requires attachment_id");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-attachment-process`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ attachment_id }),
      });
      if (!res.ok) throw new Error(`process_attachment failed: ${await res.text()}`);
      return await res.json();
    }

    case "prepare_meeting": {
      const event_title = String(p.event_title ?? "");
      if (!event_title) throw new Error("prepare_meeting requires event_title");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-meeting-prep`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ event_id: p.event_id, event_title, event_start: p.event_start, attendees: p.attendees ?? [] }),
      });
      if (!res.ok) throw new Error(`prepare_meeting failed: ${await res.text()}`);
      return await res.json();
    }

    case "transcribe_meeting": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-meeting-transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({
          audio_url: p.audio_url, audio_base64: p.audio_base64, mime_type: p.mime_type,
          meeting_title: p.meeting_title, participants: p.participants ?? [],
          create_quests: p.create_quests ?? false,
        }),
      });
      if (!res.ok) throw new Error(`transcribe_meeting failed: ${await res.text()}`);
      return await res.json();
    }

    case "health_protocol": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-health-protocol`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ date: p.date }),
      });
      if (!res.ok) throw new Error(`health_protocol failed: ${await res.text()}`);
      return await res.json();
    }

    case "performance_score": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-performance-science`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ date: p.date }),
      });
      if (!res.ok) throw new Error(`performance_score failed: ${await res.text()}`);
      return await res.json();
    }

    case "strategy_council": {
      const question = String(p.question ?? "");
      if (!question) throw new Error("strategy_council requires question");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-strategy-council`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ question, context: p.context, tags: p.tags }),
      });
      if (!res.ok) throw new Error(`strategy_council failed: ${await res.text()}`);
      return await res.json();
    }

    case "create_product": {
      const title = String(p.title ?? "");
      const description = String(p.description ?? "");
      const audience = String(p.audience ?? "");
      if (!title || !description || !audience) throw new Error("create_product requires title, description, audience");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-product-creator`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ title, description, audience, category: p.category, price_cents: p.price_cents }),
      });
      if (!res.ok) throw new Error(`create_product failed: ${await res.text()}`);
      return await res.json();
    }

    case "scan_demand": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-demand-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`scan_demand failed: ${await res.text()}`);
      return await res.json();
    }

    case "polymarket_search":
    case "polymarket_trending":
    case "polymarket_get": {
      const polyAction = action.type === "polymarket_search" ? "search"
        : action.type === "polymarket_trending" ? "trending" : "get";
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-polymarket`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ action: polyAction, query: p.query, market_id: p.market_id, limit: p.limit }),
      });
      if (!res.ok) throw new Error(`${action.type} failed: ${await res.text()}`);
      return await res.json();
    }

    case "hn_digest": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-hn-digest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ max_stories: p.max_stories ?? 10 }),
      });
      if (!res.ok) throw new Error(`hn_digest failed: ${await res.text()}`);
      return await res.json();
    }

    case "create_agent": {
      const business_name = String(p.business_name ?? "");
      if (!business_name) throw new Error("create_agent requires business_name");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-agent-builder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({
          action: "create", business_name,
          agent_name: p.agent_name, capabilities: p.capabilities,
          knowledge_base: p.knowledge_base, tone: p.tone,
          brand_color: p.brand_color, business_type: p.business_type,
          plan_tier: p.plan_tier, monthly_price_cents: p.monthly_price_cents,
        }),
      });
      if (!res.ok) throw new Error(`create_agent failed: ${await res.text()}`);
      return await res.json();
    }

    case "crew_execute": {
      const goal = String(p.goal ?? "");
      if (!goal) throw new Error("crew_execute requires goal");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-crew-orchestrator`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ goal, context: p.context }),
      });
      if (!res.ok) throw new Error(`crew_execute failed: ${await res.text()}`);
      return await res.json();
    }

    case "computer_use": {
      const task = String(p.task ?? "");
      if (!task) throw new Error("computer_use requires task");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-computer-use`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ task, url: p.url, screenshot_base64: p.screenshot_base64, user_id: userId }),
      });
      if (!res.ok) throw new Error(`computer_use failed: ${await res.text()}`);
      return await res.json();
    }

    case "terminal_exec": {
      const cmd = String(p.cmd ?? "");
      const termAction = String(p.action ?? (cmd ? "exec" : "create_session"));
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ action: termAction, session_id: p.session_id, cmd, label: p.label }),
      });
      if (!res.ok) throw new Error(`terminal_exec failed: ${await res.text()}`);
      return await res.json();
    }

    case "generate_seo": {
      const business_name = String(p.business_name ?? "");
      if (!business_name) throw new Error("generate_seo requires business_name");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-seo-engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({
          business_name, business_type: p.business_type, site_url: p.site_url,
          location: p.location, description: p.description, keywords: p.keywords,
        }),
      });
      if (!res.ok) throw new Error(`generate_seo failed: ${await res.text()}`);
      return await res.json();
    }

    case "design_website": {
      const brief = p.brief ?? p;
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-design-engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ brief }),
      });
      if (!res.ok) throw new Error(`design_website failed: ${await res.text()}`);
      return await res.json();
    }

    case "create_avatar_video": {
      const source_image_url = String(p.source_image_url ?? "");
      if (!source_image_url) throw new Error("create_avatar_video requires source_image_url");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-avatar-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ source_image_url, text: p.text, audio_url: p.audio_url, voice_id: p.voice_id, still_mode: p.still_mode }),
      });
      if (!res.ok) throw new Error(`create_avatar_video failed: ${await res.text()}`);
      return await res.json();
    }

    case "build_world_model": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-world-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ action: p.action ?? "generate" }),
      });
      if (!res.ok) throw new Error(`build_world_model failed: ${await res.text()}`);
      return await res.json();
    }

    case "record_outcome": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-outcome-tracker`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({
          action: "record", source_type: p.source_type,
          source_id: p.source_id, prediction_text: p.prediction_text,
          predicted_outcome: p.predicted_outcome, due_days: p.due_days ?? 30,
        }),
      });
      if (!res.ok) throw new Error(`record_outcome failed: ${await res.text()}`);
      return await res.json();
    }

    case "socratic_tutor": {
      const message = String(p.message ?? "");
      if (!message) throw new Error("socratic_tutor requires message");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-khanmigo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ message, topic_id: p.topic_id, history: p.history }),
      });
      if (!res.ok) throw new Error(`socratic_tutor failed: ${await res.text()}`);
      return await res.json();
    }

    case "screenpipe_search":
    case "screenpipe_context":
    case "screenpipe_recent": {
      const spAction = action.type === "screenpipe_search" ? "search"
        : action.type === "screenpipe_context" ? "context" : "recent";
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-screenpipe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ action: spAction, query: p.query, limit: p.limit ?? 20 }),
      });
      if (!res.ok) throw new Error(`${action.type} failed: ${await res.text()}`);
      return await res.json();
    }

    case "export_fine_tune_data": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-fine-tune-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization")! },
        body: JSON.stringify({ format: p.format ?? "openai", min_quality: p.min_quality, limit: p.limit }),
      });
      if (!res.ok) throw new Error(`export_fine_tune_data failed: ${await res.text()}`);
      return await res.json();
    }

    case "schedule_post": {
      const platform = String(p.platform ?? "twitter");
      const content = String(p.content ?? "");
      const scheduled_at = String(p.scheduled_at ?? "");
      if (!content) throw new Error("schedule_post requires content");
      if (!scheduled_at) throw new Error("schedule_post requires scheduled_at (ISO 8601)");
      const { data: postData, error: postErr } = await sb.from("mavis_social_posts").insert({
        user_id: userId, platform, persona: p.persona ?? "nora_vale",
        content, status: "scheduled", scheduled_at,
      }).select().single();
      if (postErr) throw postErr;
      return { scheduled: true, post_id: postData.id, scheduled_at, platform };
    }

    case "list_capabilities": {
      const category = p.category ? String(p.category) : null;
      let query = sb.from("mavis_capabilities")
        .select("action_type, category, description, requires_secrets, edge_function")
        .eq("is_active", true)
        .order("category")
        .order("action_type");
      if (category) query = query.eq("category", category);
      const { data, error: listErr } = await query;
      if (listErr) throw listErr;
      const grouped: Record<string, { action: string; description: string; requires_secrets: string[] }[]> = {};
      for (const row of (data ?? [])) {
        if (!grouped[row.category]) grouped[row.category] = [];
        grouped[row.category].push({ action: row.action_type, description: row.description, requires_secrets: row.requires_secrets ?? [] });
      }
      return { capabilities: grouped, total: data?.length ?? 0 };
    }

    case "search_capabilities": {
      const searchQuery = String(p.query ?? "");
      if (!searchQuery) throw new Error("search_capabilities requires query");
      const { data, error: searchErr } = await sb.from("mavis_capabilities")
        .select("action_type, category, description, example_params, requires_secrets")
        .eq("is_active", true)
        .or(`action_type.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%,category.ilike.%${searchQuery}%`)
        .order("category")
        .limit(20);
      if (searchErr) throw searchErr;
      return { results: data ?? [], count: data?.length ?? 0 };
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
        const actionData = await executeAction(adminClient, userId, action, req);
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

    // Fire achievement check after any successful action — non-blocking.
    // The check is idempotent (skips already-unlocked keys) so safe to call on every write.
    const hadSuccess = results.some((r) => r.success);
    const achievementTriggerTypes = new Set([
      "complete_quest", "update_quest", "complete_task", "update_task",
      "create_vault", "create_journal", "award_xp", "log_bpm_session",
      "log_revenue", "create_skill", "update_skill",
    ]);
    const shouldCheckAchievements = hadSuccess && actions.some((a) => achievementTriggerTypes.has(String(a.type)));
    if (shouldCheckAchievements) {
      fetch(`${supabaseUrl}/functions/v1/mavis-achievement-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ user_id: userId }),
      }).catch((err: unknown) => console.warn("[mavis-actions] achievement check failed:", err));
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
