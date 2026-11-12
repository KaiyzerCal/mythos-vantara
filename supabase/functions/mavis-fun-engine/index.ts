// mavis-fun-engine — the game layer of Vantara.exe, written for the Operator-as-author premise.
//
// Modes (POST { mode, ... }):
//   chapter  weekly: turns the week's journal, quests, achievements and emotions into the next chapter of the
//            Black Sun Monarch's story and files it in the vault (category "Chapter"). Skips if one was written in
//            the last 5 days unless { force: true }, or if there is nothing to chronicle.
//   boss     daily: generates ONE boss fight linked to the stalest main/epic quest, with loot and a buff drop.
//            Difficulty tunes itself from how the last bosses went (wins step it up, losses step it down).
//            Overdue bosses are closed as failed (no penalty) so the next one can arrive. Skips while one is live.
//   status   every 6h: reads the last 72h (journal emotions, chat, quest wins and losses) and may apply up to two
//            short-lived buffs/debuffs to the character's status effects (mavis_domain_effects, source
//            "mavis-auto"). Debuffs are mild, expire in <= 48h and always name a way to lift them.
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
    .eq("category", "chapter").order("created_at", { ascending: false }).limit(1);
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
    sb.from("vault_entries").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("category", "chapter"),
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

  const ins = await sb.from("vault_entries").insert({ user_id: uid, title, content: body, category: "chapter" }).select("id").single();
  if (ins.error) throw new Error(`vault insert failed: ${ins.error.message}`);
  reembedRow(sb, "vault_entries", String(ins.data.id), uid);
  await telegram(`${title}\n\nThe week is written into your vault (Vault, category: chapter).\n\n${clip(body, 280)}…`);
  return { written: title, words: body.split(/\s+/).length, provider: ai.provider, id: ins.data.id };
}

// ── boss ─────────────────────────────────────────────────────────────────────

const TIERS = ["Normal", "Hard", "Extreme"] as const;
type Tier = typeof TIERS[number];
const BOSS_REWARD: Record<Tier, { xp: number; cp: number; rarity: string }> = {
  Normal: { xp: 80, cp: 3, rarity: "uncommon" },
  Hard: { xp: 150, cp: 5, rarity: "rare" },
  Extreme: { xp: 300, cp: 10, rarity: "epic" },
};

/** Next tier from the last few finished bosses: 2+ wins and no loss steps up, 2+ losses steps down. */
function tuneTier(finished: { difficulty: string; status: string }[]): { tier: Tier; why: string } {
  const last = finished[0];
  const idx = Math.max(0, TIERS.indexOf((last?.difficulty ?? "Hard") as Tier));
  const recent = finished.slice(0, 3);
  if (recent.length < 2) return { tier: TIERS[idx === -1 ? 1 : idx], why: "not enough history yet" };
  const wins = recent.filter((q) => q.status === "completed").length;
  const losses = recent.length - wins;
  if (wins >= 2 && losses === 0 && idx < 2) return { tier: TIERS[idx + 1], why: `${wins} wins in a row` };
  if (losses >= 2 && idx > 0) return { tier: TIERS[idx - 1], why: `${losses} of the last ${recent.length} bosses slipped` };
  return { tier: TIERS[idx], why: "holding steady" };
}

