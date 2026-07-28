import type { ParsedAction, ExecutionResult, ActionClassification } from "./types";
import { ActionSchema } from "./actionSchemas";
import { logEvent } from "./logEvent";

const ALWAYS_CONFIRM = new Set([
  "delete_quest", "delete_task", "delete_skill", "delete_journal",
  "delete_vault", "delete_council_member", "delete_inventory_item",
  "delete_ally", "delete_transformation",
  "delete_ranking", "delete_store_item",
  // Filesystem and git mutations always need explicit approval
  "edit_file",
  // Journal creation requires verbal confirmation — never auto-create
  "create_journal",
]);

const IDENTITY_FIELDS = ["codex_name", "title"];
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
  if (type === "update_ranking" && "tier" in payload) return "CONFIRM";
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
  const parsed = ActionSchema.safeParse(action.payload);
  if (!parsed.success) {
    // Legacy action format uses "params" nesting — route straight to defaultHandler if registered
    if (defaultHandler) {
      try {
        await defaultHandler(action.payload);
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

  const classification = classifyAction(action);
  if (classification === "CONFIRM") {
    logEvent("action_executed", { type: action.type, classification, status: "pending_confirmation" });
    return {
      status: "pending_confirmation",
      action,
      message: `Action "${action.type}" requires confirmation before execution.`,
    };
  }

  const handler = actionHandlers[action.type] ?? defaultHandler;
  if (!handler) {
    logEvent("action_executed", { type: action.type, classification, status: "error", reason: "no_handler" });
    return { status: "error", action, message: `No handler registered for action type: ${action.type}` };
  }

  try {
    await handler(action.payload);
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
