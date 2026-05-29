import { z } from "zod";

const TitleField = z.string().min(1, "title is required");
const DescField = z.string().optional();
const StatusField = z.enum(["active", "completed", "archived"]).optional();

// QUEST
export const CreateQuestSchema = z.object({ type: z.literal("create_quest"), title: TitleField, description: DescField, status: StatusField, xp_reward: z.number().int().nonnegative().optional(), tags: z.array(z.string()).optional() });
export const UpdateQuestSchema = z.object({ type: z.literal("update_quest"), id: z.string().min(1), title: z.string().optional(), description: DescField, status: StatusField, xp_reward: z.number().int().nonnegative().optional() });
export const DeleteQuestSchema = z.object({ type: z.literal("delete_quest"), id: z.string().min(1) });

// TASK
export const CreateTaskSchema = z.object({ type: z.literal("create_task"), title: TitleField, description: DescField, priority: z.enum(["low", "medium", "high"]).optional(), due_date: z.string().optional(), quest_id: z.string().optional() });
export const UpdateTaskSchema = z.object({ type: z.literal("update_task"), id: z.string().min(1), title: z.string().optional(), completed: z.boolean().optional(), priority: z.enum(["low", "medium", "high"]).optional() });
export const DeleteTaskSchema = z.object({ type: z.literal("delete_task"), id: z.string().min(1) });

// SKILL
export const CreateSkillSchema = z.object({ type: z.literal("create_skill"), title: TitleField, category: z.string().optional(), level: z.number().int().min(1).max(100).optional(), description: DescField });
export const UpdateSkillSchema = z.object({ type: z.literal("update_skill"), id: z.string().min(1), level: z.number().int().min(1).max(100).optional(), title: z.string().optional() });
export const DeleteSkillSchema = z.object({ type: z.literal("delete_skill"), id: z.string().min(1) });

// JOURNAL
export const CreateJournalSchema = z.object({ type: z.literal("create_journal"), title: TitleField, content: z.string().min(1), mood: z.string().optional(), tags: z.array(z.string()).optional() });
export const UpdateJournalSchema = z.object({ type: z.literal("update_journal"), id: z.string().min(1), title: z.string().optional(), content: z.string().optional() });
export const DeleteJournalSchema = z.object({ type: z.literal("delete_journal"), id: z.string().min(1) });

// VAULT
export const CreateVaultSchema = z.object({ type: z.literal("create_vault"), title: TitleField, content: z.string().min(1), category: z.string().optional(), confidential: z.boolean().optional() });
export const UpdateVaultSchema = z.object({ type: z.literal("update_vault"), id: z.string().min(1), title: z.string().optional(), content: z.string().optional(), confidential: z.boolean().optional() });
export const DeleteVaultSchema = z.object({ type: z.literal("delete_vault"), id: z.string().min(1) });

// COUNCIL MEMBER
export const CreateCouncilMemberSchema = z.object({ type: z.literal("create_council_member"), name: z.string().min(1), role: z.string().optional(), archetype: z.string().optional(), description: DescField });
export const UpdateCouncilMemberSchema = z.object({ type: z.literal("update_council_member"), id: z.string().min(1), name: z.string().optional(), role: z.string().optional() });
export const DeleteCouncilMemberSchema = z.object({ type: z.literal("delete_council_member"), id: z.string().min(1) });

// INVENTORY
export const CreateInventorySchema = z.object({ type: z.literal("create_inventory"), name: z.string().min(1), quantity: z.number().int().min(0).optional(), category: z.string().optional(), description: DescField });
export const UpdateInventorySchema = z.object({ type: z.literal("update_inventory"), id: z.string().min(1), quantity: z.number().int().min(0).optional(), name: z.string().optional() });
export const DeleteInventorySchema = z.object({ type: z.literal("delete_inventory"), id: z.string().min(1) });

// ENERGY
export const UpdateEnergySchema = z.object({ type: z.literal("update_energy"), level: z.number().int().min(0).max(100), note: z.string().optional() });

