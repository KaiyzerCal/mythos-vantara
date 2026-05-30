import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const token = authHeader.slice(7);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const uid = user.id;

  // 1. Read GitHub PAT from mavis_user_integrations
  const { data: integRow, error: integErr } = await supabase
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", uid)
    .eq("provider", "github")
    .maybeSingle();

  if (integErr || !integRow?.config?.token) {
    return new Response(
      JSON.stringify({ error: "GitHub not connected. Add your PAT in Integrations." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const ghToken: string = integRow.config.token;
  const githubHeaders = {
    Authorization: `token ${ghToken}`,
    Accept: "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // 3. Fetch unread notifications
  let notifications: any[] = [];
  try {
    const notifRes = await fetch(
      "https://api.github.com/notifications?all=false&per_page=50",
      { headers: githubHeaders, signal: AbortSignal.timeout(30000) },
    );

    if (!notifRes.ok) {
      const errText = await notifRes.text();
      throw new Error(`GitHub API error (${notifRes.status}): ${errText.slice(0, 200)}`);
    }

    notifications = await notifRes.json() as any[];
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: `Failed to fetch GitHub notifications: ${e?.message}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!Array.isArray(notifications)) {
    notifications = [];
  }

  // 4. Upsert into mavis_notes
  if (notifications.length > 0) {
    const rows = notifications.map((notif) => ({
      user_id: uid,
      title: `[GitHub] ${notif.subject.title}`,
      content: `Repo: ${notif.repository.full_name}\nType: ${notif.subject.type}\nReason: ${notif.reason}\nURL: ${notif.subject.url ?? ""}`,
      tags: ["github", "notification", notif.reason, notif.subject.type.toLowerCase()],
      properties: {
        source: "github",
        repo: notif.repository.full_name,
        type: notif.subject.type,
        reason: notif.reason,
        updated_at: notif.updated_at,
      },
      importance: notif.reason === "mention" || notif.reason === "review_requested" ? 7 : 4,
    }));

    const { error: upsertErr } = await supabase
      .from("mavis_notes")
      .upsert(rows, { onConflict: "user_id,title" });

    if (upsertErr) {
      console.error("[mavis-github-sync] upsert error:", upsertErr.message);
      if (upsertErr.message?.includes("does not exist") || upsertErr.code === "42P01") {
        return new Response(
          JSON.stringify({ error: "mavis_notes table does not exist. Run the latest migration." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: `Database upsert failed: ${upsertErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // 5. Mark all notifications as read on GitHub
  try {
    await fetch("https://api.github.com/notifications", {
      method: "PATCH",
      headers: { ...githubHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e: any) {
    // Non-fatal: log and continue
    console.warn("[mavis-github-sync] failed to mark notifications as read:", e?.message);
  }

  return new Response(
    JSON.stringify({ synced: notifications.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
