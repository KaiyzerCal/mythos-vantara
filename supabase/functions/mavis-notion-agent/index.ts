// mavis-notion-agent
// Create pages, query databases, append content blocks, and search Notion.
// Requires: NOTION_API_KEY (Internal Integration Token — secret_...)
//
// Actions: create_page | update_page | get_page | query_database | append_blocks | search

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOTION_TOKEN = Deno.env.get("NOTION_API_KEY") ?? "";
const NOTION_VER   = "2022-06-28";
const NOTION_API   = "https://api.notion.com/v1";

function requireNotion() {
  if (!NOTION_TOKEN) throw new Error("Notion not configured. Set NOTION_API_KEY in Supabase secrets.");
}

async function notionReq(path: string, method = "GET", body?: unknown): Promise<any> {
  requireNotion();
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VER,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.object === "error") throw new Error(`Notion API error (${data.status}): ${data.message}`);
  return data;
}

// Build a simple paragraph block from text
function textBlocks(content: string): unknown[] {
  return content.split("\n\n").filter(Boolean).map(para => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: para.slice(0, 2000) } }],
    },
  }));
}

// Build a rich_text title property
function titleProp(text: string) {
  return { title: [{ type: "text", text: { content: String(text).slice(0, 2000) } }] };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    switch (action) {
      case "create_page": {
        const title = String(body.title ?? "Untitled");
        const content = body.content ? String(body.content) : undefined;

        // Determine parent — database or page
        const parent = body.database_id
          ? { database_id: String(body.database_id) }
          : body.parent_id
          ? { page_id: String(body.parent_id) }
          : null;
        if (!parent) return json({ error: "database_id or parent_id required" }, 400);

        // Build properties — for DB pages use the DB's title column; for page children, use title
        const properties: Record<string, unknown> = body.database_id
          ? {
              // Try "Name" first (common), caller can pass title_prop to override
              [String(body.title_prop ?? "Name")]: titleProp(title),
              ...(body.properties as Record<string, unknown> ?? {}),
            }
          : { title: titleProp(title) };

        const children = content
          ? textBlocks(content)
          : Array.isArray(body.blocks)
          ? body.blocks as unknown[]
          : [];

        const page = await notionReq("/pages", "POST", { parent, properties, children });
        return json({ page_id: page.id, url: page.url, title });
      }

      case "update_page": {
        const pageId = String(body.page_id ?? body.id ?? "");
        if (!pageId) return json({ error: "page_id required" }, 400);

        const updates: Record<string, unknown> = {};
        if (body.title) updates[String(body.title_prop ?? "title")] = titleProp(String(body.title));
        if (body.properties) Object.assign(updates, body.properties as Record<string, unknown>);

        const payload: Record<string, unknown> = { properties: updates };
        if (body.archived !== undefined) payload.archived = Boolean(body.archived);

        const page = await notionReq(`/pages/${pageId}`, "PATCH", payload);
        return json({ page_id: page.id, url: page.url, archived: page.archived });
      }

      case "get_page": {
        const pageId = String(body.page_id ?? body.id ?? "");
        if (!pageId) return json({ error: "page_id required" }, 400);
        const page = await notionReq(`/pages/${pageId}`);
        // Also fetch first block children for content preview
        const blocks = await notionReq(`/blocks/${pageId}/children?page_size=10`);
        return json({ page, blocks: blocks.results });
      }

      case "query_database": {
        const dbId = String(body.database_id ?? body.id ?? "");
        if (!dbId) return json({ error: "database_id required" }, 400);

        const queryBody: Record<string, unknown> = {};
        if (body.filter)    queryBody.filter    = body.filter;
        if (body.sorts)     queryBody.sorts     = body.sorts;
        if (body.page_size) queryBody.page_size = Math.min(Number(body.page_size), 100);
        if (body.start_cursor) queryBody.start_cursor = body.start_cursor;

        const result = await notionReq(`/databases/${dbId}/query`, "POST", queryBody);
        return json({
          results: result.results,
          has_more: result.has_more,
          next_cursor: result.next_cursor,
        });
      }

      case "append_blocks": {
        const blockId = String(body.block_id ?? body.page_id ?? body.id ?? "");
        const content = String(body.content ?? "");
        if (!blockId) return json({ error: "block_id or page_id required" }, 400);

        const children = content
          ? textBlocks(content)
          : Array.isArray(body.blocks)
          ? body.blocks as unknown[]
          : [];

        if (children.length === 0) return json({ error: "content or blocks required" }, 400);
        const result = await notionReq(`/blocks/${blockId}/children`, "PATCH", { children });
        return json({ appended: result.results?.length ?? 0, block_id: blockId });
      }

      case "search": {
        const query = String(body.query ?? "");
        const filter = body.filter_type
          ? { property: "object", value: String(body.filter_type) }
          : undefined;

        const result = await notionReq("/search", "POST", {
          query,
          ...(filter ? { filter } : {}),
          page_size: Math.min(Number(body.page_size ?? 10), 25),
        });

        return json({
          results: (result.results as any[]).map(r => ({
            id: r.id,
            type: r.object,
            title: r.properties?.title?.title?.[0]?.text?.content
              ?? r.properties?.Name?.title?.[0]?.text?.content
              ?? r.title?.[0]?.text?.content
              ?? "(untitled)",
            url: r.url,
            last_edited: r.last_edited_time,
          })),
          has_more: result.has_more,
        });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: create_page | update_page | get_page | query_database | append_blocks | search`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-notion-agent]", message);
    const status = message.includes("not configured") ? 503 : 500;
    return json({ error: message }, status);
  }
});