// ALLY
export const CreateAllySchema = z.object({ type: z.literal("create_ally"), name: z.string().min(1), relationship: z.string().optional(), trust_level: z.number().int().min(0).max(10).optional(), notes: DescField });
export const UpdateAllySchema = z.object({ type: z.literal("update_ally"), id: z.string().min(1), trust_level: z.number().int().min(0).max(10).optional(), notes: z.string().optional() });
export const DeleteAllySchema = z.object({ type: z.literal("delete_ally"), id: z.string().min(1) });

// TRANSFORMATION — NEVER mix with RANKING
export const CreateTransformationSchema = z.object({ type: z.literal("create_transformation"), title: TitleField, description: DescField, phase: z.string().optional(), rank: z.undefined().optional(), rank_id: z.undefined().optional() });
export const UpdateTransformationSchema = z.object({ type: z.literal("update_transformation"), id: z.string().min(1), title: z.string().optional(), phase: z.string().optional(), rank: z.undefined().optional(), rank_id: z.undefined().optional() });
export const DeleteTransformationSchema = z.object({ type: z.literal("delete_transformation"), id: z.string().min(1) });

// RANKING — NEVER mix with TRANSFORMATION
export const CreateRankingSchema = z.object({ type: z.literal("create_ranking"), title: TitleField, tier: z.number().int().min(1).optional(), description: DescField, transformation: z.undefined().optional(), transformation_id: z.undefined().optional(), phase: z.undefined().optional() });
export const UpdateRankingSchema = z.object({ type: z.literal("update_ranking"), id: z.string().min(1), tier: z.number().int().min(1).optional(), title: z.string().optional(), transformation: z.undefined().optional(), transformation_id: z.undefined().optional() });
export const DeleteRankingSchema = z.object({ type: z.literal("delete_ranking"), id: z.string().min(1) });

// STORE ITEM
export const CreateStoreItemSchema = z.object({ type: z.literal("create_store_item"), name: z.string().min(1), price: z.number().min(0), description: DescField, category: z.string().optional() });
export const UpdateStoreItemSchema = z.object({ type: z.literal("update_store_item"), id: z.string().min(1), price: z.number().min(0).optional(), name: z.string().optional() });
export const DeleteStoreItemSchema = z.object({ type: z.literal("delete_store_item"), id: z.string().min(1) });

// LOG BPM
export const LogBpmSchema = z.object({ type: z.literal("log_bpm"), bpm: z.number().int().min(20).max(300), context: z.string().optional(), timestamp: z.string().optional() });

// UPDATE PROFILE
export const UpdateProfileSchema = z.object({ type: z.literal("update_profile"), display_name: z.string().optional(), bio: z.string().optional(), avatar_url: z.string().url().optional(), codex_name: z.string().optional(), title: z.string().optional() });

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
export const GenerateImageSchema = z.object({ type: z.literal("generate_image"), prompt: z.string().min(1), aspect_ratio: z.enum(["1:1","16:9","9:16","4:3","3:4"]).optional(), save_to_vault: z.boolean().optional() });

// UNION — ALL SCHEMAS
export const ActionSchema = z.discriminatedUnion("type", [
  CreateQuestSchema, UpdateQuestSchema, DeleteQuestSchema,
  CreateTaskSchema, UpdateTaskSchema, DeleteTaskSchema,
  CreateSkillSchema, UpdateSkillSchema, DeleteSkillSchema,
  CreateJournalSchema, UpdateJournalSchema, DeleteJournalSchema,
  CreateVaultSchema, UpdateVaultSchema, DeleteVaultSchema,
  CreateCouncilMemberSchema, UpdateCouncilMemberSchema, DeleteCouncilMemberSchema,
  CreateInventorySchema, UpdateInventorySchema, DeleteInventorySchema,
  UpdateEnergySchema,
  CreateAllySchema, UpdateAllySchema, DeleteAllySchema,
  CreateTransformationSchema, UpdateTransformationSchema, DeleteTransformationSchema,
  CreateRankingSchema, UpdateRankingSchema, DeleteRankingSchema,
  CreateStoreItemSchema, UpdateStoreItemSchema, DeleteStoreItemSchema,
  LogBpmSchema,
  UpdateProfileSchema,
  AwardXpSchema,
  ProposeProductSchema,
  NoraTweetSchema,
  GenerateImageSchema,
  CreateSkillDefinitionSchema,
]);

export type ValidatedAction = z.infer<typeof ActionSchema>;
