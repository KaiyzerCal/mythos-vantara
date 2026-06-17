// mavis-telegram-bot — Telegram webhook receiver for mobile MAVIS access.
//
// Setup (one-time, paste in terminal after deploying):
//   curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
//     -d "url=${SUPABASE_URL}/functions/v1/mavis-telegram-bot" \
//     -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
//     -d "allowed_updates=[\"message\"]"
//
// Required env vars:
//   TELEGRAM_BOT_TOKEN          — from @BotFather
//   TELEGRAM_OPERATOR_CHAT_ID   — your Telegram chat ID (security gate)
//   TELEGRAM_WEBHOOK_SECRET     — any random string, set in setWebhook + Supabase secrets
//   MAVIS_OPERATOR_MAIN_ID      — Supabase user UUID for Calvin (task ownership)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const BOT_TOKEN       = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const OPERATOR_CHAT   = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const WEBHOOK_SECRET  = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const OPERATOR_UID    = Deno.env.get("MAVIS_OPERATOR_MAIN_ID") ?? "";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY   = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ─────────────────────────────────────────────────────────────
// TELEGRAM API
// ─────────────────────────────────────────────────────────────

async function tg(method: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return res.json().catch(() => ({}));
}

async function send(chatId: string | number, text: string, extra: Record<string, unknown> = {}) {
  return tg("sendMessage", { chat_id: chatId, text: text.slice(0, 4096), parse_mode: "Markdown", ...extra });
}

async function sendPhoto(chatId: string | number, photoUrl: string, caption?: string) {
  return tg("sendPhoto", { chat_id: chatId, photo: photoUrl, caption: caption?.slice(0, 1024) ?? "" });
}

async function typing(chatId: string | number) {
  return tg("sendChatAction", { chat_id: chatId, action: "typing" });
}

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

async function callFunction(name: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
}

async function queueTask(
  type: string,
  description: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const { data } = await sb
    .from("mavis_tasks")
    .insert({ user_id: OPERATOR_UID, type, description, payload, status: "pending" })
    .select("id")
    .single()
    .catch(() => ({ data: null }));
  return (data as any)?.id ?? null;
}

async function callClaude(system: string, user: string, maxTokens = 800): Promise<string> {
  if (!ANTHROPIC_KEY) return "(ANTHROPIC_API_KEY not set)";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return "";
  const d = await res.json();
  return d?.content?.[0]?.text ?? "";
}

// ─────────────────────────────────────────────────────────────
// INTENT CLASSIFICATION
// ─────────────────────────────────────────────────────────────

type Intent =
  | "help"
  | "image"
  | "tweet"
  | "content_machine"
  | "daily_brief"
  | "goal"
  | "quests"
  | "revenue"
  | "tasks"
  | "chat";

interface Classified {
  intent: Intent;
  params: Record<string, string>;
  subject?: string;
}

async function classify(text: string): Promise<Classified> {
  const lower = text.toLowerCase().trim();

  // Hard-coded shortcuts for speed (no LLM needed)
  if (/^\/?(help|commands?)$/i.test(lower)) return { intent: "help", params: {} };
  if (/^\/?(brief|status|morning|daily)$/i.test(lower)) return { intent: "daily_brief", params: {} };
  if (/^\/?(quests?|missions?)$/i.test(lower)) return { intent: "quests", params: {} };
  if (/^\/?(revenue|money|earnings?|income)$/i.test(lower)) return { intent: "revenue", params: {} };
  if (/^\/?(tasks?|queue|pending)$/i.test(lower)) return { intent: "tasks", params: {} };

  if (/^\/?(image|img|generate|gen|draw|create image)\s+(.+)$/i.test(lower)) {
    const topic = text.replace(/^\/?(image|img|generate|gen|draw|create image)\s+/i, "").trim();
    return { intent: "image", params: { topic }, subject: topic };
  }
  if (/^\/?(tweet|post to twitter|twitter)\s+(.+)$/i.test(lower)) {
    const content = text.replace(/^\/?(tweet|post to twitter|twitter)\s+/i, "").trim();
    return { intent: "tweet", params: { content }, subject: content };
  }
  if (/^\/?(content|nora content|video content|post content)\s+(.+)$/i.test(lower)) {
    const topic = text.replace(/^\/?(content|nora content|video content|post content)\s+/i, "").trim();
    return { intent: "content_machine", params: { topic }, subject: topic };
  }
  if (/^\/?(goal|achieve|accomplish|work on)\s+(.+)$/i.test(lower)) {
    const objective = text.replace(/^\/?(goal|achieve|accomplish|work on)\s+/i, "").trim();
    return { intent: "goal", params: { objective }, subject: objective };
  }

  // Claude classifies ambiguous messages
  const raw = await callClaude(
    `You classify a message from a user commanding their AI operating system (MAVIS).
Return ONLY a JSON object — no markdown, no explanation.

Intents:
- "image"           → wants an image generated. Extract "topic".
- "tweet"           → wants to post a tweet as Nora Vale. Extract "content".
- "content_machine" → wants a full content video posted to social media. Extract "topic".
- "daily_brief"     → wants a daily status/briefing.
- "goal"            → wants to pursue a specific goal/objective. Extract "objective".
- "quests"          → wants to see active quests.
- "revenue"         → wants revenue/earnings overview.
- "tasks"           → wants to see pending tasks.
- "help"            → wants to know what MAVIS can do.
- "chat"            → general conversation, question, or anything else.

Example: {"intent":"image","params":{"topic":"a cyberpunk cityscape at dusk"}}`,
    `Message: "${text}"`,
    400,
  );

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as Classified;
  } catch { /* fall through */ }

  return { intent: "chat", params: { message: text } };
}

