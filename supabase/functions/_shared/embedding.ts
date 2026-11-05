// One embedding call, one dimension, for everything that searches semantically.
//
// The dimension is the whole reason this is shared. Every vector column in
// this database is vector(1536), which is OpenAI text-embedding-3-small's
// size. Embedding a query with a model that emits anything else does not
// return poor results — the query simply errors or, worse, silently matches
// nothing, which is indistinguishable from "the operator has written nothing
// about that". Half a dozen functions had already open-coded this call; the
// risk is that one of them quietly drifts to a different model.
//
// The key is read under both names the codebase uses. mavis-chat reads
// OPENAI_API to prefer it over OPENAI_API_KEY, so this matches that order
// rather than inventing a third convention.

/**
 * The default dimension — what journal, vault, quests, meeting notes,
 * notebooks and mavis_notes all declare.
 *
 * It is NOT universal. The older memory tables were built against different
 * models and declare narrower vectors:
 *
 *   mavis_memory          vector(384)   built for Supabase's gte-small
 *   mavis_agent_memories  vector(768)
 *
 * text-embedding-3-small can emit any of these natively via the `dimensions`
 * parameter (Matryoshka representation learning), so one API and one key
 * still serve every table — pass the column's width and the vector fits.
 * Writing a 1536 vector into a vector(384) column is rejected outright, so
 * this is a correctness requirement, not a tuning knob.
 */
export const EMBEDDING_DIMS = 1536;
const MODEL = "text-embedding-3-small";
/** Beyond this the model truncates anyway; sending more just costs latency. */
const MAX_INPUT_CHARS = 8000;
const TIMEOUT_MS = 8_000;

export function embeddingKey(): string {
  return Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
}

// Why the most recent embedText call returned null. embedText deliberately
// degrades to null (callers fall back to keyword search), but that made every
// cause look identical: when the OpenAI account ran out of credit on
// 2026-10-30, the backfill reported "embedded 0, failed 100" every five
// minutes for six days with nothing in the logs saying why. This keeps the
// cause where a caller can report it, and the log line below puts it where
// someone will read it.
let lastFailure: { reason: string; at: number } | null = null;
let lastLoggedAt = 0;
const LOG_EVERY_MS = 60_000;

function recordFailure(reason: string): void {
  lastFailure = { reason, at: Date.now() };
  // A backfill batch can fail 100 times in a row for one cause; one line a
  // minute is enough to find it without drowning the log.
  if (Date.now() - lastLoggedAt >= LOG_EVERY_MS) {
    lastLoggedAt = Date.now();
    console.error(`[embedding] embedText failing: ${reason}`);
  }
}

/** The reason the latest embedText call failed, or null if it last succeeded. */
export function lastEmbeddingFailure(): string | null {
  return lastFailure?.reason ?? null;
}

/**
 * A query or document embedding, or null when one cannot be produced.
 *
 * Null rather than throwing: every caller treats semantic search as an
 * enhancement over keyword search, and a missing key or a slow embedding
 * endpoint must degrade to keyword results rather than fail the reply.
 */
export async function embedText(text: string, dims: number = EMBEDDING_DIMS): Promise<number[] | null> {
  const key = embeddingKey();
  const input = (text ?? "").trim();
  if (input.length === 0) return null;
  if (!key) {
    recordFailure("no OpenAI key set (OPENAI_API / OPENAI_API_KEY)");
    return null;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        input: input.slice(0, MAX_INPUT_CHARS),
        // Omitted at the default so the request stays byte-identical to what
        // every existing caller already sends.
        ...(dims !== EMBEDDING_DIMS ? { dimensions: dims } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // Status + OpenAI's machine-readable code/type only. Never the error
      // message: for invalid_api_key it quotes part of the key.
      const err = await res.json().then((j) => j?.error).catch(() => null);
      const detail = [err?.code, err?.type].filter(Boolean).join("/");
      recordFailure(`OpenAI HTTP ${res.status}${detail ? ` ${detail}` : ""}`);
      return null;
    }
    const data = await res.json();
    const vec = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) {
      recordFailure("OpenAI response had no embedding");
      return null;
    }
    // A wrong-length vector would be rejected by Postgres on write and match
    // nothing on read. Refusing it here turns a confusing failure into a
    // clean fall back to keyword search.
    if (vec.length !== dims) {
      console.warn(`[embedding] expected ${dims} dims, got ${vec.length} — ignoring`);
      recordFailure(`dimension mismatch: expected ${dims}, got ${vec.length}`);
      return null;
    }
    lastFailure = null;
    return vec as number[];
  } catch (err) {
    recordFailure(`request failed: ${(err as Error)?.name ?? "error"}`);
    return null;
  }
}

/** What gets embedded for a row: its title carries most of the signal. */
export function embeddableText(title: unknown, body: unknown): string {
  const t = String(title ?? "").trim();
  const b = String(body ?? "").trim();
  return t && b ? `${t}\n\n${b}` : t || b;
}
