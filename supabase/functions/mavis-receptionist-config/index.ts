// mavis-receptionist-config
// CRUD for AI Receptionist business profiles
// GET / → list businesses for user
// POST / → create business
// PUT /:id → update business
// DELETE /:id → delete business

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Auth
  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(SB_URL, SB_KEY);
  const { data: { user }, error: authErr } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);
  const userId = user.id;

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // pathParts[0] = "functions", [1] = "v1", [2] = "mavis-receptionist-config", [3] = optional id
  const businessId = pathParts[3] ?? null;

  try {
    if (req.method === "GET") {
      // List all businesses for user with phone numbers and call counts
      const { data, error } = await sb
        .from("receptionist_businesses")
        .select(`
          *,
          receptionist_phone_numbers(id, phone_number, vapi_phone_number_id, is_active),
          receptionist_calls(count)
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return json({ businesses: data ?? [] });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { name, industry, description, greeting, hours, timezone, plan } = body;
      if (!name) return json({ error: "name is required" }, 400);

      const { data, error } = await sb
        .from("receptionist_businesses")
        .insert({
          user_id: userId,
          name,
          industry: industry ?? "general",
          description: description ?? "",
          greeting: greeting ?? `Thank you for calling ${name}. How can I help you today?`,
          hours: hours ?? null,
          timezone: timezone ?? "America/New_York",
          plan: plan ?? "starter",
        })
        .select()
        .single();

      if (error) throw error;
      return json({ business: data }, 201);
    }

    if (req.method === "PUT" && businessId) {
      const body = await req.json();
      const allowed = ["name", "industry", "description", "greeting", "hours", "timezone", "is_active", "plan"];
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const key of allowed) {
        if (key in body) updates[key] = body[key];
      }

      const { data, error } = await sb
        .from("receptionist_businesses")
        .update(updates)
        .eq("id", businessId)
        .eq("user_id", userId)
        .select()
        .single();

      if (error) throw error;
      if (!data) return json({ error: "Business not found" }, 404);
      return json({ business: data });
    }

    if (req.method === "DELETE" && businessId) {
      const { error } = await sb
        .from("receptionist_businesses")
        .delete()
        .eq("id", businessId)
        .eq("user_id", userId);

      if (error) throw error;
      return json({ deleted: true });
    }

    return json({ error: "Not found" }, 404);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[receptionist-config] Error:", message);
    return json({ error: message }, 500);
  }
});
