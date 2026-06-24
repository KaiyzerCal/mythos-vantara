// MAVIS Web Crawler + RAG
// Replaces the n8n "Deep Web Scrapper + RAG" workflow natively in Supabase Edge Functions.
//
// Actions (POST):
//   start          — seed a URL into the crawl queue and optionally start processing
//   process        — fetch and embed the next pending URL from the queue (call repeatedly)
//   recover        — retry errored URLs; permanently mark dead ones
//   query          — semantic search over embedded documents
//   status         — return queue stats
//
// POST { action: "start",   url: string,   user_id: string, process_now?: boolean }
// POST { action: "process", user_id: string, max?: number }
// POST { action: "recover", user_id: string }
// POST { action: "query",   user_id: string, query: string, match_count?: number }
// POST { action: "status",  user_id: string }
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   OPENAI_API / OPENAI_API_KEY  — for embeddings (text-embedding-3-small)
//   ANTHROPIC_API_KEY             — for PDF text extraction
//   GEMINI_API_KEY                — for PDF text extraction fallback

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY   = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_KEY   = Deno.env.get("GEMINI_API_KEY") ?? "";

const FUNCTIONS_URL = SB_URL + "/functions/v1";

const CHUNK_SIZE    = 800;
const CHUNK_OVERLAP = 200;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── Text chunking ─────────────────────────────────────────────────────────────

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
    i += CHUNK_SIZE - CHUNK_OVERLAP;
    if (i < 0) break;
  }
  return chunks.filter(c => c.trim().length > 20);
}

// ── OpenAI embedding ──────────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// ── Query embedding ───────────────────────────────────────────────────────────

async function queryEmbedding(text: string): Promise<number[] | null> {
  return embedText(text);
}

// ── HTML parsing — extract text, internal links, emails ───────────────────────

interface PageData {
  text: string;
  links: string[];
  emails: string[];
}

function extractPageData(html: string, baseDomain: string): PageData {
  const links = new Set<string>();
  const emails = new Set<string>();

  // Extract <a href="..."> relative + PDF absolute
  html.replace(/<a\b[^>]*href=["']([^"']+)["']/gi, (_, href: string) => {
    href = href.trim();
    const skip = /login|signup|signin|password|logout|register|auth|#|javascript:|mailto:/i.test(href);
    if (!skip) {
      if (href.startsWith("/") && href !== "/") links.add(baseDomain + href);
      else if (/^https?:\/\/.+\.pdf$/i.test(href)) links.add(href);
    }
    return "";
  });

  // Extract url: "/..." from JS blocks
  html.replace(/url\s*:\s*["']([^"']+)["']/gi, (_, url: string) => {
    url = url.trim();
    if (url.startsWith("/") && url !== "/") links.add(baseDomain + url);
    else if (/^https?:\/\/.+\.pdf$/i.test(url)) links.add(url);
    return "";
  });

  // Extract emails from entire HTML
  const emailMatches = html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-z]{2,}/gi) ?? [];
  for (const e of emailMatches) emails.add(e.toLowerCase());

  // Strip to visible text
  let visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { text: visible, links: Array.from(links), emails: Array.from(emails) };
}

// ── PDF text extraction via Claude ────────────────────────────────────────────

async function extractPdfText(pdfUrl: string): Promise<string> {
  if (!ANTHROPIC_KEY) return `[PDF at ${pdfUrl} — add ANTHROPIC_API_KEY to extract text]`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "url", url: pdfUrl } },
            { type: "text", text: "Extract and return all text content from this PDF. Output only the raw text, no commentary." },
          ],
        }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return `[PDF extraction failed: HTTP ${res.status}]`;
    const d = await res.json();
    return d.content?.[0]?.text ?? "[PDF: no text extracted]";
  } catch (err: any) {
    return `[PDF extraction error: ${err.message}]`;
  }
}

// ── Embed + store chunks in mavis_documents ───────────────────────────────────

