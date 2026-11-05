// Picks the skills a quest genuinely trains, out of the operator's full skill
// set (~1,400 rows, 1,312 of them Beyonder pathway/sequence/ability entries).
//
// Why this exists: linking used to depend on the chat model scanning a
// 1,400-line skill dump in its prompt, and only when the operator asked it
// to. Quests created by every other path (12h MAVIS digest, council
// heartbeats, goal engine, task executor, meeting transcripts) never saw the
// skill list at all and landed unlinked. Picking from 1,400 lines is also
// exactly where models fail: attention spreads thin and they grab whatever
// name looks plausible.
//
// So it's done in two stages, the way search systems do it:
//   1. Retrieve ~30 candidates. Semantic (match_skills over skills.embedding)
//      catches "run 5k" -> an endurance ability. Keyword matching catches the
//      operator naming a skill outright ("train my Seer sequence") and covers
//      the gap while the embedding backfill is still filling in.
//   2. One small model call picks 0-3 from that shortlist. 30 lines with
//      their pathway/sequence context is a judgement a cheap model makes
//      well; 1,400 is not.
//
// Beyonder structure is handled explicitly. Abilities carry the most
// descriptive text, so they're the best retrieval signal, but proficiency
// that advances the tree lands on sequences (mastering one unlocks the next
// via prerequisites). An ability hit is therefore offered as its sequence,
// with the ability quoted as evidence. And a locked sequence is redirected
// to the pathway's current sequence, since progress on a sequence you can't
// reach yet doesn't move you forward.

import { embedText } from "./embedding.ts";
import { aiComplete } from "./providers.ts";

interface SkillRow {
  id: string;
  name: string;
  category: string;
  description: string | null;
  parent_skill_id: string | null;
  tier: number | null;
  unlocked: boolean | null;
  proficiency: number | null;
}

interface Candidate {
  skill: SkillRow;
  path: string;
  evidence: string[];
  score: number;
}

export interface SkillLinkResult {
  ids: string[];
  /** id -> human-readable path, for activity-log and UI display. */
  labels: Record<string, string>;
  why: string;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "your", "you", "into", "about", "will", "have", "has",
  "are", "was", "were", "been", "being", "per", "each", "every", "day", "daily", "week", "weekly", "quest",
  "complete", "completed", "finish", "make", "get", "set", "new", "one", "two", "three", "least", "more",
  "than", "then", "them", "they", "their", "what", "when", "where", "which", "while", "who", "how", "all",
  "any", "some", "own", "out", "not", "can", "use", "using", "also", "just", "like", "over", "under",
]);

function stem(w: string): string {
  return w.replace(/(ing|ed|es|s)$/, "");
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(stem);
}

function isBeyonder(s: SkillRow) {
  return s.category === "Beyonder";
}

/** Sequence N for a Beyonder sequence row: tier 1 = Seq.9 ... tier 10 = Seq.0. */
function seqLabel(s: SkillRow) {
  return `Seq.${10 - Number(s.tier ?? 1)}`;
}

/**
 * The sequence in a pathway where progress currently counts: the most
 * advanced one that's unlocked and not yet mastered. Falls back to the
 * least-developed sequence (Seq.9) when nothing qualifies.
 */
function currentSequence(pathwayId: string, byParent: Map<string, SkillRow[]>): SkillRow | null {
  const seqs = (byParent.get(pathwayId) ?? []).slice().sort((a, b) => Number(a.tier ?? 0) - Number(b.tier ?? 0));
  if (seqs.length === 0) return null;
  const active = seqs.filter((s) => s.unlocked && Number(s.proficiency ?? 0) < 100);
  return active.length ? active[active.length - 1] : seqs[0];
}

