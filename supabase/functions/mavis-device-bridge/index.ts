import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Resolve userId — support service-role pass-through (same pattern as mavis-actions)
    const body = await req.json();
    let userId: string;

    if (token === serviceRoleKey && body.userId) {
      userId = String(body.userId);
    } else {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data: userData, error: userError } = await userClient.auth.getUser(token);
      if (userError || !userData?.user?.id) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = userData.user.id;
    }

    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const action = String(body.action ?? "");

    // ── register_device ───────────────────────────────────────────────────
    if (action === "register_device") {
      const { data, error } = await sb.from("mavis_devices").insert({
        user_id: userId,
        name: String(body.name ?? "My Device"),
        device_type: String(body.device_type ?? "pc"),
        platform: body.platform ? String(body.platform) : null,
        status: "online",
        last_seen: new Date().toISOString(),
        metadata: body.metadata ?? {},
      }).select("id").single();

      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, device_id: data.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── queue_command ─────────────────────────────────────────────────────
    if (action === "queue_command") {
      const deviceId = String(body.device_id ?? "");
      if (!deviceId) throw new Error("queue_command requires device_id");

      const { data, error } = await sb.from("mavis_device_commands").insert({
        user_id: userId,
        device_id: deviceId,
        command_type: String(body.command_type ?? ""),
        params: body.params ?? {},
        status: "pending",
      }).select("id").single();

      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, command_id: data.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── get_devices ───────────────────────────────────────────────────────
    if (action === "get_devices") {
      const { data, error } = await sb
        .from("mavis_devices")
        .select("id, name, device_type, platform, status, last_seen, metadata, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, devices: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── get_command ───────────────────────────────────────────────────────
    if (action === "get_command") {
      const commandId = String(body.command_id ?? "");
      if (!commandId) throw new Error("get_command requires command_id");

      const { data, error } = await sb
        .from("mavis_device_commands")
        .select("*")
        .eq("id", commandId)
        .eq("user_id", userId)
        .single();

      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, command: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── list_commands ─────────────────────────────────────────────────────
    if (action === "list_commands") {
      const deviceId = String(body.device_id ?? "");
      if (!deviceId) throw new Error("list_commands requires device_id");

      const { data, error } = await sb
        .from("mavis_device_commands")
        .select("*")
        .eq("device_id", deviceId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, commands: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error("mavis-device-bridge error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
