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

/** The dimension every vector column in this database is declared with. */
export const EMBEDDING_DIMS = 1536;
const MODEL = "text-embedding-3-small";
/** Beyond this the model truncates anyway; sending more just costs latency. */
const MAX_INPUT_CHARS = 8000;
const TIMEOUT_MS = 8_000;

export function embeddingKey(): string {
  return Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
}

/**
 * A query or document embedding, or null when one cannot be produced.
 *
 * Null rather than throwing: every caller treats semantic search as an
 * enhancement over keyword search, and a missing key or a slow embedding
 * endpoint must degrade to keyword results rather than fail the reply.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const key = embeddingKey();
  const input = (text ?? "").trim();
  if (!key || input.length === 0) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, input: input.slice(0, MAX_INPUT_CHARS) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const vec = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) return null;
    // A wrong-length vector would be rejected by Postgres on write and match
    // nothing on read. Refusing it here turns a confusing failure into a
    // clean fall back to keyword search.
    if (vec.length !== EMBEDDING_DIMS) {
      console.warn(`[embedding] expected ${EMBEDDING_DIMS} dims, got ${vec.length} — ignoring`);
      return null;
    }
    return vec as number[];
  } catch {
    return null;
  }
}

/** What gets embedded for a row: its title carries most of the signal. */
export function embeddableText(title: unknown, body: unknown): string {
  const t = String(title ?? "").trim();
  const b = String(body ?? "").trim();
  return t && b ? `${t}\n\n${b}` : t || b;
}
