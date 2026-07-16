import type { AppContextSnapshot } from "./appContextLoader";
import { buildCouncilMemberPrompt, buildContextSummary, buildDeliberationPrompt, type CouncilMember } from "./councilPersona";
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
  deliberationRound?: number; // 1 = initial responses, 2+ = deliberation rounds
}

export interface CouncilBoardResult {
  mavisResponse: string;
  memberResponses: { member: CouncilMember; response: string }[];
  personaResponses?: { persona: UnifiedPersona; response: string; summoned: boolean }[];
  deliberationRounds: Array<{
    round: number;
    memberResponses: { member: CouncilMember; response: string }[];
    personaResponses: { persona: UnifiedPersona; response: string; summoned: boolean }[];
  }>;
  synthesisByMavis?: string;
}

export interface CouncilSessionOptions {
  summonedPersonas?: UnifiedPersona[];
  includePersonas?: UnifiedPersona[];
  /** Realtime channel session ID — responses broadcast as they resolve. */
  sessionId?: string;
  /** Number of deliberation rounds after the initial response. Default: 1. */
  deliberationRounds?: number;
}

// ── Realtime broadcast ────────────────────────────────────────────────────────
async function broadcastCouncilResponse(
  sessionId: string,
  memberName: string,
  speakerId: string,
  speakerRole: string,
  speakerType: "council" | "persona",
  response: string,
  round: number,
  summoned?: boolean,
  error?: string,
) {
  try {
    const channel = supabase.channel(`council:${sessionId}`);
    await channel.send({
      type: "broadcast",
      event: round === 1 ? "member_response" : "deliberation_response",
      payload: {
        memberName,
        speakerId,
        speakerRole,
        speakerType,
        response,
        round,
        summoned,
        error,
        timestamp: Date.now(),
      },
    });
    await supabase.removeChannel(channel);
  } catch { /* non-critical */ }
}

// ── Round 1: initial responses ────────────────────────────────────────────────

async function runRound1(
  councilMembers: CouncilMember[],
  activePersonas: UnifiedPersona[],
  summonedPersonas: UnifiedPersona[],
  historyWithMavis: { role: "user" | "assistant"; content: string }[],
  contextSummary: string,
  sessionId: string | undefined,
  appContext: AppContextSnapshot,
): Promise<{
  memberResponses: { member: CouncilMember; response: string }[];
  personaResponses: { persona: UnifiedPersona; response: string; summoned: boolean }[];
}> {
  const memberPromises = councilMembers.map(async (member) => {
    const prompt = buildCouncilMemberPrompt(member, contextSummary);
    try {
      const response = await invokeAI(prompt, historyWithMavis, "COUNCIL", "council-member");
      if (sessionId) {
        await broadcastCouncilResponse(
          sessionId, member.name, member.id,
          member.role ?? "Council Member", "council", response, 1,
        );
      }
      return { member, response };
    } catch (err: any) {
      if (sessionId) {
        await broadcastCouncilResponse(
          sessionId, member.name, member.id,
          member.role ?? "Council Member", "council", "PASS", 1, undefined, err?.message,
        );
      }
      return { member, response: "PASS" };
    }
  });

  const personaPromises = activePersonas.map(async (persona) => {
    const isSummoned = summonedPersonas.some(s => s.id === persona.id);
    const prompt = buildPersonaCouncilPrompt(persona, appContext);
    try {
      const response = await invokeAI(prompt, historyWithMavis, "COUNCIL", "council-persona");
      if (sessionId) {
        await broadcastCouncilResponse(
          sessionId, persona.name, persona.id,
          persona.role ?? "Persona", "persona", response, 1, isSummoned,
        );
      }
      return { persona, response, summoned: isSummoned };
    } catch (err: any) {
      if (sessionId) {
        await broadcastCouncilResponse(
          sessionId, persona.name, persona.id,
          persona.role ?? "Persona", "persona", "PASS", 1, isSummoned, err?.message,
        );
      }
      return { persona, response: "PASS", summoned: isSummoned };
    }
  });

  const [rawMember, rawPersona] = await Promise.all([
    Promise.allSettled(memberPromises),
    Promise.allSettled(personaPromises),
  ]);

  const memberResponses = rawMember
    .map(r => r.status === "fulfilled" ? r.value : null)
    .filter((r): r is { member: CouncilMember; response: string } =>
      r != null && r.response.trim().toUpperCase() !== "PASS" && r.response.trim() !== ""
    );

  const personaResponses = rawPersona
    .map(r => r.status === "fulfilled" ? r.value : null)
    .filter((r): r is { persona: UnifiedPersona; response: string; summoned: boolean } =>
      r != null && r.response.trim().toUpperCase() !== "PASS" && r.response.trim() !== ""
    );

  return { memberResponses, personaResponses };
}