export async function suggestSkillLinks(
  // deno-lint-ignore no-explicit-any
  sb: any,
  userId: string,
  quest: { title: string; description?: string | null; category?: string | null },
  opts: { max?: number } = {},
): Promise<SkillLinkResult> {
  const max = Math.max(1, Math.min(5, opts.max ?? 3));
  const empty: SkillLinkResult = { ids: [], labels: {}, why: "" };
  const questText = [quest.title, quest.description ?? "", quest.category ?? ""].filter(Boolean).join("\n").trim();
  if (!questText) return empty;

  // PostgREST caps one response at 1,000 rows and this operator has ~1,400
  // skills. A single unpaginated query silently dropped the rest — including
  // parents — so abilities whose sequence was cut off looked like roots and
  // got linked directly (labels like "Warrior — Ability 1 pathway"), and any
  // skill past row 1,000 could never be a candidate. Page until a short
  // page; order by id so pages don't overlap or skip.
  const PAGE = 1000;
  const skills: SkillRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await sb
      .from("skills")
      .select("id, name, category, description, parent_skill_id, tier, unlocked, proficiency")
      .eq("user_id", userId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    skills.push(...((page ?? []) as SkillRow[]));
    if (!page || page.length < PAGE) break;
  }
  if (skills.length === 0) return empty;

  const byId = new Map(skills.map((s) => [s.id, s]));
  const byParent = new Map<string, SkillRow[]>();
  for (const s of skills) {
    if (!s.parent_skill_id) continue;
    const list = byParent.get(s.parent_skill_id) ?? [];
    list.push(s);
    byParent.set(s.parent_skill_id, list);
  }

  // Map any hit to the skill proficiency should actually land on, plus the
  // path shown to the reranker.
  const resolveTarget = (s: SkillRow): { target: SkillRow; path: string; evidence?: string } => {
    if (!isBeyonder(s)) {
      const parent = s.parent_skill_id ? byId.get(s.parent_skill_id) : null;
      return { target: s, path: parent ? `${parent.name} › ${s.name}` : s.name };
    }
    const parent = s.parent_skill_id ? byId.get(s.parent_skill_id) : null;
    const grand = parent?.parent_skill_id ? byId.get(parent.parent_skill_id) : null;
    if (!parent) {
      // Pathway root — offer its current sequence instead of the root itself.
      const cur = currentSequence(s.id, byParent);
      return cur ? { target: cur, path: `${s.name} pathway › ${seqLabel(cur)} ${cur.name}` } : { target: s, path: `${s.name} pathway` };
    }
    if (!grand) {
      return { target: s, path: `${parent.name} pathway › ${seqLabel(s)} ${s.name}` };
    }
    // Ability — offered as its sequence, with the ability quoted.
    return {
      target: parent,
      path: `${grand.name} pathway › ${seqLabel(parent)} ${parent.name}`,
      evidence: (s.description || s.name).slice(0, 160),
    };
  };

  const candidates = new Map<string, Candidate>();
  const add = (s: SkillRow, score: number) => {
    const { target, path, evidence } = resolveTarget(s);
    const existing = candidates.get(target.id);
    if (existing) {
      existing.score = Math.max(existing.score, score);
      if (evidence && existing.evidence.length < 2 && !existing.evidence.includes(evidence)) existing.evidence.push(evidence);
      return;
    }
    candidates.set(target.id, { skill: target, path, evidence: evidence ? [evidence] : [], score });
  };

  // 1a. Semantic.
  const vec = await embedText(questText);
  if (vec) {
    const { data: hits } = await sb.rpc("match_skills", { p_user_id: userId, p_query: vec, p_count: 40 });
    for (const h of (hits ?? []) as Array<{ id: string; similarity: number }>) {
      const s = byId.get(h.id);
      if (s) add(s, Number(h.similarity) || 0);
    }
  }

  // 1b. Keyword — name hits weigh most, so a skill named outright always
  // makes the shortlist.
  const qTokens = new Set(tokens(questText));
  if (qTokens.size > 0) {
    const scored: Array<{ s: SkillRow; score: number }> = [];
    for (const s of skills) {
      let score = 0;
      for (const t of tokens(s.name)) if (qTokens.has(t)) score += 3;
      for (const t of tokens(s.category)) if (qTokens.has(t)) score += 1.5;
      for (const t of new Set(tokens(s.description ?? ""))) if (qTokens.has(t)) score += 1;
      if (score > 0) scored.push({ s, score });
    }
    scored.sort((a, b) => b.score - a.score);
    // Normalised into roughly the same 0-1 band as cosine similarity so the
    // two lists merge sensibly.
    for (const { s, score } of scored.slice(0, 15)) add(s, Math.min(0.9, 0.2 + score / 15));
  }

  const shortlist = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 30);
  if (shortlist.length === 0) return empty;

  // 2. Rerank.
  const lines = shortlist.map((c) => {
    const s = c.skill;
    const state = `${s.unlocked === false ? "locked" : "unlocked"}, ${Number(s.proficiency ?? 0)}%`;
    const desc = (s.description ?? "").replace(/\s+/g, " ").slice(0, 140);
    const ev = c.evidence.length ? ` | abilities matched: ${c.evidence.map((e) => `"${e}"`).join("; ")}` : "";
    return `[${s.id}] ${c.path} (${s.category}, ${state})${desc ? ` — ${desc}` : ""}${ev}`;
  });

  const system = `You link quests in a gamified real-life progression system (think Solo Leveling's System) to the skills they genuinely train. Completing a quest raises proficiency on every linked skill, so a link should mean "doing this quest in real life actually exercises this skill".

Choose 0 to ${max} skills from the candidate list. Rules:
- Only skills the quest would really exercise. A loosely related link is worse than no link — returning none is a normal outcome.
- Prefer the most specific fitting skill over a broad one.
- Beyonder entries are sequences within a pathway; "abilities matched" shows which real-world abilities of that sequence fit. Judge by those abilities and the description, not by how mystical the name sounds.
- A quest can legitimately train both a Beyonder sequence and an ordinary skill — include both when both genuinely apply.
- Use ids exactly as written in brackets. Never invent one.

Reply with ONLY a JSON object: {"ids":["<id>", ...],"why":"<one short sentence naming what each pick trains>"}`;

  const user = `QUEST\nTitle: ${quest.title}${quest.description ? `\nDescription: ${quest.description}` : ""}${quest.category ? `\nCategory: ${quest.category}` : ""}\n\nCANDIDATE SKILLS\n${lines.join("\n")}`;

  let parsed: { ids?: unknown; why?: unknown } = {};
  try {
    const { content } = await aiComplete({ system, user });
    const json = content.match(/\{[\s\S]*\}/)?.[0];
    if (json) parsed = JSON.parse(json);
  } catch (err) {
    // No link beats a guessed link — retrieval alone isn't trusted to decide.
    console.warn("[skillLinker] rerank failed, leaving quest unlinked:", err instanceof Error ? err.message : err);
    return empty;
  }

  const allowed = new Map(shortlist.map((c) => [c.skill.id, c]));
  const picked: string[] = [];
  const labels: Record<string, string> = {};
  for (const raw of Array.isArray(parsed.ids) ? parsed.ids : []) {
    const c = allowed.get(String(raw));
    if (!c) continue;
    let target = c.skill;
    let label = c.path;
    // A locked sequence can't be advanced yet — move the link to where
    // progress in that pathway currently counts.
    if (isBeyonder(target) && target.unlocked === false && target.parent_skill_id) {
      const cur = currentSequence(target.parent_skill_id, byParent);
      const pathway = byId.get(target.parent_skill_id);
      if (cur && cur.id !== target.id) {
        target = cur;
        label = `${pathway?.name ?? "Pathway"} pathway › ${seqLabel(cur)} ${cur.name}`;
      }
    }
    if (picked.includes(target.id)) continue;
    picked.push(target.id);
    labels[target.id] = label;
    if (picked.length >= max) break;
  }

  return { ids: picked, labels, why: typeof parsed.why === "string" ? parsed.why.slice(0, 300) : "" };
}
