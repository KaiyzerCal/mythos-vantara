// mavis-notion-sync
// Pulls Notion pages into MAVIS memory (mavis_agent_memories).
// Skips pages whose last_edited_time hasn't changed since last sync.
// Called by mavis-actions "notion_sync" or directly on a schedule.
//
// POST body: { user_id: string, query?: string, max_pages?: number }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL   = Deno.env.get("SUPABASE_URL")!;
const SB_SRK   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOTION_TOKEN = Deno.env.get("NOTION_API_KEY") ?? "";
const NOTION_VER   = "2022-06-28";
const NOTION_API   = "https://api.notion.com/v1";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ── Notion helpers ────────────────────────────────────────────

async function notionReq(path: string, method = "GET", body?: unknown): Promise<any> {
  if (!NOTION_TOKEN) throw new Error("Notion not configured. Set NOTION_API_KEY in Supabase secrets.");
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VER,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.object === "error") throw new Error(`Notion ${data.status}: ${data.message}`);
  return data;
}

// Extract plain text from a list of Notion block objects
function extractBlockText(blocks: any[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    const type = b.type as string;
    const rt = (b[type]?.rich_text ?? []) as any[];
    const text = rt.map((r: any) => r.plain_text ?? "").join("");
    if (text) lines.push(text);
  }
  return lines.join("\n");
}

// Get page title from Notion page object
function getPageTitle(page: any): string {
  const props = page.properties ?? {};
  for (const key of ["title", "Title", "Name", "name"]) {
    const p = props[key];
    if (p?.type === "title" && p.title?.length) {
      return p.title.map((r: any) => r.plain_text ?? "").join("");
    }
  }
  // Fallback: check page.title (database pages)
  if (page.title?.length) {
    return page.title.map((r: any) => r.plain_text ?? "").join("");
  }
  return "(Untitled)";
}

// Fetch all text content from a page (first 50 blocks)
async function fetchPageContent(pageId: string): Promise<string> {
  try {
    const res = await notionReq(`/blocks/${pageId}/children?page_size=50`);
    return extractBlockText(res.results ?? []);
  } catch {
    return "";
  }
}

// ── Main handler ──────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body      = await req.json().catch(() => ({}));
    const userId    = String(body.user_id ?? "");
    const query     = String(body.query ?? "");
    const maxPages  = Math.min(Number(body.max_pages ?? 50), 100);

    if (!userId) return json({ error: "user_id required" }, 400);

    const sb = createClient(SB_URL, SB_SRK);

    // ── 1. Search Notion for all accessible pages ──────────
    const searchPayload: Record<string, unknown> = {
      filter: { property: "object", value: "page" },
      page_size: maxPages,
      sort: { direction: "descending", timestamp: "last_edited_time" },
    };
    if (query) searchPayload.query = query;

    const searchResult = await notionReq("/search", "POST", searchPayload);
    const pages: any[] = searchResult.results ?? [];

    if (pages.length === 0) return json({ synced: 0, skipped: 0, total: 0, pages: [] });

    // ── 2. Load existing sync log for this user ────────────
    const { data: logRows } = await sb
      .from("mavis_notion_sync_log")
      .select("notion_page_id, last_edited, memory_id")
      .eq("user_id", userId);

    const syncMap = new Map<string, { last_edited: string; memory_id: string | null }>(
      (logRows ?? []).map((r: any) => [r.notion_page_id, { last_edited: r.last_edited, memory_id: r.memory_id }])
    );

    // ── 3. Process pages ───────────────────────────────────
    let synced = 0;
    let skipped = 0;
    const syncedPages: { title: string; url: string }[] = [];

    for (const page of pages) {
      const pageId    = String(page.id ?? "");
      const lastEdited = String(page.last_edited_time ?? "");
      const title     = getPageTitle(page);
      const url       = String(page.url ?? "");

      // Skip if unchanged
      const existing = syncMap.get(pageId);
      if (existing && existing.last_edited === lastEdited) {
        skipped++;
        continue;
      }

      // Fetch page content (blocks)
      const content = await fetchPageContent(pageId);
      if (!content.trim()) {
        skipped++;
        continue;
      }

      const memoryContent = `[Notion: ${title}]\n\n${content}`.slice(0, 8000);

      // Upsert into mavis_agent_memories
      const memPayload = {
        user_id:     userId,
        agent_id:    "plugin/notion",
        agent_name:  "Notion Sync",
        agent_type:  "plugin",
        entity_type: "fact",
        memory_type: "semantic",
        content:     memoryContent,
        summary:     title.slice(0, 500),
        tags:        ["notion", "knowledge-base"],
        importance:  6,
        confidence:  8,
        status:      "active",
        updated_at:  new Date().toISOString(),
      };

      let memoryId: string | null = existing?.memory_id ?? null;

      if (memoryId) {
        // Update existing memory row
        await sb.from("mavis_agent_memories").update(memPayload).eq("id", memoryId);
      } else {
        // Insert new memory row
        const { data: inserted } = await sb
          .from("mavis_agent_memories")
          .insert(memPayload)
          .select("id")
          .single();
        memoryId = inserted?.id ?? null;
      }

      // Upsert sync log
      await sb.from("mavis_notion_sync_log").upsert(
        {
          user_id:       userId,
          notion_page_id: pageId,
          page_title:    title,
          page_url:      url,
          last_edited:   lastEdited,
          synced_at:     new Date().toISOString(),
          memory_id:     memoryId,
        },
        { onConflict: "user_id,notion_page_id" }
      );

      synced++;
      syncedPages.push({ title, url });
    }

    return json({
      synced,
      skipped,
      total: pages.length,
      pages: syncedPages,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-notion-sync]", message);
    const status = message.includes("not configured") ? 503 : 500;
    return json({ error: message }, status);
  }
});