async function storeChunks(
  sb: ReturnType<typeof createClient>,
  userId: string,
  text: string,
  metadata: Record<string, unknown>,
): Promise<number> {
  const chunks = chunkText(text);
  let stored = 0;
  for (const chunk of chunks) {
    const embedding = await embedText(chunk);
    const { error } = await sb.from("mavis_documents" as any).insert({
      user_id: userId,
      content: chunk,
      metadata,
      embedding: embedding ? JSON.stringify(embedding) : null,
    });
    if (!error) stored++;
  }
  return stored;
}

// ── Normalise domain ──────────────────────────────────────────────────────────

function getDomain(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function actionStart(sb: ReturnType<typeof createClient>, userId: string, url: string, processNow: boolean) {
  const domain = getDomain(url);

  // Upsert seed URL into queue
  await sb.from("mavis_scrape_queue" as any).upsert({
    user_id: userId, link: url, domain, status: "created",
  }, { onConflict: "user_id,link" });

  if (processNow) {
    return actionProcess(sb, userId, 1);
  }
  return { queued: url, domain, message: "Seed URL queued. Call action=process to begin crawling." };
}

async function actionProcess(
  sb: ReturnType<typeof createClient>,
  userId: string,
  maxUrls = 1,
): Promise<Record<string, unknown>> {
  const processed: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < maxUrls; i++) {
    // Pick next pending URL
    const { data: rows } = await sb
      .from("mavis_scrape_queue" as any)
      .select("id, link, domain")
      .eq("user_id", userId)
      .eq("status", "created")
      .order("id", { ascending: true })
      .limit(1);

    const row = (rows as any[])?.[0];
    if (!row) break;

    // Mark as processing
    await sb.from("mavis_scrape_queue" as any)
      .update({ status: "processing" }).eq("id", row.id);

    const isPdf = /\.pdf$/i.test(row.link);

    try {
      if (isPdf) {
        // ── PDF path ────────────────────────────────────────────────────────
        const pdfText = await extractPdfText(row.link);
        await storeChunks(sb, userId, pdfText, {
          source: row.link, domain: row.domain, type: "pdf",
        });
        await sb.from("mavis_scrape_queue" as any)
          .update({ status: "done" }).eq("id", row.id);
      } else {
        // ── HTML path ───────────────────────────────────────────────────────
        const pageRes = await fetch(row.link, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; MAVIS-Crawler/1.0)",
            Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(15000),
          redirect: "follow",
        });

        if (!pageRes.ok) {
          await sb.from("mavis_scrape_queue" as any)
            .update({ status: `dead-${pageRes.status}` }).eq("id", row.id);
          errors.push(`${row.link}: HTTP ${pageRes.status}`);
          continue;
        }

        const html = await pageRes.text();
        const { text, links, emails } = extractPageData(html, row.domain);

        // Store emails on queue row
        if (emails.length) {
          await sb.from("mavis_scrape_queue" as any)
            .update({ emails }).eq("id", row.id);
        }

        // Embed and store page content
        if (text.length > 50) {
          await storeChunks(sb, userId, text, {
            source: row.link, domain: row.domain, type: "html",
          });
        }

        // Enqueue newly discovered internal links (deduplicate via unique index)
        if (links.length > 0) {
          const inserts = links.map(l => ({
            user_id: userId,
            link: l,
            domain: row.domain,
            status: "created",
          }));
          await sb.from("mavis_scrape_queue" as any)
            .upsert(inserts, { onConflict: "user_id,link", ignoreDuplicates: true })
            .catch(() => {});
        }

        await sb.from("mavis_scrape_queue" as any)
          .update({ status: "done" }).eq("id", row.id);
      }

      processed.push(row.link);
    } catch (err: any) {
      await sb.from("mavis_scrape_queue" as any)
        .update({ status: "error" }).eq("id", row.id);
      errors.push(`${row.link}: ${err.message}`);
    }

    // Rate-limit — 1 second between pages
    if (i < maxUrls - 1) await new Promise(r => setTimeout(r, 1000));
  }

  // Queue stats
  const { count: remaining } = await sb
    .from("mavis_scrape_queue" as any)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "created");

  return {
    processed: processed.length,
    urls: processed,
    errors,
    remaining: remaining ?? 0,
    message: remaining ? `${remaining} URLs still pending. Call process again to continue.` : "Queue empty.",
  };
}

