import { z } from "zod";

const TitleField = z.string().min(1, "title is required");
const DescField = z.string().optional();
const StatusField = z.enum(["active", "completed", "archived"]).optional();

// QUEST
// Was {title, description, status, xp_reward, tags, parent_quest_id} — tags
// is validated but the create_quest handler never reads it (dead field,
// removed); missing several real fields the handler does read
// (type/difficulty/codex_points_reward/progress_current/progress_target/
// real_world_mapping/category/loot_rewards/linked_skill_ids). Found via
// vantara-crud-update-fix-brief.md follow-up.
export const CreateQuestSchema = z.object({
  type: z.literal("create_quest"),
  title: TitleField,
  description: DescField,
  quest_type: z.enum(["daily", "side", "main", "epic"]).optional(), // maps to the real "type" column (renamed here to avoid colliding with the action discriminant)
  status: StatusField,
  difficulty: z.enum(["Easy", "Normal", "Hard", "Extreme", "Impossible"]).optional(),
  xp_reward: z.number().int().nonnegative().optional(),
  codex_points_reward: z.number().int().nonnegative().optional(),
  progress_current: z.number().int().nonnegative().optional(),
  progress_target: z.number().int().positive().optional(),
  real_world_mapping: z.string().optional(),
  category: z.string().optional(),
  loot_rewards: z.array(z.unknown()).optional(),
  linked_skill_ids: z.array(z.string()).optional(),
  parent_quest_id: z.string().uuid().optional(),
});
// LOOKUP_BUG fixed: required a bare "id", but promptBuilder.ts documents
// "quest_id" (never bare id), and update_task aliases to this same handler
// with its own "task_id". Was ALSO missing type/difficulty/
// progress_current/progress_target/real_world_mapping/category, which the
// update_quest handler's field loop does read. parent_quest_id removed —
// not in that loop, unused on update.
export const UpdateQuestSchema = z.object({
  type: z.literal("update_quest"),
  quest_id: z.string().min(1).optional(),
  task_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  title: z.string().optional(),
  description: DescField,
  quest_type: z.enum(["daily", "side", "main", "epic"]).optional(),
  status: StatusField,
  difficulty: z.enum(["Easy", "Normal", "Hard", "Extreme", "Impossible"]).optional(),
  xp_reward: z.number().int().nonnegative().optional(),
  progress_current: z.number().int().nonnegative().optional(),
  progress_target: z.number().int().positive().optional(),
  real_world_mapping: z.string().optional(),
  category: z.string().optional(),
}).refine(
  (v) => v.quest_id || v.task_id || v.id,
  { message: "quest_id or task_id (or id) is required to identify the quest" },
);
// LOOKUP_BUG fixed: same class as the update-path bugs already found in
// this brief, but on DELETE — and every delete_* action type is
// ALWAYS_CONFIRM-gated in actionExecutor.ts. A bare-id-required schema
// that never matches what's actually sent means the action fails Zod
// validation and falls through the legacy fallback path, which never
// consults classifyAction() at all — so every real delete_quest call has
// been silently bypassing confirmation, not just validating nothing.
// Found via vantara-crud-update-fix-brief.md follow-up; same pattern
// fixed across every other Delete*Schema below.
export const DeleteQuestSchema = z.object({
  type: z.literal("delete_quest"),
  quest_id: z.string().min(1).optional(),
  task_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine(
  (v) => v.quest_id || v.task_id || v.id,
  { message: "quest_id or task_id (or id) is required to identify the quest" },
);

// COMPLETE QUEST — complete_task aliases here too (mavis-actions/index.ts's
// ACTION_ALIASES). Had zero schema coverage despite a real, live handler
// (marks the quest completed + awards its xp_reward) — same missing-schema
// bug as PERSONA/NOTE/CONTACT/DOMAIN_EFFECT above.
export const CompleteQuestSchema = z.object({
  type: z.literal("complete_quest"),
  quest_id: z.string().min(1).optional(),
  task_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  quest_name: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
}).refine(
  (v) => v.quest_id || v.task_id || v.id || v.quest_name || v.title,
  { message: "quest_id or task_id/quest_name/title (or id) is required to identify the quest" },
);

// TASK — create_task/update_task/delete_task all alias to the quest
// handlers above (tasks/habits are quests with quest_type "task"/"habit";
// there is no separate "tasks" table involved here despite one existing in
// the schema — mavis-actions never touches it for these action types).
// Was {title, description, priority, due_date, quest_id} — priority/
// due_date/quest_id(as a parent-link) all map to nothing real; the real
// underlying fields are create_quest's. "recurrence" IS documented in
// promptBuilder.ts's create_task example but does NOT persist anywhere —
// accepted here (so a real prompt-documented payload doesn't fail
// validation) but flagged: this is a genuine feature gap (habit
// recurrence isn't tracked), not just a naming mismatch, and needs a
// product decision (add a column, or stop promising it), not a schema fix.
export const CreateTaskSchema = z.object({
  type: z.literal("create_task"),
  title: TitleField,
  description: DescField,
  quest_type: z.enum(["task", "habit"]).optional(),
  recurrence: z.enum(["once", "daily", "weekly", "monthly"]).optional(), // NOT currently persisted — see comment above
  xp_reward: z.number().int().nonnegative().optional(),
  status: StatusField,
  difficulty: z.enum(["Easy", "Normal", "Hard", "Extreme", "Impossible"]).optional(),
  category: z.string().optional(),
});
export const UpdateTaskSchema = z.object({
  type: z.literal("update_task"),
  task_id: z.string().min(1).optional(),
  quest_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  title: z.string().optional(),
  description: DescField,
  status: StatusField,
  difficulty: z.enum(["Easy", "Normal", "Hard", "Extreme", "Impossible"]).optional(),
  xp_reward: z.number().int().nonnegative().optional(),
  progress_current: z.number().int().nonnegative().optional(),
  progress_target: z.number().int().positive().optional(),
  category: z.string().optional(),
  // "completed"/"priority" removed — neither is in update_quest's field
  // loop, so neither ever persisted. Marking something done goes through
  // the separate complete_quest action type instead.
}).refine(
  (v) => v.task_id || v.quest_id || v.id,
  { message: "task_id or quest_id (or id) is required to identify the task" },
);
export const DeleteTaskSchema = z.object({
  type: z.literal("delete_task"),
  task_id: z.string().min(1).optional(),
  quest_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine(
  (v) => v.task_id || v.quest_id || v.id,
  { message: "task_id or quest_id (or id) is required to identify the task" },
);

// SKILL
// Was {title (required), category, level} — none are real fields: the
// create_skill/create_subskill handler reads name/description/category/
// energy_type/tier/cost/proficiency/prerequisites/parent_skill_id/
// parent_skill_name (supabase/functions/mavis-actions/index.ts), and the
// real skills table has no "level" column (it's tier + proficiency). Same
// bug class as the update_skill fix — found via the same investigation,
// same silent-legacy-fallback masking, fixed the same way. "unlocked" is
// deliberately NOT included: the handler hardcodes it to true on create,
// never reads it from params.
export const CreateSkillSchema = z.object({
  type: z.literal("create_skill"),
  name: z.string().min(1, "name is required"),
  description: z.string().optional(),
  category: z.string().optional(),
  energy_type: z.string().optional(),
  tier: z.number().int().optional(),
  cost: z.number().int().nonnegative().optional(),
  proficiency: z.number().int().min(0).max(100).optional(),
  prerequisites: z.array(z.string()).optional(),
  parent_skill_id: z.string().optional(),
  parent_skill_name: z.string().optional(),
});
export const UpdateSkillSchema = z.object({
  type: z.literal("update_skill"),
  skill_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  skill_name: z.string().min(1).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  energy_type: z.string().optional(),
  tier: z.number().int().optional(),
  unlocked: z.boolean().optional(),
  proficiency: z.number().int().min(0).max(100).optional(),
}).refine(
  (v) => v.skill_id || v.id || v.skill_name || v.name,
  { message: "skill_id or skill_name (or id/name) is required to identify the skill" },
);
// LOOKUP_BUG fixed — same class/severity as delete_quest above (delete_skill
// is ALWAYS_CONFIRM-gated too). promptBuilder.ts documents "skill_id".
export const DeleteSkillSchema = z.object({
  type: z.literal("delete_skill"),
  skill_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine((v) => v.skill_id || v.id, { message: "skill_id (or id) is required to identify the skill" });

// JOURNAL
export const CreateJournalSchema = z.object({ type: z.literal("create_journal"), title: TitleField, content: z.string().min(1), mood: z.string().optional(), tags: z.array(z.string()).optional() });
export const UpdateJournalSchema = z.object({
  type: z.literal("update_journal"),
  entry_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  entry_title: z.string().min(1).optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  category: z.string().optional(),
  importance: z.string().optional(),
  mood: z.string().optional(),
}).refine(
  (v) => v.entry_id || v.id || v.entry_title || v.title,
  { message: "entry_id or entry_title (or id/title) is required to identify the journal entry" },
);
// LOOKUP_BUG fixed — same class/severity as delete_quest above.
// promptBuilder.ts documents "entry_id".
export const DeleteJournalSchema = z.object({
  type: z.literal("delete_journal"),
  entry_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine((v) => v.entry_id || v.id, { message: "entry_id (or id) is required to identify the journal entry" });

// VAULT
// confidential intentionally removed — not a real column, not read by the
// create_vault handler, not in what promptBuilder.ts documents. Same field
// as the one already removed from UpdateVaultSchema this session. Also
// added importance/attachments, which the handler does read but the old
// schema didn't declare.
export const CreateVaultSchema = z.object({ type: z.literal("create_vault"), title: TitleField, content: z.string().min(1), category: z.string().optional(), importance: z.string().optional(), attachments: z.array(z.string()).optional() });
export const UpdateVaultSchema = z.object({
  type: z.literal("update_vault"),
  entry_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  entry_title: z.string().min(1).optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  category: z.string().optional(),
  importance: z.string().optional(),
  // confidential intentionally removed — not a real column, not accepted by
  // mavis-actions' update_vault handler, not in what promptBuilder.ts tells
  // the LLM to send. CreateVaultSchema had the same unused field — also
  // removed, see that schema's own comment.
}).refine(
  (v) => v.entry_id || v.id || v.entry_title || v.title,
  { message: "entry_id or entry_title (or id/title) is required to identify the vault entry" },
);
// LOOKUP_BUG fixed — same class/severity as delete_quest above.
// promptBuilder.ts documents "entry_id".
export const DeleteVaultSchema = z.object({
  type: z.literal("delete_vault"),
  entry_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine((v) => v.entry_id || v.id, { message: "entry_id (or id) is required to identify the vault entry" });

// COUNCIL MEMBER
// Was {name, role, archetype, description} — the handler reads
// name/role/specialty/class/notes/avatar; "description" doesn't map
// (real notes field is "notes"), "archetype" isn't a councils column
// anywhere (it's real, but on the unrelated personas table).
export const CreateCouncilMemberSchema = z.object({
  type: z.literal("create_council_member"),
  name: z.string().min(1),
  role: z.string().optional(),
  specialty: z.string().optional(),
  class: z.enum(["core", "advisory", "think-tank", "shadows"]).optional(),
  notes: z.string().optional(),
  avatar: z.string().optional(),
});
export const UpdateCouncilMemberSchema = z.object({
  type: z.literal("update_council_member"),
  member_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  member_name: z.string().min(1).optional(),
  name: z.string().optional(),
  role: z.string().optional(),
  specialty: z.string().optional(),
  class: z.enum(["core", "advisory", "think-tank", "shadows"]).optional(),
  notes: z.string().optional(),
}).refine(
  (v) => v.member_id || v.id || v.member_name || v.name,
  { message: "member_id or member_name (or id/name) is required to identify the council member" },
);
// LOOKUP_BUG fixed — same class/severity as delete_quest above.
export const DeleteCouncilMemberSchema = z.object({
  type: z.literal("delete_council_member"),
  member_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine((v) => v.member_id || v.id, { message: "member_id (or id) is required to identify the council member" });

// INVENTORY — type names match mavis-chat system prompt and mavis-actions switch
// Was {name, quantity, category, description, rarity, slot, tier, effect,
// is_equipped} — "category" is not a column on inventory at all (fabricated,
// same class as vault's removed "confidential"); missing "stat_effects",
// which the handler does read. item_type added below — see its own comment.
export const CreateInventorySchema = z.object({
  type: z.literal("create_inventory_item"),
  name: z.string().min(1),
  // item_type maps to the real "type" column (renamed to avoid colliding
  // with the action discriminant — mavis-actions/index.ts's create_inventory_item
  // handler accepts item_type as a fallback specifically for this reason).
  item_type: z.enum(["equipment", "weapon", "artifact", "consumable", "material"]).optional(),
  quantity: z.number().int().min(0).optional(),
  description: DescField,
  rarity: z.string().optional(),
  slot: z.string().optional(),
  tier: z.string().optional(),
  effect: z.string().optional(),
  is_equipped: z.boolean().optional(),
  stat_effects: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().optional() })).optional(),
});
export const UpdateInventorySchema = z.object({
  type: z.literal("update_inventory_item"),
  item_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  item_name: z.string().min(1).optional(),
  name: z.string().optional(),
  item_type: z.enum(["equipment", "weapon", "artifact", "consumable", "material"]).optional(),
  description: z.string().optional(),
  rarity: z.string().optional(),
  quantity: z.number().int().min(0).optional(),
  effect: z.string().optional(),
  slot: z.string().optional(),
  tier: z.string().optional(),
  is_equipped: z.boolean().optional(),
  stat_effects: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().optional() })).optional(),
}).refine(
  (v) => v.item_id || v.id || v.item_name || v.name,
  { message: "item_id or item_name (or id/name) is required to identify the inventory item" },
);
// LOOKUP_BUG fixed — item_id/id were both optional with no refine ensuring
// at least one was present, so a payload with neither would validate fine
// (deletion would then fail downstream in resolveId with a clear error —
// less severe than the CONFIRM-bypass class of bug, but still worth
// tightening for consistency with every other Delete*Schema here).
export const DeleteInventorySchema = z.object({
  type: z.literal("delete_inventory_item"),
  item_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine((v) => v.item_id || v.id, { message: "item_id (or id) is required to identify the inventory item" });

// ENERGY
// Was {level, note} — neither is real (real fields are current_value/
// max_value/status/description/color/type). No lookup field declared at
// all — resolveId always throws without one. No CreateEnergySystemSchema
// existed despite a real create_energy_system handler existing — every
// create_energy_system call has always fallen through the legacy path
// (lower severity than the delete-gate bugs since it's not
// ALWAYS_CONFIRM-gated, but still a real gap, added here).
export const CreateEnergySystemSchema = z.object({
  type: z.literal("create_energy_system"),
  name: z.string().min(1), // maps to the real "type" column (create_energy_system already accepts p.name as a fallback for it, no backend change needed)
  current_value: z.number().int().min(0).max(100).optional(),
  max_value: z.number().int().min(0).max(100).optional(),
  color: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["developing", "mastered", "locked"]).optional(),
});
export const UpdateEnergySchema = z.object({
  type: z.literal("update_energy"),
  energy_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  energy_name: z.string().min(1).optional(),
  // energy_type maps to the real "type" column (renamed to avoid colliding
  // with the action discriminant).
  energy_type: z.string().optional(),
  current_value: z.number().int().min(0).max(100).optional(),
  max_value: z.number().int().min(0).max(100).optional(),
  status: z.enum(["developing", "mastered", "locked"]).optional(),
  description: z.string().optional(),
  color: z.string().optional(),
}).refine(
  (v) => v.energy_id || v.id || v.energy_name || v.energy_type,
  { message: "energy_id or energy_name/energy_type (or id) is required to identify the energy system" },
);
// No DeleteEnergySchema existed at all despite a real "delete_energy" handler
// (mavis-actions/index.ts) and promptBuilder.ts documenting it — every real
// delete_energy call has always fallen through the legacy path. delete_energy
// was also missing from actionExecutor.ts's ALWAYS_CONFIRM set (fixed
// alongside this, for consistency with every other delete_* action type).
export const DeleteEnergySchema = z.object({
  type: z.literal("delete_energy"),
  energy_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine((v) => v.energy_id || v.id, { message: "energy_id (or id) is required to identify the energy system" });

// ALLY
// Was {name, relationship, trust_level, notes} — trust_level is not a real
// allies column anywhere (fabricated, same class as vault's "confidential");
// real fields are name/relationship/level/specialty/affinity/notes.
export const CreateAllySchema = z.object({
  type: z.literal("create_ally"),
  name: z.string().min(1),
  relationship: z.enum(["ally", "council", "rival", "contact", "mentor", "partner"]).optional(),
  level: z.number().int().optional(),
  specialty: z.string().optional(),
  affinity: z.number().int().min(0).max(100).optional(),
  notes: DescField,
});
export const UpdateAllySchema = z.object({
  type: z.literal("update_ally"),
  ally_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  ally_name: z.string().min(1).optional(),
  name: z.string().optional(),
  relationship: z.enum(["ally", "council", "rival", "contact", "mentor", "partner"]).optional(),
  level: z.number().int().optional(),
  specialty: z.string().optional(),
  affinity: z.number().int().min(0).max(100).optional(),
  notes: z.string().optional(),
}).refine(
  (v) => v.ally_id || v.id || v.ally_name || v.name,
  { message: "ally_id or ally_name (or id/name) is required to identify the ally" },
);
// LOOKUP_BUG fixed — same class/severity as delete_quest above.
export const DeleteAllySchema = z.object({
  type: z.literal("delete_ally"),
  ally_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine((v) => v.ally_id || v.id, { message: "ally_id (or id) is required to identify the ally" });

// TRANSFORMATION — NEVER mix with RANKING
// Was {title, phase} — neither maps to anything: the real fields are
// "name" (not title) and "tier" (a text field like "Base"/"Spartan", not
// "phase"). Every real create/update_transformation call has been
// silently no-oping into defaults regardless of what MAVIS sent.
export const CreateTransformationSchema = z.object({
  type: z.literal("create_transformation"),
  name: TitleField,
  tier: z.string().optional(),
  form_order: z.number().int().optional(),
  bpm_range: z.string().optional(),
  energy: z.string().optional(),
  jjk_grade: z.string().optional(),
  op_tier: z.string().optional(),
  description: DescField,
  category: z.string().optional(),
  unlocked: z.boolean().optional(),
  active_buffs: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().optional() })).optional(),
  passive_buffs: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().optional() })).optional(),
  abilities: z.array(z.object({ title: z.string(), irl: z.string().optional() })).optional(),
  rank: z.undefined().optional(),
  rank_id: z.undefined().optional(),
});
export const UpdateTransformationSchema = z.object({
  type: z.literal("update_transformation"),
  transformation_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  transformation_name: z.string().min(1).optional(),
  name: z.string().optional(),
  tier: z.string().optional(),
  form_order: z.number().int().optional(),
  bpm_range: z.string().optional(),
  energy: z.string().optional(),
  jjk_grade: z.string().optional(),
  op_tier: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  unlocked: z.boolean().optional(),
  active_buffs: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().optional() })).optional(),
  passive_buffs: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().optional() })).optional(),
  abilities: z.array(z.object({ title: z.string(), irl: z.string().optional() })).optional(),
  rank: z.undefined().optional(),
  rank_id: z.undefined().optional(),
}).refine(
  (v) => v.transformation_id || v.id || v.transformation_name || v.name,
  { message: "transformation_id or transformation_name (or id/name) is required to identify the transformation" },
);
// LOOKUP_BUG fixed — same class/severity as delete_quest above.
export const DeleteTransformationSchema = z.object({
  type: z.literal("delete_transformation"),
  transformation_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine((v) => v.transformation_id || v.id, { message: "transformation_id (or id) is required to identify the transformation" });

// RANKING — NEVER mix with TRANSFORMATION
// Was {title, tier(number)} — neither maps to anything: real fields are
// "display_name" (not title) and "rank" (a TEXT field like "D"/"S", not a
// number called "tier" — rankings_profiles has no tier column at all).
// This was also the source of a CONFIRM-gate bug (fixed separately in
// actionExecutor.ts): the gate checked for "tier" in the payload, a field
// that never existed, so a real rank change via the actual "rank" field
// never triggered confirmation.
export const CreateRankingSchema = z.object({
  type: z.literal("create_ranking"),
  display_name: TitleField,
  role: z.string().optional(),
  rank: z.string().optional(),
  level: z.number().int().optional(),
  jjk_grade: z.string().optional(),
  op_tier: z.string().optional(),
  gpr: z.number().int().optional(),
  pvp: z.number().int().optional(),
  influence: z.string().optional(),
  notes: DescField,
  is_self: z.boolean().optional(),
  transformation: z.undefined().optional(),
  transformation_id: z.undefined().optional(),
  phase: z.undefined().optional(),
});
export const UpdateRankingSchema = z.object({
  type: z.literal("update_ranking"),
  ranking_id: z.string().min(1).optional(),
  profile_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  ranking_name: z.string().min(1).optional(),
  display_name: z.string().optional(),
  role: z.string().optional(),
  rank: z.string().optional(),
  level: z.number().int().optional(),
  jjk_grade: z.string().optional(),
  op_tier: z.string().optional(),
  gpr: z.number().int().optional(),
  pvp: z.number().int().optional(),
  influence: z.string().optional(),
  notes: z.string().optional(),
  is_self: z.boolean().optional(),
  transformation: z.undefined().optional(),
  transformation_id: z.undefined().optional(),
}).refine(
  (v) => v.ranking_id || v.profile_id || v.id || v.ranking_name || v.display_name,
  { message: "ranking_id/profile_id or ranking_name/display_name (or id) is required to identify the ranking" },
);
// LOOKUP_BUG fixed — same class/severity as delete_quest above.
export const DeleteRankingSchema = z.object({
  type: z.literal("delete_ranking"),
  ranking_id: z.string().min(1).optional(),
  profile_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine((v) => v.ranking_id || v.profile_id || v.id, { message: "ranking_id or profile_id (or id) is required to identify the ranking" });

// STORE ITEM
export const CreateStoreItemSchema = z.object({
  type: z.literal("create_store_item"),
  name: z.string().min(1),
  price: z.number().min(0),
  description: DescField,
  currency: z.string().optional(),
  rarity: z.string().optional(),
  category: z.string().optional(),
  effect: z.string().optional(),
  req_level: z.number().int().optional(),
  req_rank: z.string().optional(),
});
export const UpdateStoreItemSchema = z.object({
  type: z.literal("update_store_item"),
  // promptBuilder.ts documents "store_item_id" — was missing from both this
  // schema and the backend's resolveId call (fixed separately in
  // mavis-actions/index.ts).
  store_item_id: z.string().min(1).optional(),
  item_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  item_name: z.string().min(1).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  price: z.number().min(0).optional(),
  currency: z.string().optional(),
  rarity: z.string().optional(),
  category: z.string().optional(),
  effect: z.string().optional(),
  req_level: z.number().int().optional(),
  req_rank: z.string().optional(),
}).refine(
  (v) => v.store_item_id || v.item_id || v.id || v.item_name || v.name,
  { message: "store_item_id or item_name (or item_id/id/name) is required to identify the store item" },
);
// LOOKUP_BUG fixed — same class/severity as delete_quest above, plus the
// same missing store_item_id fallback (fixed in mavis-actions/index.ts).
export const DeleteStoreItemSchema = z.object({
  type: z.literal("delete_store_item"),
  store_item_id: z.string().min(1).optional(),
  item_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine((v) => v.store_item_id || v.item_id || v.id, { message: "store_item_id (or item_id/id) is required to identify the store item" });

// LOG BPM
export const LogBpmSchema = z.object({ type: z.literal("log_bpm"), bpm: z.number().int().min(20).max(300), context: z.string().optional(), timestamp: z.string().optional() });
// LOG BPM SESSION — the actual canonical type ("log_bpm" is a legacy alias
// that normalizes to this one in both mavis-actions/index.ts's
// ACTION_ALIASES and actionExecutor.ts's mirror of it). promptBuilder.ts
// only ever documents "log_bpm_session", with bpm/form/duration/mood/notes
// — none of which except bpm existed on LogBpmSchema above, so every real
// log_bpm_session call has always skipped Zod validation and gone through
// the legacy fallback path (lower severity — not CONFIRM-gated either way
// — but the handler's form/mood/notes fields were silently unreachable
// through this action shape until now).
export const LogBpmSessionSchema = z.object({
  type: z.literal("log_bpm_session"),
  bpm: z.number().int().min(20).max(300),
  form: z.string().optional(),
  duration: z.number().int().nonnegative().optional(),
  mood: z.string().optional(),
  notes: z.string().optional(),
});

// RITUAL — create_ritual/update_ritual/delete_ritual had ZERO backend
// implementation despite being documented in promptBuilder.ts,
// mavis-persona-router, and telegram-webhook — every real call has always
// returned "unknown action type". complete_ritual already works (a separate
// mechanism — toolDispatch.ts's native Claude tool-calling). Real handlers
// added to mavis-actions/index.ts alongside these schemas.
export const CreateRitualSchema = z.object({
  type: z.literal("create_ritual"),
  name: z.string().min(1),
  description: z.string().optional(),
  ritual_type: z.enum(["fitness", "business", "self_care", "legal", "other"]).optional(), // maps to the real "type" column
  category: z.string().optional(),
  xp_reward: z.number().int().nonnegative().optional(),
});
export const UpdateRitualSchema = z.object({
  type: z.literal("update_ritual"),
  ritual_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  ritual_name: z.string().min(1).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  ritual_type: z.enum(["fitness", "business", "self_care", "legal", "other"]).optional(),
  category: z.string().optional(),
  xp_reward: z.number().int().nonnegative().optional(),
}).refine(
  (v) => v.ritual_id || v.id || v.ritual_name || v.name,
  { message: "ritual_id or ritual_name (or id/name) is required to identify the ritual" },
);
export const DeleteRitualSchema = z.object({
  type: z.literal("delete_ritual"),
  ritual_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  ritual_name: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
}).refine(
  (v) => v.ritual_id || v.id || v.ritual_name || v.name,
  { message: "ritual_id or ritual_name (or id/name) is required to identify the ritual" },
);

// PERSISTENT PLANS — mavis-plans edge function. Discovered to be
// completely unreachable from chat: every real call fell through
// actionExecutor.ts's legacy path to the generic mavis-actions
// defaultHandler, which has no cases for any of these types, so they've
// always failed with "unknown action type" despite mavis-plans being a
// fully-built, working edge function. Fixed by adding these schemas AND
// registering dedicated proxy handlers in MavisChat.tsx that route to
// mavis-plans instead of mavis-actions (same pattern already used for
// composio_action → mavis-composio-agent).
const PlanStepSchema = z.object({ step: z.string(), notes: z.string().optional() });
export const GeneratePlanSchema = z.object({
  type: z.literal("generate_plan"),
  goal: z.string().min(1),
  context: z.string().optional(),
  timeframe: z.string().optional(),
});
export const CreatePlanSchema = z.object({
  type: z.literal("create_plan"),
  title: z.string().optional(),
  goal: z.string().optional(),
  steps: z.array(PlanStepSchema).optional(),
});
export const GetPlansSchema = z.object({
  type: z.literal("get_plans"),
  status: z.enum(["active", "paused", "completed", "abandoned", "all"]).optional(),
});
export const GetPlanSchema = z.object({
  type: z.literal("get_plan"),
  plan_id: z.string().min(1),
});
export const UpdatePlanSchema = z.object({
  type: z.literal("update_plan"),
  plan_id: z.string().min(1),
  title: z.string().optional(),
  goal: z.string().optional(),
  steps: z.array(PlanStepSchema).optional(),
  current_step: z.number().int().nonnegative().optional(),
  status: z.enum(["active", "paused", "completed", "abandoned"]).optional(),
  context: z.string().optional(),
});
export const AdvanceStepSchema = z.object({
  type: z.literal("advance_step"),
  plan_id: z.string().min(1),
  notes: z.string().optional(),
});
export const UpdateSessionSchema = z.object({
  type: z.literal("update_session"),
  plan_id: z.string().min(1),
  summary: z.string().optional(),
});
export const CompletePlanSchema = z.object({
  type: z.literal("complete_plan"),
  plan_id: z.string().min(1),
});
export const DeletePlanSchema = z.object({
  type: z.literal("delete_plan"),
  plan_id: z.string().min(1),
});

// QUEST CHAINS / SKILL CHAINS — mavis-chain-builder edge function. Same
// "fully built but unreachable from chat" gap as PERSISTENT PLANS above.
export const AutoLinkQuestChainsSchema = z.object({ type: z.literal("auto_link_quest_chains") });
export const AutoLinkSkillChainsSchema = z.object({ type: z.literal("auto_link_skill_chains") });
export const GetQuestChainsSchema = z.object({ type: z.literal("get_quest_chains") });
export const GetSkillChainsSchema = z.object({ type: z.literal("get_skill_chains") });
export const CreateQuestChainSchema = z.object({
  type: z.literal("create_quest_chain"),
  title: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  quest_ids: z.array(z.string()).optional(),
});
export const CreateSkillChainSchema = z.object({
  type: z.literal("create_skill_chain"),
  title: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  skill_ids: z.array(z.string()).optional(),
});
export const UpdateQuestChainSchema = z.object({
  type: z.literal("update_quest_chain"),
  chain_id: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
});
export const UpdateSkillChainSchema = z.object({
  type: z.literal("update_skill_chain"),
  chain_id: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
});
export const DeleteQuestChainSchema = z.object({
  type: z.literal("delete_quest_chain"),
  chain_id: z.string().min(1),
});
export const DeleteSkillChainSchema = z.object({
  type: z.literal("delete_skill_chain"),
  chain_id: z.string().min(1),
});
export const AddQuestToChainSchema = z.object({
  type: z.literal("add_quest_to_chain"),
  chain_id: z.string().min(1),
  quest_id: z.string().min(1),
  position: z.number().int().nonnegative().optional(),
});
export const AddSkillToChainSchema = z.object({
  type: z.literal("add_skill_to_chain"),
  chain_id: z.string().min(1),
  skill_id: z.string().min(1),
  position: z.number().int().nonnegative().optional(),
});
export const RemoveFromChainSchema = z.object({
  type: z.literal("remove_from_chain"),
  item_id: z.string().min(1),
  chain_type: z.enum(["quest", "skill"]).optional(),
});

// SIGNAL CONFIGS — mavis-signal-watcher edge function. Same "fully built
// but unreachable from chat" gap as PERSISTENT PLANS above. "watch_signals"
// deliberately has no schema — it's the pg_cron entry point, never emitted
// by the LLM (not in promptBuilder.ts).
export const GetSignalConfigsSchema = z.object({ type: z.literal("get_signal_configs") });
export const UpsertSignalConfigSchema = z.object({
  type: z.literal("upsert_signal_config"),
  id: z.string().optional(), // present → update, absent → insert
  signal_type: z.enum(["rss", "market_move", "keyword_email", "keyword_telegram"]),
  name: z.string().min(1),
  source: z.string().min(1),
  threshold: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().optional(),
  cooldown_hours: z.number().int().positive().optional(),
});
export const DeleteSignalConfigSchema = z.object({
  type: z.literal("delete_signal_config"),
  id: z.string().min(1),
});

// UPDATE PROFILE
// Was {display_name, bio, avatar_url, codex_name, title} — bio/codex_name/
// title are not real profiles columns at all (not in PROFILE_ALLOWED);
// display_name/avatar_url were the only two real fields. Rewritten to match
// PROFILE_ALLOWED (supabase/functions/mavis-actions/index.ts) exactly — every
// field here maps 1:1 to a column that handler will actually persist.
export const UpdateProfileSchema = z.object({
  type: z.literal("update_profile"),
  inscribed_name: z.string().optional(),
  true_name: z.string().optional(),
  titles: z.array(z.string()).optional(),
  species_lineage: z.array(z.string()).optional(),
  aura: z.string().optional(),
  territory_class: z.string().optional(),
  territory_floors: z.string().optional(),
  arc_story: z.string().optional(),
  stat_str: z.number().int().optional(),
  stat_agi: z.number().int().optional(),
  stat_vit: z.number().int().optional(),
  stat_int: z.number().int().optional(),
  stat_wis: z.number().int().optional(),
  stat_cha: z.number().int().optional(),
  stat_lck: z.number().int().optional(),
  fatigue: z.number().int().min(0).max(100).optional(),
  full_cowl_sync: z.number().int().min(0).max(100).optional(),
  codex_integrity: z.number().int().min(0).max(100).optional(),
  current_form: z.string().optional(),
  current_bpm: z.number().int().min(20).max(300).optional(),
  current_floor: z.number().int().optional(),
  aura_power: z.string().optional(),
  display_name: z.string().optional(),
  operator_level: z.number().int().optional(),
  operator_xp: z.number().int().nonnegative().optional(),
  notification_settings: z.record(z.string(), z.boolean()).optional(),
  rank: z.string().optional(),
  level: z.number().int().optional(),
  xp: z.number().int().nonnegative().optional(),
  xp_to_next_level: z.number().int().nonnegative().optional(),
  pvp_rating: z.number().int().optional(),
  gpr: z.number().int().optional(),
  avatar_url: z.string().url().optional(),
});

// AWARD XP
export const AwardXpSchema = z.object({ type: z.literal("award_xp"), amount: z.number().int().min(1), reason: z.string().optional(), source: z.string().optional() });

// NORA TWEET — queue a tweet for Nora Vale's Twitter account (requires_confirmation by default)
export const NoraTweetSchema = z.object({
  type: z.literal("nora_tweet"),
  content: z.string().min(1).max(280),
  replyToTweetId: z.string().optional(),
});

// CREATE SKILL DEFINITION — MAVIS writes a new runtime skill to the database
export const CreateSkillDefinitionSchema = z.object({
  type: z.literal("create_skill_definition"),
  name: z.string().min(1),
  description: z.string().min(1),
  keywords: z.array(z.string()).min(1),
  prompt_template: z.string().min(10),
});

// PROPOSE PRODUCT — autonomous product creation (routes to mavis_tasks requires_confirmation)
// MAVIS emits this when she detects a revenue opportunity worth pursuing.
// Operator approves in Inbox Task Log → executor creates product + PDF content.
// platform: "gumroad" (default, digital products) | "stripe" (services/subscriptions)
export const ProposeProductSchema = z.object({
  type: z.literal("propose_product"),
  title: z.string().min(1),
  description: z.string().min(1),
  audience: z.string().optional(),
  price_cents: z.number().int().min(100).max(50000).optional(),
  category: z.enum(["guide", "prompt_pack", "template", "framework", "mini_course"]).optional(),
  platform: z.enum(["gumroad", "stripe"]).optional(),
});

// IMAGE GENERATION
// provider explicitly selects which backend mavis-image-gen uses
// (gemini/imagen-4, flux-pro, openai, modelslab, stable-diffusion,
// lovable, pollinations, promptchan) instead of its automatic cascade.
// nsfw:true is a shorthand synonym for provider:"promptchan". Neither
// requires anything else — provider selection here is AUTO, not
// confirmation-gated (see actionExecutor.ts's classifyAction comment).
export const GenerateImageSchema = z.object({
  type: z.literal("generate_image"),
  prompt: z.string().min(1),
  aspect_ratio: z.enum(["1:1","16:9","9:16","4:3","3:4"]).optional(),
  save_to_vault: z.boolean().optional(),
  provider: z.enum(["auto","flux-pro","imagen-4","openai","modelslab","stable-diffusion","lovable","pollinations","promptchan"]).optional(),
  nsfw: z.boolean().optional(),
});

// VIDEO GENERATION
// provider enum was missing kling/runway/modelslab/promptchan — all four
// were already live in mavis-video-gen's own provider chain, just never
// reachable through this validated action-tag path (the LLM could name
// them, but Zod would reject the request before it ever got there).
export const GenerateVideoSchema = z.object({
  type: z.literal("generate_video"),
  prompt: z.string().min(1),
  duration: z.number().int().min(1).max(30).optional(),
  aspect_ratio: z.enum(["16:9","9:16","1:1"]).optional(),
  provider: z.enum(["fal","veo","omni","kling","runway","modelslab","promptchan","auto"]).optional(),
  save_to_vault: z.boolean().optional(),
});

export const VideoStatusSchema = z.object({
  type: z.literal("video_status"),
  provider: z.enum(["fal","veo","omni","kling","runway","modelslab","promptchan"]),
  request_id: z.string().optional(),
  operation_name: z.string().optional(),
});

// AVATAR SOCIAL POST — script → trained HeyGen avatar video → TikTok/YouTube,
// via mavis-avatar-publish. Uses the operator's saved default_heygen_avatar_id/
// voice_id (set in Avatar Studio) unless avatar_id/voice_id are given — never
// assumes a stock avatar; errors if neither the params nor the profile have one.
export const AvatarSocialPostSchema = z.object({
  type: z.literal("avatar_social_post"),
  action: z.enum(["generate_and_post", "post_existing"]),
  script: z.string().optional(),
  video_url: z.string().optional(),
  avatar_id: z.string().optional(),
  voice_id: z.string().optional(),
  platforms: z.string().min(1), // comma-separated: "tiktok,youtube"
  tiktok_caption: z.string().optional(),
  youtube_title: z.string().optional(),
  youtube_description: z.string().optional(),
  privacy_status: z.enum(["private", "unlisted", "public"]).optional(),
});

// PLAN-AND-EXECUTE — decompose a high-level goal into a DAG of steps via mavis-planner
// plan_execute requires confirmation — see actionExecutor.ts ALWAYS_CONFIRM
export const PlanExecuteSchema = z.object({
  type: z.literal("plan_execute"),
  params: z.object({
    goal: z.string().min(10).max(500),
    context: z.string().max(1000).optional(),
    auto_create_quests: z.boolean().default(true),
  }),
});

// WEBSITE BUILDER — create a complete client website via mavis-web-builder
export const CreateWebsiteSchema = z.object({
  type: z.literal("create_website"),
  client_name: z.string().min(1),
  business_name: z.string().min(1),
  business_type: z.enum(["local_business","saas","agency","ecommerce","restaurant","medical","portfolio","nonprofit"]).optional(),
  description: z.string().min(10),
  target_audience: z.string().optional(),
  unique_value: z.string().optional(),
  location: z.string().optional(),
  style: z.enum(["modern","corporate","creative","minimal","bold","elegant"]).optional(),
  color_scheme: z.enum(["blue","green","purple","orange","red","monochrome"]).optional(),
  pages: z.array(z.string()).optional(),
  price_cents: z.number().int().min(0).optional(),
});

// PUBLISH WEBPAGE — publish a specific page to an existing project's WP site
export const PublishWebpageSchema = z.object({
  type: z.literal("publish_webpage"),
  project_id: z.string().uuid(),
  page_type: z.string().min(1),
  title: z.string().min(1),
  content_brief: z.string().optional(),
});

// CREATE WIDGET — generate an AI-powered embeddable widget via mavis-widget-gen
export const CreateWidgetSchema = z.object({
  type: z.literal("create_widget"),
  widget_type: z.enum(["chat","lead_capture","quote_calculator","faq","roi_calculator","appointment_booker"]),
  business_name: z.string().min(1),
  primary_color: z.string().optional(),
  position: z.enum(["bottom-right","bottom-left"]).optional(),
  name: z.string().optional(),
  greeting: z.string().optional(),
  system_prompt: z.string().optional(),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
  project_id: z.string().optional(),
  monthly_price_cents: z.number().int().min(0).optional(),
});

// VIDEO EDITOR — AI-powered clip extraction and editing
export const AnalyzeVideoSchema = z.object({
  type: z.literal("analyze_video"),
  source_url: z.string().url(),
  source_type: z.enum(["upload", "youtube", "loom", "url"]).optional(),
  title: z.string().optional(),
  language: z.string().optional(),
});

export const GenerateClipsSchema = z.object({
  type: z.literal("generate_clips"),
  project_id: z.string().uuid(),
  formats: z.array(z.enum(["shorts", "reels", "highlight", "long_form"])).optional(),
  count_per_format: z.number().int().min(1).max(10).optional(),
});

export const RenderClipSchema = z.object({
  type: z.literal("render_clip"),
  clip_id: z.string().uuid(),
  aspect_ratio: z.enum(["9:16", "16:9", "1:1"]).optional(),
  add_captions: z.boolean().optional(),
  push_to_nora: z.boolean().optional(),
});

// EXECUTE IN SANDBOX — multi-language code execution via the MAVIS sandbox server
export const ExecuteInSandboxSchema = z.object({
  type: z.literal("execute_in_sandbox"),
  code: z.string().min(1),
  language: z.enum(["python", "node", "typescript", "bash"]).default("python"),
  session_id: z.string().optional(),
  timeout: z.number().int().min(1).max(60).optional(),
});

// EDIT FILE — propose a file edit (always requires confirmation before execution)
export const EditFileSchema = z.object({
  type: z.literal("edit_file"),
  path: z.string().min(1),
  description: z.string().min(1),
  old_content: z.string(),
  new_content: z.string().min(1),
});

// GIT OPERATION — read-only git ops run directly; write ops require confirmation
export const GitOperationSchema = z.object({
  type: z.literal("git_operation"),
  operation: z.enum(["status", "diff", "log", "commit", "push"]),
  message: z.string().optional(),   // for commit
  files: z.array(z.string()).optional(),
});

// BROWSE PAGE — fetch and analyse a web page via the internet agent
export const BrowsePageSchema = z.object({
  type: z.literal("browse_page"),
  url: z.string().url(),
  task: z.string().optional(),   // what to extract / do
  selector: z.string().optional(),
});

// PERSONA — create_persona routes through mavis-persona-forge (fire-and-
// forget, no lookup needed); delete_persona is actually a soft-delete
// (is_active=false) in mavis-actions/index.ts, not a real DELETE.
// Neither had ANY schema at all despite both being live, promptBuilder.ts-
// documented action types — every real call has always skipped Zod
// validation entirely and gone straight through actionExecutor.ts's legacy
// fallback path. Lower severity than the ALWAYS_CONFIRM delete_* bugs above
// (neither type is CONFIRM-gated), but the same root bug class.
export const CreatePersonaSchema = z.object({
  type: z.literal("create_persona"),
  description: z.string().min(1),
});
export const DeletePersonaSchema = z.object({
  type: z.literal("delete_persona"),
  persona_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  persona_name: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
}).refine(
  (v) => v.persona_id || v.id || v.persona_name || v.name,
  { message: "persona_id or persona_name (or id/name) is required to identify the persona" },
);

// NOTE (knowledge graph) — same missing-schema bug as PERSONA above.
// "note_type" is documented in promptBuilder.ts's create_note example but
// not read by the create_note handler (accepted-but-ignored here, same
// treatment as create_vault's removed "confidential").
export const CreateNoteSchema = z.object({
  type: z.literal("create_note"),
  title: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  source: z.string().optional(),
  note_type: z.string().optional(), // not persisted — see comment above
});
export const UpdateNoteSchema = z.object({
  type: z.literal("update_note"),
  note_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  note_title: z.string().min(1).optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
}).refine(
  (v) => v.note_id || v.id || v.note_title || v.title,
  { message: "note_id or note_title (or id/title) is required to identify the note" },
);
export const DeleteNoteSchema = z.object({
  type: z.literal("delete_note"),
  note_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  note_title: z.string().min(1).optional(),
  title: z.string().optional(),
}).refine(
  (v) => v.note_id || v.id || v.note_title || v.title,
  { message: "note_id or note_title (or id/title) is required to identify the note" },
);

// CONTACT — same missing-schema bug as PERSONA/NOTE above. promptBuilder.ts's
// create_contact example documents email/phone/company/role, but the
// contacts table (20260517200000_new_features.sql) has no such columns.
// Rather than a migration (off-limits without explicit instruction — see
// CLAUDE.md) or leaving them silently dropped, mavis-actions/index.ts now
// folds all four into the existing "profile" jsonb column on both create
// and update (update reads-merges-writes so partial updates don't clobber
// previously-saved fields).
export const CreateContactSchema = z.object({
  type: z.literal("create_contact"),
  name: z.string().min(1),
  relationship_type: z.string().optional(),
  relationship: z.string().optional(),
  last_contact_at: z.string().optional(),
  follow_up_date: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  profile: z.record(z.string(), z.unknown()).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  role: z.string().optional(),
});
export const UpdateContactSchema = z.object({
  type: z.literal("update_contact"),
  contact_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  contact_name: z.string().min(1).optional(),
  name: z.string().optional(),
  relationship_type: z.string().optional(),
  relationship: z.string().optional(),
  last_contact_at: z.string().optional(),
  follow_up_date: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  profile: z.record(z.string(), z.unknown()).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  role: z.string().optional(),
}).refine(
  (v) => v.contact_id || v.id || v.contact_name || v.name,
  { message: "contact_id or contact_name (or id/name) is required to identify the contact" },
);

// DOMAIN EFFECT — same missing-schema bug as PERSONA/NOTE/CONTACT above.
export const CreateDomainEffectSchema = z.object({
  type: z.literal("create_domain_effect"),
  name: z.string().min(1),
  description: z.string().optional(),
  effect_type: z.string().optional(),
  stat_modifiers: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().optional() })).optional(),
  area_effects: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
  expires_at: z.string().optional(),
  source: z.string().optional(),
});
export const UpdateDomainEffectSchema = z.object({
  type: z.literal("update_domain_effect"),
  effect_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  effect_name: z.string().min(1).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  effect_type: z.string().optional(),
  stat_modifiers: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().optional() })).optional(),
  area_effects: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
  expires_at: z.string().optional(),
  source: z.string().optional(),
}).refine(
  (v) => v.effect_id || v.id || v.effect_name || v.name,
  { message: "effect_id or effect_name (or id/name) is required to identify the domain effect" },
);
export const DeleteDomainEffectSchema = z.object({
  type: z.literal("delete_domain_effect"),
  effect_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  effect_name: z.string().min(1).optional(),
  name: z.string().optional(),
}).refine(
  (v) => v.effect_id || v.id || v.effect_name || v.name,
  { message: "effect_id or effect_name (or id/name) is required to identify the domain effect" },
);

