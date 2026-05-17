import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Restricted set of globals exposed to executed code.
// No network, no file system, no Deno APIs — pure computation only.
const SAFE_GLOBALS = {
  Math, JSON, Date, Array, Object, Number, String, Boolean, parseInt, parseFloat,
  isNaN, isFinite, encodeURIComponent, decodeURIComponent,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { code } = await req.json();
    if (!code?.trim()) {
      return new Response(JSON.stringify({ error: "code required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      // Build a function with only safe globals in scope.
      // Using Function constructor (not eval) so strict mode is available.
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
      JSON.stringify({ result: resultStr, output, error: execError }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
