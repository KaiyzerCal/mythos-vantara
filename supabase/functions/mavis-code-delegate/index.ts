/**
 * mavis-code-delegate — Devin 3 / Cursor Composer agentic coding delegation.
 *
 * Manages coding sessions with Devin AI or Cursor Composer as the backend.
 * Falls back to mock data when neither API key is configured.
 *
 * Required Supabase secrets (at least one):
 *   DEVIN_API_KEY
 *   CURSOR_API_KEY
 *
 * Request body:
 *   {
 *     action: "create_session" | "send_message" | "get_session" | "list_sessions",
 *     task?: string,          // for create_session
 *     session_id?: string,    // for send_message / get_session
 *     message?: string,       // for send_message
 *     user_id: string,
 *   }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEVIN_API_KEY = Deno.env.get("DEVIN_API_KEY") ?? "";
const DEVIN_BASE = "https://api.devin.ai/v1";

const CURSOR_KEY = Deno.env.get("CURSOR_API_KEY") ?? "";
const CURSOR_BASE = "https://api.cursor.sh/v1";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DelegateRequest {
  action: "create_session" | "send_message" | "get_session" | "list_sessions";
  task?: string;
  session_id?: string;
  message?: string;
  snapshot_id?: string;
  user_id: string;
}

interface NormalizedSession {
  session_id: string;
  status: string;
  url: string | null;
  messages: unknown[];
  prs_created: unknown[];
  provider: "devin" | "cursor" | "mock";
  task?: string;
  created_at?: string;
}

// ── Devin API ─────────────────────────────────────────────────────────────────

async function devinCreateSession(task: string, snapshot_id?: string): Promise<NormalizedSession> {
  const res = await fetch(`${DEVIN_BASE}/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEVIN_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: task,
      ...(snapshot_id ? { snapshot_id } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Devin create_session ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json() as Record<string, unknown>;

  return {
    session_id: (data.session_id ?? data.id) as string,
    status: (data.status as string) ?? "active",
    url: (data.url as string) ?? null,
    messages: [],
    prs_created: [],
    provider: "devin",
    task,
  };
}

async function devinSendMessage(session_id: string, message: string): Promise<NormalizedSession> {
  const res = await fetch(`${DEVIN_BASE}/sessions/${session_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEVIN_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Devin send_message ${res.status}: ${err.slice(0, 300)}`);
  }

  // After sending, fetch updated session state
  return devinGetSession(session_id);
}

async function devinGetSession(session_id: string): Promise<NormalizedSession> {
  const res = await fetch(`${DEVIN_BASE}/sessions/${session_id}`, {
    headers: { Authorization: `Bearer ${DEVIN_API_KEY}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Devin get_session ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json() as Record<string, unknown>;

  return {
    session_id,
    status: (data.status as string) ?? "active",
    url: (data.url as string) ?? null,
    messages: (data.messages as unknown[]) ?? [],
    prs_created: (data.pull_requests as unknown[]) ?? (data.prs as unknown[]) ?? [],
    provider: "devin",
  };
}

async function devinListSessions(): Promise<NormalizedSession[]> {
  const res = await fetch(`${DEVIN_BASE}/sessions`, {
    headers: { Authorization: `Bearer ${DEVIN_API_KEY}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Devin list_sessions ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json() as { sessions?: unknown[] } | unknown[];
  const sessions = Array.isArray(data) ? data : (data as { sessions?: unknown[] }).sessions ?? [];

  return sessions.map((s) => {
    const session = s as Record<string, unknown>;
    return {
      session_id: (session.session_id ?? session.id) as string,
      status: (session.status as string) ?? "active",
      url: (session.url as string) ?? null,
      messages: [],
      prs_created: [],
      provider: "devin" as const,
    };
  });
}

// ── Cursor Composer API ───────────────────────────────────────────────────────

async function cursorCreateSession(task: string): Promise<NormalizedSession> {
  const res = await fetch(`${CURSOR_BASE}/composer/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CURSOR_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: task }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cursor create_session ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json() as Record<string, unknown>;

  return {
    session_id: (data.session_id ?? data.id) as string,
    status: (data.status as string) ?? "active",
    url: (data.url as string) ?? null,
    messages: [],
    prs_created: [],
    provider: "cursor",
    task,
  };
}

async function cursorGetSession(session_id: string): Promise<NormalizedSession> {
  const res = await fetch(`${CURSOR_BASE}/composer/sessions/${session_id}`, {
    headers: { Authorization: `Bearer ${CURSOR_KEY}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cursor get_session ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json() as Record<string, unknown>;

  return {
    session_id,
    status: (data.status as string) ?? "active",
    url: (data.url as string) ?? null,
    messages: (data.messages as unknown[]) ?? [],
    prs_created: (data.pull_requests as unknown[]) ?? [],
    provider: "cursor",
  };
}

async function cursorSendMessage(session_id: string, message: string): Promise<NormalizedSession> {
  const res = await fetch(`${CURSOR_BASE}/composer/sessions/${session_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CURSOR_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cursor send_message ${res.status}: ${err.slice(0, 300)}`);
  }

  return cursorGetSession(session_id);
}

// ── Mock provider (no API keys configured) ────────────────────────────────────

function mockCreateSession(task: string): NormalizedSession {
  const session_id = `mock_${crypto.randomUUID()}`;
  return {
    session_id,
    status: "mock",
    url: null,
    messages: [
      {
        role: "system",
        content:
          "This is a mock session. Configure DEVIN_API_KEY or CURSOR_API_KEY in Supabase secrets to enable real code delegation.",
      },
      {
        role: "assistant",
        content: `I would work on: "${task}"\n\nWith a real Devin/Cursor integration, I would:\n1. Analyze your codebase\n2. Implement the requested changes\n3. Create a pull request\n4. Notify you when complete.`,
      },
    ],
    prs_created: [],
    provider: "mock",
    task,
    created_at: new Date().toISOString(),
  };
}

function mockGetSession(session_id: string): NormalizedSession {
  return {
    session_id,
    status: "mock",
    url: null,
    messages: [],
    prs_created: [],
    provider: "mock",
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function persistSession(
  sb: ReturnType<typeof createClient>,
  userId: string,
  session: NormalizedSession,
  taskDescription?: string,
): Promise<void> {
  try {
    await sb.from("code_delegation_sessions").upsert({
      user_id: userId,
      provider: session.provider,
      external_session_id: session.session_id,
      task_description: taskDescription ?? session.task ?? "(no description)",
      status: session.status,
      session_url: session.url,
      prs_created: session.prs_created,
      messages: session.messages,
      updated_at: new Date().toISOString(),
    }, { onConflict: "external_session_id" });
  } catch (e) {
    console.warn("[mavis-code-delegate] DB persist failed:", e);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Auth gate
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error: authErr } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as DelegateRequest;
    const { action, task, session_id, message, snapshot_id, user_id } = body;
    const resolvedUserId = user_id ?? user.id;

    // Determine active provider
    const hasDevin = Boolean(DEVIN_API_KEY);
    const hasCursor = Boolean(CURSOR_KEY);
    const useMock = !hasDevin && !hasCursor;

    let result: NormalizedSession | NormalizedSession[];

    switch (action) {
      case "create_session": {
        if (!task) {
          return new Response(JSON.stringify({ error: "task is required for create_session" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (useMock) {
          result = mockCreateSession(task);
        } else if (hasDevin) {
          result = await devinCreateSession(task, snapshot_id);
        } else {
          result = await cursorCreateSession(task);
        }

        await persistSession(sb, resolvedUserId, result as NormalizedSession, task);
        break;
      }

      case "send_message": {
        if (!session_id) {
          return new Response(JSON.stringify({ error: "session_id is required for send_message" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!message) {
          return new Response(JSON.stringify({ error: "message is required for send_message" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (useMock) {
          result = mockGetSession(session_id);
        } else if (hasDevin) {
          result = await devinSendMessage(session_id, message);
        } else {
          result = await cursorSendMessage(session_id, message);
        }

        await persistSession(sb, resolvedUserId, result as NormalizedSession);
        break;
      }

      case "get_session": {
        if (!session_id) {
          return new Response(JSON.stringify({ error: "session_id is required for get_session" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (useMock) {
          result = mockGetSession(session_id);
        } else if (hasDevin) {
          result = await devinGetSession(session_id);
        } else {
          result = await cursorGetSession(session_id);
        }

        await persistSession(sb, resolvedUserId, result as NormalizedSession);
        break;
      }

      case "list_sessions": {
        if (useMock) {
          // Return from DB for mock provider
          const { data: dbSessions } = await sb
            .from("code_delegation_sessions")
            .select("*")
            .eq("user_id", resolvedUserId)
            .order("created_at", { ascending: false })
            .limit(20);

          result = (dbSessions ?? []).map((s: Record<string, unknown>) => ({
            session_id: s.external_session_id as string,
            status: s.status as string,
            url: s.session_url as string | null,
            messages: (s.messages as unknown[]) ?? [],
            prs_created: (s.prs_created as unknown[]) ?? [],
            provider: (s.provider as "devin" | "cursor" | "mock"),
            task: s.task_description as string,
            created_at: s.created_at as string,
          }));
        } else if (hasDevin) {
          result = await devinListSessions();
        } else {
          // Cursor doesn't have a list endpoint; fall back to DB
          const { data: dbSessions } = await sb
            .from("code_delegation_sessions")
            .select("*")
            .eq("user_id", resolvedUserId)
            .eq("provider", "cursor")
            .order("created_at", { ascending: false })
            .limit(20);

          result = (dbSessions ?? []).map((s: Record<string, unknown>) => ({
            session_id: s.external_session_id as string,
            status: s.status as string,
            url: s.session_url as string | null,
            messages: [],
            prs_created: (s.prs_created as unknown[]) ?? [],
            provider: "cursor" as const,
            task: s.task_description as string,
          }));
        }
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-code-delegate]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