// COMPOSIO ACTION — any third-party integration routed through Composio
// (mavis-composio-agent), instead of a new bespoke edge function. Execution
// Blueprint Stage G: "from this point forward, new third-party integrations
// MAVIS needs get built through mavis-composio-agent + this action type, not
// as a new bespoke edge function." Generic on purpose — Composio exposes
// 1000+ toolkit actions and this schema isn't meant to enumerate them; it
// validates the envelope (which tool, what arguments), classifyAction()
// below decides AUTO vs CONFIRM per the tool_slug's implied verb.
export const ComposioActionSchema = z.object({
  type: z.literal("composio_action"),
  tool_slug: z.string().min(1),        // e.g. "GITHUB_CREATE_ISSUE"
  params: z.record(z.string(), z.unknown()).default({}),
});

// UNION — ALL SCHEMAS
export const ActionSchema = z.discriminatedUnion("type", [
  CreateQuestSchema, UpdateQuestSchema, DeleteQuestSchema, CompleteQuestSchema,
  CreateTaskSchema, UpdateTaskSchema, DeleteTaskSchema,
  CreateSkillSchema, UpdateSkillSchema, DeleteSkillSchema,
  CreateJournalSchema, UpdateJournalSchema, DeleteJournalSchema,
  CreateVaultSchema, UpdateVaultSchema, DeleteVaultSchema,
  CreateCouncilMemberSchema, UpdateCouncilMemberSchema, DeleteCouncilMemberSchema,
  CreateInventorySchema, UpdateInventorySchema, DeleteInventorySchema,
  CreateEnergySystemSchema, UpdateEnergySchema, DeleteEnergySchema,
  CreateAllySchema, UpdateAllySchema, DeleteAllySchema,
  CreateTransformationSchema, UpdateTransformationSchema, DeleteTransformationSchema,
  CreateRankingSchema, UpdateRankingSchema, DeleteRankingSchema,
  CreateStoreItemSchema, UpdateStoreItemSchema, DeleteStoreItemSchema,
  CreateRitualSchema, UpdateRitualSchema, DeleteRitualSchema,
  GeneratePlanSchema, CreatePlanSchema, GetPlansSchema, GetPlanSchema, UpdatePlanSchema,
  AdvanceStepSchema, UpdateSessionSchema, CompletePlanSchema, DeletePlanSchema,
  AutoLinkQuestChainsSchema, AutoLinkSkillChainsSchema, GetQuestChainsSchema, GetSkillChainsSchema,
  CreateQuestChainSchema, CreateSkillChainSchema, UpdateQuestChainSchema, UpdateSkillChainSchema,
  DeleteQuestChainSchema, DeleteSkillChainSchema, AddQuestToChainSchema, AddSkillToChainSchema, RemoveFromChainSchema,
  GetSignalConfigsSchema, UpsertSignalConfigSchema, DeleteSignalConfigSchema,
  LogBpmSchema,
  LogBpmSessionSchema,
  UpdateProfileSchema,
  AwardXpSchema,
  ProposeProductSchema,
  NoraTweetSchema,
  GenerateImageSchema,
  GenerateVideoSchema,
  VideoStatusSchema,
  AvatarSocialPostSchema,
  CreateSkillDefinitionSchema,
  PlanExecuteSchema,
  CreateWebsiteSchema,
  PublishWebpageSchema,
  CreateWidgetSchema,
  AnalyzeVideoSchema,
  GenerateClipsSchema,
  RenderClipSchema,
  ExecuteInSandboxSchema,
  EditFileSchema,
  GitOperationSchema,
  BrowsePageSchema,
  ComposioActionSchema,
  CreatePersonaSchema, DeletePersonaSchema,
  CreateNoteSchema, UpdateNoteSchema, DeleteNoteSchema,
  CreateContactSchema, UpdateContactSchema,
  CreateDomainEffectSchema, UpdateDomainEffectSchema, DeleteDomainEffectSchema,
]);

export type ValidatedAction = z.infer<typeof ActionSchema>;
