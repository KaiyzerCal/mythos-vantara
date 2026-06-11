// MAVIS Home — Smart Home / IoT Integration
// Bridges MAVIS to Home Assistant (local or cloud) and Philips Hue.
// Env vars:
//   HOME_ASSISTANT_URL   — e.g. http://homeassistant.local:8123 or https://your-ha.duckdns.org
//   HOME_ASSISTANT_TOKEN — Long-lived access token from HA profile page
//   PHILIPS_HUE_BRIDGE   — Hue bridge IP (e.g. 192.168.1.10)
//   PHILIPS_HUE_TOKEN    — Hue bridge username/token

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HA_URL  = Deno.env.get("HOME_ASSISTANT_URL") ?? "";
const HA_TOK  = Deno.env.get("HOME_ASSISTANT_TOKEN") ?? "";
const HUE_BRIDGE = Deno.env.get("PHILIPS_HUE_BRIDGE") ?? "";
const HUE_TOKEN  = Deno.env.get("PHILIPS_HUE_TOKEN") ?? "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Home Assistant helpers ───────────────────────────────────────────────────

async function haGetStates(): Promise<any[]> {
  if (!HA_URL || !HA_TOK) return [];
  const res = await fetch(`${HA_URL}/api/states`, {
    headers: { Authorization: `Bearer ${HA_TOK}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  return await res.json();
}

async function haCallService(domain: string, service: string, entityId: string, extraData: Record<string, unknown> = {}): Promise<boolean> {
  if (!HA_URL || !HA_TOK) return false;
  const res = await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${HA_TOK}`, "Content-Type": "application/json" },
    body: JSON.stringify({ entity_id: entityId, ...extraData }),
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}

// ── Philips Hue helpers ──────────────────────────────────────────────────────

async function hueGetLights(): Promise<any> {
  if (!HUE_BRIDGE || !HUE_TOKEN) return {};
  const res = await fetch(`http://${HUE_BRIDGE}/api/${HUE_TOKEN}/lights`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return {};
  return await res.json();
}

async function hueSetLight(lightId: string, state: Record<string, unknown>): Promise<boolean> {
  if (!HUE_BRIDGE || !HUE_TOKEN) return false;
  const res = await fetch(`http://${HUE_BRIDGE}/api/${HUE_TOKEN}/lights/${lightId}/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
    signal: AbortSignal.timeout(8000),
  });
  return res.ok;
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data: { user }, error: authErr } = await sb.auth.getUser(auth.replace("Bearer ", ""));
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  // Config check
  if (!HA_URL && !HUE_BRIDGE) {
    return json({
      error: "Smart home not configured",
      hint: "Set HOME_ASSISTANT_URL + HOME_ASSISTANT_TOKEN (for Home Assistant) or PHILIPS_HUE_BRIDGE + PHILIPS_HUE_TOKEN (for Hue) in Supabase Edge Function secrets.",
      configured: false,
    });
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { action } = body as { action: string; entity_id?: string; service?: string; domain?: string; state?: Record<string, unknown>; light_id?: string };

  switch (action) {

    case "get_states": {
      const states = await haGetStates();
      return json({ states: states.map((s: any) => ({
        entity_id: s.entity_id,
        state: s.state,
        friendly_name: s.attributes?.friendly_name,
        device_class: s.attributes?.device_class,
      }))});
    }

    case "call_service": {
      const { entity_id, domain = "homeassistant", service: svc = "toggle" } = body;
      if (!entity_id) return json({ error: "entity_id required" }, 400);
      const ok = await haCallService(domain, svc, entity_id, body.data ?? {});
      return json({ success: ok, entity_id, domain, service: svc });
    }

    case "turn_on":
    case "turn_off":
    case "toggle": {
      const { entity_id } = body;
      if (!entity_id) return json({ error: "entity_id required" }, 400);
      const domain = entity_id.split(".")[0] ?? "homeassistant";
      const ok = await haCallService(domain, action, entity_id, body.data ?? {});
      return json({ success: ok, entity_id, action });
    }

    case "set_scene": {
      const { entity_id } = body;
      if (!entity_id) return json({ error: "entity_id (scene id) required" }, 400);
      const ok = await haCallService("scene", "turn_on", entity_id);
      return json({ success: ok, scene: entity_id });
    }

    case "get_hue_lights": {
      const lights = await hueGetLights();
      return json({ lights });
    }

    case "set_hue_light": {
      const { light_id, state: lightState } = body;
      if (!light_id || !lightState) return json({ error: "light_id and state required" }, 400);
      const ok = await hueSetLight(light_id, lightState);
      return json({ success: ok, light_id });
    }

    case "status": {
      const haOk = HA_URL && HA_TOK;
      const hueOk = HUE_BRIDGE && HUE_TOKEN;
      return json({
        home_assistant: { configured: !!haOk, url: HA_URL ? new URL(HA_URL).hostname : null },
        philips_hue:    { configured: !!hueOk, bridge: HUE_BRIDGE || null },
      });
    }

    default:
      return json({ error: `Unknown action: ${action}` }, 400);
  }
});
