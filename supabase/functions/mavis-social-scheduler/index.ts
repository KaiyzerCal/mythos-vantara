// MAVIS Social Scheduler
// Runs hourly (cron) to publish queued/scheduled social posts.
// Picks up posts where status='scheduled' AND scheduled_at <= now(),
// and also auto-posts 'queued' posts older than 1 hour.
// Posts to Twitter/X by calling the mavis-nora-post edge function.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

// ─────────────────────────────────────────────────────────────
// Post a single social post record
// ─────────────────────────────────────────────────────────────

async function postRecord(post: any): Promise<{ success: boolean; error?: string }> {
  const platform = (post.platform ?? "").toLowerCase();

  if (platform === "twitter" || platform === "x") {
    // Delegate to mavis-nora-post edge function
    const functionUrl = `${SUPABASE_URL}/functions/v1/mavis-nora-post`;

    try {
      const res = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          userId:  post.user_id,
          content: post.content,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { success: false, error: `mavis-nora-post error (${res.status}): ${errText.slice(0, 200)}` };
      }

      const data = await res.json() as any;
      if (!data.success) {
        return { success: false, error: data.error ?? "Unknown posting error" };
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message ?? "fetch error" };
    }
  }

  // Unsupported platform — skip gracefully
  return { success: false, error: `Unsupported platform: ${platform}` };
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const now           = new Date();
    const oneHourAgo    = new Date(now.getTime() - 3600_000).toISOString();
    const nowIso        = now.toISOString();

    // Fetch posts due for publishing
    const [scheduledRes, queuedRes] = await Promise.all([
      // Explicitly scheduled posts whose time has come
      supabase
        .from("mavis_social_posts")
        .select("id, user_id, platform, content, scheduled_at")
        .eq("status", "scheduled")
        .lte("scheduled_at", nowIso)
        .limit(50),

      // Queued posts older than 1 hour (auto-publish)
      supabase
        .from("mavis_social_posts")
        .select("id, user_id, platform, content, created_at")
        .eq("status", "queued")
        .lt("created_at", oneHourAgo)
        .limit(50),
    ]);

    const scheduledPosts = (scheduledRes.data ?? []) as any[];
    const queuedPosts    = (queuedRes.data ?? []) as any[];

    // De-duplicate by id in case any overlap
    const seen = new Set<string>();
    const allPosts: any[] = [];
    for (const p of [...scheduledPosts, ...queuedPosts]) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        allPosts.push(p);
      }
    }

    let posted = 0;
    let failed = 0;

    for (const post of allPosts) {
      const result = await postRecord(post);
      const postedAt = new Date().toISOString();

      if (result.success) {
        await supabase
          .from("mavis_social_posts")
          .update({ status: "posted", posted_at: postedAt })
          .eq("id", post.id);
        posted++;
      } else {
        console.error(`[mavis-social-scheduler] post ${post.id} failed:`, result.error);
        await supabase
          .from("mavis_social_posts")
          .update({
            status: "failed",
            metadata: { error: result.error, failed_at: postedAt },
          })
          .eq("id", post.id);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ processed: allPosts.length, posted, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[mavis-social-scheduler]", err?.message ?? err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