// ── Deliberation round ────────────────────────────────────────────────────────

async function runDeliberationRound(
  round: number,
  councilMembers: CouncilMember[],
  activePersonas: UnifiedPersona[],
  summonedPersonas: UnifiedPersona[],
  historyWithMavis: { role: "user" | "assistant"; content: string }[],
  contextSummary: string,
  allPreviousResponses: Array<{ name: string; role: string; response: string }>,
  sessionId: string | undefined,
): Promise<{
  memberResponses: { member: CouncilMember; response: string }[];
  personaResponses: { persona: UnifiedPersona; response: string; summoned: boolean }[];
}> {
  // Members deliberate — each sees what everyone else said in the previous round
  const memberPromises = councilMembers.map(async (member) => {
    const prompt = buildDeliberationPrompt(member, contextSummary, allPreviousResponses, round);
    try {
      const response = await invokeAI(prompt, historyWithMavis, "COUNCIL", "council-deliberation");
      if (sessionId) {
        await broadcastCouncilResponse(
          sessionId, member.name, member.id,
          member.role ?? "Council Member", "council", response, round,
        );
      }
      return { member, response };
    } catch (err: any) {
      if (sessionId) {
        await broadcastCouncilResponse(
          sessionId, member.name, member.id,
          member.role ?? "Council Member", "council", "PASS", round, undefined, err?.message,
        );
      }
      return { member, response: "PASS" };
    }
  });

  const personaPromises = activePersonas.map(async (persona) => {
    const isSummoned = summonedPersonas.some(s => s.id === persona.id);
    // Build deliberation prompt for persona (same structure, uses notes/role)
    const memberLike: CouncilMember = {
      id: persona.id,
      name: persona.name,
      role: persona.role ?? "Persona",
      specialty: persona.archetype,
      notes: persona.systemPrompt?.slice(0, 200),
    };
    const prompt = buildDeliberationPrompt(memberLike, contextSummary, allPreviousResponses, round);
    try {
      const response = await invokeAI(prompt, historyWithMavis, "COUNCIL", "council-deliberation");
      if (sessionId) {
        await broadcastCouncilResponse(
          sessionId, persona.name, persona.id,
          persona.role ?? "Persona", "persona", response, round, isSummoned,
        );
      }
      return { persona, response, summoned: isSummoned };
    } catch (err: any) {
      if (sessionId) {
        await broadcastCouncilResponse(
          sessionId, persona.name, persona.id,
          persona.role ?? "Persona", "persona", "PASS", round, isSummoned, err?.message,
        );
      }
      return { persona, response: "PASS", summoned: isSummoned };
    }
  });

  const [rawMember, rawPersona] = await Promise.all([
    Promise.allSettled(memberPromises),
    Promise.allSettled(personaPromises),
  ]);

  const memberResponses = rawMember
    .map(r => r.status === "fulfilled" ? r.value : null)
    .filter((r): r is { member: CouncilMember; response: string } =>
      r != null && r.response.trim().toUpperCase() !== "PASS" && r.response.trim() !== ""
    );

  const personaResponses = rawPersona
    .map(r => r.status === "fulfilled" ? r.value : null)
    .filter((r): r is { persona: UnifiedPersona; response: string; summoned: boolean } =>
      r != null && r.response.trim().toUpperCase() !== "PASS" && r.response.trim() !== ""
    );

  return { memberResponses, personaResponses };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Sends a message to the full Council Board with multi-round discourse.
 *
 * Flow:
 *   1. MAVIS responds first (presiding)
 *   2. Round 1 — all members respond to user + MAVIS independently (parallel)
 *   3. Deliberation round(s) — each member sees what others said and responds directly
 *      Members address each other by name, push back, agree, build on points
 *   4. Returns all rounds so the UI can render the full discourse chronologically
 */
function mergeConsecutiveAssistants(
  msgs: { role: "user" | "assistant"; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const msg of msgs) {
    if (out.length > 0 && out[out.length - 1].role === "assistant" && msg.role === "assistant") {
      out[out.length - 1] = { role: "assistant", content: out[out.length - 1].content + "\n\n" + msg.content };
    } else {
      out.push({ ...msg });
    }
  }
  return out;
}

export async function sendCouncilMessage(
  userMessage: string,
  history: CouncilBoardMessage[],
  councilMembers: CouncilMember[],
  appContext: AppContextSnapshot,
  sessionOptions?: CouncilSessionOptions,
): Promise<CouncilBoardResult> {
  const contextSummary = buildContextSummary(appContext);
  const maxDeliberationRounds = sessionOptions?.deliberationRounds ?? 1;

  // Council board produces multiple assistant messages per user turn (MAVIS + each member).
  // AI APIs (Claude, OpenAI, Gemini) all reject consecutive same-role messages, so we
  // merge them into a single combined assistant message before sending.
  const rawHistory = history.slice(-10).map(m => ({
    role: (m.isUser ? "user" : "assistant") as "user" | "assistant",
    content: m.isUser ? m.content : `[${m.speakerName}]: ${m.content}`,
  }));
  const historyForAI = mergeConsecutiveAssistants(rawHistory);

  const currentUserMsg = { role: "user" as const, content: userMessage };

  // ── MAVIS responds first ──────────────────────────────────────────────────
  const mavisSystemPrompt =
    (await buildSystemPromptFromSnapshot("SOVEREIGN", appContext)) +
    `\n\nCOUNCIL BOARD MODE — You are presiding. Respond first as MAVIS, before council members weigh in. Keep it focused — 1–3 paragraphs. Do not speak for individual council members; they respond separately after you.`;

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

  // Active personas for this session
  const activePersonas: UnifiedPersona[] = [];
  const seenIds = new Set<string>();
  for (const p of [
    ...(sessionOptions?.summonedPersonas ?? []),
    ...(sessionOptions?.includePersonas ?? []),
  ]) {
    if (!seenIds.has(p.id)) { seenIds.add(p.id); activePersonas.push(p); }
  }
  const summonedPersonas = sessionOptions?.summonedPersonas ?? [];

  // ── Round 1: initial responses ────────────────────────────────────────────
  const round1 = await runRound1(
    councilMembers, activePersonas, summonedPersonas,
    historyWithMavis, contextSummary, sessionId, appContext,
  );

  // ── Deliberation rounds ───────────────────────────────────────────────────
  // Only run if ≥2 voices spoke in Round 1 (need actual discourse to deliberate on)
  const deliberationResults: CouncilBoardResult["deliberationRounds"] = [];
  const totalVoices = round1.memberResponses.length + round1.personaResponses.length;

  if (totalVoices >= 2 && maxDeliberationRounds > 0) {
    // Build the combined Round 1 context that every deliberator will see
    let previousResponses = [
      ...round1.memberResponses.map(r => ({
        name: r.member.name,
        role: r.member.role ?? "Council Member",
        response: r.response,
      })),
      ...round1.personaResponses.map(r => ({
        name: r.persona.name,
        role: r.persona.role ?? "Persona",
        response: r.response,
      })),
    ];

    for (let roundNum = 2; roundNum <= 1 + maxDeliberationRounds; roundNum++) {
      const deliberation = await runDeliberationRound(
        roundNum,
        councilMembers,
        activePersonas,
        summonedPersonas,
        historyWithMavis,
        contextSummary,
        previousResponses,
        sessionId,
      );

      const deliberationVoices =
        deliberation.memberResponses.length + deliberation.personaResponses.length;

      if (deliberationVoices > 0) {
        deliberationResults.push({
          round: roundNum,
          memberResponses: deliberation.memberResponses,
          personaResponses: deliberation.personaResponses,
        });

        // Update context for the next deliberation round
        previousResponses = [
          ...deliberation.memberResponses.map(r => ({
            name: r.member.name,
            role: r.member.role ?? "Council Member",
            response: r.response,
          })),
          ...deliberation.personaResponses.map(r => ({
            name: r.persona.name,
            role: r.persona.role ?? "Persona",
            response: r.response,
          })),
        ];
      } else {
        // Everyone PASSed — no point continuing
        break;
      }
    }
  }

  return {
    mavisResponse,
    memberResponses: round1.memberResponses,
    personaResponses: round1.personaResponses.length > 0 ? round1.personaResponses : undefined,
    deliberationRounds: deliberationResults,
  };
}
