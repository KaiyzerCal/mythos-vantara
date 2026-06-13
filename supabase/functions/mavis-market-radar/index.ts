// mavis-market-radar
// Monitors daily news and trends for topics the operator cares about,
// scores relevance with Claude Haiku, stores signals in mavis_market_intel,
// and pushes high-relevance signals via Telegram.
// Runs daily at 6:30am via pg_cron. Also callable on-demand.
// verify_jwt = false (cron + service-role)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const TAVILY_KEY = Deno.env.get("TAVILY_API_KEY") ?? "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const FALLBACK_TOPICS = ["AI and technology trends", "global business news", "startup and venture capital"];

// ── Helpers ────────────────────────────────────────────────────────────────

async function getOperatorTopics(userId: string): Promise<{ topics: string[]; operatorName: string }> {
  const [notesRes, tacitRes] = await Promise.all([
    sb.from("mavis_notes")
      .select("content, tags")
      .eq("user_id", userId)
      .contains("tags", ["topic"]),
    sb.from("mavis_tacit")
      .select("key, value")
      .eq("user_id", userId),
  ]);

  // Extract operator name
  const tacitRows: { key: string; value: string }[] = (tacitRes.data ?? []) as { key: string; value: string }[];
  const operatorNameRow = tacitRows.find((r) => r.key === "operator_name");
  const operatorName = operatorNameRow?.value ?? "the operator";

  // Pull topics from tacit knowledge
  const tacitTopics: string[] = tacitRows
    .filter((r) =>
      r.key.includes("interest") || r.key.includes("industry") || r.key.includes("focus")
    )
    .map((r) => String(r.value))
    .filter(Boolean);

  // Pull topics from notes tagged with relevant tags
  const relevantNoteTags = new Set(["topic", "interest", "market", "business"]);
  const noteTopics: string[] = [];
  for (const note of (notesRes.data ?? []) as { content: string; tags: string[] }[]) {
    const tags: string[] = note.tags ?? [];
    const hasRelevantTag = tags.some((t) => relevantNoteTags.has(t));
    if (hasRelevantTag && note.content) {
      // Use the first sentence of the note as the topic hint
      const firstSentence = note.content.split(/[.\n]/)[0].trim();
      if (firstSentence.length > 3 && firstSentence.length < 150) {
        noteTopics.push(firstSentence);
      }
    }
  }

  // Also check notes tagged 'market' or 'business' explicitly via OR filter
  const { data: moreNotes } = await sb.from("mavis_notes")
    .select("content, tags")
    .eq("user_id", userId)
    .or("tags.cs.{interest},tags.cs.{market},tags.cs.{business}");

  for (const note of (moreNotes ?? []) as { content: string; tags: string[] }[]) {
    const firstSentence = (note.content ?? "").split(/[.\n]/)[0].trim();
    if (firstSentence.length > 3 && firstSentence.length < 150) {
      noteTopics.push(firstSentence);
    }
  }

  // Deduplicate and merge
  const combined = [...new Set([...tacitTopics, ...noteTopics])];
  const topics = combined.length > 0 ? combined.slice(0, 5) : FALLBACK_TOPICS;

  return { topics, operatorName };
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  published_date?: string;
}

