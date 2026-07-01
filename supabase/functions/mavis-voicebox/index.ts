import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// Proxy edge function for self-hosted Voicebox (https://github.com/KaiyzerCal/voicebox)
// When VOICEBOX_URL is set in Supabase secrets, all requests route through here.
// For local Voicebox (localhost:17493), the browser calls it directly — this function
// is only needed when Voicebox is deployed to a cloud server (Railway, Fly, VPS, etc).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errRes(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function safeFetch(url: string, opts?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(30000), ...opts });
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth — require valid Supabase token (not service role required, any authed user)
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return errRes("Unauthorized", 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser(token);
  if (!userData?.user?.id) return errRes("Unauthorized", 401);

  // Get voicebox base URL
  const vbUrl = (Deno.env.get("VOICEBOX_URL") ?? "").replace(/\/$/, "");
  if (!vbUrl) {
    return errRes(
      "VOICEBOX_URL not configured. Set this Supabase secret to your self-hosted Voicebox instance URL (e.g. https://voicebox.yourdomain.com). For local Voicebox, call localhost:17493 directly from the browser.",
      503,
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch { /* no body */ }

  const { action = "health", ...params } = body;

  switch (action) {
    // ── Health check ─────────────────────────────────────────────────────────
    case "health": {
      const res = await safeFetch(`${vbUrl}/`);
      if (!res || !res.ok) return errRes("Voicebox unreachable", 503);
      const data = await res.json().catch(() => ({}));
      return jsonRes({ ok: true, url: vbUrl, info: data });
    }

    // ── List voice profiles ───────────────────────────────────────────────────
    case "profiles": {
      const res = await safeFetch(`${vbUrl}/profiles`);
      if (!res || !res.ok) return errRes("Failed to fetch profiles", 502);
      return jsonRes(await res.json());
    }

    // ── Generate speech (stream → return WAV bytes) ───────────────────────────
    case "generate": {
      const { profile_id, text, language, engine, personality, max_chunk_chars } = params;
      if (!profile_id || !text) return errRes("profile_id and text are required");

      const res = await safeFetch(`${vbUrl}/generate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id, text, language, engine, personality, max_chunk_chars }),
      });
      if (!res || !res.ok) return errRes(`Generation failed: ${res?.status ?? "timeout"}`, 502);

      // Stream the WAV audio back to the client
      const audioBytes = await res.arrayBuffer();
      return new Response(audioBytes, {
        headers: {
          ...corsHeaders,
          "Content-Type": "audio/wav",
          "Content-Disposition": 'inline; filename="voicebox.wav"',
        },
      });
    }

    // ── Transcribe audio file ─────────────────────────────────────────────────
    // Note: client should send multipart formdata with 'audio_base64' and 'model'
    // We re-encode and forward to /transcribe
    case "transcribe": {
      const { audio_base64, filename = "audio.webm", model = "base", language } = params;
      if (!audio_base64) return errRes("audio_base64 required");

      // Decode base64 to bytes
      const binaryStr = atob(audio_base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      const form = new FormData();
      form.append("file", new Blob([bytes]), filename);
      if (model) form.append("model", model);
      if (language) form.append("language", language);

      const res = await safeFetch(`${vbUrl}/transcribe`, { method: "POST", body: form });
      if (!res || !res.ok) return errRes(`Transcription failed: ${res?.status ?? "timeout"}`, 502);
      return jsonRes(await res.json());
    }

    // ── Generation history ────────────────────────────────────────────────────
    case "history": {
      const { profile_id, search, limit = 30, offset = 0 } = params;
      const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (profile_id) qs.set("profile_id", profile_id);
      if (search) qs.set("search", search);

      const res = await safeFetch(`${vbUrl}/history?${qs}`);
      if (!res || !res.ok) return errRes("Failed to fetch history", 502);
      return jsonRes(await res.json());
    }

    // ── Export a history item's audio ─────────────────────────────────────────
    case "export_audio": {
      const { generation_id } = params;
      if (!generation_id) return errRes("generation_id required");

      const res = await safeFetch(`${vbUrl}/history/${generation_id}/export-audio`);
      if (!res || !res.ok) return errRes("Audio not found", 404);
      const bytes = await res.arrayBuffer();
      return new Response(bytes, {
        headers: { ...corsHeaders, "Content-Type": "audio/wav" },
      });
    }

    // ── MCP speak (agent-triggered voice output) ──────────────────────────────
    case "speak": {
      const { text, profile, personality } = params;
      if (!text) return errRes("text required");

      const res = await safeFetch(`${vbUrl}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, profile, personality }),
      });
      if (!res || !res.ok) return errRes(`Speak failed: ${res?.status ?? "timeout"}`, 502);
      return jsonRes(await res.json());
    }

    default:
      return errRes(`Unknown action: ${action}`);
  }
});
