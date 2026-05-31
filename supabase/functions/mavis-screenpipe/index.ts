/**
 * MAVIS Screenpipe Integration — local desktop lifelogging context capture.
 * Screenpipe runs as a local daemon on port 3030 (default).
 * Supports OCR + Audio capture, MAVIS memory sync via Gemini summarization.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SCREENPIPE_URL  = Deno.env.get("SCREENPIPE_URL") ?? "http://localhost:3030";
const GEMINI_KEY      = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SVCKEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Screenpipe content types ──────────────────────────────────────────────────

interface ScreenpipeOCRContent {
  text:        string;
  app_name:    string;
  window_name: string;
  timestamp:   string;
}

interface ScreenpipeAudioContent {
  transcription: string;
  timestamp:     string;
}

interface ScreenpipeItem {
  type:    "OCR" | "Audio";
  content: ScreenpipeOCRContent | ScreenpipeAudioContent;
}

interface ScreenpipeSearchResult {
  data:       ScreenpipeItem[];
  pagination: { total: number; limit: number; offset: number };
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function dbInsert(table: string, row: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        SUPABASE_SVCKEY,
      "Authorization": `Bearer ${SUPABASE_SVCKEY}`,
      "Prefer":        "return=representation",
    },
    body: JSON.stringify(row),
  });
  return res.json();
}

// ── Screenpipe API helpers ────────────────────────────────────────────────────

async function screenpipeSearch(params: {
  query?:        string;
  limit?:        number;
  offset?:       number;
  content_type?: string;
}): Promise<ScreenpipeSearchResult> {
  const qs = new URLSearchParams({
    limit:        String(params.limit ?? 20),
    offset:       String(params.offset ?? 0),
    content_type: params.content_type ?? "all",
  });
  if (params.query) qs.set("q", params.query);

  const res = await fetch(`${SCREENPIPE_URL}/search?${qs}`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`Screenpipe returned ${res.status}`);
  return res.json() as Promise<ScreenpipeSearchResult>;
}

function isOfflineError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("connection refused") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("Failed to fetch") ||
    msg.includes("timed out");
}

const OFFLINE_RESPONSE = {
  status:  "offline",
  message: "Screenpipe daemon not running. Install from screenpipe.so",
};

// ── Gemini summarization ──────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function searchScreenpipe(req: ScreenpipeRequest) {
  const results = await screenpipeSearch({
    query:  req.query,
    limit:  req.limit ?? 20,
  });
  return results;
}

async function getRecent(req: ScreenpipeRequest) {
  const results = await screenpipeSearch({ limit: req.limit ?? 20 });
  return results;
}

async function getContext(_req: ScreenpipeRequest) {
  // Fetch last 20 entries as context window for MAVIS
  const results = await screenpipeSearch({ limit: 20 });
  const items = results.data;

  const contextText = items.map((item) => {
    if (item.type === "OCR") {
      const c = item.content as ScreenpipeOCRContent;
      return `[${item.type} @ ${c.timestamp}] App: ${c.app_name} | Window: ${c.window_name}\n${c.text}`;
    } else {
      const c = item.content as ScreenpipeAudioContent;
      return `[Audio @ ${c.timestamp}] ${c.transcription}`;
    }
  }).join("\n\n");

  return {
    items:        items.length,
    context_text: contextText,
    raw:          items,
  };
}

async function getActiveApp(req: ScreenpipeRequest) {
  const results = await screenpipeSearch({ limit: req.limit ?? 5, content_type: "all" });

  const ocrItems = results.data
    .filter((item) => item.type === "OCR")
    .map((item) => item.content as ScreenpipeOCRContent);

  if (ocrItems.length === 0) {
    return { active_app: null, window: null, message: "No recent OCR data" };
  }

  // Most recent OCR entry
  const latest = ocrItems[0];
  return {
    active_app:  latest.app_name,
    window:      latest.window_name,
    timestamp:   latest.timestamp,
    recent_apps: [...new Set(ocrItems.map((i) => i.app_name))],
  };
}

async function syncToMemory(req: ScreenpipeRequest) {
  const minutes = req.minutes_ago ?? 30;
  const results = await screenpipeSearch({ limit: req.limit ?? 50 });

  const items = results.data;
  if (items.length === 0) {
    return { memories_created: 0, message: "No screen activity to sync" };
  }

  const rawText = items.map((item) => {
    if (item.type === "OCR") {
      const c = item.content as ScreenpipeOCRContent;
      return `[${c.timestamp}] ${c.app_name}: ${c.text.slice(0, 300)}`;
    }
    const c = item.content as ScreenpipeAudioContent;
    return `[${c.timestamp}] Audio: ${c.transcription}`;
  }).join("\n");

  const summary = await callGemini([
    `You are MAVIS, an AI assistant synthesizing desktop activity into memory.`,
    `Summarize the following ${minutes}-minute screen/audio capture into a concise memory entry.`,
    `Focus on: what was the user working on, key decisions, important content seen.`,
    `Keep it under 300 words. Be specific about apps and tasks.\n\n`,
    rawText,
  ].join(""));

  // Store as MAVIS memory
  await dbInsert("mavis_agent_memories", {
    user_id:    req.user_id,
    content:    summary,
    source:     "screenpipe",
    created_at: new Date().toISOString(),
    metadata:   JSON.stringify({ items_captured: items.length, minutes_window: minutes }),
  });

  // Log sync
  await dbInsert("screenpipe_sync_log", {
    user_id:                req.user_id,
    items_synced:           items.length,
    memories_created:       1,
    context_window_minutes: minutes,
  });

  return { memories_created: 1, items_synced: items.length, summary };
}

// ── Request type ──────────────────────────────────────────────────────────────

interface ScreenpipeRequest {
  action:       "search" | "recent" | "get_context" | "get_active_app" | "sync_to_memory";
  query?:       string;
  minutes_ago?: number;
  limit?:       number;
  user_id:      string;
}

// ── Entry point ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body: ScreenpipeRequest = await req.json();
    const { action, user_id } = body;

    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    let data: unknown;

    try {
      switch (action) {
        case "search":        data = await searchScreenpipe(body); break;
        case "recent":        data = await getRecent(body);        break;
        case "get_context":   data = await getContext(body);       break;
        case "get_active_app": data = await getActiveApp(body);    break;
        case "sync_to_memory": data = await syncToMemory(body);    break;
        default:
          return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      }
    } catch (err: unknown) {
      if (isOfflineError(err)) {
        return new Response(JSON.stringify({ ok: true, data: OFFLINE_RESPONSE }), { headers: { ...CORS, "Content-Type": "application/json" } });
      }
      throw err;
    }

    return new Response(JSON.stringify({ ok: true, data }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
