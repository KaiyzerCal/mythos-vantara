/**
 * MAVIS Local Embeddings — BM25 vector store for on-device semantic search.
 *
 * Pattern from OpenJarvis's knowledge retrieval:
 *   - BM25 ranking (no external ML deps, pure JS)
 *   - IndexedDB persistence so index survives page reloads
 *   - Portable to any device — works offline immediately
 *   - Paves the way for true vector embeddings when local hardware arrives
 *     (swap scoreBM25 for cosine similarity against local embedding model)
 *
 * Usage:
 *   await indexDocuments(vaultEntries);
 *   const results = await searchLocal("meditation and focus", 5);
 */

export interface EmbeddingDoc {
  id: string;
  title: string;
  content: string;
  category?: string;
  source: "vault" | "journal" | "knowledge" | "skill" | "quest";
  updatedAt?: string;
}

export interface SearchResult {
  doc: EmbeddingDoc;
  score: number;
}

// ── IndexedDB setup ───────────────────────────────────────────
const DB_NAME = "mavis-local-embeddings";
const STORE   = "docs";
const VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbPut(docs: EmbeddingDoc[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const doc of docs) store.put(doc);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function dbGetAll(): Promise<EmbeddingDoc[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror   = () => reject(req.error);
  });
}

async function dbClear(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ── Text tokenization ─────────────────────────────────────────
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

// ── BM25 scoring (k1=1.5, b=0.75) ────────────────────────────
const K1 = 1.5;
const B  = 0.75;

function scoreBM25(
  queryTokens: string[],
  docTokens: string[],
  avgDocLen: number,
  docFreq: Map<string, number>,
  N: number,
): number {
  const tf = new Map<string, number>();
  for (const t of docTokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const docLen = docTokens.length;

  let score = 0;
  for (const qt of queryTokens) {
    const tfScore = tf.get(qt) ?? 0;
    if (tfScore === 0) continue;
    const df = docFreq.get(qt) ?? 0;
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (tfScore * (K1 + 1)) / (tfScore + K1 * (1 - B + B * (docLen / avgDocLen)));
    score += idf * tfNorm;
  }
  return score;
}

// ── Public API ────────────────────────────────────────────────

/** Index documents into the local store. Replaces any existing doc with same id. */
export async function indexDocuments(docs: EmbeddingDoc[]): Promise<void> {
  if (!docs.length) return;
  await dbPut(docs);
}

/** Convenience: index vault or journal entries from AppContextSnapshot fields. */
export function formatVaultDocs(entries: any[], source: EmbeddingDoc["source"] = "vault"): EmbeddingDoc[] {
  return entries.map((e) => ({
    id: e.id,
    title: e.title ?? "(untitled)",
    content: `${e.title ?? ""} ${e.content ?? ""}`,
    category: e.category,
    source,
    updatedAt: e.updated_at ?? e.created_at,
  }));
}

/**
 * Search the local store using BM25 ranking.
 * Returns up to topK results sorted by relevance score.
 */
export async function searchLocal(query: string, topK = 5): Promise<SearchResult[]> {
  const all = await dbGetAll();
  if (!all.length) return [];

  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  // Pre-compute document frequencies and average length
  const docFreq = new Map<string, number>();
  let totalLen = 0;
  const tokenized = all.map((doc) => {
    const tokens = tokenize(doc.content);
    totalLen += tokens.length;
    for (const t of new Set(tokens)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    return tokens;
  });

  const avgDocLen = totalLen / all.length;
  const N = all.length;

  const scored = all.map((doc, i) => ({
    doc,
    score: scoreBM25(queryTokens, tokenized[i], avgDocLen, docFreq, N),
  }));

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Total number of documents in the local index. */
export async function getIndexSize(): Promise<number> {
  const all = await dbGetAll();
  return all.length;
}

/** Wipe the entire local index. */
export async function clearIndex(): Promise<void> {
  await dbClear();
}

/**
 * Rebuild the index from a full app context snapshot.
 * Call this after every successful cloud sync to keep local search up to date.
 */
export async function rebuildIndexFromSnapshot(snapshot: {
  vaultEntries?: any[];
  journalEntries?: any[];
  quests?: any[];
  skills?: any[];
}): Promise<number> {
  const docs: EmbeddingDoc[] = [
    ...formatVaultDocs(snapshot.vaultEntries ?? [], "vault"),
    ...formatVaultDocs(snapshot.journalEntries ?? [], "journal"),
    ...(snapshot.quests ?? []).map((q: any): EmbeddingDoc => ({
      id: q.id,
      title: q.title,
      content: `${q.title} ${q.description ?? ""} ${q.type} ${q.status}`,
      category: q.type,
      source: "quest",
    })),
    ...(snapshot.skills ?? []).map((s: any): EmbeddingDoc => ({
      id: s.id,
      title: s.name,
      content: `${s.name} ${s.description ?? ""} ${s.category}`,
      category: s.category,
      source: "skill",
    })),
  ];

  await dbClear();
  await dbPut(docs);
  return docs.length;
}