// ─────────────────────────────────────────────────────────────
// INTENT HANDLERS
// ─────────────────────────────────────────────────────────────

async function handleHelp(chatId: string | number) {
  await send(chatId,
    `*MAVIS — Mobile Commands*\n\n` +
    `🖼 \`image <topic>\` — generate an image\n` +
    `🐦 \`tweet <text>\` — post as Nora Vale on Twitter\n` +
    `🎬 \`content <topic>\` — create avatar video + multi-platform post\n` +
    `🎯 \`goal <objective>\` — start an autonomous goal\n` +
    `📋 \`brief\` — daily status briefing\n` +
    `⚔️ \`quests\` — active quests\n` +
    `💰 \`revenue\` — earnings overview\n` +
    `📌 \`tasks\` — pending task queue\n` +
    `💬 anything else — chat with MAVIS\n\n` +
    `_All commands also work in natural language._`
  );
}

async function handleImage(chatId: string | number, topic: string) {
  await send(chatId, `🖼 Generating image: _${topic}_…`);
  await typing(chatId);

  const res = await callFunction("mavis-actions", {
    actions: [{ type: "generate_image", params: { prompt: topic, aspect_ratio: "1:1", save_to_vault: true } }],
    userId: OPERATOR_UID,
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  const results = (data as any)?.results ?? [];
  const imageUrl = (results[0] as any)?.imageUrl ?? (results[0] as any)?.result?.imageUrl ?? "";

  if (imageUrl && imageUrl.startsWith("http")) {
    await sendPhoto(chatId, imageUrl, `📸 ${topic}`);
  } else if (imageUrl.startsWith("data:image")) {
    await send(chatId, `✅ Image generated and saved to Vault. Open MAVIS to view it.`);
  } else {
    await send(chatId, `⚠️ Image generation failed or GEMINI_API_KEY not set. Check Supabase secrets.`);
  }
}

async function handleTweet(chatId: string | number, content: string) {
  const id = await queueTask("nora_tweet", content, { content });
  if (id) {
    await send(chatId, `🐦 Tweet queued — Nora will post it on the next executor cycle (≤15 min).\n\n_"${content.slice(0, 100)}${content.length > 100 ? "…" : ""}"_`);
  } else {
    await send(chatId, `⚠️ Failed to queue tweet. Check Supabase connection.`);
  }
}

async function handleContentMachine(chatId: string | number, topic: string) {
  const id = await queueTask("nora_content_machine", `Nora content: ${topic}`, {
    topic,
    platforms: ["twitter", "linkedin", "tiktok"],
    triggered_by: "telegram",
  });
  if (id) {
    await send(chatId,
      `🎬 Content pipeline queued for: _${topic}_\n\n` +
      `Phase 1 (next cycle): research → write script → submit avatar video\n` +
      `Phase 2 (after video renders): post to Twitter, LinkedIn, TikTok\n\n` +
      `_Requires: FAL_API_KEY, ELEVENLABS_API_KEY, NORA_AVATAR_IMAGE_URL, social tokens_`
    );
  } else {
    await send(chatId, `⚠️ Failed to queue content pipeline.`);
  }
}

async function handleDailyBrief(chatId: string | number) {
  const id = await queueTask("daily_brief", "Daily brief (Telegram)", {});
  if (id) {
    await send(chatId, `📋 Daily brief queued — check back in a few minutes or open MAVIS to view it.`);
  } else {
    await send(chatId, `⚠️ Failed to queue brief.`);
  }
}

async function handleGoal(chatId: string | number, objective: string) {
  const id = await queueTask("goal", objective, { objective, context: "triggered via Telegram" });
  if (id) {
    await send(chatId,
      `🎯 Goal queued: _${objective}_\n\n` +
      `MAVIS will plan and execute this autonomously over the next cron cycles. ` +
      `Open the Task Dashboard in MAVIS to track progress.`
    );
  } else {
    await send(chatId, `⚠️ Failed to queue goal.`);
  }
}

async function handleQuests(chatId: string | number) {
  const { data: quests } = await sb
    .from("quests")
    .select("title, status, type, xp_reward")
    .eq("user_id", OPERATOR_UID)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(10);

  if (!quests || (quests as any[]).length === 0) {
    await send(chatId, `⚔️ No active quests. Open MAVIS to create one.`);
    return;
  }

  const lines = (quests as any[]).map((q) =>
    `• *${q.title}* [${q.type}] +${q.xp_reward ?? 0}XP`
  );
  await send(chatId, `⚔️ *Active Quests (${lines.length})*\n\n${lines.join("\n")}`);
}

async function handleRevenue(chatId: string | number) {
  const { data: rows } = await sb
    .from("mavis_revenue")
    .select("amount, source, created_at")
    .eq("user_id", OPERATOR_UID)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!rows || (rows as any[]).length === 0) {
    await send(chatId, `💰 No revenue recorded yet.`);
    return;
  }

  const total = (rows as any[]).reduce((s: number, r: any) => s + Number(r.amount), 0);
  const bySource = (rows as any[]).reduce((acc: Record<string, number>, r: any) => {
    acc[r.source] = (acc[r.source] ?? 0) + Number(r.amount);
    return acc;
  }, {});

  const breakdown = Object.entries(bySource)
    .sort(([, a], [, b]) => b - a)
    .map(([src, amt]) => `• ${src}: $${(amt as number).toFixed(2)}`)
    .join("\n");

  await send(chatId, `💰 *Revenue Overview*\n\nTotal: *$${total.toFixed(2)}*\n\n${breakdown}`);
}

async function handleTasks(chatId: string | number) {
  const { data: tasks } = await sb
    .from("mavis_tasks")
    .select("type, description, status, created_at")
    .eq("user_id", OPERATOR_UID)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (!tasks || (tasks as any[]).length === 0) {
    await send(chatId, `📌 No pending tasks in the queue.`);
    return;
  }

  const lines = (tasks as any[]).map((t) =>
    `• [${t.status}] *${t.type}* — ${(t.description ?? "").slice(0, 60)}`
  );
  await send(chatId, `📌 *Task Queue (${lines.length})*\n\n${lines.join("\n")}`);
}

async function handleChat(chatId: string | number, message: string) {
  await typing(chatId);

  // Load minimal context
  const { data: profile } = await sb
    .from("profiles")
    .select("display_name, level, rank, xp")
    .eq("id", OPERATOR_UID)
    .single()
    .catch(() => ({ data: null }));

  const p = profile as any;
  const context = p
    ? `Operator: ${p.display_name} | Level ${p.level} | Rank ${p.rank} | ${p.xp} XP`
    : "";

  const reply = await callClaude(
    `You are MAVIS — Calvin's personal AI operating system. Sharp, direct, strategic. You're responding via Telegram mobile.
Keep responses concise (≤3 paragraphs). No markdown headers. Bullet points ok.

${context}`,
    message,
    600,
  );

  await send(chatId, reply || "⚠️ No response — check ANTHROPIC_API_KEY.");
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // Verify Telegram webhook secret
  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Respond to Telegram immediately — do work after
  const process = async () => {
    const message = (update.message ?? update.edited_message) as Record<string, unknown> | undefined;
    if (!message) return;

    const chatId = (message.chat as any)?.id;
    const text = String((message.text ?? message.caption) ?? "").trim();

    if (!chatId || !text) return;

    // Security gate — only respond to the operator
    if (String(chatId) !== String(OPERATOR_CHAT)) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "⛔ Unauthorized. This MAVIS instance is operator-locked.",
      });
      return;
    }

    if (!OPERATOR_UID) {
      await send(chatId, "⚠️ MAVIS_OPERATOR_MAIN_ID not configured. Add it to Supabase secrets.");
      return;
    }

    try {
      const { intent, params } = await classify(text);

      switch (intent) {
        case "help":           await handleHelp(chatId); break;
        case "image":          await handleImage(chatId, params.topic ?? text); break;
        case "tweet":          await handleTweet(chatId, params.content ?? text); break;
        case "content_machine": await handleContentMachine(chatId, params.topic ?? text); break;
        case "daily_brief":    await handleDailyBrief(chatId); break;
        case "goal":           await handleGoal(chatId, params.objective ?? text); break;
        case "quests":         await handleQuests(chatId); break;
        case "revenue":        await handleRevenue(chatId); break;
        case "tasks":          await handleTasks(chatId); break;
        default:               await handleChat(chatId, text); break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await send(chatId, `⚠️ Error: ${msg.slice(0, 200)}`);
    }
  };

  // Fire processing in background, return 200 to Telegram immediately
  if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
    (globalThis as any).EdgeRuntime.waitUntil(process());
  } else {
    process(); // non-blocking fire-and-forget
  }

  return new Response("ok", { status: 200 });
});
