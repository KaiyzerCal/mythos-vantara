// MAVIS E2B Sandbox — sandboxed code execution via the E2B REST API.
// Accepts a code snippet and language, spins up an ephemeral sandbox,
// executes the code, streams back stdout/stderr, then tears down the sandbox.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Env ───────────────────────────────────────────────────────────────────────
const E2B_API_KEY = Deno.env.get("E2B_API_KEY") ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────
type Language = "python3" | "javascript" | "bash" | "r";

interface SandboxRequest {
  code: string;
  language: Language;
  timeout?: number;
}

interface SandboxResponse {
  output: string;
  exit_code: number;
  duration_ms: number;
  language: string;
}

interface SandboxErrorResponse {
  error: string;
  output: string;
}

// ── E2B API helpers ───────────────────────────────────────────────────────────

const E2B_BASE = "https://api.e2b.dev";

function e2bHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": E2B_API_KEY,
  };
}

/** Step 1 — Create an ephemeral sandbox and return its ID. */
async function createSandbox(): Promise<string> {
  const res = await fetch(`${E2B_BASE}/sandboxes`, {
    method: "POST",
    headers: e2bHeaders(),
    body: JSON.stringify({ template: "base", timeout: 300 }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`E2B create sandbox ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const sandboxId: string = data.sandboxId ?? data.sandbox_id ?? data.id;
  if (!sandboxId) throw new Error("E2B returned no sandboxId");
  return sandboxId;
}

/** Step 1b — Upload code to a temp file (used for python3 to avoid shell-escaping issues). */
async function uploadFile(sandboxId: string, path: string, content: string): Promise<void> {
  const res = await fetch(`${E2B_BASE}/sandboxes/${sandboxId}/files`, {
    method: "POST",
    headers: e2bHeaders(),
    body: JSON.stringify({ path, content }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`E2B upload file ${res.status}: ${errText.slice(0, 300)}`);
  }
}

/** Step 2 — Spawn a process inside the sandbox and return its PID. */
async function spawnProcess(sandboxId: string, cmd: string): Promise<string> {
  const res = await fetch(`${E2B_BASE}/sandboxes/${sandboxId}/processes`, {
    method: "POST",
    headers: e2bHeaders(),
    body: JSON.stringify({ cmd }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`E2B spawn process ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const pid: string = String(data.pid ?? data.id ?? "");
  if (!pid) throw new Error("E2B returned no process PID");
  return pid;
}

/** Step 3 — Poll until the process finishes, then return its output and exit code. */
async function waitForProcess(
  sandboxId: string,
  pid: string,
  timeoutMs: number,
): Promise<{ output: string; exit_code: number }> {
  const deadline = Date.now() + timeoutMs;
  const POLL_INTERVAL_MS = 500;

  while (Date.now() < deadline) {
    const res = await fetch(`${E2B_BASE}/sandboxes/${sandboxId}/processes/${pid}`, {
      headers: e2bHeaders(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`E2B poll process ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();

    if (data.finished === true || data.status === "finished" || data.status === "exited") {
      const stdout: string = data.stdout ?? data.output ?? "";
      const stderr: string = data.stderr ?? "";
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      const exit_code: number = typeof data.exit_code === "number" ? data.exit_code : 0;
      return { output: combined, exit_code };
    }

    // Process still running — wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Code execution timed out after ${timeoutMs / 1000}s`);
}

/** Step 4 — Delete the sandbox (fire-and-forget cleanup). */
function deleteSandbox(sandboxId: string): void {
  (async () => {
    try {
      await fetch(`${E2B_BASE}/sandboxes/${sandboxId}`, {
        method: "DELETE",
        headers: e2bHeaders(),
      });
    } catch (err) {
      console.warn(`[e2b-sandbox] Failed to delete sandbox ${sandboxId}:`, err);
    }
  })();
}

/** Build the shell command for the given language. */
function buildCmd(language: Language, code: string): string {
  switch (language) {
    case "python3":
      // python3 uses the uploaded /tmp/code.py to avoid shell-escaping issues
      return "python3 /tmp/code.py";
    case "javascript":
      return `node -e '${code}'`;
    case "bash":
      return `bash -c '${code}'`;
    case "r":
      return `Rscript -e '${code}'`;
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

// ── JWT auth (mirrors mavis-crew-orchestrator pattern) ────────────────────────
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";

async function getUserId(req: Request): Promise<string | null> {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;

    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (jwtSecret) {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(jwtSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signedPart = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const b64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const sig = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const valid = await crypto.subtle.verify("HMAC", key, sig, signedPart);
      if (!valid) return null;
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(
        atob(payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4)),
      );
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload.sub ?? null;
    }

    // Fallback: ask Supabase to validate the token
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.4");
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const userSb = createClient(SB_URL, token, { auth: { persistSession: false } });
    const { data } = await userSb.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  const userId = await getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Guard: E2B API key ──────────────────────────────────────────────────────
  if (!E2B_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          "E2B_API_KEY is not configured. Set this secret in your Supabase project to enable sandboxed code execution. " +
          "Get your key at https://e2b.dev.",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: SandboxRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const code = String(body.code ?? "").trim();
  if (!code) {
    return new Response(JSON.stringify({ error: '"code" is required' }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const language = body.language as Language;
  const validLanguages: Language[] = ["python3", "javascript", "bash", "r"];
  if (!validLanguages.includes(language)) {
    return new Response(
      JSON.stringify({
        error: `"language" must be one of: ${validLanguages.join(", ")}`,
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Clamp timeout: default 30s, max 120s
  const rawTimeout = Number(body.timeout ?? 30);
  const timeoutSec = Math.max(1, Math.min(120, isNaN(rawTimeout) ? 30 : rawTimeout));
  const timeoutMs = timeoutSec * 1000;

  const overallStart = Date.now();
  let sandboxId: string | null = null;

  try {
    // ── Step 1: Create sandbox ──────────────────────────────────────────────
    sandboxId = await createSandbox();
    console.log(`[e2b-sandbox] Created sandbox ${sandboxId} for user ${userId}`);

    // ── Step 1b: Upload code file for python3 ─────────────────────────────
    if (language === "python3") {
      await uploadFile(sandboxId, "/tmp/code.py", code);
    }

    // ── Step 2: Build command and spawn process ────────────────────────────
    const cmd = buildCmd(language, code);
    const pid = await spawnProcess(sandboxId, cmd);
    console.log(`[e2b-sandbox] Spawned PID ${pid} in sandbox ${sandboxId}`);

    // ── Step 3: Poll for completion ───────────────────────────────────────
    const { output, exit_code } = await waitForProcess(sandboxId, pid, timeoutMs);

    // ── Step 4: Cleanup (fire-and-forget) ─────────────────────────────────
    deleteSandbox(sandboxId);

    const response: SandboxResponse = {
      output,
      exit_code,
      duration_ms: Date.now() - overallStart,
      language,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[e2b-sandbox] Execution error:", message);

    // Attempt cleanup if we managed to create a sandbox
    if (sandboxId) deleteSandbox(sandboxId);

    const errorResponse: SandboxErrorResponse = {
      error: message,
      output: "",
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
