// mavis-reddit-agent
// Analyze Reddit posts to identify business opportunities.
// Uses public Reddit JSON API — no credentials needed for public subreddits.
// AI pipeline: search → filter → classify → summarize + solutions + sentiment → Sheets + Gmail drafts.
//
// Actions: search_posts | get_post | get_subreddit_info | analyze_opportunities

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const REDDIT_BASE   = "https://www.reddit.com";
const UA            = "MAVIS/1.0 (business-opportunity-scanner)";

// ── Reddit public JSON API ─────────────────────────────────────

async function redditGet(path: string, qs: Record<string, string> = {}): Promise<any> {
  const url  = `${REDDIT_BASE}${path}`;
  const full = Object.keys(qs).length ? `${url}?${new URLSearchParams(qs)}` : url;
  const res  = await fetch(full, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
    signal:  AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Reddit API ${res.status} for ${path}`);
  return res.json();
}

interface RedditPost {
  id:                    string;
  title:                 string;
  selftext:              string;
  ups:                   number;
  url:                   string;
  permalink:             string;
  created_utc:           number;
  subreddit:             string;
  subreddit_subscribers: number;
  author:                string;
}

function parsePost(child: any): RedditPost {
  const d = child?.data ?? child ?? {};
  return {
    id:                    d.id ?? "",
    title:                 d.title ?? "",
    selftext:              d.selftext ?? "",
    ups:                   d.ups ?? 0,
    url:                   d.url ?? `https://www.reddit.com${d.permalink ?? ""}`,
    permalink:             d.permalink ?? "",
    created_utc:           d.created_utc ?? d.created ?? 0,
    subreddit:             d.subreddit ?? "",
    subreddit_subscribers: d.subreddit_subscribers ?? 0,
    author:                d.author ?? "",
  };
}

function isUsablePost(p: RedditPost, minUpvotes: number, cutoff: number): boolean {
  return (
    p.ups >= minUpvotes &&
    p.selftext.trim().length > 20 &&
    p.selftext !== "[removed]" &&
    p.selftext !== "[deleted]" &&
    p.created_utc >= cutoff
  );
}

// ── Claude helper ──────────────────────────────────────────────

