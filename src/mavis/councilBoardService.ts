import type { AppContextSnapshot } from "./appContextLoader";
import { buildCouncilMemberPrompt, buildContextSummary, type CouncilMember } from "./councilPersona";
import { buildSystemPromptFromSnapshot } from "./buildSystemPrompt";
import { invokeAI } from "./chatService";

export interface CouncilBoardMessage {
  id: string;
  speakerId: string;
  speakerName: string;
  speakerRole: string;
  content: string;
  timestamp: number;
  isUser: boolean;
}

export interface CouncilBoardResult {
  mavisResponse: string;
  memberResponses: { member: CouncilMember; response: string }[];
}

/**
 * Sends a message to the full Council Board.
 * MAVIS responds first, then all council members evaluate in parallel.
 * Members that return "PASS" are filtered out of the final result.
 */
export async function sendCouncilMessage(
  userMessage: string,
  history: CouncilBoardMessage[],
  councilMembers: CouncilMember[],
  appContext: AppContextSnapshot,
): Promise<CouncilBoardResult> {
  const contextSummary = buildContextSummary(appContext);

  // Build shared conversation history (last 10 turns)
  const historyForAI = history.slice(-10).map(m => ({
    role: m.isUser ? "user" : "assistant",
    content: m.isUser ? m.content : `[${m.speakerName}]: ${m.content}`,
  }));

  const currentUserMsg = { role: "user" as const, content: userMessage };

  // ── MAVIS responds first as moderator ──────────────────────────────
  const mavisSystemPrompt =
    buildSystemPromptFromSnapshot("SOVEREIGN", appContext) +
    `\n\nCOUNCIL BOARD MODE — You are presiding over a live council session. Respond first as MAVIS. Keep it focused — 1–3 paragraphs. Do not attempt to speak for individual council members; they will respond separately after you.`;

  const mavisResponse = await invokeAI(
    mavisSystemPrompt,
    [...historyForAI, currentUserMsg],
    "SOVEREIGN",
    "council-mavis",
  );

  // ── All council members evaluate in parallel ───────────────────────
  const memberResponsePromises = councilMembers.map(async (member) => {
    const memberSystemPrompt = buildCouncilMemberPrompt(member, contextSummary);

    const councilHistory = [
      ...historyForAI,
      currentUserMsg,
      { role: "assistant" as const, content: `[MAVIS]: ${mavisResponse}` },
    ];

    try {
      const response = await invokeAI(memberSystemPrompt, councilHistory, "PRIME", "council-member");
      return { member, response };
    } catch {
      return { member, response: "PASS" };
    }
  });

  const allResponses = await Promise.all(memberResponsePromises);

  const memberResponses = allResponses.filter(
    r => r.response.trim().toUpperCase() !== "PASS" && r.response.trim() !== "",
  );

  return { mavisResponse, memberResponses };
}
