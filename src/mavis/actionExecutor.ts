import type { ParsedAction, ExecutionResult, ActionClassification } from "./types";
import { ActionSchema } from "./actionSchemas";
import { logEvent } from "./logEvent";

const ALWAYS_CONFIRM = new Set([
  "delete_quest", "delete_task", "delete_skill", "delete_journal",
  "delete_vault", "delete_council_member", "delete_inventory_item",
  "delete_ally", "delete_transformation",
  "delete_ranking", "delete_store_item", "delete_energy", "delete_ritual",
  "delete_plan", "delete_quest_chain", "delete_skill_chain", "delete_signal_config",
  // Filesystem and git mutations always need explicit approval
  "edit_file",
  // Journal creation requires verbal confirmation — never auto-create
  "create_journal",
]);

// mavis-actions/index.ts normalizes ~80 alternate type spellings to a
// canonical action type (its own ACTION_ALIASES + normalizeActionType) —
// but it does that AFTER this gate. If the LLM emits an alias directly
// (promptBuilder.ts documents "delete_ranking_profile", never
// "delete_ranking", for example), ActionSchema.safeParse() never matches
// any z.literal() (they're all canonical names) and classifyAction() never
// matches ALWAYS_CONFIRM (also canonical names) — so the action falls
// through the legacy fallback path, silently bypassing BOTH validation and
// the CONFIRM gate, then reaches the backend which normalizes it and
// executes it fine. Same bug class/severity as the missing-lookup-field
// fixes elsewhere in this file's history, caused by a type-name mismatch
// instead of a field-name mismatch. Must stay in sync with
// mavis-actions/index.ts's ACTION_ALIASES — see
// actionBackendFieldSync.test.ts for the drift guard.
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
  "create_ranking_profile": "create_ranking", "update_ranking_profile": "update_ranking", "delete_ranking_profile": "delete_ranking",
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
  "add_domain_effect": "create_domain_effect", "new_domain_effect": "create_domain_effect",
  "apply_domain": "create_domain_effect", "apply_curse": "create_domain_effect",
  "apply_buff_domain": "create_domain_effect", "apply_debuff_domain": "create_domain_effect",
  "apply_aura": "create_domain_effect", "apply_terrain": "create_domain_effect",
  "apply_zone": "create_domain_effect", "apply_environmental": "create_domain_effect",
  "edit_domain_effect": "update_domain_effect", "modify_domain_effect": "update_domain_effect",
  "deactivate_domain_effect": "update_domain_effect", "activate_domain_effect": "update_domain_effect",
  "remove_domain_effect": "delete_domain_effect", "clear_domain_effect": "delete_domain_effect",
  "lift_curse": "delete_domain_effect", "remove_curse": "delete_domain_effect",
  "remove_aura": "delete_domain_effect", "clear_aura": "delete_domain_effect",
};

function normalizeActionType(type: string): string {
  const normalized = type.toLowerCase().trim();
  return ACTION_ALIASES[normalized] || normalized;
}

// Was ["codex_name", "title"] — neither is a real profiles column (the
// backend's PROFILE_ALLOWED allowlist has never included them), so this
// gate never actually fired for a real update_profile call. The real
// identity-shaped columns are inscribed_name/true_name/titles/display_name.
// Found via vantara-crud-update-fix-brief.md follow-up.
const IDENTITY_FIELDS = ["inscribed_name", "true_name", "titles", "display_name"];
const LARGE_XP_THRESHOLD = 500;

// Composio exposes 1000+ toolkit actions (GITHUB_CREATE_ISSUE, SLACK_SEND_MESSAGE,
// NOTION_SEARCH_PAGE, ...) — there's no fixed list to special-case per action the
// way the rest of this file does. Classify by the verb implied in tool_slug
// instead: any mutating-sounding verb anywhere in the name forces CONFIRM, even
// if a read-y verb also appears (safety wins ties). Only a slug matching a known
// read-only verb AND nothing mutating is AUTO. Unrecognized shapes default to
// CONFIRM — same "when in doubt, ask" posture as everything else here.
const COMPOSIO_MUTATING_VERBS = /_(CREATE|UPDATE|DELETE|REMOVE|SEND|POST|PUBLISH|WRITE|UPLOAD|EXECUTE|RUN|INVITE|SHARE|ADD|SET|ARCHIVE|CANCEL|APPROVE|MERGE|CLOSE|PAY|REFUND|TRANSFER)_/;
const COMPOSIO_READONLY_VERBS = /_(GET|LIST|SEARCH|FETCH|FIND|READ|QUERY|VIEW)_/;

