import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

export interface ProposedAction {
  type: string;
  params: Record<string, unknown>;
  summary?: string;
}

function lenientJsonParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  return JSON.parse(raw.replace(/,\s*([}\]])/g, "$1"));
}

/** Parse `:::PROPOSE_ACTION{...}:::` blocks from any AI reply. */
export function parseProposedActions(text: string): { cleanText: string; proposals: ProposedAction[] } {
  const proposals: ProposedAction[] = [];
  // Allow optional whitespace between the tag and the JSON — LLMs often add a space.
  const re = /:::PROPOSE_ACTION\s*(\{[\s\S]*?\})\s*:::/g;
  const cleanText = text.replace(re, (_m, json) => {
    try {
      const obj = lenientJsonParse(json) as any;
      if (obj && typeof obj === "object" && obj.type) {
        proposals.push({
          type: String(obj.type),
          params: (obj.params && typeof obj.params === "object") ? obj.params : {},
          summary: typeof obj.summary === "string" ? obj.summary : undefined,
        });
      }
    } catch {}
    return "";
  }).trim();
  return { cleanText, proposals };
}

/**
 * Submit AI-proposed writes to the `approvals` queue. They wait for
 * the operator (and MAVIS) to approve before being executed via mavis-actions.
 */
export async function submitProposalsForApproval(
  userId: string,
  proposedBy: string,
  proposals: ProposedAction[],
): Promise<number> {
  if (!proposals.length) return 0;
  const rows = proposals.map(p => ({
    user_id: userId,
    action_type: p.type,
    action_summary: p.summary ?? `${proposedBy} proposes: ${p.type}`,
    action_payload: { type: p.type, params: p.params, proposed_by: proposedBy } as any,
    status: "pending",
  }));
  const { error } = await supabase.from("approvals").insert(rows as any);
  if (error) {
    console.error("[proposeAction] insert failed:", error.message);
    return 0;
  }
  return rows.length;
}

/** System-prompt fragment teaching AIs to emit proposals instead of writing directly. */
export const PROPOSAL_INSTRUCTIONS = `

═══ ACTION PROPOSALS (write access via approval) ═══
You may VIEW, READ, ANALYZE, and REFERENCE every part of the operator's app state freely.
You may NOT write directly. To create/update/delete anything, emit one or more proposal blocks
inside your reply using the EXACT format below — these are routed to the operator's Inbox
where the operator and MAVIS must approve them before they execute.

Format (one block per proposed action, valid JSON inside the braces):
:::PROPOSE_ACTION{"type":"create_quest","summary":"Add a daily meditation quest","params":{"title":"Daily Meditation","type":"daily","xp_reward":50}}:::

Supported action types include: create_quest / update_quest / complete_quest / delete_quest,
create_task / update_task / delete_task, create_skill / update_skill / delete_skill,
create_journal / update_journal / delete_journal, create_vault / update_vault / delete_vault,
create_inventory_item / update_inventory_item / delete_inventory_item,
create_council_member / update_council_member / delete_council_member,
create_ally / update_ally / delete_ally,
create_transformation / update_transformation, create_ranking / update_ranking,
update_profile, update_energy, award_xp.

Speak naturally to the operator about what you propose — the proposal blocks themselves are
hidden from the rendered reply. Never invent a type that isn't listed. Never claim you executed
a write; only the operator can approve execution.
═══ END ACTION PROPOSALS ═══
`;
