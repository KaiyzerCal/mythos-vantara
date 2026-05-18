import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshGoogleToken(config: any, adminSb: any, uid: string, provider: string): Promise<string> {
  if (config.expires_at && config.expires_at > Date.now() / 1000 + 300) return config.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      refresh_token: config.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed: " + JSON.stringify(data));
  const newConfig = {
    ...config,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  };
  await adminSb.from("mavis_user_integrations").update({ config: newConfig }).eq("user_id", uid).eq("provider", provider);
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSb = createClient(supabaseUrl, serviceRoleKey);

    // Auth → uid
    let uid: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const userSb = createClient(supabaseUrl, token);
      const { data: { user } } = await userSb.auth.getUser();
      uid = user?.id ?? null;
    }
    if (!uid) uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? null;
    if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const direction: "pull" | "push" | "sync" = body.direction ?? "sync";

    // Get google_tasks OAuth config
    const { data: integration } = await adminSb
      .from("mavis_user_integrations")
      .select("config")
      .eq("user_id", uid)
      .eq("provider", "google_tasks")
      .single();

    if (!integration?.config) {
      return new Response(
        JSON.stringify({ error: "Google Tasks not connected. Add OAuth credentials in Integrations." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const config = integration.config;
    const token = await refreshGoogleToken(config, adminSb, uid, "google_tasks");

    // Get task list — use first list ID
    const listsRes = await fetch(
      "https://www.googleapis.com/tasks/v1/users/@me/lists?maxResults=10",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const listsData = await listsRes.json();
    const listId = listsData.items?.[0]?.id;

    if (!listId) {
      return new Response(
        JSON.stringify({ error: "No Google Task lists found." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let pullCount = 0;
    let pushCount = 0;

    // PULL: Google Tasks → MAVIS
    if (direction === "pull" || direction === "sync") {
      const gtRes = await fetch(
        `https://www.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=false&maxResults=50`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const gtData = await gtRes.json();
      for (const gt of gtData.items ?? []) {
        await adminSb
          .from("tasks")
          .upsert(
            {
              user_id: uid,
              title: gt.title,
              status: gt.status === "completed" ? "completed" : "active",
              due_date: gt.due ? gt.due.slice(0, 10) : null,
              type: "task",
              source: "google_tasks",
              external_id: gt.id,
            },
            { onConflict: "user_id,external_id" },
          )
          .catch(() => {
            // tasks table may not have external_id — insert only if not exists
            adminSb.from("tasks").insert({ user_id: uid, title: gt.title, status: "active", type: "task" }).catch(() => {});
          });
        pullCount++;
      }
    }

    // PUSH: MAVIS → Google Tasks
    if (direction === "push" || direction === "sync") {
      const { data: mavisTasks } = await adminSb
        .from("tasks")
        .select("id,title,due_date,status")
        .eq("user_id", uid)
        .eq("status", "active")
        .is("external_id", null)
        .limit(20);

      for (const t of mavisTasks ?? []) {
        const taskBody: any = { title: t.title, status: "needsAction" };
        if (t.due_date) taskBody.due = new Date(t.due_date).toISOString();
        const res = await fetch(
          `https://www.googleapis.com/tasks/v1/lists/${listId}/tasks`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(taskBody),
          },
        );
        const created = await res.json();
        if (created.id) {
          await adminSb.from("tasks").update({ external_id: created.id }).eq("id", t.id).catch(() => {});
        }
        pushCount++;
      }
    }

    return new Response(
      JSON.stringify({ pull: pullCount, push: pushCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
