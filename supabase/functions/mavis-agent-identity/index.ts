// mavis-agent-identity
// Manages MAVIS's cryptographic identity for autonomous action signing and verification.
// Uses Web Crypto API (ECDSA P-256 / SHA-256) — no external dependencies required.
//
// Actions: generate_keypair | sign_action | verify_action | get_identity

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    let uid: string | null = null;

    const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

    if (authHeader === `Bearer ${SB_SRK}`) {
      const body = await req.json().catch(() => ({}));
      uid = String(body.userId ?? body.user_id ?? "");
      if (!uid) return json({ error: "userId required for service-role calls" }, 400);
      (req as any)._body = body;
    } else if (authHeader.startsWith("Bearer eyJ")) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      const userClient = createClient(SB_URL, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: ud } = await userClient.auth.getUser();
      if (!ud?.user?.id) return json({ error: "Unauthorized" }, 401);
      uid = ud.user.id;
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = (req as any)._body ?? await req.json().catch(() => ({}));
    const { action, ...params } = body as { action?: string; [k: string]: unknown };

    switch (action) {

      // ── generate_keypair ──────────────────────────────────────────────────────
      case "generate_keypair": {
        // Generate ECDSA P-256 key pair
        const keyPair = await crypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          true, // extractable
          ["sign", "verify"],
        );

        // Export public key as base64-encoded JWK
        const pubKeyJwk  = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
        const pubKeyB64  = btoa(JSON.stringify(pubKeyJwk));

        // Export private key as JWK (for operator to store as MAVIS_SIGNING_KEY)
        const privKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

        // Upsert public key into mavis_agent_identity
        const { error: upsertErr } = await sb
          .from("mavis_agent_identity")
          .upsert(
            { user_id: uid, public_key: pubKeyB64, algorithm: "ECDSA-P256-SHA256" },
            { onConflict: "user_id" },
          );

        if (upsertErr) throw new Error(`Failed to store public key: ${upsertErr.message}`);

        return json({
          public_key:     pubKeyB64,
          private_key_jwk: JSON.stringify(privKeyJwk),
          instruction:    "Store private_key_jwk as MAVIS_SIGNING_KEY in Supabase secrets (Settings → Edge Functions → Secrets). Never expose the private key.",
        });
      }

      // ── sign_action ───────────────────────────────────────────────────────────
      case "sign_action": {
        const { action_type, timestamp, params: actionParams } = params as {
          action_type?: string;
          timestamp?:   string;
          params?:      unknown;
        };

        if (!action_type) return json({ error: "action_type is required" }, 400);

        const ts = timestamp ?? new Date().toISOString();

        // Read private key from env
        const signingKeyRaw = Deno.env.get("MAVIS_SIGNING_KEY");
        if (!signingKeyRaw) {
          return json({ error: "MAVIS_SIGNING_KEY not configured. Run generate_keypair and store private_key_jwk as MAVIS_SIGNING_KEY in Supabase secrets." }, 503);
        }

        let privKeyJwk: JsonWebKey;
        try {
          privKeyJwk = JSON.parse(atob(signingKeyRaw));
        } catch {
          return json({ error: "MAVIS_SIGNING_KEY is malformed — expected base64-encoded JWK JSON" }, 500);
        }

        const privKey = await crypto.subtle.importKey(
          "jwk",
          privKeyJwk,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign"],
        );

        const payload    = `${uid}:${action_type}:${ts}:${JSON.stringify(actionParams ?? {})}`;
        const enc        = new TextEncoder();
        const sigBuf     = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privKey, enc.encode(payload));
        const signature  = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

        return json({ signature, payload_hash: payload.slice(0, 100), timestamp: ts });
      }

      // ── verify_action ─────────────────────────────────────────────────────────
      case "verify_action": {
        const { action_type, timestamp, params: actionParams, signature } = params as {
          action_type?: string;
          timestamp?:   string;
          params?:      unknown;
          signature?:   string;
        };

        if (!action_type) return json({ error: "action_type is required" }, 400);
        if (!signature)   return json({ error: "signature is required" }, 400);
        if (!timestamp)   return json({ error: "timestamp is required" }, 400);

        // Fetch stored public key for this user
        const { data: identityRow, error: fetchErr } = await sb
          .from("mavis_agent_identity")
          .select("public_key, algorithm")
          .eq("user_id", uid)
          .maybeSingle();

        if (fetchErr) throw new Error(`Failed to fetch identity: ${fetchErr.message}`);
        if (!identityRow) return json({ valid: false, reason: "No identity found for user. Run generate_keypair first." });

        const publicKeyB64 = (identityRow as any).public_key as string;

        let pubKeyJwk: JsonWebKey;
        try {
          pubKeyJwk = JSON.parse(atob(publicKeyB64));
        } catch {
          return json({ valid: false, reason: "Stored public key is malformed" });
        }

        const pubKey = await crypto.subtle.importKey(
          "jwk",
          pubKeyJwk,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        );

        const payload = `${uid}:${action_type}:${timestamp}:${JSON.stringify(actionParams ?? {})}`;
        const enc     = new TextEncoder();

        let sigBuf: Uint8Array;
        try {
          sigBuf = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
        } catch {
          return json({ valid: false, reason: "signature is not valid base64" });
        }

        const valid = await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          pubKey,
          sigBuf,
          enc.encode(payload),
        );

        return json({ valid, userId: uid, action_type, timestamp });
      }

      // ── get_identity ──────────────────────────────────────────────────────────
      case "get_identity": {
        const { data: identityRow } = await sb
          .from("mavis_agent_identity")
          .select("public_key, algorithm, created_at")
          .eq("user_id", uid)
          .maybeSingle();

        const signingConfigured = Boolean(Deno.env.get("MAVIS_SIGNING_KEY"));

        if (!identityRow) {
          return json({
            configured:        false,
            signing_configured: signingConfigured,
            message:           "No identity found. Run generate_keypair to create one.",
          });
        }

        return json({
          configured:        true,
          signing_configured: signingConfigured,
          public_key:        (identityRow as any).public_key,
          algorithm:         (identityRow as any).algorithm,
          created_at:        (identityRow as any).created_at,
        });
      }

      default:
        return json({
          error: `Unknown action: ${action ?? "(none)"}. Use: generate_keypair | sign_action | verify_action | get_identity`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-agent-identity]", message);
    return json({ error: message }, 500);
  }
});
