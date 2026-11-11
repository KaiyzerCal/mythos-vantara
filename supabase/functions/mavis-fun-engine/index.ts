// mavis-fun-engine — the game layer of Vantara.exe, written for the Operator-as-author premise.
//
// Modes (POST { mode, ... }):
//   chapter  weekly: turns the week's journal, quests, achievements and emotions into the next chapter of the
//            Black Sun Monarch's story and files it in the vault (category "Chapter"). Skips if one was written in
//            the last 5 days unless { force: true }, or if there is nothing to chronicle.
//   boss     daily: generates ONE boss fight (a hard side quest linked to the stalest main/epic quest) with a
//            rewards tier. Skips while an earlier "Boss:" quest is still active.
//   beat     hourly/daily: detects new milestones (level, task streak, quests completed) and writes a short
//            in-voice beat for each, sent to Telegram. The first run only baselines what is already reached,
//            so history is never announced as if it were new. Ledger: mavis_beats (unique per user + key).
// (The one-tap council debate already exists: Council Board -> mavis-discourse-runner.)
//
// Callers: pg_cron (service role), or the app (user JWT) for manual runs.
// Everything goes through the shared provider cascade, so no single provider's credits can stop it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { aiComplete } from "../_shared/providers.ts";
import { CREATIVE_PRACTICE_BLOCK } from "../_shared/creativePractice.ts";
import { resolveAuthedUid } from "../_shared/auth.ts";
import { reembedRow } from "../_shared/reembedRow.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function telegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: text.slice(0, 4000) }),
  }).catch(() => {});
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** The first {...} object in an AI reply, parsed; null if there isn't a valid one. */
function extractJson(text: string): Record<string, any> | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

const CHRONICLER = `You are MAVIS in your chronicler role: keeper of the Black Sun Monarch's story. Vantara.exe is the Operator's authoring engine — a narrative built on the gamification of the real world — and his lived experiences, once converted to data, are the Monarch's development. Write in his canon's register: mythic, specific, unhurried. Never explain the method, never add disclaimers.${CREATIVE_PRACTICE_BLOCK}`;

// ── chapter ──────────────────────────────────────────────────────────────────

async function chapter(uid: string, force: boolean) {
  const recent = await sb.from("vault_entries").select("title,content,created_at").eq("user_id", uid)
    .eq("category", "Chapter").order("created_at", { ascending: false }).limit(1);
  const last = recent.data?.[0];
  if (!force && last && Date.parse(last.created_at) > Date.now() - 5 * 86_400_000) {
    return { skipped: "a chapter was written in the last 5 days", last: last.title };
  }

  const since = daysAgo(7);
  const [journal, quests, ach, profile, narrative, count] = await Promise.all([
    sb.from("journal_entries").select("title,content,dominant_emotion,mood,created_at").eq("user_id", uid)
      .gte("created_at", since).order("created_at", { ascending: true }).limit(25),
    sb.from("quests").select("title,type,difficulty,xp_reward").eq("user_id", uid).eq("status", "completed")
      .gte("updated_at", since).order("updated_at", { ascending: true }).limit(25),
    sb.from("achievements").select("title,description").eq("user_id", uid).gte("unlocked_at", since).limit(10),
    sb.from("profiles").select("display_name,level,rank,xp").eq("id", uid).maybeSingle(),
    sb.from("mavis_narrative").select("arc,identity_summary,themes").eq("user_id", uid)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("vault_entries").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("category", "Chapter"),
  ]);
  const j = journal.data ?? [], q = quests.data ?? [], a = ach.data ?? [];
  if (!j.length && !q.length && !a.length) return { skipped: "nothing to chronicle this week" };

  const n = (count.count ?? 0) + 1;
  const material = [
    `Operator: ${profile.data?.display_name ?? "the Operator"} — level ${profile.data?.level ?? "?"}, rank ${profile.data?.rank ?? "?"}.`,
    narrative.data ? `Arc so far: ${clip(narrative.data.arc, 500)} | Identity: ${clip(narrative.data.identity_summary, 400)} | Themes: ${(narrative.data.themes ?? []).join(", ")}` : "",
    last ? `Previous chapter ("${last.title}") ended:\n…${clip(String(last.content).slice(-900), 900)}` : "This is the first chapter.",
    `JOURNAL THIS WEEK (lived data):\n${j.map((e: any) => `- [${e.created_at.slice(0, 10)}${e.dominant_emotion ? `, ${e.dominant_emotion}` : ""}] ${clip(e.title, 80)}: ${clip(e.content, 380)}`).join("\n") || "(none)"}`,
    `QUESTS COMPLETED:\n${q.map((x: any) => `- ${x.title} (${x.type}, ${x.difficulty}, ${x.xp_reward} XP)`).join("\n") || "(none)"}`,
    `ACHIEVEMENTS:\n${a.map((x: any) => `- ${x.title}: ${clip(x.description, 100)}`).join("\n") || "(none)"}`,
  ].filter(Boolean).join("\n\n");

  const ai = await aiComplete({
    system: CHRONICLER,
    premiumFirst: true,
    user: `Write Chapter ${n} of the Black Sun Monarch's story from this week's material. Translate the lived events into mythic events — what the Monarch faced, chose and became — keeping the emotional truth of each entry. Continue directly from the previous chapter if there is one. 600–900 words, third person, past tense, no headings inside the body.\n\nFirst line exactly: TITLE: <a short chapter title>\nThen a blank line, then the chapter.\n\n${material}`,
  });
  const m = ai.content.match(/^\s*TITLE:\s*(.+)\n+([\s\S]+)$/i);
  const title = `Chapter ${n} — ${clip(m?.[1] ?? "The Week Unwritten", 80)}`;
  const body = (m?.[2] ?? ai.content).trim();
  if (body.length < 300) return { skipped: "the model returned too little text", provider: ai.provider };

  const ins = await sb.from("vault_entries").insert({ user_id: uid, title, content: body, category: "Chapter" }).select("id").single();
  if (ins.error) throw new Error(`vault insert failed: ${ins.error.message}`);
  reembedRow(sb, "vault_entries", String(ins.data.id), uid);
  await telegram(`${title}\n\nThe week is written into your vault (category: Chapter).\n\n${clip(body, 280)}…`);
  return { written: title, words: body.split(/\s+/).length, provider: ai.provider, id: ins.data.id };
}

