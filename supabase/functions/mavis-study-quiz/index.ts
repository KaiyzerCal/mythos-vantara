// mavis-study-quiz
// Turns a note the operator already wrote into a short quiz about that note.
//
// /study reviews mavis_notes on a spaced-repetition schedule, but the review
// itself is a flip card graded on the honour system: read the note, decide for
// yourself whether you knew it. Self-rating is the weakest signal in spaced
// repetition — the testing effect needs an actual retrieval attempt, and a
// card you *recognise* feels known when it is not.
//
// So this asks questions instead. The difficulty register below is the useful
// half: eight levels, each with its own pedagogical register, so a note you
// have held for a year is not tested the way one you met yesterday is.
//
// SOURCE-GROUNDED, and that is the whole design. Every question must be
// answerable from the note's own text. The model is told, twice and in the
// output contract, that it may return fewer questions rather than invent one —
// a confabulated question about the operator's own notes is worse than no
// question, because it teaches something they never wrote.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { callWithFallback } from "../_shared/providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const KEYS = {
  openai: Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "",
  claude: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
  grok: Deno.env.get("GROK_API_KEY") ?? Deno.env.get("XAI_API_KEY") ?? "",
  gemini: Deno.env.get("GEMINI_API_KEY") ?? "",
  groq: Deno.env.get("GROQ_API_KEY") ?? "",
};

/**
 * What "harder" means at each level. Not a difficulty knob — each entry asks
 * for a different *kind* of thinking, which is what stops level 8 from being
 * level 1 with longer words.
 */
const REGISTER = [
  "plain first principles, zero jargon, concrete everyday examples",
  "core vocabulary and the basic mechanism behind it",
  "the working method — how a beginner applies it deliberately",
  "common failure modes and how a competent practitioner avoids them",
  "structural understanding — how the parts constrain each other",
  "nuance, tension, and contested readings of the material",
  "synthesis across the whole note, transfer to new situations",
  "mastery: generating original judgment and teaching it to others",
];

const TIERS = [
  "Novice", "Apprentice", "Practitioner", "Journeyman",
  "Adept", "Specialist", "Authority", "Master",
];

/**
 * Competency is read from the review interval rather than stored separately.
 *
 * The scheduler already tracks how well the operator knows a note — that is
 * precisely what a long interval means. Adding a parallel `level` column would
 * be a second source of truth that could disagree with the first, and would
 * need a migration against live data to introduce.
 */
export function levelForInterval(days: number): number {
  const d = Number.isFinite(days) ? days : 1;
  if (d < 3) return 1;
  if (d < 7) return 2;
  if (d < 14) return 3;
  if (d < 30) return 4;
  if (d < 60) return 5;
  if (d < 120) return 6;
  if (d < 240) return 7;
  return 8;
}

interface Question {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

/**
 * A model that returns prose around its JSON, or five options, or an index
 * pointing past the end of the list, must not reach the UI as a broken quiz.
 * Anything that cannot be repaired is dropped rather than shown.
 */
function coerceQuiz(raw: unknown): Question[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: Question[] = [];
  for (const q of arr) {
    const item = q as Record<string, unknown>;
    const question = String(item?.question ?? "").trim();
    const options = (Array.isArray(item?.options) ? item.options : [])
      .map((o) => String(o ?? "").trim())
      .filter(Boolean)
      .slice(0, 4);
    const explanation = String(item?.explanation ?? "").trim();
    // Four distinct options or the question is not answerable as posed.
    if (!question || options.length !== 4 || new Set(options).size !== 4) continue;
    const idx = Number(item?.correctIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) continue;
    out.push({ question, options, correctIndex: idx, explanation });
  }
  return out.slice(0, 3);
}

function extractJson(text: string): unknown {
  const t = (text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    // Models sometimes wrap the object in a sentence. Take the outermost braces.
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s === -1 || e <= s) return null;
    try {
      return JSON.parse(t.slice(s, e + 1));
    } catch {
      return null;
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const noteId = String(body?.note_id ?? "").trim();
    if (!noteId) return json({ error: "note_id is required" }, 400);

    // The caller's own JWT decides whose notes these are. The service role is
    // used only to read the row after ownership is established.
    let userId: string;
    if (token === SB_SRK && body?.user_id) {
      userId = String(body.user_id);
    } else {
      const userClient = createClient(SB_URL, ANON, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await userClient.auth.getUser(token);
      if (error || !data?.user?.id) return json({ error: "Unauthorized" }, 401);
      userId = data.user.id;
    }

    const sb = createClient(SB_URL, SB_SRK);
    const { data: note, error: noteErr } = await sb
      .from("mavis_notes")
      .select("id,title,content,review_interval_days")
      .eq("id", noteId)
      .eq("user_id", userId)
      .maybeSingle();

    if (noteErr) return json({ error: noteErr.message }, 500);
    if (!note) return json({ error: "note not found" }, 404);

    const title = String(note.title ?? "").trim();
    const content = String(note.content ?? "").trim();

    // Said plainly rather than asking the model to invent questions about an
    // empty note, which is exactly how a source-grounded tutor stops being one.
    if (content.length < 80) {
      return json({
        ok: true,
        note_id: noteId,
        level: levelForInterval(Number(note.review_interval_days ?? 1)),
        quiz: [],
        note: "This note is too short to ask a fair question about. Review it as a card instead.",
      });
    }

    const level = levelForInterval(Number(note.review_interval_days ?? 1));
    const system =
      "You write retrieval-practice questions about a note the learner wrote themselves. " +
      "You are strictly source-grounded: every question and every correct answer must be " +
      "verifiable from the note text you are given. You never use outside knowledge to " +
      "invent a question, and you would rather return fewer questions than one the note " +
      "does not support. Return JSON only, no markdown.";

    const prompt = `NOTE TITLE: ${title || "(untitled)"}

NOTE CONTENT:
"""
${content.slice(0, 6000)}
"""

The learner is at competency level ${level} of 8 for this note (tier "${TIERS[level - 1]}").
Register for this level: ${REGISTER[level - 1]}.

Write up to 3 multiple-choice questions that test genuine understanding of THIS NOTE, not recall of its wording.
Every question must be answerable from the note content above and nothing else. If the note only supports one or two fair questions, return only that many. Returning fewer is correct; inventing one is not.
Each question needs exactly 4 distinct, plausible options.
Each explanation must say why the correct answer is correct AND why the tempting wrong options fail.

Return JSON exactly:
{"quiz":[{"question":string,"options":[string,string,string,string],"correctIndex":number,"explanation":string}]}`;

    // callWithFallback returns { content, provider }, not a string. Taking the
    // object here put a non-string into extractJson, which calls .trim() on it.
    const { content: text } = await callWithFallback(
      "gemini",
      [{ role: "user", content: prompt }],
      system,
      KEYS,
      false,
      "STUDY",
    );

    const parsed = extractJson(text) as { quiz?: unknown } | null;
    const quiz = coerceQuiz(parsed?.quiz);

    return json({
      ok: true,
      note_id: noteId,
      level,
      tier: TIERS[level - 1],
      quiz,
      ...(quiz.length === 0
        ? { note: "Could not build a question this note fully supports. Review it as a card instead." }
        : {}),
    });
  } catch (err) {
    return json({ error: (err as Error)?.message ?? String(err) }, 500);
  }
});
