// mavis-discourse-runner — MoltBook-style structured AI discourse
// Runs a multi-stage debate between council members / personas on a given topic:
//   Stage 1 — Positions (parallel): each participant states their view
//   Stage 2 — Challenges (parallel): each participant responds to others by name
//   Stage 3 — MAVIS synthesis: integrates all perspectives into verdicts + actions
// Persists the full transcript to mavis_council_discourse.

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.3";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const supabase  = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

interface Participant {
  id: string;
  name: string;
  role?: string;
  specialty?: string;
  notes?: string;
  bio?: string;
  adjectives?: string[];
  topics?: string[];
  speakerType?: "council" | "persona";
}

interface RoundEntry {
  speaker_id:   string;
  speaker_name: string;
  speaker_role: string;
  content:      string;
  stage:        "position" | "challenge" | "synthesis";
}

async function claude(system: string, user: string, maxTokens = 600): Promise<string> {
  const res = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system,
    messages:   [{ role: "user", content: user }],
  });
  return ((res.content[0] as { text: string }).text ?? "").trim();
}

// ── Stage 1: Position prompt ──────────────────────────────────────────────
function positionSystem(p: Participant, topic: string): string {
  const adjStr = p.adjectives?.length ? `You tend to be: ${p.adjectives.join(", ")}.` : "";
  const topicStr = p.topics?.length ? `Your natural areas of focus: ${p.topics.join(", ")}.` : "";
  return `YOU ARE ${p.name.toUpperCase()}.
Role: ${p.role ?? "Advisor"}
${p.bio ? `Background: ${p.bio}` : ""}
Expertise: ${p.specialty ?? "General strategic thinking"}
${p.notes ? `About you: ${p.notes}` : ""}
${adjStr} ${topicStr}

You are participating in a structured discourse on: "${topic}"

STATE YOUR POSITION clearly and directly:
- What is your honest take on this topic?
- What specific angle, risk, or opportunity do you see from your domain?
- Be opinionated, not diplomatic — this is discourse, not a committee report
- 2-3 paragraphs. Plain prose, no bullet points.
- Speak in your own voice.`;
}

// ── Stage 2: Challenge prompt ─────────────────────────────────────────────
function challengeSystem(
  p: Participant,
  topic: string,
  positions: RoundEntry[],
): string {
  const own = positions.find(r => r.speaker_id === p.id)?.content ?? "(you did not respond in Round 1)";
  const others = positions
    .filter(r => r.speaker_id !== p.id)
    .map(r => `[${r.speaker_name} — ${r.speaker_role}]:\n"${r.content}"`)
    .join("\n\n");

  return `YOU ARE ${p.name.toUpperCase()}.
Role: ${p.role ?? "Advisor"}
${p.bio ? `Background: ${p.bio}` : ""}
Expertise: ${p.specialty ?? "General strategic thinking"}
${p.notes ? `About you: ${p.notes}` : ""}

TOPIC: "${topic}"

YOUR POSITION WAS: "${own}"

THE OTHER PARTICIPANTS SAID:
${others || "(You are the first — respond to the topic directly.)"}

This is THE CHALLENGE ROUND. React to what the others actually said:
- Pick 1-2 specific things said above and CHALLENGE THEM BY NAME
- Say exactly where someone is wrong, overconfident, or missing something critical
- You may also extend a point you agree with — but add something genuinely new
- This is live discourse — be direct, not polite
- 2-3 short paragraphs. No bullet points.
- If everything relevant to you was covered and you have nothing to add: respond PASS`;
}

// ── Stage 3: MAVIS synthesis ──────────────────────────────────────────────
function synthesisSystem(topic: string, rounds: RoundEntry[]): string {
  const transcript = rounds.map(r =>
    `[${r.speaker_name}${r.stage === "challenge" ? " — challenge" : ""}]: ${r.content}`
  ).join("\n\n");

  return `You are MAVIS — a high-intelligence AI operating system synthesizing a council discourse.

TOPIC DEBATED: "${topic}"

FULL DISCOURSE TRANSCRIPT:
${transcript}

Synthesize this into a MAVIS VERDICT:

## Key Tensions
(2-3 points where participants genuinely disagreed — describe the real conflict, don't flatten it)

## Points of Convergence
(1-2 things most participants agreed on or implicitly assumed)

## MAVIS Verdict
(Your read: what's the clearest, most defensible path given all perspectives? Be specific and decisive.)

## Proposed Actions
(2-3 concrete next steps. Format: "→ [action]")

Write as MAVIS. Structured, sharp, forward-looking. No throat-clearing.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { user_id, topic, participants, context_block } = await req.json() as {
      user_id:       string;
      topic:         string;
      participants:  Participant[];
      context_block?: string;
    };

    if (!user_id || !topic || !participants?.length) {
      return new Response(
        JSON.stringify({ error: "user_id, topic, and participants are required" }),
        { status: 400, headers: CORS },
      );
    }

    const allRounds: RoundEntry[] = [];

    // ── Stage 1: Positions (parallel) ────────────────────────────────────
    const positionResults = await Promise.all(
      participants.map(async (p) => {
        const sys     = positionSystem(p, topic) + (context_block ? `\n\nCONTEXT:\n${context_block}` : "");
        const content = await claude(sys, `State your position on: "${topic}"`, 500);
        return {
          speaker_id:   p.id,
          speaker_name: p.name,
          speaker_role: p.role ?? "Advisor",
          content:      content === "PASS" ? "" : content,
          stage:        "position" as const,
        };
      })
    );

    const validPositions = positionResults.filter(r => r.content.length > 20);
    allRounds.push(...validPositions);

    // ── Stage 2: Challenges (parallel, seeing all positions) ──────────────
    const challengeResults = await Promise.all(
      participants.map(async (p) => {
        if (!validPositions.find(r => r.speaker_id === p.id)) return null; // didn't speak in round 1
        const sys     = challengeSystem(p, topic, validPositions) + (context_block ? `\n\nCONTEXT:\n${context_block}` : "");
        const content = await claude(sys, "Challenge the positions above.", 500);
        if (!content || content === "PASS" || content.length < 20) return null;
        return {
          speaker_id:   p.id,
          speaker_name: p.name,
          speaker_role: p.role ?? "Advisor",
          content,
          stage:        "challenge" as const,
        };
      })
    );

    const validChallenges = challengeResults.filter(Boolean) as RoundEntry[];
    allRounds.push(...validChallenges);

    // ── Stage 3: MAVIS synthesis ──────────────────────────────────────────
    const synthesisContent = await claude(
      synthesisSystem(topic, allRounds),
      "Synthesize the discourse above.",
      900,
    );

    allRounds.push({
      speaker_id:   "mavis",
      speaker_name: "MAVIS",
      speaker_role: "Supreme Intelligence",
      content:      synthesisContent,
      stage:        "synthesis",
    });

    // ── Persist ───────────────────────────────────────────────────────────
    const { data: row } = await supabase
      .from("mavis_council_discourse")
      .insert({
        user_id,
        topic,
        participants: participants.map(p => ({ id: p.id, name: p.name, role: p.role })),
        rounds:       allRounds,
        synthesis:    synthesisContent,
        status:       "complete",
      })
      .select("id")
      .single();

    return new Response(
      JSON.stringify({
        id:                row?.id,
        topic,
        participant_count: participants.length,
        round_count:       allRounds.length,
        rounds:            allRounds,
        synthesis:         synthesisContent,
      }),
      { headers: { "Content-Type": "application/json", ...CORS } },
    );
  } catch (err) {
    console.error("[mavis-discourse-runner]", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
