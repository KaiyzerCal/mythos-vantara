import type { AppContextSnapshot } from "./appContextLoader";
import { buildCouncilMemberPrompt, buildContextSummary, type CouncilMember } from "./councilPersona";
import { buildCouncilAgentPrompt, buildPersonaCouncilPrompt } from "./agentPersona";
import { buildSystemPromptFromSnapshot } from "./buildSystemPrompt";
import { invokeAI } from "./chatService";
import type { UnifiedCouncilMember, UnifiedPersona } from "./agentTypes";
import { supabase } from "@/integrations/supabase/client";

export interface CouncilBoardMessage {
  id: string;
  speakerId: string;
  speakerName: string;
  speakerRole: string;
  speakerType?: "council" | "persona" | "mavis" | "user";
  content: string;
  timestamp: number;
  isUser: boolean;
  summoned?: boolean;
}

export interface CouncilBoardResult {
  mavisResponse: string;
  memberResponses: { member: CouncilMember; response: string }[];
  personaResponses?: { persona: UnifiedPersona; response: string; summoned: boolean }[];
}

export interface CouncilSessionOptions {
  summonedPersonas?: UnifiedPersona[];
  includePersonas?: UnifiedPersona[];
  /** Optional session ID for Realtime broadcast — each member response is
   *  published to `council:{sessionId}` as it resolves, so the UI can render
   *  cards progressively without waiting for the full round-trip. */
  sessionId?: string;
}

// ── Realtime broadcast ────────────────────────────────────────────────────────
async function broadcastCouncilResponse(
  sessionId: string,
  memberName: string,
  speakerId: string,
  speakerRole: string,
  speakerType: "council" | "persona",
  response: string,
  summoned?: boolean,
  error?: string,
) {
  try {
    const channel = supabase.channel(`council:${sessionId}`);
    await channel.send({
      type: "broadcast",
      event: "member_response",
      payload: {
        memberName,
        speakerId,
        speakerRole,
        speakerType,
        response,
        summoned,
        error,
        timestamp: Date.now(),
      },
    });
    // The UI component manages the channel lifecycle — don't unsubscribe here.
  } catch { /* non-critical */ }
}

/**
 * Sends a message to the full Council Board.
 * MAVIS responds first, then all council members evaluate in parallel.
 * Optionally, summoned Personas also respond (with scoped context).
 * Members/personas that return "PASS" are filtered from results.
 */
export async function sendCouncilMessage(
  userMessage: string,
  history: CouncilBoardMessage[],
  councilMembers: CouncilMember[],
  appContext: AppContextSnapshot,
  sessionOptions?: CouncilSessionOptions,
): Promise<CouncilBoardResult> {
  const contextSummary = buildContextSummary(appContext);

  const historyForAI = history.slice(-10).map(m => ({
    role: m.isUser ? "user" : "assistant",
    content: m.isUser ? m.content : `[${m.speakerName}]: ${m.content}`,
  }));

  const currentUserMsg = { role: "user" as const, content: userMessage };

  // ── MAVIS responds first ──────────────────────────────────
  const mavisSystemPrompt =
    (await buildSystemPromptFromSnapshot("SOVEREIGN", appContext)) +
    `\n\nCOUNCIL BOARD MODE — You are presiding. Respond first as MAVIS. Keep it focused — 1–3 paragraphs. Do not speak for individual council members; they respond separately after you.`;

  const mavisResponse = await invokeAI(
    mavisSystemPrompt,
    [...historyForAI, currentUserMsg],
    "SOVEREIGN",
    "council-mavis",
  );

  const historyWithMavis = [
    ...historyForAI,
    currentUserMsg,
    { role: "assistant" as const, content: `[MAVIS]: ${mavisResponse}` },
  ];

  const sessionId = sessionOptions?.sessionId;

  // ── Council members respond in parallel ───────────────────
  // Each member deliberates independently; results are broadcast to the
  // Realtime channel as they arrive so the UI can render them progressively.
  const memberPromises = councilMembers.map(async (member) => {
    const prompt = buildCouncilMemberPrompt(member, contextSummary);
    try {
      const response = await invokeAI(prompt, historyWithMavis, "PRIME", "council-member");
      if (sessionId) {
        await broadcastCouncilResponse(
          sessionId,
          member.name,
          member.id,
          member.role ?? "Council Member",
          "council",
          response,
        );
      }
      return { member, response };
    } catch (err: any) {
      if (sessionId) {
        await broadcastCouncilResponse(
          sessionId,
          member.name,
          member.id,
          member.role ?? "Council Member",
          "council",
          "PASS",
          undefined,
          err?.message,
        );
      }
      return { member, response: "PASS" };
    }
  });

  // ── Active personas respond in parallel (scoped context) ──
  const activePersonas: UnifiedPersona[] = [
    ...(sessionOptions?.summonedPersonas ?? []),
    ...(sessionOptions?.includePersonas ?? []),
  ];

  // Deduplicate by id
  const seenIds = new Set<string>();
  const uniquePersonas = activePersonas.filter(p => {
    if (seenIds.has(p.id)) return false;
    seenIds.add(p.id);
    return true;
  });

  const personaPromises = uniquePersonas.map(async (persona) => {
    const isSummoned = (sessionOptions?.summonedPersonas ?? []).some(s => s.id === persona.id);
    const prompt = buildPersonaCouncilPrompt(persona, appContext);
    try {
      const response = await invokeAI(prompt, historyWithMavis, "PRIME", "council-persona");
      if (sessionId) {
        await broadcastCouncilResponse(
          sessionId,
          persona.name,
          persona.id,
          persona.role ?? "Persona",
          "persona",
          response,
          isSummoned,
        );
      }
      return { persona, response, summoned: isSummoned };
    } catch (err: any) {
      if (sessionId) {
        await broadcastCouncilResponse(
          sessionId,
          persona.name,
          persona.id,
          persona.role ?? "Persona",
          "persona",
          "PASS",
          isSummoned,
          err?.message,
        );
      }
      return { persona, response: "PASS", summoned: isSummoned };
    }
  });

  // Use Promise.allSettled so one failed member never blocks the others
  const [rawMemberResults, rawPersonaResults] = await Promise.all([
    Promise.allSettled(memberPromises),
    Promise.allSettled(personaPromises),
  ]);

  const allMemberResults = rawMemberResults.map(r =>
    r.status === "fulfilled" ? r.value : { member: (r as any).reason?.member, response: "PASS" },
  ).filter(r => r.member != null);

  const allPersonaResults = rawPersonaResults.map(r =>
    r.status === "fulfilled" ? r.value : { persona: (r as any).reason?.persona, response: "PASS", summoned: false },
  ).filter(r => r.persona != null);

  const memberResponses = allMemberResults.filter(
    r => r.response.trim().toUpperCase() !== "PASS" && r.response.trim() !== "",
  );

  const personaResponses = allPersonaResults.filter(
    r => r.response.trim().toUpperCase() !== "PASS" && r.response.trim() !== "",
  );

  return {
    mavisResponse,
    memberResponses,
    personaResponses: personaResponses.length > 0 ? personaResponses : undefined,
  };
}
