// MAVIS Data Export — exports key tables as JSON to Supabase storage for backup.
// Called daily by pg_cron. Keeps 30 days of rolling backups per user.
// Also callable manually: POST /functions/v1/mavis-data-export { user_id: "..." }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL   = Deno.env.get("SUPABASE_URL")!;
const SB_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET   = "mavis-backups";
const KEEP_DAYS = 30;

// Tables to export and their user_id column name (or null for shared tables)
const EXPORT_TABLES: Array<{ table: string; userCol: string; limit: number }> = [
  { table: "mavis_memory",       userCol: "user_id", limit: 5000  },
  { table: "mavis_knowledge",    userCol: "user_id", limit: 2000  },
  { table: "goals",              userCol: "user_id", limit: 1000  },
  { table: "contacts",           userCol: "user_id", limit: 2000  },
  { table: "workflows",          userCol: "user_id", limit: 500   },
  { table: "mavis_inbound_emails", userCol: "user_id", limit: 1000 },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

    // Auth: service role (cron) or authenticated user
    const auth = req.headers.get("Authorization") ?? "";
    let userId: string | null = null;
    let isServiceRole = false;

    if (auth === `Bearer ${SB_KEY}` || auth.includes("service_role")) {
      isServiceRole = true;
    } else if (auth.startsWith("Bearer ")) {
      const { data: { user } } = await sb.auth.getUser(auth.slice(7));
      userId = user?.id ?? null;
      if (!userId) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    } else {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const targetUserId: string | null = body.user_id ?? userId;

    // If service role without specific user, export all users (batch cron mode)
    const userIds: string[] = [];
    if (isServiceRole && !targetUserId) {
      const { data: users } = await sb.from("profiles").select("user_id").limit(200);
      userIds.push(...(users?.map((u: any) => u.user_id) ?? []));
    } else if (targetUserId) {
      userIds.push(targetUserId);
    }

    if (!userIds.length) {
      return new Response(JSON.stringify({ message: "No users to export" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results: { user_id: string; tables: string[]; path: string; error?: string }[] = [];

    for (const uid of userIds) {
      try {
        const exportData: Record<string, unknown[]> = {};

        for (const { table, userCol, limit } of EXPORT_TABLES) {
          const { data } = await sb.from(table).select("*").eq(userCol, uid).limit(limit).order("created_at", { ascending: false });
          exportData[table] = data ?? [];
        }

        const exportJson = JSON.stringify({ exported_at: new Date().toISOString(), user_id: uid, tables: exportData }, null, 2);
        const encoder    = new TextEncoder();
        const bytes      = encoder.encode(exportJson);

        const datePath = new Date().toISOString().split("T")[0];
        const filePath = `${uid}/${datePath}.json`;

        await sb.storage.from(BUCKET).upload(filePath, bytes, {
          contentType: "application/json",
          upsert: true,
        });

        // Clean up old backups (keep KEEP_DAYS)
        const { data: existing } = await sb.storage.from(BUCKET).list(uid, { limit: 100, sortBy: { column: "name", order: "asc" } });
        if (existing && existing.length > KEEP_DAYS) {
          const toDelete = existing.slice(0, existing.length - KEEP_DAYS).map((f: any) => `${uid}/${f.name}`);
          await sb.storage.from(BUCKET).remove(toDelete).catch(() => {});
        }

        const tableNames = Object.entries(exportData).filter(([, v]) => v.length > 0).map(([k]) => k);
        results.push({ user_id: uid, tables: tableNames, path: filePath });
      } catch (e: any) {
        results.push({ user_id: uid, tables: [], path: "", error: e.message });
      }
    }

    return new Response(
      JSON.stringify({ exported: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