async function callClaude(
  prompt: string,
  maxTokens = 300,
  model = "claude-haiku-4-5-20251001",
): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body:    JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    signal:  AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Anthropic: ${data.error?.message ?? JSON.stringify(data)}`);
  return (data.content?.[0]?.text ?? "").trim();
}

async function runBatch<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  batchSize = 3,
): Promise<{ results: R[]; failures: number }> {
  const results: R[] = [];
  let failures = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const done  = await Promise.allSettled(batch.map(fn));
    for (const r of done) {
      if (r.status === "fulfilled") results.push(r.value);
      else failures++;
    }
  }
  return { results, failures };
}

// ── Main ───────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    let uid: string | null = null;
    const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

    if (authHeader === `Bearer ${SB_SRK}`) {
      const body = await req.json().catch(() => ({}));
      uid = String(body.userId ?? body.user_id ?? "");
      if (!uid) return json({ error: "userId required for service-role calls" }, 400);
      (req as any)._body = body;
    } else if (authHeader.startsWith("Bearer eyJ")) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      const uc = createClient(SB_URL, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: ud } = await uc.auth.getUser();
      if (!ud?.user?.id) return json({ error: "Unauthorized" }, 401);
      uid = ud.user.id;
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = (req as any)._body ?? await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    switch (action) {

      // ── Read ──────────────────────────────────────────────────

      case "search_posts": {
        const subreddit  = String(body.subreddit ?? "");
        const keyword    = String(body.keyword ?? body.query ?? "");
        const sort       = String(body.sort ?? "hot");
        const limit      = Math.min(Number(body.limit ?? 25), 100);
        const daysBack   = Number(body.days_back ?? 180);
        const minUpvotes = Number(body.min_upvotes ?? 0);

        if (!subreddit && !keyword) return json({ error: "subreddit and/or keyword required" }, 400);

        const qs: Record<string, string> = { limit: String(limit), sort };
        let path: string;

        if (keyword) {
          qs.q = keyword;
          if (subreddit) { qs.restrict_sr = "true"; path = `/r/${subreddit}/search.json`; }
          else path = `/search.json`;
          qs.type = "self";
        } else {
          path = `/r/${subreddit}/${sort}.json`;
        }

        const data   = await redditGet(path, qs);
        const cutoff = Date.now() / 1000 - daysBack * 86400;
        const posts  = (data.data?.children ?? [])
          .map(parsePost)
          .filter((p: RedditPost) => isUsablePost(p, minUpvotes, cutoff))
          .map((p: RedditPost) => ({
            id:                    p.id,
            title:                 p.title,
            content:               p.selftext.slice(0, 500),
            upvotes:               p.ups,
            url:                   `https://www.reddit.com${p.permalink}`,
            subreddit:             p.subreddit,
            subreddit_subscribers: p.subreddit_subscribers,
            author:                p.author,
            created_at:            new Date(p.created_utc * 1000).toISOString(),
          }));

        return json({ posts, count: posts.length, subreddit: subreddit || "all", keyword, sort });
      }

      case "get_post": {
        const urlOrId = String(body.url ?? body.post_id ?? body.id ?? "");
        if (!urlOrId) return json({ error: "url or post_id required" }, 400);
        const match = urlOrId.match(/\/r\/(\w+)\/comments\/([a-z0-9]+)/i);
        if (!match) return json({ error: "Provide a full reddit.com post URL" }, 400);
        const [, sub, postId] = match;

        const data = await redditGet(`/r/${sub}/comments/${postId}.json`, { limit: "1" });
        const post = parsePost(data[0]?.data?.children?.[0]);

        return json({
          id:                    post.id,
          title:                 post.title,
          content:               post.selftext,
          upvotes:               post.ups,
          url:                   `https://www.reddit.com${post.permalink}`,
          subreddit:             post.subreddit,
          subreddit_subscribers: post.subreddit_subscribers,
          author:                post.author,
          created_at:            new Date(post.created_utc * 1000).toISOString(),
        });
      }

      case "get_subreddit_info": {
        const subreddit = String(body.subreddit ?? "");
        if (!subreddit) return json({ error: "subreddit required" }, 400);

        const data = await redditGet(`/r/${subreddit}/about.json`);
        const s    = data.data ?? {};
        return json({
          name:        s.display_name,
          title:       s.title,
          description: s.public_description,
          subscribers: s.subscribers,
          active:      s.active_user_count,
          created_at:  s.created_utc ? new Date(s.created_utc * 1000).toISOString() : null,
          url:         `https://www.reddit.com/r/${subreddit}`,
          nsfw:        s.over18 ?? false,
        });
      }

      // ── Full AI pipeline ──────────────────────────────────────

      case "analyze_opportunities": {
        if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY required" }, 503);

        const subreddit     = String(body.subreddit ?? "smallbusiness");
        const keyword       = String(body.keyword ?? "looking for a solution");
        const sort          = String(body.sort ?? "hot");
        const limit         = Math.min(Number(body.limit ?? 20), 30);
        const daysBack      = Number(body.days_back ?? 180);
        const minUpvotes    = Number(body.min_upvotes ?? 2);
        const spreadsheetId = body.spreadsheet_id ? String(body.spreadsheet_id) : null;
        const sheetName     = String(body.sheet_name ?? "Opportunities");
        const gmailDrafts   = body.gmail_drafts === true;

        // Step 1: Fetch + feature-filter
        const qs: Record<string, string> = {
          q: keyword, sort, limit: String(limit), restrict_sr: "true", type: "self",
        };
        const rawData = await redditGet(`/r/${subreddit}/search.json`, qs);
        const cutoff  = Date.now() / 1000 - daysBack * 86400;

        const filtered: RedditPost[] = (rawData.data?.children ?? [])
          .map(parsePost)
          .filter((p: RedditPost) => isUsablePost(p, minUpvotes, cutoff));

        // Step 2: AI content classification — is this a business problem?
        const classify = await runBatch(filtered, async (post) => {
          const ans = await callClaude(
            `Is this Reddit post describing a business-related problem or a need for a solution? The post should mention a specific challenge or requirement that a business is trying to address.\n\nPost: "${post.selftext.slice(0, 800)}"\n\nAnswer with only: yes or no`,
            5,
          );
          return { post, qualified: ans.toLowerCase().startsWith("yes") };
        });

        const qualified = classify.results.filter(r => r.qualified).map(r => r.post);

        // Step 3: Full analysis — summary + solution + sentiment (parallel within each batch)
        interface Analyzed {
          url:                   string;
          date:                  string;
          upvotes:               number;
          subreddit_subscribers: number;
          postcontent:           string;
          summary:               string;
          solution:              string;
          sentiment:             "positive" | "neutral" | "negative";
        }

        const analyze = await runBatch(qualified, async (post): Promise<Analyzed> => {
          const content = post.selftext.slice(0, 1500);
          const [summary, solution, sentRaw] = await Promise.all([
            callClaude(`Summarize this Reddit post in 2-3 sentences:\n\n"${content}"`, 200),
            callClaude(`Based on this Reddit post, suggest a business idea or service that could address this problem for multiple businesses:\n\nPost: "${content}"\n\nProvide a concise description of a scalable business idea or service.`, 500),
            callClaude(`What is the sentiment of this post? Reply with exactly one word: positive, neutral, or negative.\n\nPost: "${content.slice(0, 500)}"`, 5),
          ]);
          const sentimentRaw = sentRaw.toLowerCase();
          const sentiment = (["positive", "negative"].find(s => sentimentRaw.includes(s)) ?? "neutral") as "positive" | "neutral" | "negative";
          return {
            url:                   `https://www.reddit.com${post.permalink}`,
            date:                  new Date(post.created_utc * 1000).toISOString(),
            upvotes:               post.ups,
            subreddit_subscribers: post.subreddit_subscribers,
            postcontent:           post.selftext,
            summary,
            solution,
            sentiment,
          };
        });

        const results: Analyzed[] = analyze.results;

        // Step 4: Append to Google Sheets (one row per result)
        let sheetsAppended = 0;
        if (spreadsheetId && results.length > 0) {
          for (const r of results) {
            try {
              await fetch(`${SB_URL}/functions/v1/mavis-sheets-agent`, {
                method:  "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
                body:    JSON.stringify({
                  userId:         uid,
                  action:         "append_row",
                  spreadsheet_id: spreadsheetId,
                  sheet_name:     sheetName,
                  values: {
                    Upvotes:        String(r.upvotes),
                    Post_url:       r.url,
                    Post_date:      r.date,
                    Post_summary:   r.summary,
                    Post_solution:  r.solution,
                    Subreddit_size: String(r.subreddit_subscribers),
                    Sentiment:      r.sentiment,
                  },
                }),
                signal: AbortSignal.timeout(15000),
              });
              sheetsAppended++;
            } catch { /* skip failed rows */ }
          }
        }

        // Step 5: Gmail drafts categorised by sentiment
        let draftsCreated = 0;
        if (gmailDrafts && results.length > 0) {
          const subjectMap = { positive: "Positive Post", neutral: "Neutral Post", negative: "Negative Post" } as const;
          for (const r of results) {
            try {
              await fetch(`${SB_URL}/functions/v1/mavis-google-agent`, {
                method:  "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
                body:    JSON.stringify({ userId: uid, action: "create_draft", subject: subjectMap[r.sentiment], body: r.postcontent }),
                signal:  AbortSignal.timeout(12000),
              });
              draftsCreated++;
            } catch { /* skip if Gmail not connected */ }
          }
        }

        // Step 6: Store scan record in mavis_memory
        await sb.from("mavis_memory").insert({
          user_id:          uid,
          role:             "assistant",
          content:          `[REDDIT SCAN] r/${subreddit} | keyword: "${keyword}" | fetched: ${filtered.length} | qualified: ${qualified.length} | analyzed: ${results.length} | sheets: ${sheetsAppended}`,
          importance_score: 5,
          tags:             ["reddit_intelligence", `r_${subreddit}`, "business_opportunities", keyword.replace(/\s+/g, "_")],
        });

        return json({
          subreddit,
          keyword,
          fetched:         filtered.length,
          qualified:       qualified.length,
          analyzed:        results.length,
          results,
          sheets_appended: sheetsAppended,
          drafts_created:  draftsCreated,
        });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: search_posts | get_post | get_subreddit_info | analyze_opportunities`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-reddit-agent]", message);
    return json({ error: message }, 500);
  }
});
