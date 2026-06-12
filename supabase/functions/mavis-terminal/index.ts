// MAVIS Terminal — persistent shell sessions backed by E2B sandboxes.
// Unlike mavis-e2b-sandbox (one-shot), this keeps the sandbox alive across
// multiple commands so state like cwd and installed packages persists.
//
// Actions: create_session | exec | list_sessions | kill_session

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const E2B_BASE = "https://api.e2b.dev";
const E2B_API_KEY = Deno.env.get("E2B_API_KEY") ?? "";

// ── E2B helpers ───────────────────────────────────────────────────────────────

function e2bHeaders() {
  return { "Content-Type": "application/json", "X-API-Key": E2B_API_KEY };
}

async function createSandbox(): Promise<string> {
  const res = await fetch(`${E2B_BASE}/sandboxes`, {
    method: "POST",
    headers: e2bHeaders(),
    // 1800s = 30 minutes of inactivity before E2B reclaims it
    body: JSON.stringify({ template: "base", timeout: 1800 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`E2B create sandbox ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  const id: string = d.sandboxId ?? d.sandbox_id ?? d.id;
  if (!id) throw new Error("E2B returned no sandboxId");
  return id;
}

async function uploadFile(sandboxId: string, path: string, content: string): Promise<void> {
  const res = await fetch(`${E2B_BASE}/sandboxes/${sandboxId}/files`, {
    method: "POST",
    headers: e2bHeaders(),
    body: JSON.stringify({ path, content }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`E2B upload file ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function spawnProcess(sandboxId: string, cmd: string): Promise<string> {
  const res = await fetch(`${E2B_BASE}/sandboxes/${sandboxId}/processes`, {
    method: "POST",
    headers: e2bHeaders(),
    body: JSON.stringify({ cmd }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    if (res.status === 404) throw new Error("SANDBOX_DEAD");
    throw new Error(`E2B spawn ${res.status}: ${text}`);
  }
  const d = await res.json();
  const pid = String(d.pid ?? d.id ?? "");
  if (!pid) throw new Error("E2B returned no PID");
  return pid;
}

async function waitForProcess(
  sandboxId: string,
  pid: string,
  timeoutMs: number,
): Promise<{ output: string; exit_code: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${E2B_BASE}/sandboxes/${sandboxId}/processes/${pid}`, {
      headers: e2bHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`E2B poll ${res.status}`);
    const d = await res.json();
    if (d.finished === true || d.status === "finished" || d.status === "exited") {
      const out = [d.stdout ?? d.output ?? "", d.stderr ?? ""].filter(Boolean).join("\n").trim();
      return { output: out, exit_code: typeof d.exit_code === "number" ? d.exit_code : 0 };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Command timed out after ${timeoutMs / 1000}s`);
}

function killSandbox(sandboxId: string) {
  fetch(`${E2B_BASE}/sandboxes/${sandboxId}`, {
    method: "DELETE",
    headers: e2bHeaders(),
  }).catch(() => {});
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function resolveUid(req: Request, adminSb: any): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const { data: { user } } = await adminSb.auth.getUser(auth.slice(7));
    if (user?.id) return user.id;
  }
  return Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? null;
}

// ── Session helpers ───────────────────────────────────────────────────────────

/** Get or auto-create the most-recent active session for a user. */
async function resolveSession(
  adminSb: any,
  userId: string,
  sessionId: string | undefined,
  label: string,
): Promise<{ id: string; sandboxId: string; cwd: string; isNew: boolean }> {
  if (sessionId) {
    const { data } = await adminSb
      .from("mavis_terminal_sessions")
      .select("id, sandbox_id, cwd, status")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single();
    if (data) return { id: data.id, sandboxId: data.sandbox_id, cwd: data.cwd, isNew: false };
  }

  // Try most-recent active session
  const { data: existing } = await adminSb
    .from("mavis_terminal_sessions")
    .select("id, sandbox_id, cwd")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("last_used_at", { ascending: false })
    .limit(1)
    .single();

  if (existing) return { id: existing.id, sandboxId: existing.sandbox_id, cwd: existing.cwd, isNew: false };

  // No active session — create one
  return await createSession(adminSb, userId, label);
}

async function createSession(
  adminSb: any,
  userId: string,
  label: string,
): Promise<{ id: string; sandboxId: string; cwd: string; isNew: boolean }> {
  if (!E2B_API_KEY) throw new Error("E2B_API_KEY not configured. Add it in Supabase Vault to enable terminal sessions.");
  const sandboxId = await createSandbox();

  // Bootstrap the sandbox: create home dir, set up .bashrc
  try {
    const initPid = await spawnProcess(sandboxId, "mkdir -p /home/user && echo 'PS1=\"$ \"' > /root/.bashrc");
    await waitForProcess(sandboxId, initPid, 10_000);
  } catch { /* non-fatal bootstrap */ }

  const { data } = await adminSb
    .from("mavis_terminal_sessions")
    .insert({ user_id: userId, sandbox_id: sandboxId, label, cwd: "/home/user" })
    .select("id")
    .single();

  return { id: data.id, sandboxId, cwd: "/home/user", isNew: true };
}

/** Execute one command in a session, tracking cwd. */
async function execInSession(
  adminSb: any,
  userId: string,
  session: { id: string; sandboxId: string; cwd: string },
  command: string,
  timeoutMs: number,
): Promise<{ output: string; exit_code: number; cwd: string }> {
  // Wrap command so we capture the resulting cwd after execution.
  // The ##MAVIS_CWD## marker is stripped before returning to the caller.
  const wrapped = `bash -c 'cd ${JSON.stringify(session.cwd)} 2>/dev/null; ${command}; __RC__=$?; echo "##MAVIS_CWD##$(pwd)##"; exit $__RC__'`;

  const pid = await spawnProcess(session.sandboxId, wrapped);
  const { output, exit_code } = await waitForProcess(session.sandboxId, pid, timeoutMs);

  // Extract new cwd from output
  const cwdMatch = output.match(/##MAVIS_CWD##(.+?)##/);
  const newCwd = cwdMatch ? cwdMatch[1].trim() : session.cwd;
  const cleanOutput = output.replace(/##MAVIS_CWD##.+?##\n?/g, "").trim();

  // Persist updated cwd and touch last_used_at
  await adminSb
    .from("mavis_terminal_sessions")
    .update({ cwd: newCwd, last_used_at: new Date().toISOString() })
    .eq("id", session.id);

  return { output: cleanOutput, exit_code, cwd: newCwd };
}

// ── Main handler ──────────────────────────────────────────────────────────────

function json(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSb = createClient(supabaseUrl, serviceKey);

    const userId = await resolveUid(req, adminSb);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "exec";

    // ── create_session ─────────────────────────────────────────────────────
    if (action === "create_session") {
      const label: string = body.label ?? "Terminal";
      const { id, sandboxId, isNew: _ } = await createSession(adminSb, userId, label);
      return json({ session_id: id, sandbox_id: sandboxId, label, message: `Session "${label}" ready.` });
    }

    // ── exec ───────────────────────────────────────────────────────────────
    if (action === "exec") {
      const command: string = body.command ?? "";
      if (!command.trim()) return json({ error: "command is required" }, 400);
      const timeoutMs = Math.min(Number(body.timeout ?? 30) * 1000, 120_000);

      let session = await resolveSession(adminSb, userId, body.session_id, "Terminal");

      // Try to run; if the sandbox is dead, recreate and retry once
      let attempt = 0;
      while (attempt < 2) {
        try {
          const result = await execInSession(adminSb, userId, session, command, timeoutMs);
          return json({
            output: result.output,
            exit_code: result.exit_code,
            cwd: result.cwd,
            session_id: session.id,
            new_session: session.isNew,
          });
        } catch (err: any) {
          if (err.message === "SANDBOX_DEAD" && attempt === 0) {
            // Sandbox expired — spin up a fresh one and retry
            console.warn(`[mavis-terminal] Sandbox dead for session ${session.id}, recreating…`);
            await adminSb
              .from("mavis_terminal_sessions")
              .update({ status: "dead" })
              .eq("id", session.id);

            const fresh = await createSession(adminSb, userId, "Terminal (auto-recovered)");
            session = { ...fresh };
            attempt++;
            continue;
          }
          throw err;
        }
      }
    }

    // ── list_sessions ──────────────────────────────────────────────────────
    if (action === "list_sessions") {
      const { data } = await adminSb
        .from("mavis_terminal_sessions")
        .select("id, label, status, cwd, created_at, last_used_at")
        .eq("user_id", userId)
        .order("last_used_at", { ascending: false })
        .limit(20);
      return json({ sessions: data ?? [] });
    }

    // ── kill_session ───────────────────────────────────────────────────────
    if (action === "kill_session") {
      const sessionId: string = body.session_id;
      if (!sessionId) return json({ error: "session_id required" }, 400);
      const { data } = await adminSb
        .from("mavis_terminal_sessions")
        .select("sandbox_id")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .single();
      if (data?.sandbox_id) killSandbox(data.sandbox_id);
      await adminSb
        .from("mavis_terminal_sessions")
        .update({ status: "dead" })
        .eq("id", sessionId)
        .eq("user_id", userId);
      return json({ ok: true, message: "Session terminated." });
    }

    // ── write_file ─────────────────────────────────────────────────────────
    if (action === "write_file") {
      const path: string = body.path;
      const content: string = body.content ?? "";
      if (!path) return json({ error: "path required" }, 400);

      const session = await resolveSession(adminSb, userId, body.session_id, "Terminal");
      await uploadFile(session.sandboxId, path, content);
      await adminSb
        .from("mavis_terminal_sessions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", session.id);
      return json({ ok: true, path, session_id: session.id });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("[mavis-terminal]", err.message);
    return json({ error: err.message }, 500);
  }
});
