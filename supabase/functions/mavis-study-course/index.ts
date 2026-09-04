// mavis-study-course
// Name anything — a skill, book, essay, speech, film, documentary, textbook —
// and learn it to mastery.
//
// Three actions:
//   build_course  subject            -> eight competency tiers
//   build_lesson  course + level     -> a ~90s lesson plus a quiz at that level
//   ask_mentor    course + messages  -> a tutor to argue with about the subject
//
// The operator's own material comes first. Before generating anything, this
// searches everything they have written (searchAppData spans the whole app)
// and, when it finds material on the subject, teaches from that. A course on
// their own vault entry should be about what they actually wrote, not what a
// model assumes the topic contains.
//
// When nothing matches, it still builds the course from general knowledge —
// that is the point of "learn anything" — but says so. `grounded_in` reaches
// the UI so the operator always knows which of the two they are reading.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { callWithFallback } from "../_shared/providers.ts";
import { searchAppData, type AppSearchHit } from "../_shared/appSearch.ts";
import { embedText } from "../_shared/embedding.ts";

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

export const MAX_LEVEL = 8;

/**
 * What "one level harder" means. Each rung asks for a different *kind* of
 * thinking, which is what stops level 8 from being level 1 with longer words.
 */
export const REGISTER = [
  "plain first principles, zero jargon, concrete everyday examples",
  "core vocabulary and the basic mechanism behind it",
  "the working method — how a beginner applies it deliberately",
  "common failure modes and how a competent practitioner avoids them",
  "structural understanding — how the parts constrain each other",
  "nuance, tension, and contested readings of the material",
  "synthesis across the whole material, transfer to new situations",
  "mastery: generating original judgment and teaching it to others",
];

export const TIER_FALLBACK = [
  "Novice", "Apprentice", "Practitioner", "Journeyman",
  "Adept", "Specialist", "Authority", "Master",
];

/** XP needed to leave a level. Rises so later tiers take real work. */
export function levelGoal(level: number): number {
  return 300 + (level - 1) * 250;
}

/** A wrong answer still earns something — the attempt is the learning. */
export function xpForAnswer(level: number, correct: boolean): number {
  return correct ? 35 + level * 6 : 8 + Math.round(level * 1.5);
}

export function applyXp(level: number, xp: number, gained: number) {
  let nextLevel = level;
  let nextXp = xp + gained;
  let leveled = false;
  while (nextLevel < MAX_LEVEL && nextXp >= levelGoal(nextLevel)) {
    nextXp -= levelGoal(nextLevel);
    nextLevel += 1;
    leveled = true;
  }
  if (nextLevel === MAX_LEVEL) nextXp = Math.min(nextXp, levelGoal(MAX_LEVEL));
  return { level: nextLevel, xp: nextXp, leveled };
}

function extractJson(text: string): unknown {
  const t = (text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s === -1 || e <= s) return null;
    try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
  }
}

interface Question {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

/** A malformed question must not reach the UI as an unanswerable one. */
export function coerceQuiz(raw: unknown, max = 3): Question[] {
  const out: Question[] = [];
  for (const q of Array.isArray(raw) ? raw : []) {
    const item = q as Record<string, unknown>;
    const question = String(item?.question ?? "").trim();
    const options = (Array.isArray(item?.options) ? item.options : [])
      .map((o) => String(o ?? "").trim()).filter(Boolean).slice(0, 4);
    const idx = Number(item?.correctIndex);
    if (!question || options.length !== 4 || new Set(options).size !== 4) continue;
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) continue;
    out.push({
      question, options, correctIndex: idx,
      explanation: String(item?.explanation ?? "").trim(),
    });
  }
  return out.slice(0, max);
}