function classifyComposioAction(payload: Record<string, unknown>): ActionClassification {
  const slug = `_${String(payload.tool_slug ?? "").toUpperCase()}_`;
  if (COMPOSIO_MUTATING_VERBS.test(slug)) return "CONFIRM";
  if (COMPOSIO_READONLY_VERBS.test(slug)) return "AUTO";
  return "CONFIRM";
}

function classifyAction(action: ParsedAction): ActionClassification {
  const { type, payload } = action;
  if (ALWAYS_CONFIRM.has(type)) return "CONFIRM";
  if (type === "award_xp" && typeof payload.amount === "number" && payload.amount >= LARGE_XP_THRESHOLD) return "CONFIRM";
  if (type === "update_profile" && IDENTITY_FIELDS.some((f) => f in payload)) return "CONFIRM";
  if (type === "update_vault" || type === "delete_vault") return "CONFIRM";
  // Was "tier" — not a real rankings_profiles column (the real prestige
  // field is "rank", a text column); this gate never fired for a real
  // rank change. Found via vantara-crud-update-fix-brief.md follow-up.
  if (type === "update_ranking" && "rank" in payload) return "CONFIRM";
  // Git write operations require confirmation; read-only ops (status, diff, log) do not
  if (type === "git_operation" && ["commit", "push"].includes(String(payload.operation))) return "CONFIRM";
  if (type === "composio_action") return classifyComposioAction(payload);
  return "AUTO";
}

type ActionHandler = (payload: Record<string, unknown>) => Promise<void> | void;
const actionHandlers: Partial<Record<string, ActionHandler>> = {};
let defaultHandler: ActionHandler | null = null;

export function registerActionHandler(type: string, handler: ActionHandler): void {
  actionHandlers[type] = handler;
}

export function setDefaultHandler(handler: ActionHandler): void {
  defaultHandler = handler;
}

export async function executeAction(action: ParsedAction): Promise<ExecutionResult> {
  // Normalize aliases (e.g. "remove_quest" → "delete_quest") BEFORE Zod
  // validation and classification — see the ACTION_ALIASES comment above.
  // Only the type field is rewritten; every other payload field is passed
  // through unchanged.
  const rawType = (action.payload?.type as string | undefined) ?? action.type;
  const canonicalType = normalizeActionType(rawType);
  const normalizedPayload = canonicalType === rawType ? action.payload : { ...action.payload, type: canonicalType };
  const normalizedAction: ParsedAction = canonicalType === action.type ? action : { ...action, type: canonicalType };

  const parsed = ActionSchema.safeParse(normalizedPayload);
  if (!parsed.success) {
    // Legacy action format uses "params" nesting — route straight to defaultHandler if registered
    if (defaultHandler) {
      try {
        await defaultHandler(normalizedPayload);
        logEvent("action_executed", { type: action.type, classification: "legacy", status: "success" });
        return { status: "success", action };
      } catch (err) {
        logEvent("action_executed", { type: action.type, classification: "legacy", status: "error" });
        return { status: "error", action, message: err instanceof Error ? err.message : String(err) };
      }
    }
    logEvent("action_executed", { type: action.type, classification: "invalid", status: "error" });
    return {
      status: "error",
      action,
      message: `Validation failed: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    };
  }

  const classification = classifyAction(normalizedAction);
  if (classification === "CONFIRM") {
    logEvent("action_executed", { type: action.type, classification, status: "pending_confirmation" });
    return {
      status: "pending_confirmation",
      action,
      message: `Action "${action.type}" requires confirmation before execution.`,
    };
  }

  const handler = actionHandlers[canonicalType] ?? defaultHandler;
  if (!handler) {
    logEvent("action_executed", { type: action.type, classification, status: "error", reason: "no_handler" });
    return { status: "error", action, message: `No handler registered for action type: ${action.type}` };
  }

  try {
    await handler(normalizedPayload);
    logEvent("action_executed", { type: action.type, classification, status: "success" });
    return { status: "success", action };
  } catch (err) {
    logEvent("action_executed", { type: action.type, classification, status: "error" });
    return { status: "error", action, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function executeActions(actions: ParsedAction[]): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  for (const action of actions) {
    try {
      results.push(await executeAction(action));
    } catch (err) {
      results.push({ status: "error", action, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
