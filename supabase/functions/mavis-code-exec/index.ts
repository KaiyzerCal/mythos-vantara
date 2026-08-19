import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveAuthedUid } from "../_shared/auth.ts";

// Retrigger: live testing confirmed any authenticated (non-operator) user
// could still execute arbitrary code against the real project despite this
// operator-only check being merged — the deployed function was stale.
// Forcing a fresh deploy via PR to confirm it actually takes effect.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// This function runs arbitrary code — the PYTHON_SANDBOX_URL path is real
// remote code execution on the operator's own VPS, and the JS path's
// new Function() "sandbox" is escapable (constructor-chain access to
// globalThis is not actually blocked by curating which names are passed
// as parameters — a real fix means real process isolation, e.g. via E2B
// like mavis-e2b-sandbox already does correctly elsewhere in this repo;
// out of scope for this patch). Previously had no auth check of any kind
// beyond the platform gateway's verify_jwt=true — any authenticated user,
// not just the operator, could reach it. Restricted to the operator only,
// plus a simple per-minute rate limit as a second layer.
const OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? "";
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20; // executions per minute
function checkRate(uid: string): boolean {
  const now = Date.now();
  const e = rateMap.get(uid);
  if (!e || now > e.resetAt) { rateMap.set(uid, { count: 1, resetAt: now + 60_000 }); return true; }
  if (e.count >= RATE_LIMIT) return false;
  e.count++;
  return true;
}

// ── Self-hosted multi-language sandbox (optional) ─────────────────────────────
// Set PYTHON_SANDBOX_URL in edge function secrets to enable execution.
// Deploy sandbox/Dockerfile on any $4.50/mo VPS to self-host.
const PYTHON_SANDBOX_URL = Deno.env.get("PYTHON_SANDBOX_URL"); // e.g. "http://your-server:8080"

type SandboxLang = "python" | "node" | "typescript" | "bash";

function looksLikePython(code: string): boolean {
  return (
    /^\s*(import|from)\s+\w/m.test(code) ||
    /^\s*def\s+\w+\(/m.test(code) ||
    /^\s*class\s+\w+/m.test(code) ||
    /\bprint\s*\(/m.test(code) ||
    /^\s*#.*python/im.test(code) ||
    /\bpandas\b|\bnumpy\b|\bmatplotlib\b|\bscipy\b/i.test(code)
  );
}

async function runSandbox(code: string, language: SandboxLang): Promise<{ result?: string; output: string[]; error?: string; provider: string }> {
  if (!PYTHON_SANDBOX_URL) {
    return { output: [], error: `${language} execution requires PYTHON_SANDBOX_URL to be configured. See sandbox/README.md.`, provider: "none" };
  }
  try {
    const res = await fetch(`${PYTHON_SANDBOX_URL}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, language, timeout: 25 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Sandbox returned ${res.status}`);
    const d = await res.json();
    const combined = [d.stdout, d.stderr].filter(Boolean).join("\n").trim();
    return {
      result: d.returncode === 0 ? (d.stdout?.trim() || "(no output)") : undefined,
      output: combined ? combined.split("\n") : [],
      error: d.returncode !== 0 ? (d.error || d.stderr || "Execution failed") : d.error || undefined,
      provider: `${language}-sandbox`,
    };
  } catch (e: any) {
    return { output: [], error: `Sandbox error: ${e.message}`, provider: `${language}-sandbox` };
  }
}

// ── Restricted JS globals ─────────────────────────────────────────────────────
const SAFE_GLOBALS = {
  Math, JSON, Date, Array, Object, Number, String, Boolean, parseInt, parseFloat,
  isNaN, isFinite, encodeURIComponent, decodeURIComponent,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const adminSb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const uid = await resolveAuthedUid(req, adminSb);
    if (!uid) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!OPERATOR_USER_ID || uid !== OPERATOR_USER_ID) {
      return new Response(JSON.stringify({ error: "Forbidden — code execution is operator-only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!checkRate(uid)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded — too many executions this minute" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { code, language } = await req.json();
    if (!code?.trim()) {
      return new Response(JSON.stringify({ error: "code required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Route to sandbox for Python, Node, TypeScript, Bash ──────────────────
    const SANDBOX_LANGS: Record<string, SandboxLang> = {
      python: "python", node: "node", typescript: "typescript", bash: "bash",
    };
    const explicitSandboxLang = language ? SANDBOX_LANGS[language] : undefined;
    const isPython = explicitSandboxLang === "python" || (!explicitSandboxLang && looksLikePython(code));
    if (isPython || explicitSandboxLang) {
      const lang: SandboxLang = explicitSandboxLang ?? "python";
      const sandboxResult = await runSandbox(code, lang);
      return new Response(
        JSON.stringify(sandboxResult),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── JavaScript execution (sandboxed in-process) ───────────────────────────
    const output: string[] = [];
    const mockConsole = {
      log:   (...args: unknown[]) => output.push(args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")),
      error: (...args: unknown[]) => output.push("[ERR] " + args.join(" ")),
      warn:  (...args: unknown[]) => output.push("[WARN] " + args.join(" ")),
      table: (data: unknown) => output.push(JSON.stringify(data, null, 2)),
    };

    let result: unknown;
    let execError: string | undefined;

    try {
      const paramNames = ["console", ...Object.keys(SAFE_GLOBALS)];
      const paramValues = [mockConsole, ...Object.values(SAFE_GLOBALS)];
      const wrapped = `"use strict";\n${code}`;
      const fn = new Function(...paramNames, wrapped);
      const raw = fn(...paramValues);
      result = raw instanceof Promise ? await Promise.race([
        raw,
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout after 8s")), 8000)),
      ]) : raw;
    } catch (err: any) {
      execError = err?.message ?? String(err);
    }

    const resultStr = execError
      ? undefined
      : result !== undefined
        ? (typeof result === "object" ? JSON.stringify(result, null, 2) : String(result))
        : "(no return value)";

    return new Response(
      JSON.stringify({ result: resultStr, output, error: execError, provider: "js-sandbox" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
