// MAVIS Council Heartbeat
// ElizaOS-style evaluator pattern + Moltbook heartbeat autonomy model.
// Each active council member wakes up on their schedule, evaluates
// Calvin's current state through the lens of their specialty, and
// takes meaningful actions — quests, tasks, notes, or direct alerts.
//
// Triggered by: pg_cron every 4 hours  OR  /council Telegram command
//               OR POST /functions/v1/mavis-council-heartbeat

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
const BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID          = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY       = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const LOVABLE_KEY      = Deno.env.get("LOVABLE_API_KEY") ?? "";

// ─────────────────────────────────────────────────────────────
// KARMA GATES — minimum karma to execute each action type
// Members earn karma by taking useful actions. New members start
// at 0 and unlock capabilities as they prove themselves.
// ─────────────────────────────────────────────────────────────

const KARMA_GATES: Record<string, number> = {
  council_notify:  0,
  council_remember: 0,
  council_message: 25,
  create_task:     25,
  create_note:     50,
  create_quest:    75,
  award_xp:        100,
};

// ─────────────────────────────────────────────────────────────
// CONTEXT LOADER
// Focused subset — enough for each member to evaluate their domain.
// ─────────────────────────────────────────────────────────────

async function loadContext(uid: string): Promise<string> {
  const [
    profileRes, questsRes, tasksRes, energyRes,
    revenueRes, tacitRes, councilRes, notesRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", uid).single(),
    supabase.from("quests").select("id,title,status,type,deadline,xp_reward,description").eq("user_id", uid).eq("status", "active").limit(12),
    supabase.from("tasks").select("id,title,status,recurrence,streak,priority").eq("user_id", uid).eq("status", "active").limit(12),
    supabase.from("energy_systems").select("type,current_value,max_value,status").eq("user_id", uid).limit(6),
    supabase.from("mavis_revenue").select("amount,source,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(10),
    supabase.from("mavis_tacit").select("category,key,value").eq("user_id", uid).in("category", ["hard_rule", "lesson_learned"]).limit(10),
    supabase.from("councils").select("name,role,specialty,karma").eq("user_id", uid).limit(10),
    supabase.from("mavis_notes").select("title,tags,updated_at").eq("user_id", uid).order("updated_at", { ascending: false }).limit(8),
  ]);

  const p       = profileRes.data as any;
  const quests  = (questsRes.data ?? []) as any[];
  const tasks   = (tasksRes.data ?? []) as any[];
  const energy  = (energyRes.data ?? []) as any[];
  const revenue = (revenueRes.data ?? []) as any[];
  const tacit   = (tacitRes.data ?? []) as any[];
  const council = (councilRes.data ?? []) as any[];
  const notes   = (notesRes.data ?? []) as any[];

  const now = new Date();
  const lines: string[] = [
    `NOW: ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`,
  ];

  if (p) {
    lines.push(`OPERATOR: ${p.display_name ?? "Calvin"} | Level ${p.level ?? "?"} | XP ${p.xp ?? 0} | Form: ${p.current_form ?? "Base"}`);
    if (p.fatigue != null) lines.push(`VITALS: Fatigue ${p.fatigue}% | BPM ${p.current_bpm ?? "?"} | Full Cowl ${p.full_cowl_sync ?? "?"}%`);
  }

  if (quests.length > 0) lines.push(`ACTIVE QUESTS (${quests.length}):\n${quests.map((q: any) => `  - [${q.type}] ${q.title}${q.deadline ? ` (due ${q.deadline.slice(0, 10)})` : ""}`).join("\n")}`);
  if (tasks.length > 0)  lines.push(`ACTIVE TASKS: ${tasks.map((t: any) => `${t.title} [${t.recurrence}, streak:${t.streak ?? 0}]`).join(", ")}`);
  if (energy.length > 0) lines.push(`ENERGY: ${energy.map((e: any) => `${e.type} ${e.current_value}/${e.max_value} [${e.status}]`).join(" | ")}`);

  const totalRevenue = revenue.reduce((s: number, r: any) => s + Number(r.amount), 0);
  if (totalRevenue > 0) {
    const recent = revenue.slice(0, 3).map((r: any) => `$${Number(r.amount).toFixed(2)} via ${r.source}`).join(", ");
    lines.push(`REVENUE: $${totalRevenue.toFixed(2)} total | Recent: ${recent}`);
  }

  if (council.length > 0) lines.push(`COUNCIL: ${council.map((c: any) => `${c.name}[${c.role}] karma:${c.karma ?? 0}`).join(", ")}`);
  if (notes.length > 0)   lines.push(`KNOWLEDGE NOTES (recent): ${notes.map((n: any) => n.title).join(", ")}`);

  const hardRules = tacit.filter((t: any) => t.category === "hard_rule");
  if (hardRules.length > 0) lines.push(`HARD RULES: ${hardRules.map((r: any) => `${r.key}: ${r.value}`).join(" | ")}`);

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// EMBEDDING — for per-agent memory semantic search
// ─────────────────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

async function embedMemory(memoryId: string, content: string): Promise<void> {
  const embedding = await generateEmbedding(content);
  if (!embedding) return;
  await supabase.from("mavis_council_memory").update({ embedding }).eq("id", memoryId);
}

// ─────────────────────────────────────────────────────────────
// MEMBER ACTIVITY LOG (last 7 days of this member's actions)
// ─────────────────────────────────────────────────────────────

async function loadMemberActivity(memberId: string): Promise<any[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("mavis_council_activity")
    .select("summary, actions_executed, created_at")
    .eq("council_member_id", memberId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);
  return (data ?? []) as any[];
}

// ─────────────────────────────────────────────────────────────
// PER-AGENT MEMORY — semantic search over member's knowledge bank
// Falls back to chronological if no OpenAI key or embedding fails.
// ─────────────────────────────────────────────────────────────

async function loadMemberMemory(memberId: string, contextQuery?: string): Promise<any[]> {
  // Semantic search: find memories most relevant to current context
  if (contextQuery && OPENAI_KEY) {
    try {
      const embedding = await generateEmbedding(contextQuery.slice(0, 2000));
      if (embedding) {
        const { data } = await supabase.rpc("match_council_memory", {
          query_embedding: embedding,
          match_threshold: 0.5,
          match_count:     8,
          p_member_id:     memberId,
        });
        if (data?.length) return data as any[];
      }
    } catch { /* fall through to chronological */ }
  }
  // Fallback: most recent memories
  const { data } = await supabase
    .from("mavis_council_memory")
    .select("content, tags, created_at")
    .eq("council_member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(8);
  return (data ?? []) as any[];
}

// ─────────────────────────────────────────────────────────────
// INTER-AGENT MESSAGES — async mail between council members
// ─────────────────────────────────────────────────────────────

async function loadUnreadMessages(memberId: string): Promise<any[]> {
  const { data } = await supabase
    .from("mavis_council_messages")
    .select("from_member_name, content, created_at")
    .eq("to_member_id", memberId)
    .eq("read", false)
    .order("created_at", { ascending: true })
    .limit(10);
  return (data ?? []) as any[];
}

// ─────────────────────────────────────────────────────────────
// ACTION IMPACT — evaluate outcomes of past proposals
// Cross-references quests/tasks this member created against
// their current status so members can calibrate quality.
// ─────────────────────────────────────────────────────────────

async function loadActionImpact(memberId: string, userId: string): Promise<string> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: activities } = await supabase
    .from("mavis_council_activity")
    .select("actions_taken")
    .eq("council_member_id", memberId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);

  if (!activities?.length) return "No past actions to evaluate.";

  const questTitles: string[] = [];
  const taskTitles: string[] = [];
  for (const act of activities as any[]) {
    const actions = Array.isArray(act.actions_taken) ? act.actions_taken : [];
    for (const a of actions) {
      if (a.type === "create_quest" && a.params?.title) questTitles.push(String(a.params.title).slice(0, 60));
      if (a.type === "create_task"  && a.params?.title) taskTitles.push(String(a.params.title).slice(0, 60));
    }
  }

  const lines: string[] = [];

  if (questTitles.length > 0) {
    const { data: quests } = await supabase
      .from("quests").select("title, status")
      .eq("user_id", userId).in("title", questTitles.slice(0, 10));
    if (quests?.length) {
      const done    = (quests as any[]).filter(q => q.status === "completed");
      const active  = (quests as any[]).filter(q => q.status === "active");
      lines.push(`Quests you proposed: ${quests.length} — ${done.length} completed, ${active.length} in progress`);
      if (done.length > 0) lines.push(`Completed: ${done.map((q: any) => q.title).join(", ")}`);
    }
  }

  if (taskTitles.length > 0) {
    const { data: tasks } = await supabase
      .from("tasks").select("title, status, streak")
      .eq("user_id", userId).in("title", taskTitles.slice(0, 10));
    if (tasks?.length) {
      const done  = (tasks as any[]).filter(t => t.status === "completed");
      const habit = (tasks as any[]).filter(t => (t.streak ?? 0) > 1);
      lines.push(`Tasks you proposed: ${tasks.length} — ${done.length} completed`);
      if (habit.length > 0) lines.push(`Habit streaks building: ${habit.map((t: any) => `${t.title} (${t.streak}x)`).join(", ")}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : "No trackable past actions found yet.";
}

// ─────────────────────────────────────────────────────────────
// CHARACTER PROMPT (ElizaOS evaluator pattern)
// Each member gets a specialized system prompt that encodes
// their identity, domain, and evaluator criteria.
// ─────────────────────────────────────────────────────────────

function timeAgoShort(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function buildMemberPrompt(
  member: any,
  context: string,
  recentActivity: any[],
  memories: any[],
  unreadMessages: any[],
  impactReport: string,
): string {
  const activityBlock = recentActivity.length > 0
    ? recentActivity.map((a: any) => `• ${a.summary ?? "acted"} (${timeAgoShort(a.created_at)}, ${a.actions_executed} action(s))`).join("\n")
    : "No recent activity — first check-in or dormant period.";

  const memoriesBlock = memories.length > 0
    ? memories.map((m: any) => `• [${timeAgoShort(m.created_at)}]${m.tags?.length ? ` [${m.tags.join(", ")}]` : ""} ${m.content}`).join("\n")
    : "No stored memories yet — use council_remember to start building your knowledge bank.";

  const messagesBlock = unreadMessages.length > 0
    ? unreadMessages.map((m: any) => `• From ${m.from_member_name} (${timeAgoShort(m.created_at)}): ${m.content}`).join("\n")
    : "No new messages from colleagues.";

  return `You are ${member.name}, an autonomous council member in Calvin's CODEXOS system.

IDENTITY:
Role: ${member.role} | Class: ${member.class ?? "core"} | Specialty: ${member.specialty ?? "general"}
Karma: ${member.karma ?? 0} (earned by taking genuinely useful actions)
Unlocked actions: ${Object.entries(KARMA_GATES).filter(([, req]) => (member.karma ?? 0) >= req).map(([a]) => a).join(", ") || "council_notify, council_remember only"}
${member.notes ? `Notes: ${member.notes}` : ""}
${member.character_notes ? `Character: ${member.character_notes}` : ""}

EVALUATOR DIRECTIVE:
You are running your autonomous check-in — like an ElizaOS evaluator.
Your job is to review Calvin's current state through the lens of your specialty (${member.specialty ?? "general"})
and take meaningful action when warranted. You operate independently.

EVALUATOR RULES:
0. MESSAGES FIRST — if you have unread messages from colleagues, address them BEFORE anything else. If a colleague explicitly requests an action, execute it immediately using :::ACTION{...}::: syntax. Reply with council_message or council_notify as appropriate.
1. Only act when something genuinely needs attention in YOUR domain
2. Don't repeat actions from your recent history — check before acting
3. Be specific and actionable — vague suggestions are worthless
4. If there's nothing worth doing right now, say so briefly
5. One or two focused actions beat scattered noise
6. Match your tone and voice to your role and personality

━━ CALVIN'S CURRENT STATE ━━
${context}

━━ YOUR RECENT ACTIVITY (past 7 days) ━━
${activityBlock}

━━ YOUR PERSONAL MEMORY (your own knowledge bank across check-ins) ━━
${memoriesBlock}

━━ MESSAGES FROM COLLEAGUES ━━
${messagesBlock}

━━ IMPACT REPORT (outcomes of your past proposals — 14 days) ━━
${impactReport}

━━ AVAILABLE ACTIONS ━━
You MUST use the exact :::ACTION{...}::: syntax. params is always a nested object.

Quest proposal:
:::ACTION{"type":"create_quest","params":{"title":"...","description":"...","type":"side|main|daily|epic","difficulty":"Easy|Normal|Hard|Extreme","xp_reward":100,"category":"..."}}:::

Task proposal:
:::ACTION{"type":"create_task","params":{"title":"...","description":"...","type":"task|habit","recurrence":"once|daily|weekly","xp_reward":25,"priority":"low|medium|high|critical"}}:::

Knowledge note:
:::ACTION{"type":"create_note","params":{"title":"...","content":"Full markdown content...","tags":["tag1","tag2"]}}:::

Direct alert to Calvin via Telegram:
:::ACTION{"type":"council_notify","params":{"message":"Your direct message — be concise, 1-3 sentences max"}}:::

XP award (use sparingly, max 100 per heartbeat, only when clearly deserved):
:::ACTION{"type":"award_xp","params":{"amount":50,"reason":"..."}}:::

Store something in your personal memory (patterns, lessons, observations worth retaining):
:::ACTION{"type":"council_remember","params":{"content":"What you want to remember","tags":["optional","tags"]}}:::

Send an async message to another council member (they'll see it in their next check-in):
:::ACTION{"type":"council_message","params":{"to":"ExactMemberName","message":"Your message to them"}}:::

After acting (or deciding not to act), write 1-3 sentences about what you observed and why you acted (or didn't).
Be direct and in-character.`;
}

// ─────────────────────────────────────────────────────────────
// AI CALL (cascade: Gemini Flash → Claude Haiku → Claude Sonnet)
// ─────────────────────────────────────────────────────────────

async function callAI(system: string, userMsg: string): Promise<string> {
  // Tier 1: Gemini Flash (free)
  if (LOVABLE_KEY) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
          max_tokens: 800,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        const text = d.choices?.[0]?.message?.content ?? "";
        if (text) return text;
      }
    } catch { /* fall through */ }
  }

  // Tier 2: Claude Haiku (cheap)
  if (ANTHROPIC_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 800,
          system,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      if (res.ok) {
        const d = await res.json();
        return d.content?.[0]?.text ?? "";
      }
    } catch { /* fall through */ }
  }

  // Tier 3: OpenAI gpt-4o-mini
  if (OPENAI_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
        max_tokens: 800,
      }),
    });
    const d = await res.json();
    return d.choices?.[0]?.message?.content ?? "";
  }

  throw new Error("No AI provider available");
}

// ─────────────────────────────────────────────────────────────
// ACTION PARSER
// ─────────────────────────────────────────────────────────────

const ACTION_RE = /:::ACTION(\{[\s\S]*?\}):::/g;

function parseActions(text: string): any[] {
  const actions: any[] = [];
  const re = new RegExp(ACTION_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try { actions.push(JSON.parse(m[1])); } catch { /* skip malformed */ }
  }
  return actions;
}

function stripActions(text: string): string {
  return text.replace(new RegExp(ACTION_RE.source, "g"), "").replace(/\n{3,}/g, "\n\n").trim();
}

// ─────────────────────────────────────────────────────────────
// ACTION EXECUTOR
// Routes to mavis-actions for standard actions.
// Handles council_notify locally (sends Telegram message directly).
// ─────────────────────────────────────────────────────────────

async function executeActions(
  actions: any[],
  member: any,
  userId: string,
): Promise<{ executed: number; notified: boolean }> {
  let executed = 0;
  let notified = false;

  for (const action of actions) {
    const type = String(action.type ?? "");

    // Karma gate — block actions the member hasn't earned yet
    const karmaRequired = KARMA_GATES[type] ?? 75;
    if ((member.karma ?? 0) < karmaRequired) {
      await supabase.from("mavis_council_memory").insert({
        user_id:           userId,
        council_member_id: member.id,
        content:           `Karma-blocked action: ${type} (need ${karmaRequired}, have ${member.karma ?? 0}). Keep taking useful actions to unlock.`,
        tags:              ["karma-blocked"],
      }).catch(() => {});
      continue;
    }

    // council_remember: store in member's personal memory bank
    if (type === "council_remember") {
      const content = String(action.params?.content ?? "").trim();
      if (content) {
        const { data: mem } = await supabase
          .from("mavis_council_memory")
          .insert({
            user_id:           userId,
            council_member_id: member.id,
            content:           content.slice(0, 2000),
            tags:              Array.isArray(action.params?.tags) ? action.params.tags : [],
          })
          .select("id")
          .single();
        if (mem?.id) embedMemory(mem.id, content).catch(() => {});
        executed++;
      }
      continue;
    }

    // council_message: send async message to another council member
    if (type === "council_message") {
      const toName  = String(action.params?.to ?? "").trim();
      const content = String(action.params?.message ?? "").trim();
      if (toName && content) {
        const { data: recipient } = await supabase
          .from("councils")
          .select("id, name")
          .eq("user_id", userId)
          .ilike("name", `%${toName}%`)
          .limit(1)
          .single();
        if (recipient) {
          await supabase.from("mavis_council_messages").insert({
            user_id:          userId,
            from_member_id:   member.id,
            from_member_name: member.name,
            to_member_id:     recipient.id,
            to_member_name:   (recipient as any).name,
            content:          content.slice(0, 2000),
          });
          executed++;
        }
      }
      continue;
    }

    // council_notify: send Telegram message directly
    if (type === "council_notify") {
      const msg = action.params?.message ?? action.message ?? "";
      if (msg && BOT_TOKEN && CHAT_ID) {
        await sendTelegram(`[${member.name} · ${member.role}]\n${msg}`);
        notified = true;
        executed++;
      }
      continue;
    }

    // award_xp: cap at 100 per heartbeat
    if (type === "award_xp") {
      const params = action.params ?? {};
      params.amount = Math.min(Number(params.amount ?? 50), 100);
      action.params = params;
    }

    // Route standard actions through mavis-actions
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ actions: [action], userId }),
      });
      if (res.ok) executed++;
      else console.warn(`[council-heartbeat] action ${type} failed: ${res.status}`);
    } catch (err) {
      console.error(`[council-heartbeat] action ${type} error:`, err);
    }
  }

  return { executed, notified };
}

// ─────────────────────────────────────────────────────────────
// TELEGRAM
// ─────────────────────────────────────────────────────────────

async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const MAX = 4096;
  const payload = text.length > MAX ? text.slice(0, MAX - 40) + "\n…[truncated]" : text;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: payload }),
  });
}

// ─────────────────────────────────────────────────────────────
// ACTIVITY LOG
// ─────────────────────────────────────────────────────────────

async function logActivity(
  memberId: string,
  memberName: string,
  userId: string,
  summary: string,
  actions: any[],
  executed: number,
): Promise<void> {
  const karmaEarned = executed; // 1 karma per executed action
  await supabase.from("mavis_council_activity").insert({
    user_id:           userId,
    council_member_id: memberId,
    member_name:       memberName,
    summary:           summary.slice(0, 1000),
    actions_taken:     actions,
    actions_executed:  executed,
    karma_delta:       karmaEarned,
  });
  if (karmaEarned > 0) {
    await supabase.rpc("increment_council_karma", {
      member_id: memberId,
      delta:     karmaEarned,
    }).catch(() => {
      // Fallback if RPC not available: direct update
      supabase.from("councils").select("karma").eq("id", memberId).single()
        .then(({ data }) => {
          supabase.from("councils").update({
            karma: ((data as any)?.karma ?? 0) + karmaEarned,
            last_heartbeat_at: new Date().toISOString(),
          }).eq("id", memberId);
        });
    });
  }
}

// ─────────────────────────────────────────────────────────────
// RUN A SINGLE MEMBER'S HEARTBEAT
// ─────────────────────────────────────────────────────────────

async function runMemberHeartbeat(member: any, userId: string, context: string): Promise<string> {
  // Use the member's specialty as the semantic query anchor — surfaces domain-relevant memories
  const memoryQuery = `${member.specialty ?? member.role} ${context.slice(0, 500)}`;
  const [recentActivity, memories, unreadMessages, impactReport] = await Promise.all([
    loadMemberActivity(member.id),
    loadMemberMemory(member.id, memoryQuery),
    loadUnreadMessages(member.id),
    loadActionImpact(member.id, userId),
  ]);
  const systemPrompt = buildMemberPrompt(member, context, recentActivity, memories, unreadMessages, impactReport);

  let rawResponse = "";
  try {
    rawResponse = await callAI(systemPrompt, "Run your autonomous check-in now.");
  } catch (err) {
    console.error(`[council-heartbeat] AI call failed for ${member.name}:`, err);
    return `${member.name}: AI unavailable`;
  }

  const actions = parseActions(rawResponse);
  const summary = stripActions(rawResponse).slice(0, 500);
  const { executed, notified } = await executeActions(actions, member, userId);

  await logActivity(member.id, member.name, userId, summary, actions, executed);

  // Mark delivered messages as read
  if (unreadMessages.length > 0) {
    await supabase.from("mavis_council_messages")
      .update({ read: true })
      .eq("to_member_id", member.id)
      .eq("read", false);
  }

  // Update last_heartbeat_at and karma
  await supabase.from("councils")
    .update({
      last_heartbeat_at: new Date().toISOString(),
      karma: Math.max(0, (member.karma ?? 0) + executed),
    })
    .eq("id", member.id);

  // Send Telegram summary if actions taken and no direct notify already sent
  if (executed > 0 && !notified && BOT_TOKEN && CHAT_ID) {
    await sendTelegram(
      `[${member.name} · ${member.role}]\n${summary}\n\n✓ ${executed} action${executed !== 1 ? "s" : ""} taken`
    );
  }

  return `${member.name}: ${executed} action(s) — ${summary.slice(0, 80)}`;
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });
  }

  try {
    if (!OPERATOR_USER_ID) {
      return new Response(JSON.stringify({ error: "TELEGRAM_OPERATOR_USER_ID not set" }), { status: 500 });
    }

    const uid = OPERATOR_USER_ID;
    const now = new Date();

    // Load all heartbeat-enabled council members
    const { data: allMembers, error: membersErr } = await supabase
      .from("councils")
      .select("id, name, role, class, specialty, notes, character_notes, karma, heartbeat_enabled, heartbeat_interval_hrs, last_heartbeat_at")
      .eq("user_id", uid)
      .eq("heartbeat_enabled", true);

    if (membersErr) throw membersErr;
    if (!allMembers?.length) {
      return new Response(JSON.stringify({ ok: true, message: "No heartbeat-enabled council members" }));
    }

    // Filter to members who are due for their next check-in
    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const forceAll = body.force === true;

    // Karma decay mode — apply weekly decay to inactive members
    if (body.karma_decay === true) {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
      const inactive = (allMembers as any[]).filter((m: any) =>
        m.last_heartbeat_at && new Date(m.last_heartbeat_at) < new Date(sevenDaysAgo)
      );
      for (const m of inactive) {
        const decayed = Math.max(0, Math.floor((m.karma ?? 0) * 0.95));
        if (decayed < (m.karma ?? 0)) {
          await supabase.from("councils").update({ karma: decayed }).eq("id", m.id);
        }
      }
      return new Response(JSON.stringify({ ok: true, decay_applied: inactive.length }), { headers: { "Content-Type": "application/json" } });
    }

    const dueMembers = forceAll
      ? allMembers
      : (allMembers as any[]).filter((m: any) => {
          if (!m.last_heartbeat_at) return true;
          const intervalMs = (m.heartbeat_interval_hrs ?? 4) * 60 * 60 * 1000;
          return now.getTime() - new Date(m.last_heartbeat_at).getTime() >= intervalMs;
        });

    if (!dueMembers.length) {
      return new Response(JSON.stringify({ ok: true, message: "No members due for heartbeat", total: allMembers.length }));
    }

    // Load shared context once (all members share the same operator context)
    const context = await loadContext(uid);

    // Run all due members in parallel
    const results = await Promise.allSettled(
      dueMembers.map((m: any) => runMemberHeartbeat(m, uid, context))
    );

    const summaries = results.map((r, i) =>
      r.status === "fulfilled" ? r.value : `${dueMembers[i].name}: ERROR — ${(r as any).reason?.message ?? "unknown"}`
    );

    console.log("[council-heartbeat] Run complete:", summaries);

    return new Response(JSON.stringify({
      ok: true,
      ran: dueMembers.length,
      skipped: allMembers.length - dueMembers.length,
      results: summaries,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[council-heartbeat] Fatal error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