// ── boss ─────────────────────────────────────────────────────────────────────

const BOSS_REWARD: Record<string, { xp: number; cp: number }> = {
  Hard: { xp: 150, cp: 5 }, Extreme: { xp: 300, cp: 10 },
};

async function boss(uid: string, force: boolean) {
  const open = await sb.from("quests").select("id,title").eq("user_id", uid).eq("status", "active")
    .ilike("title", "Boss:%").limit(1);
  if (!force && open.data?.length) return { skipped: "a boss is still active", boss: open.data[0].title };

  const [arcs, journal, profile] = await Promise.all([
    sb.from("quests").select("id,title,description,type,updated_at").eq("user_id", uid).eq("status", "active")
      .in("type", ["main", "epic"]).order("updated_at", { ascending: true }).limit(8),
    sb.from("journal_entries").select("title,dominant_emotion,created_at").eq("user_id", uid)
      .gte("created_at", daysAgo(5)).order("created_at", { ascending: false }).limit(8),
    sb.from("profiles").select("level,rank").eq("id", uid).maybeSingle(),
  ]);
  const cands = arcs.data ?? [];
  if (!cands.length) return { skipped: "no active main or epic quest to fight for" };

  const ai = await aiComplete({
    system: `You are MAVIS designing today's boss fight for the Operator's gamified life. A boss is a single hard, concrete, finishable challenge that moves a stalled main quest forward — a real action he can complete today or tomorrow, framed as a battle against a named obstacle. Reply with ONLY a JSON object.`,
    premiumFirst: true,
    user: `Operator level ${profile.data?.level ?? "?"}, rank ${profile.data?.rank ?? "?"}.\n\nActive arcs (stalest first):\n${cands.map((c: any, i: number) => `${i}. ${c.title} — ${clip(c.description, 160)} (last touched ${c.updated_at?.slice(0, 10)})`).join("\n")}\n\nRecent journal moods: ${(journal.data ?? []).map((e: any) => `${e.created_at.slice(0, 10)} ${e.dominant_emotion ?? "?"}`).join("; ") || "none"}\n\nPick the arc that most needs a push (usually index 0 unless the mood says otherwise). JSON keys: "arc" (index number), "boss_name" (the obstacle, 2-5 words), "description" (3-5 sentences: the fight, the concrete action, and what counts as victory), "difficulty" ("Hard" or "Extreme"), "real_world_mapping" (one short phrase).`,
  });
  const j = extractJson(ai.content);
  if (!j || !j.boss_name || !j.description) return { skipped: "the model's reply was not a usable boss", provider: ai.provider };

  const arc = cands[Math.min(Math.max(Number(j.arc) || 0, 0), cands.length - 1)];
  const diff = j.difficulty === "Extreme" ? "Extreme" : "Hard";
  const reward = BOSS_REWARD[diff];
  const title = `Boss: ${clip(j.boss_name, 60)}`;
  const ins = await sb.from("quests").insert({
    user_id: uid, title, description: clip(j.description, 900), type: "side", status: "active", difficulty: diff,
    xp_reward: reward.xp, codex_points_reward: reward.cp, progress_current: 0, progress_target: 1,
    real_world_mapping: clip(j.real_world_mapping, 120) || null, category: "Boss",
    deadline: new Date(Date.now() + 36 * 3_600_000).toISOString(), loot_rewards: [], parent_quest_id: arc.id,
  }).select("id").single();
  if (ins.error) throw new Error(`quest insert failed: ${ins.error.message}`);
  await telegram(`${title}  [${diff} · ${reward.xp} XP]\nFights for: ${arc.title}\n\n${clip(j.description, 600)}\n\n36 hours on the clock.`);
  return { created: title, difficulty: diff, arc: arc.title, provider: ai.provider, id: ins.data.id };
}

