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

// ── Profile fields MAVIS is allowed to update ─────────────
const PROFILE_ALLOWED = [
  "inscribed_name", "true_name", "titles", "species_lineage", "aura",
  "territory_class", "territory_floors", "arc_story",
  "stat_str", "stat_agi", "stat_vit", "stat_int", "stat_wis", "stat_cha", "stat_lck",
  "fatigue", "full_cowl_sync", "codex_integrity",
  "current_form", "current_bpm", "current_floor",
  "aura_power", "display_name", "operator_level", "operator_xp",
  "notification_settings",
] as const;

// ── Action executor ────────────────────────────────────────
async function executeAction(sb: ReturnType<typeof createClient>, userId: string, action: MavisAction) {
  const p = action.params || {};

  switch (action.type) {

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
      if (!p.quest_id) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["title", "description", "type", "status", "difficulty", "xp_reward", "progress_current", "progress_target", "real_world_mapping", "category"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      updates.updated_at = new Date().toISOString();
      const { error } = await sb.from("quests").update(updates).eq("id", String(p.quest_id)).eq("user_id", userId);
      if (error) throw error;
      return;
    }

    case "complete_quest": {
      if (!p.quest_id) return;
      const { data: quest } = await sb.from("quests").select("xp_reward, title").eq("id", String(p.quest_id)).eq("user_id", userId).single();
      if (!quest) return;
      await sb.from("quests").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", String(p.quest_id)).eq("user_id", userId);
      await awardXP(sb, userId, Number(quest.xp_reward || 0));
      await logActivity(sb, userId, "quest_completed", `Quest completed: ${quest.title}`, Number(quest.xp_reward || 0));
      return;
    }

    case "delete_quest": {
      if (!p.quest_id) return;
      await sb.from("quests").delete().eq("id", String(p.quest_id)).eq("user_id", userId);
      await logActivity(sb, userId, "quest_deleted", "Quest deleted", 0);
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
      if (!p.task_id) return;
      const { data: task } = await sb.from("tasks").select("xp_reward, title, recurrence, completed_count, streak").eq("id", String(p.task_id)).eq("user_id", userId).single();
      if (!task) return;
      const newStatus = task.recurrence === "once" ? "completed" : "active";
      await sb.from("tasks").update({
        status: newStatus,
        completed_count: (task.completed_count || 0) + 1,
        streak: (task.streak || 0) + 1,
        last_completed: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", String(p.task_id)).eq("user_id", userId);
      await awardXP(sb, userId, Number(task.xp_reward || 0));
      await logActivity(sb, userId, "task_completed", `Task completed: ${task.title}`, Number(task.xp_reward || 0));
      return;
    }

    case "delete_task": {
      if (!p.task_id) return;
      await sb.from("tasks").delete().eq("id", String(p.task_id)).eq("user_id", userId);
      return;
    }

    // ── SKILLS ───────────────────────────────────────────
    case "create_skill": {
      const { error } = await sb.from("skills").insert({
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
      });
      if (error) throw error;
      await logActivity(sb, userId, "skill_created", `Skill unlocked: ${String(p.name || "New Skill")}`, 0);
      return;
    }

    case "update_skill": {
      if (!p.skill_id) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["name", "description", "category", "energy_type", "tier", "unlocked", "proficiency"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      updates.updated_at = new Date().toISOString();
      await sb.from("skills").update(updates).eq("id", String(p.skill_id)).eq("user_id", userId);
      return;
    }

    case "delete_skill": {
      if (!p.skill_id) return;
      await sb.from("skills").delete().eq("id", String(p.skill_id)).eq("user_id", userId);
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
      if (!p.entry_id) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["title", "content", "tags", "category", "importance", "mood"]) {
        if (p[key] !== undefined) updates[key] = key === "tags" ? asStringArray(p[key]) : p[key];
      }
      updates.updated_at = new Date().toISOString();
      await sb.from("journal_entries").update(updates).eq("id", String(p.entry_id)).eq("user_id", userId);
      return;
    }

    case "delete_journal": {
      if (!p.entry_id) return;
      await sb.from("journal_entries").delete().eq("id", String(p.entry_id)).eq("user_id", userId);
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
      if (!p.entry_id) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["title", "content", "category", "importance"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      updates.updated_at = new Date().toISOString();
      await sb.from("vault_entries").update(updates).eq("id", String(p.entry_id)).eq("user_id", userId);
      return;
    }

    case "delete_vault": {
      if (!p.entry_id) return;
      await sb.from("vault_entries").delete().eq("id", String(p.entry_id)).eq("user_id", userId);
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
      if (!p.member_id) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["name", "role", "specialty", "class", "notes"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      updates.updated_at = new Date().toISOString();
      await sb.from("councils").update(updates).eq("id", String(p.member_id)).eq("user_id", userId);
      return;
    }

    case "delete_council_member": {
      if (!p.member_id) return;
      await sb.from("councils").delete().eq("id", String(p.member_id)).eq("user_id", userId);
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

    case "delete_inventory_item": {
      if (!p.item_id) return;
      await sb.from("inventory").delete().eq("id", String(p.item_id)).eq("user_id", userId);
      return;
    }

    // ── ENERGY ───────────────────────────────────────────
    case "update_energy": {
      if (!p.energy_id) return;
      await sb.from("energy_systems").update({
        current_value: Number(p.current_value),
        updated_at: new Date().toISOString(),
      }).eq("id", String(p.energy_id)).eq("user_id", userId);
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
      if (!p.ally_id) return;
      const updates: Record<string, unknown> = {};
      for (const key of ["name", "relationship", "level", "specialty", "affinity", "notes"]) {
        if (p[key] !== undefined) updates[key] = p[key];
      }
      await sb.from("allies").update(updates).eq("id", String(p.ally_id)).eq("user_id", userId);
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

    case "complete_ritual": {
      if (!p.ritual_id) return;
      const { data: ritual } = await sb.from("rituals").select("xp_reward, name, streak").eq("id", String(p.ritual_id)).eq("user_id", userId).single();
      if (!ritual) return;
      await sb.from("rituals").update({
        completed: true,
        streak: (ritual.streak || 0) + 1,
        last_completed: new Date().toISOString(),
      }).eq("id", String(p.ritual_id)).eq("user_id", userId);
      await awardXP(sb, userId, Number(ritual.xp_reward || 0));
      await logActivity(sb, userId, "ritual_completed", `Ritual: ${ritual.name}`, Number(ritual.xp_reward || 0));
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

    // Verify user identity
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

    // Use service role to write data
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