async function fetchNewsForTopic(topic: string): Promise<TavilyResult[]> {
  if (!TAVILY_KEY) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query: topic,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        days: 1,
      }),
    });
    if (!res.ok) {
      console.warn(`[market-radar] Tavily error for topic "${topic}": ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data.results ?? []) as TavilyResult[];
  } catch (err) {
    console.warn(`[market-radar] Tavily fetch failed for topic "${topic}":`, err);
    return [];
  }
}

interface ScoredArticle {
  headline: string;
  relevance_score: number;
  signal_type: string;
  summary: string;
}

async function scoreArticlesWithClaude(
  articles: Array<{ topic: string; title: string; content: string; url: string }>,
  operatorName: string,
): Promise<Array<ScoredArticle & { topic: string; url: string }>> {
  if (!ANTHROPIC_KEY || articles.length === 0) {
    // Return minimal fallback scores so we still store something
    return articles.map((a) => ({
      topic: a.topic,
      url: a.url,
      headline: a.title,
      summary: a.content.slice(0, 200),
      relevance_score: 0.5,
      signal_type: "news",
    }));
  }

  // Batch up to 10 articles per Claude call
  const results: Array<ScoredArticle & { topic: string; url: string }> = [];
  const batchSize = 10;

  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    const articleList = batch
      .map(
        (a, idx) =>
          `[${idx + 1}] Topic: ${a.topic}\nHeadline: ${a.title}\nContent: ${a.content.slice(0, 400)}`,
      )
      .join("\n\n---\n\n");

    const systemPrompt = `You are a market intelligence analyst for ${operatorName}. Score each article for business relevance and classify its signal type.

Return ONLY a valid JSON array with one object per article, in the same order as provided. Each object must have:
- headline: string (cleaned-up headline, max 120 chars)
- relevance_score: number between 0.00 and 1.00 (0=irrelevant, 1=highly actionable)
- signal_type: one of "news", "trend", "opportunity", "risk"
- summary: string (2-3 sentence synthesis, max 200 chars)

No explanation, no markdown, just the JSON array.`;

    const userPrompt = `Score these ${batch.length} articles:\n\n${articleList}`;

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
          max_tokens: 1500,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (!res.ok) {
        console.warn(`[market-radar] Claude scoring failed: ${res.status}`);
        // Fallback: assign neutral scores
        for (const a of batch) {
          results.push({
            topic: a.topic,
            url: a.url,
            headline: a.title,
            summary: a.content.slice(0, 200),
            relevance_score: 0.5,
            signal_type: "news",
          });
        }
        continue;
      }

      const claudeData = await res.json();
      const rawText: string = claudeData.content?.find((b: { type: string }) => b.type === "text")?.text ?? "[]";

      // Parse JSON — strip any accidental markdown fences
      const jsonText = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const scored: ScoredArticle[] = JSON.parse(jsonText);

      for (let j = 0; j < batch.length; j++) {
        const s = scored[j];
        if (!s) {
          results.push({
            topic: batch[j].topic,
            url: batch[j].url,
            headline: batch[j].title,
            summary: batch[j].content.slice(0, 200),
            relevance_score: 0.5,
            signal_type: "news",
          });
        } else {
          results.push({
            topic: batch[j].topic,
            url: batch[j].url,
            headline: String(s.headline ?? batch[j].title).slice(0, 120),
            summary: String(s.summary ?? "").slice(0, 200),
            relevance_score: Math.min(1, Math.max(0, Number(s.relevance_score ?? 0.5))),
            signal_type: ["news", "trend", "opportunity", "risk"].includes(s.signal_type) ? s.signal_type : "news",
          });
        }
      }
    } catch (err) {
      console.warn(`[market-radar] Claude batch parse error:`, err);
      for (const a of batch) {
        results.push({
          topic: a.topic,
          url: a.url,
          headline: a.title,
          summary: a.content.slice(0, 200),
          relevance_score: 0.5,
          signal_type: "news",
        });
      }
    }
  }

  return results;
}

async function sendTelegram(message: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "Markdown",
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ── Core radar logic ────────────────────────────────────────────────────────

async function runRadarForUser(userId: string): Promise<{ stored: number; notified: number }> {
  const { topics, operatorName } = await getOperatorTopics(userId);

  // Fetch news for all topics (up to 5), continue on per-topic errors
  const allArticles: Array<{ topic: string; title: string; content: string; url: string }> = [];

  for (const topic of topics.slice(0, 5)) {
    const results = await fetchNewsForTopic(topic);
    for (const r of results) {
      if (r.title && r.content) {
        allArticles.push({
          topic,
          title: r.title,
          content: r.content,
          url: r.url ?? "",
        });
      }
    }
  }

  if (allArticles.length === 0) return { stored: 0, notified: 0 };

  // Score with Claude
  const scored = await scoreArticlesWithClaude(allArticles, operatorName);

  // Filter and store articles with relevance >= 0.3
  const toStore = scored.filter((a) => a.relevance_score >= 0.3);
  const today = new Date().toISOString().slice(0, 10);

  if (toStore.length > 0) {
    const rows = toStore.map((a) => ({
      user_id: userId,
      topic: a.topic,
      headline: a.headline,
      summary: a.summary,
      url: a.url || null,
      relevance_score: a.relevance_score,
      signal_type: a.signal_type,
      notified: false,
      source_date: today,
    }));

    const { error: upsertErr } = await sb.from("mavis_market_intel").insert(rows);
    if (upsertErr) console.warn(`[market-radar] DB insert error for user ${userId}:`, upsertErr.message);
  }

  // Notify via Telegram for relevance >= 0.7
  const toNotify = toStore.filter((a) => a.relevance_score >= 0.7);
  let notified = 0;

  for (const article of toNotify) {
    const scorePercent = Math.round(article.relevance_score * 100);
    const truncSummary = article.summary.length > 200
      ? article.summary.slice(0, 197) + "..."
      : article.summary;

    const message =
      `📡 *Market Radar* — ${article.signal_type}\n` +
      `*${article.headline}*\n` +
      `${truncSummary}\n` +
      `Relevance: ${scorePercent}%`;

    const sent = await sendTelegram(message);

    if (sent) {
      // Mark notified = true in DB (best-effort, match by user + headline + source_date)
      await sb.from("mavis_market_intel")
        .update({ notified: true })
        .eq("user_id", userId)
        .eq("headline", article.headline)
        .eq("source_date", today);
      notified++;
    }
  }

  return { stored: toStore.length, notified };
}

// ── Serve handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // GET: return recent intel for a user (last 7 days, limit 20)
    if (req.method === "GET") {
      const url = new URL(req.url);
      const userId = url.searchParams.get("user_id");
      if (!userId) return json({ error: "user_id required" }, 400);

      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data, error } = await sb.from("mavis_market_intel")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) return json({ error: error.message }, 500);
      return json({ intel: data ?? [] });
    }

    // POST
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // Cron fan-out: run for all profiles (limit 50)
    if (body.cron === true) {
      const { data: users, error: usersErr } = await sb.from("profiles").select("id").limit(50);
      if (usersErr) return json({ error: usersErr.message }, 500);
      if (!users?.length) return json({ processed: 0 });

      let totalStored = 0;
      let totalNotified = 0;

      for (const { id: userId } of users) {
        try {
          const { stored, notified } = await runRadarForUser(userId);
          totalStored += stored;
          totalNotified += notified;
        } catch (err) {
          // Per-user errors should not abort the whole run
          console.error(`[market-radar] Error for user ${userId}:`, err instanceof Error ? err.message : String(err));
        }
      }

      return json({ processed: users.length, stored: totalStored, notified: totalNotified });
    }

    // On-demand single user
    const userId = String(body.user_id ?? "");
    if (!userId) return json({ error: "user_id required" }, 400);

    const { stored, notified } = await runRadarForUser(userId);
    return json({ user_id: userId, stored, notified });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[market-radar]", msg);
    return json({ error: msg }, 500);
  }
});
