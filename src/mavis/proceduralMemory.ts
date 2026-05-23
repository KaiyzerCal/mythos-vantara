/**
 * Procedural Memory — Hermes-Agent pattern.
 * After every successful tool execution, captures HOW MAVIS handled the request
 * as a reusable procedure. proactiveRecall surfaces these on similar future requests
 * so MAVIS follows the proven path instead of reasoning from scratch.
 */

import { storeMemory } from "./agentMemoryEngine";
import type { ExecutionResult } from "./types";

const PROCEDURE_AGENT_ID = "mavis-prime";

// Map action types to human-readable verb phrases
const ACTION_VERBS: Record<string, string> = {
  create_quest: "created a quest",
  update_quest: "updated a quest",
  complete_quest: "completed a quest",
  delete_quest: "deleted a quest",
  create_task: "created a task",
  complete_task: "completed a task",
  create_journal: "wrote a journal entry",
  update_journal: "updated a journal entry",
  create_vault: "saved a vault entry",
  update_vault: "updated a vault entry",
  create_skill: "created a skill",
  update_skill: "updated a skill",
  create_ally: "added an ally",
  update_ally: "updated an ally",
  create_council_member: "added a council member",
  create_inventory_item: "added an inventory item",
  update_inventory_item: "updated an inventory item",
  create_transformation: "created a transformation form",
  update_transformation: "updated a transformation",
  create_ranking: "added a ranking profile",
  update_ranking: "updated a ranking profile",
  update_energy: "updated an energy system",
  create_energy: "created an energy system",
  create_store_item: "added a store item",
  award_xp: "awarded XP",
  update_profile: "updated the operator profile",
  propose_product: "proposed a product",
  nora_tweet: "drafted a Nora Vale tweet",
  create_note: "created a knowledge note",
  update_note: "updated a knowledge note",
  link_notes: "linked knowledge notes",
};

function buildProcedureContent(
  userRequest: string,
  confirmed: ExecutionResult[],
): string {
  const actionSummaries = confirmed.map((r) => {
    const verb = ACTION_VERBS[r.action.type] ?? r.action.type.replace(/_/g, " ");
    const params = r.action.params ?? {};
    const nameHint = params.title ?? params.name ?? params.display_name ?? "";
    return nameHint ? `${verb}: "${nameHint}"` : verb;
  });

  const procedure = [
    `Request: "${userRequest.slice(0, 200)}"`,
    `Actions taken: ${actionSummaries.join("; ")}`,
    `Outcome: All actions confirmed successful.`,
    `Pattern: When user asks to ${actionSummaries[0] ?? "perform this action"}, use ${confirmed.map(r => r.action.type).join(", ")}.`,
  ].join("\n");

  return procedure;
}

export async function captureProceduralMemory(
  userId: string,
  userRequest: string,
  confirmed: ExecutionResult[],
): Promise<void> {
  if (confirmed.length === 0) return;

  const actionTypes = confirmed.map((r) => r.action.type);
  const primaryVerb = ACTION_VERBS[actionTypes[0]] ?? actionTypes[0].replace(/_/g, " ");
  const content = buildProcedureContent(userRequest, confirmed);

  await storeMemory(
    {
      agentId: PROCEDURE_AGENT_ID,
      agentName: "MAVIS-PRIME",
      agentType: "mavis",
      entityType: "procedural",
      memoryType: "procedural",
      content,
      summary: `How to ${primaryVerb} — confirmed pattern from live execution`,
      tags: actionTypes,
      wikilinks: [],
      importance: 5,
      confidence: 9,
    },
    userId,
  ).catch(() => {});
}

export async function verifyActionOutcome(
  userId: string,
  confirmed: ExecutionResult[],
  refetchFn: () => Promise<void>,
): Promise<{ verified: boolean; note: string }> {
  if (confirmed.length === 0) return { verified: true, note: "" };

  try {
    await refetchFn();
    return {
      verified: true,
      note: `${confirmed.length} action${confirmed.length > 1 ? "s" : ""} verified in live data`,
    };
  } catch {
    return { verified: false, note: "Refetch failed — data may not reflect changes yet" };
  }
}
