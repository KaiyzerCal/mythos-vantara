// MAVIS Python Exec — Sandboxed Python code execution via e2b.dev.
// Auth: Bearer user JWT.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const E2B_API_KEY = Deno.env.get("E2B_API_KEY") ?? "";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const userId = await resolveUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const code = String(body.code ?? "").trim();
  if (!code) return json({ error: "code is required" }, 400);

  const timeoutMs = Math.min(Number(body.timeout_ms ?? 30000), 60000);

  // Check E2B configuration
  if (!E2B_API_KEY) {
    return json({
      error: "Python execution not configured — set E2B_API_KEY in Supabase secrets",
      code: "not_configured",
    });
  }

  const startTime = Date.now();
  let sandboxId: string | null = null;

  try {
    // Step 1: Create e2b sandbox
    const createRes = await fetch("https://api.e2b.dev/sandboxes", {
      method: "POST",
      headers: {
        "X-API-Key": E2B_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template: "base",
        timeout: Math.floor(timeoutMs / 1000),
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return json({
        error: `Sandbox creation failed: ${createRes.status} ${errText}`,
        stdout: "",
        stderr: "",
        exit_code: -1,
        duration_ms: Date.now() - startTime,
      });
    }

    const createData = await createRes.json();
    sandboxId = createData.sandbox_id ?? createData.sandboxID ?? createData.id ?? null;

    if (!sandboxId) {
      return json({
        error: "Sandbox creation failed: no sandbox_id returned",
        stdout: "",
        stderr: "",
        exit_code: -1,
        duration_ms: Date.now() - startTime,
      });
    }

    // Step 2: Execute code in sandbox
    const execRes = await fetch(`https://api.e2b.dev/sandboxes/${sandboxId}/process`, {
      method: "POST",
      headers: {
        "X-API-Key": E2B_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cmd: "python3 -c",
        args: [code],
        timeout: timeoutMs,
      }),
    });

    let result: {
      stdout?: string;
      stderr?: string;
      exit_code?: number;
      exitCode?: number;
    } = {};

    if (execRes.ok) {
      try {
        result = await execRes.json();
      } catch {
        result = { stdout: "", stderr: "Failed to parse execution result", exit_code: -1 };
      }
    } else {
      const errText = await execRes.text();
      result = { stdout: "", stderr: `Execution request failed: ${execRes.status} ${errText}`, exit_code: -1 };
    }

    const exitCode = result.exit_code ?? result.exitCode ?? 0;
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const durationMs = Date.now() - startTime;

    return json({
      stdout,
      stderr,
      exit_code: exitCode,
      error: exitCode !== 0 ? stderr : null,
      duration_ms: durationMs,
    });

  } catch (err) {
    console.error("[mavis-python-exec] Execution error:", err);
    return json({
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exit_code: -1,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - startTime,
    });
  } finally {
    // Step 3: Always attempt sandbox deletion
    if (sandboxId) {
      try {
        await fetch(`https://api.e2b.dev/sandboxes/${sandboxId}`, {
          method: "DELETE",
          headers: { "X-API-Key": E2B_API_KEY },
        });
      } catch (cleanupErr) {
        console.error("[mavis-python-exec] Sandbox cleanup failed:", cleanupErr);
      }
    }
  }
});