async function actionRecover(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<Record<string, unknown>> {
  const { data: errorRows } = await sb
    .from("mavis_scrape_queue" as any)
    .select("id, link")
    .eq("user_id", userId)
    .eq("status", "error")
    .limit(10);

  if (!errorRows?.length) return { message: "No error URLs to recover." };

  let reactivated = 0, dead = 0;

  for (const row of errorRows as any[]) {
    try {
      const res = await fetch(row.link, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MAVIS-Crawler/1.0)" },
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });
      if (res.ok) {
        await sb.from("mavis_scrape_queue" as any)
          .update({ status: "created" }).eq("id", row.id);
        reactivated++;
      } else {
        await sb.from("mavis_scrape_queue" as any)
          .update({ status: `dead-${res.status}` }).eq("id", row.id);
        dead++;
      }
    } catch {
      await sb.from("mavis_scrape_queue" as any)
        .update({ status: "dead-timeout" }).eq("id", row.id);
      dead++;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  return { reactivated, dead, message: `${reactivated} reactivated, ${dead} permanently marked dead.` };
}

async function actionQuery(
  sb: ReturnType<typeof createClient>,
  userId: string,
  query: string,
  matchCount: number,
): Promise<Record<string, unknown>> {
  const embedding = await queryEmbedding(query);

  if (!embedding) {
    // Fall back to text search
    const { data } = await sb
      .from("mavis_documents" as any)
      .select("content, metadata")
      .eq("user_id", userId)
      .ilike("content", `%${query.slice(0, 50)}%`)
      .limit(matchCount);
    return { results: data ?? [], method: "text_search", note: "Add OPENAI_API_KEY for semantic search" };
  }

  const { data, error } = await sb.rpc("match_documents", {
    query_embedding: JSON.stringify(embedding),
    match_user_id: userId,
    match_count: matchCount,
  });

  if (error) throw new Error(error.message);
  return { results: data ?? [], method: "vector_search" };
}

async function actionStatus(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<Record<string, unknown>> {
  const [created, processing, done, error, docs] = await Promise.all([
    sb.from("mavis_scrape_queue" as any).select("*", { count: "exact", head: true }).eq("user_id", userId).eq("status", "created"),
    sb.from("mavis_scrape_queue" as any).select("*", { count: "exact", head: true }).eq("user_id", userId).eq("status", "processing"),
    sb.from("mavis_scrape_queue" as any).select("*", { count: "exact", head: true }).eq("user_id", userId).eq("status", "done"),
    sb.from("mavis_scrape_queue" as any).select("*", { count: "exact", head: true }).eq("user_id", userId).eq("status", "error"),
    sb.from("mavis_documents" as any).select("*", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  return {
    queue: {
      pending:    created.count    ?? 0,
      processing: processing.count ?? 0,
      done:       done.count       ?? 0,
      error:      error.count      ?? 0,
    },
    documents: docs.count ?? 0,
    embeddings_enabled: !!OPENAI_KEY,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const action  = String(body.action ?? "status");
  const userId  = String(body.user_id ?? "");
  if (!userId)  return json({ error: "user_id required" }, 400);

  const sb = createClient(SB_URL, SERVICE_KEY);

  try {
    switch (action) {
      case "start": {
        const url = String(body.url ?? "").trim();
        if (!url.startsWith("http")) return json({ error: "url required (must start with http)" }, 400);
        return json(await actionStart(sb, userId, url, body.process_now === true));
      }
      case "process": {
        const max = Math.min(Number(body.max ?? 1), 20);
        return json(await actionProcess(sb, userId, max));
      }
      case "recover": {
        return json(await actionRecover(sb, userId));
      }
      case "query": {
        const query = String(body.query ?? "").trim();
        if (!query) return json({ error: "query required" }, 400);
        const matchCount = Math.min(Number(body.match_count ?? 5), 20);
        return json(await actionQuery(sb, userId, query, matchCount));
      }
      case "status": {
        return json(await actionStatus(sb, userId));
      }
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("mavis-web-crawler error:", err.message);
    return json({ error: err.message }, 500);
  }
});
