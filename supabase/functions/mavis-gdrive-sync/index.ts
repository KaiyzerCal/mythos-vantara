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

async function getFileContent(fileId: string, mimeType: string, token: string): Promise<string> {
  const exportMap: Record<string, string> = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
  };
  const exportMime = exportMap[mimeType];
  if (exportMime) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return "[Export failed]";
    return (await res.text()).slice(0, 6000);
  }
  return `[File type: ${mimeType} — metadata only]`;
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
    const maxFiles = body.max_files ?? 50;

    // Get gdrive OAuth config
    const { data: integration } = await adminSb
      .from("mavis_user_integrations")
      .select("config")
      .eq("user_id", uid)
      .eq("provider", "gdrive")
      .single();

    if (!integration?.config) {
      return new Response(
        JSON.stringify({ error: "Google Drive not connected. Add OAuth credentials in Integrations." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const config = integration.config;
    const token = await refreshGoogleToken(config, adminSb, uid, "gdrive");

    // List files
    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?pageSize=${maxFiles}&fields=files(id,name,mimeType,modifiedTime,owners,webViewLink)&orderBy=modifiedTime+desc`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const listData = await listRes.json();
    const files = listData.files ?? [];

    let count = 0;
    let skipCount = 0;

    for (const file of files) {
      try {
        const content = await getFileContent(file.id, file.mimeType, token);

        await adminSb.from("mavis_notes").upsert(
          {
            user_id: uid,
            title: `[Drive] ${file.name}`,
            content: content,
            tags: ["gdrive", "document", "knowledge"],
            properties: {
              source: "gdrive",
              file_id: file.id,
              mime_type: file.mimeType,
              modified: file.modifiedTime,
              url: file.webViewLink,
              owner: file.owners?.[0]?.displayName ?? "",
            },
            importance: 5,
          },
          { onConflict: "user_id,title" },
        );
        count++;
      } catch {
        skipCount++;
      }

      // 200ms delay between files to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return new Response(
      JSON.stringify({ synced: count, skipped: skipCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
