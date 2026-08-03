// mavis-integration-test
// Live-pings a provider's real API with the user's saved credentials, instead
// of just checking that a row exists in mavis_user_integrations (which is all
// IntegrationsPage's "Test Connection" used to do — a dead key could still
// show as connected).
//
// Only side-effect-free GET/whoami-style endpoints are used. Providers without
// a tester here return verified:null — "key saved, not live-verified" — the
// frontend must not render that as a success, only as a neutral state.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

interface Verdict {
  verified: boolean | null; // true = live check passed, false = live check failed, null = no live check available
  note: string;
}

type Tester = (keys: Record<string, string>) => Promise<Verdict>;

async function testAnthropic(keys: Record<string, string>): Promise<Verdict> {
  const key = keys["API Key"];
  if (!key) return { verified: false, note: "No key saved" };
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  });
  return res.ok ? { verified: true, note: "Live" } : { verified: false, note: `Anthropic rejected the key (${res.status})` };
}

async function testOpenAI(keys: Record<string, string>): Promise<Verdict> {
  const key = keys["API Key"];
  if (!key) return { verified: false, note: "No key saved" };
  const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  return res.ok ? { verified: true, note: "Live" } : { verified: false, note: `OpenAI rejected the key (${res.status})` };
}

async function testStripe(keys: Record<string, string>): Promise<Verdict> {
  const key = keys["Secret Key"];
  if (!key) return { verified: false, note: "No key saved" };
  const res = await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${key}` } });
  return res.ok ? { verified: true, note: "Live" } : { verified: false, note: `Stripe rejected the key (${res.status})` };
}

async function testResend(keys: Record<string, string>): Promise<Verdict> {
  const key = keys["API Key"];
  if (!key) return { verified: false, note: "No key saved" };
  const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
  return res.ok ? { verified: true, note: "Live" } : { verified: false, note: `Resend rejected the key (${res.status})` };
}

async function testTelegram(keys: Record<string, string>): Promise<Verdict> {
  const token = keys["Bot Token"];
  if (!token) return { verified: false, note: "No bot token saved" };
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = await res.json().catch(() => ({}));
  return data?.ok
    ? { verified: true, note: `Live — @${data.result?.username ?? "bot"}` }
    : { verified: false, note: "Telegram rejected the bot token" };
}

async function testOura(keys: Record<string, string>): Promise<Verdict> {
  const token = keys["Personal Access Token"];
  if (!token) return { verified: false, note: "No token saved" };
  const res = await fetch("https://api.ouraring.com/v2/usercollection/personal_info", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok ? { verified: true, note: "Live" } : { verified: false, note: `Oura rejected the token (${res.status})` };
}

async function testGumroad(keys: Record<string, string>): Promise<Verdict> {
  const token = keys["Access Token"];
  if (!token) return { verified: false, note: "No token saved" };
  const res = await fetch(`https://api.gumroad.com/v2/user?access_token=${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  return data?.success ? { verified: true, note: "Live" } : { verified: false, note: "Gumroad rejected the token" };
}

const TESTERS: Record<string, Tester> = {
  anthropic: testAnthropic,
  openai: testOpenAI,
  stripe: testStripe,
  resend: testResend,
  telegram: testTelegram,
  oura: testOura,
  gumroad: testGumroad,
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const sb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { provider } = await req.json().catch(() => ({}));
    if (!provider) return json({ error: "provider required" }, 400);

    const { data: rows, error } = await sb
      .from("mavis_user_integrations")
      .select("key_name, key_value")
      .eq("user_id", user.id)
      .eq("provider", provider);
    if (error) return json({ error: error.message }, 500);

    const keys: Record<string, string> = {};
    for (const r of rows ?? []) keys[r.key_name] = r.key_value;

    if (Object.keys(keys).length === 0) {
      return json({ verified: false, note: "No credentials saved for this provider" } satisfies Verdict);
    }

    const tester = TESTERS[provider];
    if (!tester) {
      return json({ verified: null, note: "Credentials saved — live verification isn't available for this provider yet" } satisfies Verdict);
    }

    const result = await tester(keys);
    return json(result);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
