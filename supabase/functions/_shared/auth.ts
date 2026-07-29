// Shared auth helpers for MAVIS edge functions.
//
// Background: many functions previously fell back to TELEGRAM_OPERATOR_USER_ID
// whenever no (or an invalid) Authorization header was present, with no check
// that the caller was actually trusted. Since most of these functions also had
// verify_jwt = false in config.toml, that meant anyone who found the function's
// public URL got full operator-level access with zero credentials.
//
// Fix: require proof of being a trusted caller before ever resolving to the
// operator's uid. Two kinds of trusted caller exist in this codebase:
//   1. A real end user, proven via a valid Supabase JWT.
//   2. Internal automation (pg_cron, etc.), proven by presenting the exact
//      SUPABASE_SERVICE_ROLE_KEY as a Bearer token — this is not a new
//      mechanism, it's the same secret mavis-cron-setup already embeds as the
//      Authorization header when it registers scheduled jobs via net.http_post.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

function extractBearer(req: Request): string {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

/** True only if the request presents the exact service-role key as its Bearer token. */
export function isServiceRoleCaller(req: Request): boolean {
  const bearer = extractBearer(req);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return !!serviceKey && !!bearer && bearer === serviceKey;
}

/**
 * Resolves the acting user id for a request that may come from either an
 * end user (real JWT) or trusted internal automation (service-role key).
 *
 * Returns null if neither check passes — callers MUST treat that as
 * unauthenticated and return 401, never silently default to the operator.
 */
export async function resolveAuthedUid(
  req: Request,
  adminSb: SupabaseClient,
): Promise<string | null> {
  const bearer = extractBearer(req);
  if (!bearer) return null;

  if (isServiceRoleCaller(req)) {
    return Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? null;
  }

  const { data, error } = await adminSb.auth.getUser(bearer);
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

/**
 * For operator-only automation endpoints (cron jobs, background workers)
 * that have no per-request user concept: require the exact service-role key
 * and resolve straight to the operator uid, or return null.
 */
export function resolveOperatorUid(req: Request): string | null {
  if (!isServiceRoleCaller(req)) return null;
  return Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? null;
}
