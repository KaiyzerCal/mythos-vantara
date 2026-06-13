import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseRss(xml: string, _feedName: string): { title: string; link: string; description: string }[] {
  const items: { title: string; link: string; description: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
    const item = match[1];
    const title =
      (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(item) ??
        /<title>(.*?)<\/title>/.exec(item))?.[1]?.trim() ?? "";
    const link =
      (/<link>(.*?)<\/link>/.exec(item) ??
        /<guid>(.*?)<\/guid>/.exec(item))?.[1]?.trim() ?? "";
    const desc =
      (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(item) ??
        /<description>(.*?)<\/description>/.exec(item))?.[1]
        ?.trim()
        .replace(/<[^>]+>/g, "")
        .slice(0, 200) ?? "";
    if (title) items.push({ title, link, description: desc });
  }
  return items;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSb = createClient(supabaseUrl, serviceRoleKey);

    // Auth → uid (Bearer or TELEGRAM_OPERATOR_USER_ID fallback)
    let uid: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const userSb = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? serviceRoleKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userSb.auth.getUser();
      uid = user?.id ?? null;
    }
    if (!uid) {
      uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? null;
    }
    if (!uid) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body
    let body: { max_stories?: number } = {};
    try {
      body = await req.json();
    } catch (_) { /* no body */ }
    const maxStories = Math.min(body.max_stories ?? 10, 10);

    // Fetch HN top story IDs
    const idsRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json", {
      signal: AbortSignal.timeout(10000),
    });
    if (!idsRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch HN top stories" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const allIds: number[] = await idsRes.json();
    const ids = allIds.slice(0, maxStories);

    // Fetch each story in parallel
    const stories = await Promise.all(
      ids.map((id) =>
        fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
          signal: AbortSignal.timeout(10000),
        }).then((r) => (r.ok ? r.json() : null))
      ),
    );

    let hnCount = 0;
    for (const story of stories) {
      if (!story || !story.title) continue;
      await adminSb.from("mavis_notes").upsert({
        user_id: uid,
        title: `[HN] ${story.title}`,
        content: `Score: ${story.score} | Comments: ${story.descendants ?? 0} | By: ${story.by}\nURL: ${story.url ?? "(text post)"}\n${story.text ? story.text.slice(0, 300).replace(/<[^>]+>/g, "") : ""}`,
        tags: ["news", "hn", "intel"],
        properties: {
          source: "hackernews",
          hn_id: story.id,
          score: story.score,
          url: story.url,
          author: story.by,
        },
        importance: story.score > 200 ? 7 : story.score > 100 ? 5 : 4,
      }, { onConflict: "user_id,title" });
      hnCount++;
    }

    // Fetch user's RSS feeds
    let rssCount = 0;
    try {
      const { data: feeds, error: feedsErr } = await adminSb
        .from("rss_feeds")
        .select("*")
        .eq("user_id", uid)
        .eq("is_active", true);

      if (!feedsErr && feeds && feeds.length > 0) {
        for (const feed of feeds) {
          try {
            const rssRes = await fetch(feed.url, { signal: AbortSignal.timeout(10000) });
            if (!rssRes.ok) continue;
            const xml = await rssRes.text();
            const items = parseRss(xml, feed.name);

            for (const item of items) {
              await adminSb.from("mavis_notes").upsert({
                user_id: uid,
                title: `[RSS:${feed.name}] ${item.title}`,
                content: `${item.description}\nURL: ${item.link}`,
                tags: ["news", "rss", feed.name],
                properties: {
                  source: "rss",
                  feed_name: feed.name,
                  feed_url: feed.url,
                  link: item.link,
                },
              }, { onConflict: "user_id,title" });
              rssCount++;
            }

            // Update last_synced_at
            await adminSb
              .from("rss_feeds")
              .update({ last_synced_at: new Date().toISOString() })
              .eq("id", feed.id);
          } catch (feedErr) {
            console.error(`Error processing RSS feed ${feed.name}:`, feedErr);
          }
        }
      }
    } catch (rssErr) {
      // Handle gracefully if table missing or other error
      console.error("RSS feeds error (non-fatal):", rssErr);
    }

    return new Response(JSON.stringify({ hn_stories: hnCount, rss_items: rssCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
