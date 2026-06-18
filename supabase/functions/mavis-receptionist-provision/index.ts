// mavis-receptionist-provision
// Provision VAPI phone numbers for receptionist businesses
// POST /provision → buy and assign a VAPI phone number to a business
// GET /numbers → list available phone numbers from VAPI
// DELETE /release → release a phone number

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPI_KEY = Deno.env.get("VAPI_API_KEY") ?? "";

const VAPI_BASE = "https://api.vapi.ai";

// The inbound webhook URL for MAVIS receptionist
const INBOUND_WEBHOOK_URL = `${SB_URL}/functions/v1/mavis-receptionist-inbound`;

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

  if (!VAPI_KEY) return json({ error: "VAPI_API_KEY not configured" }, 503);

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "provision";

  try {
    if (req.method === "GET" && action === "numbers") {
      // List available phone numbers from VAPI
      const res = await fetch(`${VAPI_BASE}/phone-number?limit=20`, {
        headers: { Authorization: `Bearer ${VAPI_KEY}` },
      });
      if (!res.ok) return json({ error: `VAPI error: ${res.status}` }, res.status);
      const data = await res.json();
      return json({ numbers: data });
    }

    if (req.method === "POST" && action === "provision") {
      const body = await req.json();
      const { business_id, area_code, country_code } = body;
      if (!business_id) return json({ error: "business_id is required" }, 400);

      // Verify business belongs to user
      const { data: biz } = await sb
        .from("receptionist_businesses")
        .select("id, name")
        .eq("id", business_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (!biz) return json({ error: "Business not found" }, 404);

      // Check if already has a phone number
      const { data: existing } = await sb
        .from("receptionist_phone_numbers")
        .select("id, phone_number")
        .eq("business_id", business_id)
        .eq("is_active", true)
        .maybeSingle();

      if (existing) {
        return json({ error: "Business already has an active phone number", phone_number: existing.phone_number }, 409);
      }

      // Buy a VAPI phone number (Twilio-backed via VAPI)
      const buyRes = await fetch(`${VAPI_BASE}/phone-number`, {
        method: "POST",
        headers: { Authorization: `Bearer ${VAPI_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "twilio",
          areaCode: area_code ?? "415",
          countryCode: country_code ?? "US",
          name: `MAVIS Receptionist — ${biz.name}`,
          serverUrl: INBOUND_WEBHOOK_URL,
          serverUrlSecret: Deno.env.get("VAPI_WEBHOOK_SECRET") ?? undefined,
          assistantId: undefined, // Dynamic assistant per-call via assistant-request webhook
        }),
      });

      if (!buyRes.ok) {
        const errText = await buyRes.text();
        return json({ error: `Failed to provision number: ${errText}` }, buyRes.status);
      }

      const vapiPhone = await buyRes.json();

      // Store in DB
      const { data: phoneRow, error: dbErr } = await sb
        .from("receptionist_phone_numbers")
        .insert({
          business_id,
          user_id: userId,
          phone_number: vapiPhone.number ?? vapiPhone.phoneNumber ?? "",
          vapi_phone_number_id: vapiPhone.id,
          is_active: true,
        })
        .select()
        .single();

      if (dbErr) {
        // Try to release the number since we couldn't store it
        await fetch(`${VAPI_BASE}/phone-number/${vapiPhone.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${VAPI_KEY}` },
        });
        throw dbErr;
      }

      return json({
        phone_number: phoneRow.phone_number,
        vapi_phone_number_id: vapiPhone.id,
        business_id,
        message: `Phone number ${phoneRow.phone_number} provisioned successfully for ${biz.name}`,
      }, 201);
    }

    if (req.method === "DELETE" && action === "release") {
      const body = await req.json();
      const { phone_number_id } = body;
      if (!phone_number_id) return json({ error: "phone_number_id is required" }, 400);

      // Verify ownership
      const { data: phoneRow } = await sb
        .from("receptionist_phone_numbers")
        .select("vapi_phone_number_id, business_id")
        .eq("id", phone_number_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (!phoneRow) return json({ error: "Phone number not found" }, 404);

      // Release from VAPI
      const releaseRes = await fetch(`${VAPI_BASE}/phone-number/${phoneRow.vapi_phone_number_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${VAPI_KEY}` },
      });

      if (!releaseRes.ok && releaseRes.status !== 404) {
        return json({ error: `VAPI release failed: ${releaseRes.status}` }, releaseRes.status);
      }

      // Mark inactive in DB
      await sb
        .from("receptionist_phone_numbers")
        .update({ is_active: false })
        .eq("id", phone_number_id)
        .eq("user_id", userId);

      return json({ released: true });
    }

    return json({ error: "Not found" }, 404);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[receptionist-provision] Error:", message);
    return json({ error: message }, 500);
  }
});
