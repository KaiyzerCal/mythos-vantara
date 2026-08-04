// Temporary diagnostic: reports a non-reversible fingerprint of the runtime
// SUPABASE_SERVICE_ROLE_KEY so cron auth mismatches can be diagnosed.
// Never returns the key itself.

const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function fp(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

Deno.serve(async (req) => {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return new Response(
    JSON.stringify({
      env_len: key.length,
      env_fp: await fp(key),
      bearer_len: bearer.length,
      bearer_fp: await fp(bearer),
      match: bearer === key,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