async function boss(uid: string, force: boolean) {
  // Close overdue bosses (deadline + 12h grace). Failing has no penalty here — same as the app's failQuest.
  const open = await sb.from("quests").select("id,title,deadline").eq("user_id", uid).eq("status", "active")
    .ilike("title", "Boss:%");
  const live: { id: string; title: string }[] = [];
  for (const q of open.data ?? []) {
    if (q.deadline && Date.parse(q.deadline) + 12 * 3_600_000 < Date.now()) {
      await sb.from("quests").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", q.id).eq("user_id", uid);
    } else live.push(q);
  }
  if (!force && live.length) return { skipped: "a boss is still active", boss: live[0].title };

  const [arcs, journal, profile, finished] = await Promise.all([
    sb.from("quests").select("id,title,description,type,updated_at").eq("user_id", uid).eq("status", "active")
      .in("type", ["main", "epic"]).not("title", "ilike", "Boss:%").order("updated_at", { ascending: true }).limit(8),
    sb.from("journal_entries").select("title,dominant_emotion,created_at").eq("user_id", uid)
      .gte("created_at", daysAgo(5)).order("created_at", { ascending: false }).limit(8),
    sb.from("profiles").select("level,rank").eq("id", uid).maybeSingle(),
    sb.from("quests").select("difficulty,status").eq("user_id", uid).ilike("title", "Boss:%")
      .in("status", ["completed", "failed"]).order("updated_at", { ascending: false }).limit(6),
  ]);
  const cands = arcs.data ?? [];
  if (!cands.length) return { skipped: "no active main or epic quest to fight for" };

  const { tier, why } = tuneTier((finished.data ?? []) as any[]);
  const reward = BOSS_REWARD[tier];

  const ai = await aiComplete({
    system: `You are MAVIS designing today's boss fight for the Operator's gamified life. A boss is a single concrete, finishable challenge that moves a stalled main quest forward — a real action he can complete in a day or two, framed as a battle against a named obstacle. Reply with ONLY a JSON object.`,
    premiumFirst: true,
    user: `Operator level ${profile.data?.level ?? "?"}, rank ${profile.data?.rank ?? "?"}. Today's tier is ${tier} (${why}) — scale the size of the action to that tier: Normal is one focused sitting, Hard is a demanding half-day, Extreme is a day-long push.\n\nActive arcs (stalest first):\n${cands.map((c: any, i: number) => `${i}. ${c.title} — ${clip(c.description, 160)} (last touched ${c.updated_at?.slice(0, 10)})`).join("\n")}\n\nRecent journal moods: ${(journal.data ?? []).map((e: any) => `${e.created_at.slice(0, 10)} ${e.dominant_emotion ?? "?"}`).join("; ") || "none"}\n\nPick the arc that most needs a push (usually index 0 unless the mood says otherwise). JSON keys: "arc" (index number), "boss_name" (the obstacle, 2-5 words), "description" (3-5 sentences: the fight, the concrete action, what counts as victory), "real_world_mapping" (one short phrase), "loot_name" (a canon-flavored item the victory yields, 2-4 words), "buff_label" (a short boon name, 1-3 words), "buff_value" (number 3-10, a percent).`,
  });
  const j = extractJson(ai.content);
  if (!j || !j.boss_name || !j.description) return { skipped: "the model's reply was not a usable boss", provider: ai.provider };

  const arc = cands[Math.min(Math.max(Number(j.arc) || 0, 0), cands.length - 1)];
  const title = `Boss: ${clip(j.boss_name, 60)}`;
  const loot = j.loot_name ? [{ itemName: clip(j.loot_name, 60), quantity: 1, rarity: reward.rarity }] : [];
  const buffs = j.buff_label
    ? [{ label: clip(j.buff_label, 40), value: Math.min(Math.max(Number(j.buff_value) || 5, 3), 10), unit: "%", duration: "24 hours" }]
    : [];
  const ins = await sb.from("quests").insert({
    user_id: uid, title, description: clip(j.description, 900), type: "side", status: "active", difficulty: tier,
    xp_reward: reward.xp, codex_points_reward: reward.cp, progress_current: 0, progress_target: 1,
    real_world_mapping: clip(j.real_world_mapping, 120) || null, category: "Boss",
    deadline: new Date(Date.now() + 36 * 3_600_000).toISOString(), loot_rewards: loot, buff_effects: buffs,
    parent_quest_id: arc.id,
  }).select("id").single();
  if (ins.error) throw new Error(`quest insert failed: ${ins.error.message}`);
  await telegram(`${title}  [${tier} · ${reward.xp} XP]\nFights for: ${arc.title}\n\n${clip(j.description, 600)}\n\nSpoils: ${loot[0]?.itemName ?? "—"} (${reward.rarity})${buffs[0] ? ` · ${buffs[0].label} +${buffs[0].value}%` : ""}\n36 hours on the clock.`);
  return { created: title, tier, tuned: why, arc: arc.title, loot: loot[0]?.itemName, buff: buffs[0]?.label, provider: ai.provider, id: ins.data.id };
}

// ── status ───────────────────────────────────────────────────────────────────

const STAT_LABELS = ["STR", "AGI", "VIT", "INT", "WIS", "CHA", "LCK"];

