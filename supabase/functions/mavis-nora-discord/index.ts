// MAVIS Nora Discord — Two-in-one:
//   1. POST with { action: "post" }  — posts Nora's content to a Discord channel via webhook.
//   2. POST with { action: "interact" } — handles incoming Discord slash command interactions.
//
// Auth:
//   - "post" action: Bearer JWT required.
//   - "interact" action: Discord Ed25519 signature verification (no JWT).
//
// Required env vars:
//   DISCORD_NORA_WEBHOOK_URL  — Discord incoming webhook URL for Nora's channel
//   DISCORD_PUBLIC_KEY        — Ed25519 public key for interaction verification
//   ANTHROPIC_API_KEY         — for AI content generation

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISCORD_WEBHOOK_URL = Deno.env.get("DISCORD_NORA_WEBHOOK_URL") ?? "";
const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const { data } = await adminSb.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const len = hex.length;
  const bytes = new Uint8Array(Math.floor(len / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ── Ed25519 Discord signature verification ────────────────────────────────────

async function verifyDiscordSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    const publicKeyBytes = hexToBytes(publicKeyHex);
    const signatureBytes = hexToBytes(signature);
    const message = new TextEncoder().encode(timestamp + rawBody);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    return await crypto.subtle.verify("Ed25519", cryptoKey, signatureBytes, message);
  } catch (err) {
    console.error("[mavis-nora-discord] Ed25519 verify error:", err);
    return false;
  }
}

// ── Claude content generation ─────────────────────────────────────────────────

async function generateDiscordMessage(prompt?: string): Promise<string> {
  const userPrompt = prompt && prompt.trim()
    ? prompt
    : "Share a quick insight or thought as Nora Vale — something useful for founders or operators in the Discord community.";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: `You are Nora Vale — business strategist, founder, AI automation builder.
You're writing in a Discord server for builders and founders.
Casual but sharp tone. Can use Discord markdown (**bold**, *italic*, \`code\`, > quotes).
1-2 paragraphs max. Add genuine value. Skip generic intros.`,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text?.trim() ?? "";
}

// ── Post action handler ───────────────────────────────────────────────────────

async function handlePost(
  req: Request,
  body: { content?: string; generate?: boolean; generate_prompt?: string },
): Promise<Response> {
  const userId = await resolveUserId(req);
  if (!userId) return json({ error: "Unauthorized — valid Bearer JWT required" }, 401);

  if (!DISCORD_WEBHOOK_URL) {
    return json({ ok: false, error: "DISCORD_NORA_WEBHOOK_URL is not configured" }, 400);
  }

  let content = body.content?.trim() ?? "";
  const shouldGenerate = body.generate === true || !content;

  if (shouldGenerate) {
    if (!ANTHROPIC_KEY) {
      return json({ ok: false, error: "ANTHROPIC_API_KEY is not configured for generation" }, 400);
    }
    try {
      content = await generateDiscordMessage(body.generate_prompt);
    } catch (err) {
      return json({ ok: false, error: `Generation failed: ${err instanceof Error ? err.message : String(err)}` }, 500);
    }
  }

  if (!content) {
    return json({ ok: false, error: "No content to post" }, 400);
  }

  const discordBody = {
    content,
    username: "Nora Vale",
    avatar_url: "",
  };

  const discordRes = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(discordBody),
  });

  if (!discordRes.ok) {
    const errText = await discordRes.text();
    return json(
      { ok: false, error: `Discord webhook error (${discordRes.status}): ${errText}` },
      500,
    );
  }

  return json({ ok: true, content });
}

// ── Interaction action handler ────────────────────────────────────────────────

async function handleInteract(req: Request, rawBody: string): Promise<Response> {
  if (!DISCORD_PUBLIC_KEY) {
    console.error("[mavis-nora-discord] DISCORD_PUBLIC_KEY is not set — cannot verify interactions");
    return new Response("Forbidden", { status: 401 });
  }

  const signature = req.headers.get("X-Signature-Ed25519") ?? req.headers.get("x-signature-ed25519") ?? "";
  const timestamp = req.headers.get("X-Signature-Timestamp") ?? req.headers.get("x-signature-timestamp") ?? "";

  if (!signature || !timestamp) {
    return new Response("Missing signature headers", { status: 401 });
  }

  const valid = await verifyDiscordSignature(rawBody, signature, timestamp, DISCORD_PUBLIC_KEY);
  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }

  let interaction: { type: number; data?: { name?: string; options?: Array<{ name: string; value: unknown }> } };
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // PING — Discord endpoint verification
  if (interaction.type === 1) {
    return new Response(JSON.stringify({ type: 1 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // APPLICATION_COMMAND
  if (interaction.type === 2) {
    const commandName = interaction.data?.name ?? "unknown";
    const options = interaction.data?.options ?? [];

    let reply = "";
    if (ANTHROPIC_KEY) {
      try {
        const optionsText = options.length > 0
          ? ` with options: ${options.map((o) => `${o.name}=${o.value}`).join(", ")}`
          : "";
        reply = await generateDiscordMessage(
          `Respond to the /${commandName} slash command${optionsText}. Be helpful and in-character as Nora Vale.`,
        );
      } catch {
        reply = "Hey! I'm Nora Vale. I'm here to talk revenue systems, AI automation, and founder strategy. What's on your mind?";
      }
    } else {
      reply = `Command /${commandName} received. ANTHROPIC_API_KEY is not configured for response generation.`;
    }

    return new Response(
      JSON.stringify({ type: 4, data: { content: reply } }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Default: ACK
  return new Response(JSON.stringify({ type: 1 }), {
    headers: { "Content-Type": "application/json" },
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Read raw body once (needed for signature verification)
  const rawBody = await req.text();

  let body: { action?: string; content?: string; generate?: boolean; generate_prompt?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = body.action ?? "interact";

  if (action === "post") {
    return await handlePost(req, body);
  }

  // Default: handle as Discord interaction (action === "interact" or Discord sends direct POST)
  return await handleInteract(req, rawBody);
});
