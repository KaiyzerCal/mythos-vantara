// mavis-beehiiv-agent
// Beehiiv newsletter platform — create and publish posts, manage subscribers,
// send broadcasts, read engagement stats.
// Requires: BEEHIIV_API_KEY + BEEHIIV_PUBLICATION_ID
//
// Actions: create_post | publish_post | list_posts | get_stats
//          add_subscriber | list_subscribers | get_subscriber | send_broadcast

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BH_KEY  = Deno.env.get("BEEHIIV_API_KEY") ?? "";
const BH_PUB  = Deno.env.get("BEEHIIV_PUBLICATION_ID") ?? "";
const BH_API  = "https://api.beehiiv.com/v2";

function requireBeehiiv() {
  if (!BH_KEY || !BH_PUB) throw new Error("Beehiiv not configured. Set BEEHIIV_API_KEY and BEEHIIV_PUBLICATION_ID in Supabase secrets.");
}

async function bhReq(path: string, method = "GET", body?: unknown): Promise<any> {
  requireBeehiiv();
  const url = path.startsWith("http") ? path : `${BH_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Authorization": `Bearer ${BH_KEY}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Beehiiv error (${res.status}): ${data.message ?? JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// Convert markdown text to Beehiiv-compatible HTML
function mdToHtml(text: string): string {
  return text
    .split("\n\n")
    .map(para => {
      if (para.startsWith("# "))  return `<h1>${para.slice(2)}</h1>`;
      if (para.startsWith("## ")) return `<h2>${para.slice(3)}</h2>`;
      if (para.startsWith("### ")) return `<h3>${para.slice(4)}</h3>`;
      if (para.startsWith("- "))  return `<ul>${para.split("\n").map(l => `<li>${l.slice(2)}</li>`).join("")}</ul>`;
      if (/^\d+\. /.test(para))   return `<ol>${para.split("\n").map(l => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("")}</ol>`;
      return `<p>${para.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\*(.*?)\*/g, "<em>$1</em>")}</p>`;
    })
    .join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    switch (action) {
      case "create_post": {
        const title      = String(body.title ?? "");
        const content    = String(body.content ?? body.body ?? "");
        const subtitle   = body.subtitle ? String(body.subtitle) : undefined;
        const preheader  = body.preheader ? String(body.preheader) : undefined;

        if (!title || !content) return json({ error: "title and content required" }, 400);

        const htmlContent = body.html ? content : mdToHtml(content);

        const result = await bhReq(`/publications/${BH_PUB}/posts`, "POST", {
          title,
          subtitle,
          preheader,
          content_html: htmlContent,
          content_text: content.replace(/<[^>]+>/g, ""),
          status:       body.status ?? "draft",
          audience:     body.audience ?? "free",
          send_at:      body.send_at,
          display_date: body.display_date ?? new Date().toISOString(),
          meta_default_description: subtitle ?? preheader,
        });

        return json({
          post_id:    result.data?.id,
          status:     result.data?.status,
          title:      result.data?.title,
          web_url:    result.data?.web_url,
          created_at: result.data?.created_at,
        });
      }

      case "publish_post": {
        const postId = String(body.post_id ?? body.id ?? "");
        if (!postId) return json({ error: "post_id required" }, 400);

        const result = await bhReq(`/publications/${BH_PUB}/posts/${postId}`, "PATCH", {
          status:  "confirmed",
          send_at: body.send_at ?? new Date(Date.now() + 60000).toISOString(), // 1 min from now
        });

        return json({ post_id: postId, status: result.data?.status, send_at: result.data?.send_at });
      }

      case "list_posts": {
        const limit  = Math.min(Number(body.limit ?? 10), 50);
        const status = body.status ?? "confirmed"; // draft | confirmed | archived
        const result = await bhReq(`/publications/${BH_PUB}/posts?limit=${limit}&status=${status}&expand[]=stats`);

        return json({
          posts: (result.data ?? []).map((p: any) => ({
            id:          p.id,
            title:       p.title,
            status:      p.status,
            created_at:  p.created_at,
            send_at:     p.send_at,
            web_url:     p.web_url,
            open_rate:   p.stats?.email_open_rate,
            click_rate:  p.stats?.email_click_rate,
            recipients:  p.stats?.recipients,
          })),
          total: result.total_results,
        });
      }

      case "get_stats": {
        // Publication-level stats
        const result = await bhReq(`/publications/${BH_PUB}?expand[]=stats`);
        const pub    = result.data;
        return json({
          name:           pub.name,
          subscribers:    pub.stats?.total_active_subscriptions,
          total_ever:     pub.stats?.total_subscriptions,
          avg_open_rate:  pub.stats?.avg_open_rate,
          avg_click_rate: pub.stats?.avg_click_rate,
        });
      }

      case "add_subscriber": {
        const email     = String(body.email ?? "");
        if (!email) return json({ error: "email required" }, 400);

        const result = await bhReq(`/publications/${BH_PUB}/subscriptions`, "POST", {
          email,
          reactivate_existing:   body.reactivate !== false,
          send_welcome_email:    body.welcome_email !== false,
          utm_source:            body.utm_source ?? "mavis",
          referring_site:        body.referring_site,
          custom_fields:         body.custom_fields ?? [],
        });

        return json({
          subscription_id: result.data?.id,
          email:           result.data?.email,
          status:          result.data?.status,
          created_at:      result.data?.created_at,
        });
      }

      case "list_subscribers": {
        const limit  = Math.min(Number(body.limit ?? 20), 100);
        const status = body.status ?? "active"; // active | inactive | pending
        const result = await bhReq(`/publications/${BH_PUB}/subscriptions?limit=${limit}&status=${status}`);

        return json({
          subscribers: (result.data ?? []).map((s: any) => ({
            id:         s.id,
            email:      s.email,
            status:     s.status,
            tier:       s.tier,
            created_at: s.created_at,
            utm_source: s.utm_source,
          })),
          total: result.total_results,
        });
      }

      case "get_subscriber": {
        const email = String(body.email ?? "");
        if (!email) return json({ error: "email required" }, 400);

        const result = await bhReq(`/publications/${BH_PUB}/subscriptions/by_email/${encodeURIComponent(email)}`);
        return json(result.data ?? { error: "Subscriber not found" });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: create_post | publish_post | list_posts | get_stats | add_subscriber | list_subscribers | get_subscriber`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-beehiiv-agent]", message);
    return json({ error: message }, message.includes("not configured") ? 503 : 500);
  }
});