async function status(uid: string) {
  const nowIso = new Date().toISOString();
  // Keep the sheet truthful: auto effects whose time is up are switched off (the Character page also ignores
  // expired effects of any source).
  await sb.from("mavis_domain_effects").update({ is_active: false }).eq("user_id", uid).eq("source", "mavis-auto")
    .eq("is_active", true).lt("expires_at", nowIso);

  const since = daysAgo(3);
  const [live, journal, chat, won, lost, profile] = await Promise.all([
    sb.from("mavis_domain_effects").select("name,source,expires_at").eq("user_id", uid).eq("is_active", true),
    sb.from("journal_entries").select("title,content,dominant_emotion,mood,created_at").eq("user_id", uid)
      .gte("created_at", since).order("created_at", { ascending: false }).limit(10),
    sb.from("chat_messages").select("content,created_at").eq("user_id", uid).eq("role", "user")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(14),
    sb.from("quests").select("title,difficulty").eq("user_id", uid).eq("status", "completed").gte("updated_at", since).limit(12),
    sb.from("quests").select("title").eq("user_id", uid).eq("status", "failed").gte("updated_at", since).limit(8),
    sb.from("profiles").select("level,rank").eq("id", uid).maybeSingle(),
  ]);
  const j = journal.data ?? [], c = chat.data ?? [], w = won.data ?? [], l = lost.data ?? [];
  if (!j.length && !c.length && !w.length && !l.length) return { skipped: "no new data in the last 72h" };
  const auto = (live.data ?? []).filter((e: any) => e.source === "mavis-auto");
  if (auto.length >= 3) return { skipped: "three auto-applied effects are already active", active: auto.map((e: any) => e.name) };

  const ai = await aiComplete({
    system: `You are MAVIS reading the Operator's recent life-data as the system that governs his character sheet in Vantara.exe (a gamified-life engine; the character is the Black Sun Monarch). Decide whether the data clearly supports a temporary STATUS EFFECT. Rules: only when the data plainly shows it — an empty list is a normal, good answer; at most 2 effects; a buff for real momentum or a good streak of wins, a debuff for sustained strain (e.g. several low days, a run of slipped quests) or a clear spike of a hard emotion; debuffs are mild (-3 to -8 %), expire within 48 hours, and are framed in game terms, never as a diagnosis; every effect's description must end with one concrete way to lift or earn it ("Lifted by: ..."). Never invent facts. Reply with ONLY JSON: {"effects":[{"name","kind":"buff"|"debuff","description","stat":"${STAT_LABELS.join("|")}","value":<number>,"hours":<number>}]}.${CREATIVE_PRACTICE_BLOCK}`,
    premiumFirst: false,
    user: `Operator level ${profile.data?.level ?? "?"}, rank ${profile.data?.rank ?? "?"}.\nAlready active: ${(live.data ?? []).map((e: any) => e.name).join(", ") || "none"} — do not duplicate these.\n\nJOURNAL (72h):\n${j.map((e: any) => `- [${e.created_at.slice(5, 10)}${e.dominant_emotion ? `, ${e.dominant_emotion}` : ""}${e.mood ? `, mood ${e.mood}` : ""}] ${clip(e.title, 60)}: ${clip(e.content, 220)}`).join("\n") || "(none)"}\n\nWHAT HE SAID TO MAVIS (72h):\n${c.map((m: any) => `- ${clip(m.content, 200)}`).join("\n") || "(none)"}\n\nQUESTS WON: ${w.map((q: any) => `${q.title} (${q.difficulty})`).join("; ") || "none"}\nQUESTS SLIPPED: ${l.map((q: any) => q.title).join("; ") || "none"}`,
  });
  const parsed = extractJson(ai.content);
  const list: any[] = Array.isArray(parsed?.effects) ? parsed!.effects.slice(0, 2) : [];
  const have = new Set((live.data ?? []).map((e: any) => String(e.name).toLowerCase()));
  const made: string[] = [];
  for (const e of list) {
    const name = clip(e?.name, 60);
    const stat = String(e?.stat ?? "").toUpperCase();
    if (!name || have.has(name.toLowerCase()) || !STAT_LABELS.includes(stat)) continue;
    const buff = e.kind === "buff";
    const mag = Math.min(Math.abs(Number(e.value) || 5), buff ? 10 : 8);
    const hours = Math.min(Math.max(Number(e.hours) || 24, 6), buff ? 72 : 48);
    const ins = await sb.from("mavis_domain_effects").insert({
      user_id: uid, name, description: clip(e.description, 400), effect_type: buff ? "aura" : "curse", source: "mavis-auto",
      stat_modifiers: [{ label: stat, value: buff ? mag : -mag, unit: "%" }], area_effects: [], is_active: true,
      expires_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
    });
    if (ins.error) continue;
    made.push(`${buff ? "BUFF" : "DEBUFF"} ${name} (${stat} ${buff ? "+" : "-"}${mag}%, ${hours}h)`);
  }
  if (made.length) await telegram(`STATUS UPDATE\n\n${made.join("\n")}\n\nSee your Character sheet.`);
  return { applied: made, provider: ai.provider };
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
    if (mode === "status") return json(await status(uid));
    return json({ error: "mode must be one of: chapter, boss, beat, status" }, 400);
  } catch (err) {
    console.error("[mavis-fun-engine]", mode, err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
