// mavis-run-doctor — OpenClaw pattern: health diagnostics for all integrations
// Checks env vars, OAuth tokens, and API reachability
// Upserts results to mavis_health_checks per user

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type HealthStatus = "healthy" | "degraded" | "error" | "unconfigured" | "unknown";

interface CheckResult {
  integration_name: string;
  status: HealthStatus;
  response_ms: number;
  message: string;
}

// System-level checks (env var presence)
async function checkEnvVar(name: string, envKey: string): Promise<CheckResult> {
  const start = Date.now();
  const val = Deno.env.get(envKey);
  return {
    integration_name: name,
    status: val ? "healthy" : "unconfigured",
    response_ms: Date.now() - start,
    message: val ? `${envKey} is set` : `${envKey} is not configured`,
  };
}

// User OAuth token checks
async function checkOAuthToken(
  name: string,
  provider: string,
  userId: string,
  sb: ReturnType<typeof createClient>,
): Promise<CheckResult> {
  const start = Date.now();
  const { data } = await sb
    .from("mavis_user_integrations")
    .select("status, expires_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (!data) {
    return { integration_name: name, status: "unconfigured", response_ms: Date.now() - start, message: "Not connected" };
  }
  if (data.status !== "active") {
    return { integration_name: name, status: "error", response_ms: Date.now() - start, message: `Token status: ${data.status}` };
  }
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { integration_name: name, status: "degraded", response_ms: Date.now() - start, message: "Token expired — re-connect needed" };
  }
  return { integration_name: name, status: "healthy", response_ms: Date.now() - start, message: "Connected and active" };
}

// Telegram: check if bot token is set + bot is responsive
async function checkTelegram(): Promise<CheckResult> {
  const start = Date.now();
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return { integration_name: "telegram", status: "unconfigured", response_ms: 0, message: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) });
    const data = await r.json();
    return {
      integration_name: "telegram",
      status: data.ok ? "healthy" : "error",
      response_ms: Date.now() - start,
      message: data.ok ? `Bot: @${data.result?.username}` : data.description,
    };
  } catch (e: any) {
    return { integration_name: "telegram", status: "error", response_ms: Date.now() - start, message: e.message };
  }
}

// Supabase itself
async function checkSupabase(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const r = await fetch(`${SB_URL}/rest/v1/`, {
      headers: { "apikey": SB_ANON, "Authorization": `Bearer ${SB_ANON}` },
      signal: AbortSignal.timeout(5000),
    });
    return {
      integration_name: "supabase",
      status: r.ok ? "healthy" : "degraded",
      response_ms: Date.now() - start,
      message: r.ok ? "Database reachable" : `HTTP ${r.status}`,
    };
  } catch (e: any) {
    return { integration_name: "supabase", status: "error", response_ms: Date.now() - start, message: e.message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const sbUser = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
    const { data: { user }, error } = await sbUser.auth.getUser(authHeader.replace("Bearer ", ""));
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sbAdmin = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

    // Run all checks in parallel
    const [
      supabaseCheck,
      telegramCheck,
      openaiCheck,
      anthropicCheck,
      geminiCheck,
      stripeCheck,
      vapiCheck,
      elevenlabsCheck,
      falCheck,
      googleCheck,
      spotifyCheck,
      stravaCheck,
      ouraCheck,
      whoopCheck,
      githubCheck,
    ] = await Promise.all([
      checkSupabase(),
      checkTelegram(),
      checkEnvVar("openai", "OPENAI_API"),
      checkEnvVar("anthropic", "ANTHROPIC_API_KEY"),
      checkEnvVar("gemini", "GEMINI_API_KEY"),
      checkEnvVar("stripe", "STRIPE_SECRET_KEY"),
      checkEnvVar("vapi", "VAPI_API_KEY"),
      checkEnvVar("elevenlabs", "ELEVENLABS_API_KEY"),
      checkEnvVar("fal_ai", "FAL_API_KEY"),
      checkOAuthToken("google", "google", user.id, sbAdmin),
      checkOAuthToken("spotify", "spotify", user.id, sbAdmin),
      checkOAuthToken("strava", "strava", user.id, sbAdmin),
      checkOAuthToken("oura", "oura", user.id, sbAdmin),
      checkOAuthToken("whoop", "whoop", user.id, sbAdmin),
      checkOAuthToken("github", "github", user.id, sbAdmin),
    ]);

    const checks: CheckResult[] = [
      supabaseCheck, telegramCheck, openaiCheck, anthropicCheck, geminiCheck,
      stripeCheck, vapiCheck, elevenlabsCheck, falCheck,
      googleCheck, spotifyCheck, stravaCheck, ouraCheck, whoopCheck, githubCheck,
    ];

    // Upsert all results
    for (const check of checks) {
      await sbAdmin.from("mavis_health_checks").upsert({
        user_id: user.id,
        integration_name: check.integration_name,
        status: check.status,
        response_ms: check.response_ms,
        message: check.message,
        checked_at: new Date().toISOString(),
      }, { onConflict: "user_id,integration_name" });
    }

    const healthy  = checks.filter(c => c.status === "healthy").length;
    const issues   = checks.filter(c => c.status === "error" || c.status === "degraded").length;
    const unconfig = checks.filter(c => c.status === "unconfigured").length;

    return new Response(
      JSON.stringify({ ok: true, checks, summary: { healthy, issues, unconfigured: unconfig, total: checks.length } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("mavis-run-doctor error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
