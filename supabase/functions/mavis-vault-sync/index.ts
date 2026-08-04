// Temporary one-shot: copies the edge runtime's own SUPABASE_SERVICE_ROLE_KEY
// into the database vault so pg_cron jobs send a bearer token that matches the
// runtime gate. Never returns the key. Deleted immediately after use.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

Deno.serve(async () => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);
  const { error } = await sb.rpc("__vault_secret_write", {
    p_name: "service_role_key",
    p_value: key,
  });
  return new Response(JSON.stringify({ ok: !error, error: error?.message ?? null, len: key.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
