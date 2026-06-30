// mavis-ruview-bridge
// Webhook receiver for RuView WiFi CSI sensor events.
// RuView POSTs presence, vitals, fall, sleep, and pose payloads here.
// State is upserted into mavis_ruview_state; fall events trigger a Telegram
// alert and a journal entry.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ruview-secret",
};

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET    = Deno.env.get("RUVIEW_WEBHOOK_SECRET") ?? "";
const TELEGRAM_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT_ID  = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface RuViewPayload {
  user_id:    string;
  node_id?:   string;
  event_type: "vitals" | "presence" | "fall" | "sleep" | "pose";
  presence?: {
    present:    boolean;
    n_persons:  number;
    confidence: number;
    room_id?:   string;
  };
  vitals?: {
    heart_rate_bpm:     number;
    breathing_rate_bpm: number;
    hrv_ms:             number;
    stress_score:       number;
  };
  sleep?: {
    stage:        string;
    apnea_events: number;
  };
  pose?: {
    confidence: number;
  };
  fall?: {
    detected: boolean;
  };
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // ── Secret validation ────────────────────────────────────────────────────
    // If RUVIEW_WEBHOOK_SECRET is set, the incoming header must match.
    // If not set (dev mode), all requests are accepted.
    if (WEBHOOK_SECRET) {
      const incoming = req.headers.get("x-ruview-secret") ?? "";
      if (incoming !== WEBHOOK_SECRET) {
        return json({ error: "Unauthorized" }, 401);
      }
    }

    // ── Parse body ───────────────────────────────────────────────────────────
    const payload = await req.json().catch(() => null) as RuViewPayload | null;
    if (!payload || !payload.user_id || !payload.event_type) {
      return json({ ok: false, error: "Invalid payload" }, 200);
    }

    const { user_id, node_id, event_type } = payload;

    const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ── Build upsert object from present fields ───────────────────────────────
    const upsert: Record<string, unknown> = {
      user_id,
      node_id:    node_id ?? null,
      updated_at: new Date().toISOString(),
    };

    if (payload.presence) {
      const p = payload.presence;
      upsert.present             = p.present;
      upsert.n_persons           = p.n_persons;
      upsert.presence_confidence = p.confidence;
      upsert.room_id             = p.room_id ?? null;
    }

    if (payload.vitals) {
      const v = payload.vitals;
      upsert.heart_rate_bpm     = v.heart_rate_bpm;
      upsert.breathing_rate_bpm = v.breathing_rate_bpm;
      upsert.hrv_ms             = v.hrv_ms;
      upsert.stress_score       = v.stress_score;
    }

    if (payload.sleep) {
      upsert.sleep_stage   = payload.sleep.stage;
      upsert.apnea_events  = payload.sleep.apnea_events;
    }

    if (payload.pose) {
      upsert.pose_confidence = payload.pose.confidence;
    }

    // ── Fall event handling ──────────────────────────────────────────────────
    const isFall = event_type === "fall" && payload.fall?.detected === true;

    if (isFall) {
      upsert.fall_detected = true;
      upsert.last_fall_at  = new Date().toISOString();
    }

    // ── Upsert state row ─────────────────────────────────────────────────────
    const { error: upsertError } = await adminSb
      .from("mavis_ruview_state")
      .upsert(upsert, { onConflict: "user_id" });

    if (upsertError) {
      console.warn("[ruview-bridge] upsert error:", upsertError.message);
    }

    // ── Fall side-effects ────────────────────────────────────────────────────
    if (isFall) {
      // Telegram alert
      if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_CHAT_ID,
              text:    "⚠️ FALL DETECTED — RuView sensor triggered. Check on Calvin immediately.",
            }),
            signal: AbortSignal.timeout(10_000),
          });
        } catch (err) {
          console.warn("[ruview-bridge] Telegram alert failed:", err);
        }
      }

      // Journal entry
      try {
        const { error: journalError } = await adminSb
          .from("journal_entries")
          .upsert({
            user_id,
            title:    "Fall Detected",
            content:  "RuView WiFi sensor detected a fall event.",
            category: "health",
            tags:     ["health", "ruview", "alert"],
          });

        if (journalError) {
          console.warn("[ruview-bridge] journal insert error:", journalError.message);
        }
      } catch (err) {
        console.warn("[ruview-bridge] journal insert failed:", err);
      }
    }

    return json({ ok: true, event_type });
  } catch (err) {
    console.warn("[ruview-bridge] unhandled error:", err);
    // Return 200 even on errors so RuView doesn't retry-flood
    return json({ ok: false, error: "Internal error" }, 200);
  }
});