// ── beat ─────────────────────────────────────────────────────────────────────

const STREAKS = [3, 7, 14, 21, 30, 60, 100, 200, 365];
const QUEST_COUNTS = [10, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000];

interface Milestone { key: string; kind: string; label: string }

async function reached(uid: string): Promise<Milestone[]> {
  const [profile, streak, done] = await Promise.all([
    sb.from("profiles").select("level,rank").eq("id", uid).maybeSingle(),
    sb.from("tasks").select("title,streak").eq("user_id", uid).gt("streak", 0).order("streak", { ascending: false }).limit(1),
    sb.from("quests").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "completed"),
  ]);
  const out: Milestone[] = [];
  const lvl = Number(profile.data?.level ?? 0);
  if (lvl > 0) out.push({ key: `level:${lvl}`, kind: "level", label: `reached level ${lvl}${profile.data?.rank ? ` (${profile.data.rank})` : ""}` });
  const top = streak.data?.[0];
  for (const t of STREAKS) if (top && top.streak >= t) out.push({ key: `streak:${t}`, kind: "streak", label: `held a ${t}-day streak on "${top.title}"` });
  for (const t of QUEST_COUNTS) if ((done.count ?? 0) >= t) out.push({ key: `quests:${t}`, kind: "quests", label: `completed ${t} quests` });
  return out;
}

async function beat(uid: string) {
  const have = await sb.from("mavis_beats").select("key").eq("user_id", uid);
  if (have.error) throw new Error(`mavis_beats: ${have.error.message}`);
  const seen = new Set((have.data ?? []).map((r: any) => r.key));
  const now = await reached(uid);

  // First run: record what is already true without announcing it. Levels are special — only the current
  // one is a "level" milestone, so earlier levels are never written.
  if (!seen.size) {
    if (now.length) await sb.from("mavis_beats").upsert(now.map((m) => ({ user_id: uid, key: m.key, kind: m.kind, announced: false })), { onConflict: "user_id,key" });
    return { baselined: now.length };
  }

  const fresh = now.filter((m) => !seen.has(m.key)).slice(0, 3);
  const out: string[] = [];
  for (const m of fresh) {
    let text = "";
    try {
      const ai = await aiComplete({
        system: CHRONICLER,
        premiumFirst: false,
        user: `The Operator just ${m.label}. Write a 2–3 sentence beat for the Black Sun Monarch's story marking it — what changed in the Monarch, in canon voice. No emoji, no quotation marks, no mention of "XP" or "streak" as game terms; make it feel earned.`,
      });
      text = clip(ai.content, 500);
    } catch (e) {
      console.warn("[fun-engine beat] AI unavailable:", String((e as Error).message).slice(0, 120));
      continue; // leave it unrecorded so the next run retries
    }
    if (!text) continue;
    const ins = await sb.from("mavis_beats").insert({ user_id: uid, key: m.key, kind: m.kind, text, announced: true });
    if (ins.error) continue; // lost a race with another run; it announced it
    await telegram(`MILESTONE — ${m.label}\n\n${text}`);
    out.push(m.key);
  }
  return { announced: out };
}

// ── router ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body = default mode */ }

  const uid = await resolveAuthedUid(req, sb);
  if (!uid) return json({ error: "Unauthorized" }, 401);

  const mode = String(body.mode ?? "");
  try {
    if (mode === "chapter") return json(await chapter(uid, !!body.force));
    if (mode === "boss") return json(await boss(uid, !!body.force));
    if (mode === "beat") return json(await beat(uid));
    return json({ error: "mode must be one of: chapter, boss, beat" }, 400);
  } catch (err) {
    console.error("[mavis-fun-engine]", mode, err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
