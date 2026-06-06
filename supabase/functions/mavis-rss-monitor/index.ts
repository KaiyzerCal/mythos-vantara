// mavis-rss-monitor — Proactive RSS/Atom feed monitoring → mavis_notes
// Actions: add_feed | list_feeds | remove_feed | fetch | fetch_all (cron)
// fetch_all is called by mavis-heartbeat with service-role key (no user JWT)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA      = "MAVIS/1.0 RSS Monitor";

async function getUser(authHeader: string) {
  const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
  const { data: { user }, error } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
  return { user, error };
}

// ─── Minimal RSS/Atom parser ──────────────────────────────────
function extractCDATA(xml: string, tag: string): string {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m) return m[1].trim();
  }
  return "";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

interface FeedItem {
  title: string;
  link: string;
  description: string;
  pub_date: string;
}

function parseFeed(xml: string): FeedItem[] {
  const isAtom = /<feed[\s>]/.test(xml);

  if (isAtom) {
    const blocks = xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
    return blocks.map(e => {
      const linkMatch = e.match(/href="([^"]+)"/);
      const updated   = e.match(/<updated>([^<]+)<\/updated>/);
      return {
        title:       extractCDATA(e, "title"),
        link:        linkMatch ? linkMatch[1] : "",
        description: stripHtml(extractCDATA(e, "summary") || extractCDATA(e, "content")),
        pub_date:    updated ? updated[1] : new Date().toISOString(),
      };
    });
  }

  // RSS 2.0 / RSS 1.0
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  return blocks.map(item => ({
    title:       extractCDATA(item, "title"),
    link:        extractCDATA(item, "link") || extractCDATA(item, "guid"),
    description: stripHtml(
      extractCDATA(item, "content:encoded") || extractCDATA(item, "description")
    ),
    pub_date: extractCDATA(item, "pubDate") || extractCDATA(item, "dc:date") || new Date().toISOString(),
  }));
}

// ─── Fetch one feed and ingest new articles ───────────────────
async function fetchFeedForUser(
  feedRow: any,
  sb: ReturnType<typeof createClient>,
): Promise<{ new_items: number; error?: string }> {
  try {
    const res = await fetch(feedRow.feed_url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml   = await res.text();
    const items = parseFeed(xml);

    const lastFetched = feedRow.last_fetched_at ? new Date(feedRow.last_fetched_at) : new Date(0);
    let new_items = 0;

    for (const item of items) {
      if (!item.link) continue;
      const itemDate = new Date(item.pub_date);
      if (isNaN(itemDate.getTime()) || itemDate <= lastFetched) continue;

      // Skip if already saved (dedup by source_url)
      const { count } = await sb
        .from("mavis_notes")
        .select("*", { count: "exact", head: true })
        .eq("user_id", feedRow.user_id)
        .eq("source_url", item.link);
      if ((count ?? 0) > 0) continue;

      const feedTag = (feedRow.name ?? "rss").toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 30);
      const content = [
        `# ${item.title}`,
        "",
        `**Feed:** ${feedRow.name}`,
        `**Published:** ${item.pub_date}`,
        `**Link:** ${item.link}`,
        "",
        item.description.slice(0, 800),
      ].join("\n");

      await sb.from("mavis_notes").insert({
        user_id:    feedRow.user_id,
        title:      item.title || "Untitled Article",
        content,
        tags:       ["rss", "article", feedTag],
        source_url: item.link,
      });
      new_items++;
    }

    await sb.from("mavis_rss_feeds").update({
      last_fetched_at: new Date().toISOString(),
      last_error: null,
    }).eq("id", feedRow.id);

    return { new_items };

  } catch (e: any) {
    await sb.from("mavis_rss_feeds").update({ last_error: e.message }).eq("id", feedRow.id);
    return { new_items: 0, error: e.message };
  }
}

// ─── Main handler ─────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body   = await req.json().catch(() => ({}));
    const action: string = body.action ?? "list_feeds";

    // fetch_all — called by heartbeat/cron with service-role key, no user JWT
    if (action === "fetch_all") {
      const sb = createClient(SB_KEY ? SB_URL : "", SB_KEY, { auth: { persistSession: false } });
      const { data: feeds } = await sb.from("mavis_rss_feeds").select("*").eq("enabled", true);

      let total_new = 0;
      const results: any[] = [];
      for (const feed of feeds ?? []) {
        const r = await fetchFeedForUser(feed, sb);
        total_new += r.new_items;
        results.push({ feed: feed.name, user_id: feed.user_id, ...r });
      }

      return new Response(JSON.stringify({
        ok: true,
        feeds_polled: (feeds ?? []).length,
        total_new_articles: total_new,
        results,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // All other actions require user auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const { user, error: authErr } = await getUser(authHeader);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

    // ── ADD_FEED ──────────────────────────────────────────
    if (action === "add_feed") {
      const feed_url: string = body.feed_url ?? "";
      const name: string     = body.name || new URL(feed_url).hostname;
      if (!feed_url) {
        return new Response(JSON.stringify({ error: "feed_url required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await sb
        .from("mavis_rss_feeds")
        .upsert({ user_id: user.id, feed_url, name, enabled: true }, { onConflict: "user_id,feed_url" })
        .select("id, name, feed_url")
        .single();

      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ ok: true, ...data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── LIST_FEEDS ────────────────────────────────────────
    if (action === "list_feeds") {
      const { data } = await sb
        .from("mavis_rss_feeds")
        .select("id, name, feed_url, enabled, last_fetched_at, last_error, created_at")
        .eq("user_id", user.id)
        .order("created_at");

      return new Response(JSON.stringify({ ok: true, feeds: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── REMOVE_FEED ───────────────────────────────────────
    if (action === "remove_feed") {
      const id: string = body.id ?? "";
      if (!id) {
        return new Response(JSON.stringify({ error: "id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await sb.from("mavis_rss_feeds").delete().eq("id", id).eq("user_id", user.id);
      return new Response(JSON.stringify({ ok: true, removed: id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── FETCH (poll one feed right now) ───────────────────
    if (action === "fetch") {
      const id: string = body.id ?? "";
      if (!id) {
        return new Response(JSON.stringify({ error: "id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: feed } = await sb
        .from("mavis_rss_feeds")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (!feed) {
        return new Response(JSON.stringify({ error: "Feed not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await fetchFeedForUser(feed, sb);
      return new Response(JSON.stringify({ ok: true, feed: feed.name, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("mavis-rss-monitor error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
