import type { FunctionsError } from "@supabase/supabase-js";

/**
 * Pulls the real message out of a failed `supabase.functions.invoke`.
 *
 * On a non-2xx the client throws a FunctionsHttpError whose `.message` is the
 * fixed string "Edge Function returned a non-2xx status code" — identical
 * whether the function rejected the input, could not find the record, or blew
 * up internally. The response body, which is where our functions actually put
 * `{ error: "..." }`, hangs off `.context` and is discarded unless read.
 *
 * Reporting the generic string makes every edge failure look the same to the
 * operator and to us. This reads the body when there is one and falls back to
 * the generic message when there isn't.
 */
export async function edgeErrorMessage(error: FunctionsError | Error | null): Promise<string> {
  if (!error) return "Unknown error";
  const fallback = error.message || "Unknown error";
  try {
    // `context` is the raw Response on FunctionsHttpError. It is absent on
    // FunctionsFetchError (network) and FunctionsRelayError.
    const context = (error as unknown as { context?: Response }).context;
    const body = await context?.json?.();
    if (typeof body?.error === "string" && body.error) return body.error;
    if (typeof body?.message === "string" && body.message) return body.message;
  } catch {
    // Body already consumed, empty, or not JSON — the generic message is all
    // we have.
  }
  return fallback;
}