/** Eight tiers or the ladder is not a ladder. Pads rather than failing. */
export function coerceTiers(raw: unknown): Array<{ tier: string; focus: string }> {
  const list = (Array.isArray(raw) ? raw : []).map((t) => {
    const item = t as Record<string, unknown>;
    return {
      tier: String(item?.tier ?? "").trim(),
      focus: String(item?.focus ?? "").trim(),
    };
  }).filter((t) => t.tier);
  const out = list.slice(0, MAX_LEVEL);
  for (let i = out.length; i < MAX_LEVEL; i++) {
    out.push({ tier: TIER_FALLBACK[i], focus: REGISTER[i] });
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim();

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

    // ── Whatever the operator has already written about this ──────────────
    // Searched before anything is generated, so their own material is the
    // first source rather than a footnote.
    async function ownMaterial(query: string, limit = 6) {
      try {
        const hits = await searchAppData(sb, userId, query, { limit, embed: embedText });
        return hits ?? [];
      } catch {
        // Search is an enhancement here. A failure must degrade to a general
        // course, never fail the request.
        return [];
      }
    }

    function sourceBlock(hits: AppSearchHit[]) {
      if (hits.length === 0) return "";
      return hits.map((h, i) =>
        `[${i + 1}] (${String(h.kind ?? "note")}) ${String(h.title ?? "")}\n${String(h.excerpt ?? "").slice(0, 900)}`,
      ).join("\n\n");
    }

    // ── build_course ──────────────────────────────────────────────────────
    if (action === "build_course") {
      const subject = String(body?.subject ?? "").trim();
      if (subject.length < 2) return json({ error: "subject is required" }, 400);

      const hits = await ownMaterial(subject);
      const grounded = hits.length > 0;
      const sources = sourceBlock(hits);

      const system =
        "You are a master tutor who turns any named material — a skill, book, essay, speech, " +
        "film, documentary or textbook — into a rigorous immersion curriculum of eight " +
        "competency tiers. Return JSON only, no markdown.";

      const prompt = `The learner named: "${subject}".
${grounded ? `They have already written about this. Build the curriculum around THEIR material below — use their framing, their examples and their vocabulary wherever it applies, and extend beyond it only where the tiers require.

THEIR MATERIAL:
${sources}
` : ""}
Identify what this most likely is and build an immersion curriculum of exactly 8 competency tiers, absolute beginner through complete mastery.

Return JSON exactly:
{"title":string,"attribution":string (author/creator/origin, or the domain if none),"kind":one of "Skill"|"Book"|"Essay"|"Speech"|"Film"|"Documentary"|"Textbook","premise":string (2 sentences on what mastery of this means),"tiers":[{"tier":string (short, evocative),"focus":string (one sentence on what this tier drills)}]}
Exactly 8 tiers.`;

      const { content: text } = await callWithFallback("gemini", [{ role: "user", content: prompt }], system, KEYS, false, "STUDY");
      const parsed = (extractJson(text) ?? {}) as Record<string, unknown>;

      const course = {
        title: String(parsed.title ?? subject).slice(0, 300),
        attribution: String(parsed.attribution ?? "").slice(0, 300),
        kind: String(parsed.kind ?? "Skill").slice(0, 60),
        premise: String(parsed.premise ?? "").slice(0, 2000),
        tiers: coerceTiers(parsed.tiers),
      };

      const { data: row, error } = await sb.from("study_courses").insert({
        user_id: userId,
        subject,
        kind: course.kind,
        title: course.title,
        attribution: course.attribution,
        premise: course.premise,
        tiers: course.tiers,
        grounded_in: grounded ? "own_material" : "general",
        sources: hits.map((h) => ({ kind: h.kind, id: h.id, title: h.title })),
      }).select("id").single();
      if (error) throw new Error(error.message);

      return json({
        ok: true,
        id: row.id,
        course,
        grounded_in: grounded ? "own_material" : "general",
        sources: hits.map((h) => ({ kind: h.kind, title: h.title })),
      });
    }

    // ── build_lesson ──────────────────────────────────────────────────────
    if (action === "build_lesson") {
      const id = String(body?.id ?? "").trim();
      if (!id) return json({ error: "id is required" }, 400);

      const { data: row, error } = await sb.from("study_courses")
        .select("id,subject,kind,title,tiers,level,covered,grounded_in")
        .eq("id", id).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) return json({ error: "course not found" }, 404);

      const level = Math.max(1, Math.min(MAX_LEVEL, Number(row.level) || 1));
      const tiers = coerceTiers(row.tiers);
      const tier = tiers[level - 1];
      const covered = (Array.isArray(row.covered) ? row.covered : []).map(String);

      const hits = row.grounded_in === "own_material"
        ? await ownMaterial(`${row.subject} ${tier.focus}`, 4)
        : [];
      const sources = sourceBlock(hits);

      const system =
        "You are a master tutor. You write short, dense, immersive micro-lessons and then " +
        "test real competency rather than recall of wording. Return JSON only, no markdown.";

      const prompt = `Material: "${row.subject}" (${row.kind}).
Learner is at competency level ${level} of ${MAX_LEVEL}, tier "${tier.tier}" — focus: ${tier.focus}.
Register for this level: ${REGISTER[level - 1]}.
Already covered (do not repeat): ${covered.length ? covered.join("; ") : "none"}.
${sources ? `\nThe learner's own material on this, to teach from where it applies:\n${sources}\n` : ""}
Write ONE lesson readable in about 90 seconds (110-170 words, no headings, no bullets, no markdown) plus 3 quiz questions testing genuine understanding at level ${level}.
Every question needs exactly 4 distinct plausible options and an explanation saying why the correct answer is correct AND why the tempting wrong ones fail.

Return JSON exactly:
{"title":string,"keyIdea":string (one line),"body":string,"quiz":[{"question":string,"options":[string,string,string,string],"correctIndex":number,"explanation":string}]}
Exactly 3 questions.`;

      const { content: text } = await callWithFallback("gemini", [{ role: "user", content: prompt }], system, KEYS, false, "STUDY");
      const parsed = (extractJson(text) ?? {}) as Record<string, unknown>;

      const lesson = {
        title: String(parsed.title ?? tier.tier).slice(0, 200),
        keyIdea: String(parsed.keyIdea ?? "").slice(0, 400),
        body: String(parsed.body ?? "").slice(0, 4000),
        quiz: coerceQuiz(parsed.quiz),
      };

      await sb.from("study_courses").update({
        lesson, last_opened_at: new Date().toISOString(),
      }).eq("id", id).eq("user_id", userId);

      return json({ ok: true, level, tier, lesson });
    }

    // ── answer: XP, levelling, and not repeating a lesson ─────────────────
    if (action === "answer") {
      const id = String(body?.id ?? "").trim();
      const correctCount = Math.max(0, Math.min(3, Number(body?.correct) || 0));
      const total = Math.max(1, Math.min(3, Number(body?.total) || 3));
      if (!id) return json({ error: "id is required" }, 400);

      const { data: row, error } = await sb.from("study_courses")
        .select("id,level,xp,covered,lesson").eq("id", id).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) return json({ error: "course not found" }, 404);

      const level = Math.max(1, Math.min(MAX_LEVEL, Number(row.level) || 1));
      let gained = 0;
      for (let i = 0; i < total; i++) gained += xpForAnswer(level, i < correctCount);
      const next = applyXp(level, Number(row.xp) || 0, gained);

      const covered = (Array.isArray(row.covered) ? row.covered : []).map(String);
      const title = String((row.lesson as Record<string, unknown> | null)?.title ?? "").trim();
      if (title && !covered.includes(title)) covered.push(title);

      await sb.from("study_courses").update({
        level: next.level, xp: next.xp, covered: covered.slice(-40),
        lesson: null, last_opened_at: new Date().toISOString(),
      }).eq("id", id).eq("user_id", userId);

      return json({
        ok: true, gained, level: next.level, xp: next.xp,
        leveled: next.leveled, goal: levelGoal(next.level),
      });
    }

    // ── ask_mentor ────────────────────────────────────────────────────────
    if (action === "ask_mentor") {
      const id = String(body?.id ?? "").trim();
      const messages = (Array.isArray(body?.messages) ? body.messages : [])
        .filter((m: Record<string, unknown>) => m?.role && m?.content)
        .slice(-20)
        .map((m: Record<string, unknown>) => ({
          role: String(m.role) === "assistant" ? "assistant" : "user",
          content: String(m.content).slice(0, 4000),
        }));
      if (!id || messages.length === 0) return json({ error: "id and messages are required" }, 400);

      const { data: row, error } = await sb.from("study_courses")
        .select("subject,level,lesson,grounded_in").eq("id", id).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) return json({ error: "course not found" }, 404);

      const last = messages[messages.length - 1]?.content ?? "";
      const hits = await ownMaterial(`${row.subject} ${last}`, 4);
      const sources = sourceBlock(hits);
      const lessonTitle = String((row.lesson as Record<string, unknown> | null)?.title ?? "");

      const system = `You are a mentor immersed in "${row.subject}". The learner is at competency level ${row.level} of ${MAX_LEVEL}${lessonTitle ? `, currently studying "${lessonTitle}"` : ""}. Discuss this in real depth at their level. Be direct and concrete, use examples from the material, and end with a question or a next thing to try when it helps. Keep replies under 180 words unless asked for more. Plain prose, no headings.${sources ? `\n\nThe learner's own writing that bears on this — prefer it, and say when you are drawing on it:\n${sources}` : ""}`;

      const { content: reply } = await callWithFallback("gemini", messages, system, KEYS, false, "STUDY", true);
      return json({ ok: true, reply, used_own_material: hits.length > 0 });
    }

    return json({ error: `unknown action "${action}"`, actions: ["build_course", "build_lesson", "answer", "ask_mentor"] }, 400);
  } catch (err) {
    return json({ error: (err as Error)?.message ?? String(err) }, 500);
  }
});
