import type { ParsedAction, ExecutionResult, ActionClassification } from "./types";
import { ActionSchema } from "./actionSchemas";

const ALWAYS_CONFIRM = new Set([
  "delete_quest", "delete_task", "delete_skill", "delete_journal",
  "delete_vault", "delete_council_member", "delete_inventory_item",
  "delete_ally", "delete_transformation",
  "delete_ranking", "delete_store_item",
  // Filesystem and git mutations always need explicit approval
  "edit_file",
]);

const IDENTITY_FIELDS = ["codex_name", "title"];
const LARGE_XP_THRESHOLD = 500;

function classifyAction(action: ParsedAction): ActionClassification {
  const { type, payload } = action;
  if (ALWAYS_CONFIRM.has(type)) return "CONFIRM";
  if (type === "award_xp" && typeof payload.amount === "number" && payload.amount >= LARGE_XP_THRESHOLD) return "CONFIRM";
  if (type === "update_profile" && IDENTITY_FIELDS.some((f) => f in payload)) return "CONFIRM";
  if (type === "update_vault" || type === "delete_vault") return "CONFIRM";
  if (type === "update_ranking" && "tier" in payload) return "CONFIRM";
  // Git write operations require confirmation; read-only ops (status, diff, log) do not
  if (type === "git_operation" && ["commit", "push"].includes(String(payload.operation))) return "CONFIRM";
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
  const parsed = ActionSchema.safeParse(action.payload);
  if (!parsed.success) {
    // Legacy action format uses "params" nesting — route straight to defaultHandler if registered
    if (defaultHandler) {
      try {
        await defaultHandler(action.payload);
        return { status: "success", action };
      } catch (err) {
        return { status: "error", action, message: err instanceof Error ? err.message : String(err) };
      }
    }
    return {
      status: "error",
      action,
      message: `Validation failed: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    };
  }

  const classification = classifyAction(action);
  if (classification === "CONFIRM") {
    return {
      status: "pending_confirmation",
      action,
      message: `Action "${action.type}" requires confirmation before execution.`,
    };
  }

  const handler = actionHandlers[action.type] ?? defaultHandler;
  if (!handler) {
    return { status: "error", action, message: `No handler registered for action type: ${action.type}` };
  }

  try {
    await handler(action.payload);
    return { status: "success", action };
  } catch (err) {
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
